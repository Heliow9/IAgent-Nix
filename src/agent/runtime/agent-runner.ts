import { randomUUID } from 'node:crypto'

import type { RunEventBus } from '../../main/state/run-events'
import type { RunCheckpoint, SessionStore } from '../../main/state/session-store'
import type { AgentEvent, NixSettings, PermissionMode } from '../../shared/contracts'
import { ContextBuilder } from '../context/context-builder'
import { resolveConversationFollowUp } from '../context/follow-up-context'
import { compactMessagesForBudget, estimateRequestTokens } from '../context/context-budget'
import type { ModelMessage, ModelProvider, ModelToolDefinition, ReasoningEffort } from '../providers/model-provider'
import { selectReasoningEffort, type TaskRoute } from '../router/task-router'
import { ToolRegistry, ToolRegistryError } from '../tools/tool-registry'
import type { ApprovalPolicy } from './approval-policy'
import type { ChatTitleService } from '../titles/chat-title-service'
import type { SkillEngine } from '../skills/skill-engine'
import type { ProjectMemoryService } from '../../main/memory/project-memory'
import type { WorkspaceIntelligenceService } from '../../main/intelligence/workspace-intelligence'
import type { VerificationEngine } from '../verification/verification-engine'

interface AgentRunnerDependencies {
  provider: ModelProvider
  tools: ToolRegistry
  store: SessionStore
  eventBus: RunEventBus
  approvalPolicy: ApprovalPolicy
  deepModel: string
  fastModel?: string
  router?: { route(input: string, signal?: AbortSignal): Promise<TaskRoute>; routeLocal?(input: string): TaskRoute }
  contextBuilder?: ContextBuilder
  loadAttachment?: (path: string) => Promise<{ path: string; content: string }>
  applyProposal?: (proposalId: string) => Promise<unknown>
  titleService?: ChatTitleService
  skills?: SkillEngine
  memory?: ProjectMemoryService
  intelligence?: WorkspaceIntelligenceService
  verification?: VerificationEngine
  getWorkspaceRoot?: () => string
  getSettings?: () => NixSettings
}

interface StartInput {
  sessionId: string
  prompt: string
  permissionMode: PermissionMode
  attachedFiles?: string[]
  referencedChatIds?: string[]
}

type ApprovalDecision = 'approved' | 'rejected'

interface ActiveRun {
  controller: AbortController
  pendingApproval?: { id: string; resolve: (decision: ApprovalDecision) => void }
  approvalDecision?: ApprovalDecision
}

export class AgentRunner {
  private readonly active = new Map<string, ActiveRun>()
  private readonly settledListeners = new Set<(runId: string) => void>()

  constructor(private readonly dependencies: AgentRunnerDependencies) {}

  start(input: StartInput): { runId: string } {
    const runId = randomUUID()
    const active: ActiveRun = { controller: new AbortController() }
    this.active.set(runId, active)
    void this.execute(runId, input, active).catch(() => undefined)
    return { runId }
  }

  startPrepared(runId: string, input: StartInput): void {
    if (this.active.has(runId)) throw new Error('Run is already active')
    const active: ActiveRun = { controller: new AbortController() }
    this.active.set(runId, active)
    void this.execute(runId, input, active, undefined, true).catch(() => undefined)
  }

  onSettled(listener: (runId: string) => void): () => void {
    this.settledListeners.add(listener)
    return () => this.settledListeners.delete(listener)
  }

  resume(runId: string): { runId: string } {
    if (this.active.has(runId)) throw new Error('Run is already active')
    const checkpoint = this.dependencies.store.getCheckpoint(runId)
    if (!checkpoint?.safeToResume) throw new Error('Run does not have a safe checkpoint to resume')
    const active: ActiveRun = { controller: new AbortController() }
    this.active.set(runId, active)
    const input: StartInput = {
      sessionId: checkpoint.sessionId,
      prompt: checkpoint.prompt,
      permissionMode: checkpoint.permissionMode,
      referencedChatIds: checkpoint.referencedChatIds
    }
    void this.execute(runId, input, active, checkpoint).catch(() => undefined)
    return { runId }
  }

  resolveApproval(runId: string, approvalId: string, decision: ApprovalDecision): void {
    const pending = this.active.get(runId)?.pendingApproval
    if (!pending || pending.id !== approvalId) throw new Error('Approval is not pending for this run')
    pending.resolve(decision)
  }

  resolveAllApprovals(runId: string, decision: ApprovalDecision): void {
    const active = this.active.get(runId)
    if (!active) throw new Error('Run is not active')
    active.approvalDecision = decision
    active.pendingApproval?.resolve(decision)
  }

  cancel(runId: string): void {
    const active = this.active.get(runId)
    if (!active) return
    active.controller.abort()
    active.pendingApproval?.resolve('rejected')
  }

  private async execute(runId: string, input: StartInput, active: ActiveRun, restored?: RunCheckpoint, prepared = false): Promise<void> {
    const { store, provider, tools, approvalPolicy, deepModel } = this.dependencies
    const settings = this.dependencies.getSettings?.()
    let appliedChanges = false
    let verifiedAfterLastChange = false
    try {
      let model: string
      let reasoningEffort: ReasoningEffort
      let messages: ModelMessage[]
      let operationalPrompt = input.prompt
      let groundingPrompt = input.prompt
      if (restored) {
        model = restored.model
        reasoningEffort = restored.reasoningEffort ?? (settings?.reasoningMode && settings.reasoningMode !== 'auto' ? settings.reasoningMode : 'medium')
        messages = ensurePortugueseInstruction(structuredClone(restored.messages))
      } else {
        const history: ModelMessage[] = (store.getSession(input.sessionId)?.messages ?? [])
          .filter((message) => message.role === 'user' || message.role === 'assistant')
          .map((message) => ({ role: message.role, content: message.content }))
        if (prepared && history.at(-1)?.role === 'user' && history.at(-1)?.content === input.prompt) history.pop()
        const followUp = resolveConversationFollowUp(input.prompt, history)
        operationalPrompt = followUp.operationalPrompt
        groundingPrompt = followUp.groundingPrompt
        const route = settings?.modelRouting === 'auto' || !settings
          ? settings?.groqFreeTierMode && this.dependencies.router?.routeLocal
            ? this.dependencies.router.routeLocal(operationalPrompt)
            : await this.dependencies.router?.route(operationalPrompt, active.controller.signal)
          : undefined
        const requestedRoute = settings?.modelRouting === 'fast' ? 'fast' : settings?.modelRouting === 'deep' ? 'deep' : route?.route
        model = requestedRoute === 'fast' && this.dependencies.fastModel ? this.dependencies.fastModel : deepModel
        reasoningEffort = selectReasoningEffort(settings?.reasoningMode ?? 'auto', route)
        const attachedFiles: Array<{ path: string; content: string }> = []
        for (const path of input.attachedFiles ?? []) {
          try {
            if (this.dependencies.loadAttachment) attachedFiles.push(await this.dependencies.loadAttachment(path))
          } catch { /* an attachment can disappear between selection and send */ }
        }
        const workspaceRoot = this.dependencies.getWorkspaceRoot?.()
        if (workspaceRoot) {
          this.dependencies.skills?.setWorkspace(workspaceRoot)
          this.dependencies.intelligence?.setRoot(workspaceRoot)
        }
        const skillContext = this.dependencies.skills?.promptFragment(operationalPrompt, settings?.skillMode !== 'off' && settings?.superpowersEnabled !== false) ?? ''
        const memoryContext = workspaceRoot && this.dependencies.memory ? await this.dependencies.memory.context(workspaceRoot) : ''
        let intelligenceContext = ''
        if (this.dependencies.intelligence) {
          try { intelligenceContext = await this.dependencies.intelligence.overviewText() } catch { /* indexing is advisory */ }
        }
        const systemPrompt = [
          'You are NIX, a careful autonomous coding agent inside a visual IDE. Always answer the user in Brazilian Portuguese, including progress explanations, errors, and the final response.',
          'Operate as an engineering loop: understand -> inspect -> plan -> implement -> verify -> review -> summarize. For complex work, use delegate_task with planner/reviewer/debugger/tester/architect roles when an independent pass improves reliability.',
          'Resolve references such as "esse arquivo" from recent conversation history. Treat short elliptical follow-ups such as "E na API?", "E no mobile?" or "E nessa tela?" as continuations of the previous user objective, not as standalone keyword searches. Preserve the prior intent and apply it to the new focus. For whole-workspace or monorepo requests, use workspace_overview and workspace_projects so nested apps/packages are not skipped. Prefer search_symbols and related_files before broad or repeated read_file calls.',
          'When the answer depends on the current workspace, inspect the workspace with tools before answering. If the user asks about the entire project, explicitly account for every detected nested project/subproject before concluding. For analysis/advice-only requests, inspect code but do not run tests/builds or verification commands unless the user asks. Never replace a concrete coding request with a generic greeting such as "Como posso ajudar?" or "Estou pronto para ajudar".',
          'When the user asks to open or show a file in the editor, call open_file_in_editor and reply only with a short confirmation; never paste the file content into chat.',
          'Always read an existing file before editing it. For localized changes, use propose_file_patch with exact unique search/replace blocks so unrelated code is preserved. Use propose_file_change only for new files or a complete replacement file.',
          'Never place unified-diff markers or patch protocol markers inside file content. Save durable non-secret project decisions with remember_project_fact when useful.',
          'After code changes, run verify_workspace or equivalent relevant checks, review the result and fix failures before declaring completion. Never claim a check passed unless its output confirms it.',
          settings?.groqFreeTierMode ? 'Groq Free Tier is enabled. Be economical with model calls: prefer indexed workspace tools over repeated reads, avoid unnecessary delegate_task calls, and keep tool arguments/results focused.' : '',
          skillContext,
          memoryContext,
          intelligenceContext ? `Resumo do índice do workspace:\n${intelligenceContext}` : ''
        ].filter(Boolean).join('\n\n')
        messages = (this.dependencies.contextBuilder ?? new ContextBuilder()).build({
          systemPrompt,
          history,
          attachedFiles,
          userPrompt: input.prompt,
          maxCharacters: Math.min(settings?.contextMaxCharacters ?? 140_000, (settings?.contextTokenBudget ?? 24_000) * 4)
        })
        if (followUp.contextNote) messages.splice(Math.max(1, messages.length - 1), 0, { role: 'system', content: followUp.contextNote })
        const referencedContext = buildReferencedChatContext(store, input.referencedChatIds ?? [], input.sessionId)
        if (referencedContext) messages.splice(1, 0, { role: 'system', content: referencedContext })
      }
      const saveCheckpoint = (safeToResume: boolean): Promise<void> => store.saveCheckpoint(runId, {
        sessionId: input.sessionId,
        prompt: input.prompt,
        permissionMode: input.permissionMode,
        model,
        reasoningEffort,
        messages,
        safeToResume,
        referencedChatIds: input.referencedChatIds
      })
      const toolCallCounts = new Map<string, number>()
      let forceAnswerWithoutTools = false
      let genericRetryCount = 0
      let emptyResponseRetryCount = 0
      if (!restored && !prepared) {
        await store.appendMessage(input.sessionId, { role: 'user', content: input.prompt, attachments: input.attachedFiles, referencedChatIds: input.referencedChatIds })
        await store.createRun({ id: runId, sessionId: input.sessionId, status: 'queued' })
      }
      await store.setRunStatus(runId, 'running')
      await this.publish({ type: restored ? 'run.resumed' : 'run.started', runId, timestamp: now() })
      await this.publish({
        type: 'run.configuration', runId, timestamp: now(), model, reasoningEffort,
        contextTokenBudget: settings?.contextTokenBudget ?? 24_000,
        freeTierMode: settings?.groqFreeTierMode ?? false
      })
      await saveCheckpoint(true)

      if (shouldRequireWorkspaceInspection(operationalPrompt)) {
        await groundWorkspaceLocally(tools, runId, groundingPrompt, active.controller.signal, messages, (event) => this.publish(event))
        await saveCheckpoint(true)
      }

      for (let iteration = 0; iteration < 20; iteration += 1) {
        if (active.controller.signal.aborted) throw abortError()
        let assistantText = ''
        let pendingAssistantDelta = ''
        let lastAssistantDeltaFlushAt = Date.now()
        const flushAssistantDelta = (force = false): void => {
          if (!pendingAssistantDelta) return
          const elapsed = Date.now() - lastAssistantDeltaFlushAt
          if (!force && pendingAssistantDelta.length < STREAM_DELTA_BATCH_CHARS && elapsed < STREAM_DELTA_BATCH_MS) return
          this.dependencies.eventBus.publishTransient({
            type: 'assistant.delta', runId, timestamp: now(), delta: pendingAssistantDelta
          })
          pendingAssistantDelta = ''
          lastAssistantDeltaFlushAt = Date.now()
        }
        const toolCalls: Array<{ id: string; name: string; arguments: string }> = []
        const allRequestTools = forceAnswerWithoutTools ? undefined : tools.definitionsForPhase('workspace')
        const requestTools = allRequestTools?.length
          ? selectToolsForPrompt(operationalPrompt, allRequestTools, settings?.contextTokenBudget ?? 24_000)
          : allRequestTools
        forceAnswerWithoutTools = false
        const requestMessages = compactMessagesForBudget(messages, settings?.contextTokenBudget ?? 24_000, requestTools)
        for await (const event of provider.stream({
          model,
          messages: requestMessages,
          tools: requestTools,
          toolChoice: requestTools?.length ? 'auto' : undefined,
          temperature: 0.2,
          reasoningEffort,
          maxCompletionTokens: settings?.maxCompletionTokens,
          requestClass: 'agent'
        }, active.controller.signal)) {
          if (event.type === 'text-delta') {
            assistantText += event.delta
            pendingAssistantDelta += event.delta
            flushAssistantDelta()
          } else if (event.type === 'tool-call') toolCalls.push(event)
        }
        // Groq can emit hundreds of tiny chunks per second. Coalesce them before
        // crossing the Electron IPC boundary so React is not forced to re-render
        // and re-measure the full chat for every token.
        flushAssistantDelta(true)

        if (toolCalls.length === 0) {
          if (!assistantText.trim()) {
            if (emptyResponseRetryCount < 2) {
              emptyResponseRetryCount += 1
              reasoningEffort = lowerReasoningEffort(reasoningEffort)
              forceAnswerWithoutTools = true
              messages.push({
                role: 'system',
                content: 'A geração anterior terminou sem texto e sem chamada de ferramenta. Responda agora usando as evidências já coletadas no workspace. Não deixe a resposta vazia e não peça mais contexto ao usuário.'
              })
              await saveCheckpoint(true)
              continue
            }
            throw new Error('Groq terminou duas gerações consecutivas sem resposta textual nem chamada de ferramenta')
          }
          emptyResponseRetryCount = 0
          if (isGenericDeflection(assistantText) && isWorkspaceDependentTask(operationalPrompt) && genericRetryCount < 2 && requestTools?.length) {
            genericRetryCount += 1
            messages.push({ role: 'assistant', content: assistantText })
            await groundWorkspaceLocally(tools, runId, groundingPrompt, active.controller.signal, messages, (event) => this.publish(event), genericRetryCount)
            messages.push({
              role: 'system',
              content: 'A resposta anterior foi genérica e não executou a tarefa concreta. O NIX já coletou evidências locais do workspace sem gastar uma chamada do modelo. Use essas evidências e, se precisar, escolha ferramentas adicionais em modo auto. Não cumprimente, não pergunte o que o usuário deseja e não repita a solicitação.'
            })
            continue
          }
          if (settings?.autoVerify !== false && appliedChanges && !verifiedAfterLastChange && this.dependencies.verification) {
            const verificationCallId = randomUUID()
            await this.publish({ type: 'tool.requested', runId, timestamp: now(), toolCallId: verificationCallId, name: 'verify_workspace', arguments: {} })
            await this.publish({ type: 'tool.started', runId, timestamp: now(), toolCallId: verificationCallId, name: 'verify_workspace' })
            const verification = await this.dependencies.verification.run(active.controller.signal)
            await this.publish({ type: 'tool.completed', runId, timestamp: now(), toolCallId: verificationCallId, name: 'verify_workspace', result: { ok: true, value: verification } })
            messages.push({ role: 'assistant', content: assistantText })
            messages.push({ role: 'system', content: `Verificação automática do workspace: ${JSON.stringify(verification)}. ${verification.ok ? 'Revise o resultado e conclua somente se estiver consistente.' : 'A verificação falhou. Investigue e corrija antes de concluir.'}` })
            verifiedAfterLastChange = verification.ok
            continue
          }
          await store.appendMessage(input.sessionId, { role: 'assistant', content: assistantText })
          const chat = store.getChat(input.sessionId)
          if (chat?.titleSource === 'provisional' && this.dependencies.titleService) {
            const title = await this.dependencies.titleService.generate(input.prompt, assistantText, active.controller.signal)
            const updated = await store.renameChat(input.sessionId, title, 'generated')
            await this.publish({ type: 'chat.title.updated', runId, timestamp: now(), chatId: updated.id, title: updated.title })
          }
          await this.publish({ type: 'assistant.completed', runId, timestamp: now(), content: assistantText })
          await store.clearCheckpoint(runId)
          await store.setRunStatus(runId, 'completed')
          await this.publish({ type: 'run.completed', runId, timestamp: now() })
          return
        }

        messages.push({ role: 'assistant', content: assistantText, toolCalls })
        await saveCheckpoint(false)
        emptyResponseRetryCount = 0
        for (const call of toolCalls) {
          call.arguments = repairToolCallArguments(call.name, call.arguments, operationalPrompt)
          await this.publish({ type: 'tool.requested', runId, timestamp: now(), toolCallId: call.id, name: call.name, arguments: call.arguments })
          const signature = `${call.name}\u0000${call.arguments}`
          const repeatedCount = (toolCallCounts.get(signature) ?? 0) + 1
          toolCallCounts.set(signature, repeatedCount)
          if (repeatedCount > 2) {
            const result = {
              ok: false,
              error: {
                code: 'REPEATED_TOOL_CALL',
                message: `The result of ${call.name} with these exact arguments is already available. Do not call it again; use the existing result, change the arguments, or provide the final answer.`
              }
            }
            messages.push(toolMessage(call, result))
            if (repeatedCount >= 4) {
              // Do not fail the whole run because the model got stuck asking for the
              // same read. The next turn intentionally exposes no tools, forcing a
              // useful textual answer from the information already in context.
              forceAnswerWithoutTools = true
              messages.push({
                role: 'system',
                content: `You are stuck repeating ${call.name} with identical arguments. On the next turn, answer the user using the information already available. Do not request this tool again.`
              })
            }
            await this.publish({ type: 'tool.completed', runId, timestamp: now(), toolCallId: call.id, name: call.name, result })
            continue
          }
          let parsed: unknown
          try {
            parsed = tools.parse(call.name, call.arguments)
          } catch (error) {
            const result = toolError(error)
            messages.push(toolMessage(call, result))
            await this.publish({ type: 'tool.completed', runId, timestamp: now(), toolCallId: call.id, name: call.name, result })
            continue
          }

          const effect = tools.effect(call.name)
          const policy = approvalPolicy.evaluate(call.name, parsed, input.permissionMode, effect)
          if (policy.required) {
            const approvalId = randomUUID()
            let decision = active.approvalDecision
            // Arm the approval waiter before publishing the event. The renderer/tests
            // can react immediately to approval.requested, so publishing first leaves
            // a small race where resolveApproval() sees no pending approval yet.
            const approvalPromise = decision ? undefined : this.waitForApproval(active, approvalId)
            await this.publish({
              type: 'approval.requested', runId, timestamp: now(), approvalId,
              summary: policy.reason ?? `${call.name} requires approval`
            })
            if (!decision) {
              await store.setRunStatus(runId, 'waiting_approval')
              decision = await approvalPromise!
              active.pendingApproval = undefined
            }
            await this.publish({ type: 'approval.resolved', runId, timestamp: now(), approvalId, decision })
            if (active.controller.signal.aborted) throw abortError()
            await store.setRunStatus(runId, 'running')
            if (decision === 'rejected') {
              const result = { ok: false, error: { code: 'USER_REJECTED', message: 'The user rejected this tool call' } }
              messages.push(toolMessage(call, result))
              await this.publish({ type: 'tool.completed', runId, timestamp: now(), toolCallId: call.id, name: call.name, result })
              continue
            }
          }

          await this.publish({ type: 'tool.started', runId, timestamp: now(), toolCallId: call.id, name: call.name })
          try {
            const value = await tools.execute(call.name, parsed, { runId, signal: active.controller.signal })
            if (call.name === 'verify_workspace' && value && typeof value === 'object' && 'ok' in value) verifiedAfterLastChange = Boolean((value as { ok?: boolean }).ok)
            const result = { ok: true, value }
            messages.push(toolMessage(call, result))
            if (isEditorOpenAction(value)) {
              await this.publish({ type: 'editor.open.requested', runId, timestamp: now(), path: value.path })
            }
            if (isProposal(value)) {
              await this.publish({ type: 'file.proposed', runId, timestamp: now(), proposalId: value.id, path: value.path, diff: value.diff })
              if ((input.permissionMode === 'auto-workspace' || input.permissionMode === 'autopilot') && effect === 'write' && this.dependencies.applyProposal) {
                await this.dependencies.applyProposal(value.id)
                appliedChanges = true
                verifiedAfterLastChange = false
                await this.publish({ type: 'file.applied', runId, timestamp: now(), proposalId: value.id, path: value.path })
              }
            }
            await this.publish({ type: 'tool.completed', runId, timestamp: now(), toolCallId: call.id, name: call.name, result })
          } catch (error) {
            if (active.controller.signal.aborted) throw abortError()
            const result = toolError(error)
            messages.push(toolMessage(call, result))
            await this.publish({ type: 'tool.completed', runId, timestamp: now(), toolCallId: call.id, name: call.name, result })
          }
        }
        await saveCheckpoint(true)
      }
      throw new Error('Agent stopped after reaching the 20 iteration limit')
    } catch (error) {
      if (active.controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        if (store.getRun(runId)) {
          await store.setRunStatus(runId, 'cancelled')
          await store.clearCheckpoint(runId)
          await this.publish({ type: 'run.cancelled', runId, timestamp: now() })
        }
      } else if (store.getRun(runId)) {
        await store.setRunStatus(runId, 'failed')
        await this.publish({
          type: 'run.failed', runId, timestamp: now(), message: safeErrorMessage(error),
          resumable: Boolean(store.getCheckpoint(runId)?.safeToResume)
        })
      }
    } finally {
      this.active.delete(runId)
      for (const listener of this.settledListeners) listener(runId)
    }

    function toolMessage(call: { id: string; name: string }, result: unknown): ModelMessage {
      return { role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(result) }
    }
  }

  private waitForApproval(active: ActiveRun, approvalId: string): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      const settle = (decision: ApprovalDecision): void => {
        active.controller.signal.removeEventListener('abort', onAbort)
        resolve(decision)
      }
      const onAbort = (): void => settle('rejected')
      active.pendingApproval = { id: approvalId, resolve: settle }
      active.controller.signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private async publish(event: AgentEvent): Promise<void> {
    const diagnosticEvent = compactDiagnosticEvent(event)
    await this.dependencies.store.appendEvent(event.runId, diagnosticEvent)
    this.dependencies.eventBus.publish(diagnosticEvent)
  }
}

function now(): string { return new Date().toISOString() }

const MAX_DIAGNOSTIC_RESULT_CHARACTERS = 12_000
const STREAM_DELTA_BATCH_MS = 80
const STREAM_DELTA_BATCH_CHARS = 384

function compactDiagnosticEvent(event: AgentEvent): AgentEvent {
  if (event.type !== 'tool.completed') return event
  let serialized: string
  try { serialized = typeof event.result === 'string' ? event.result : JSON.stringify(event.result) }
  catch { serialized = '[Resultado não serializável]' }
  if (serialized.length <= MAX_DIAGNOSTIC_RESULT_CHARACTERS) return event
  return {
    ...event,
    result: {
      truncated: true,
      originalCharacters: serialized.length,
      preview: `${serialized.slice(0, MAX_DIAGNOSTIC_RESULT_CHARACTERS)}\n… resultado reduzido para proteger a memória`
    }
  }
}

function toolError(error: unknown): { ok: false; error: { code: string; message: string } } {
  if (error instanceof ToolRegistryError) return { ok: false, error: { code: error.code, message: error.message } }
  return { ok: false, error: { code: 'TOOL_ERROR', message: safeErrorMessage(error) } }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/(?:sk|gsk)_[A-Za-z0-9_-]+/g, '[REDACTED]') : 'Unknown agent error'
}

function abortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function isProposal(value: unknown): value is { id: string; path: string; diff: string } {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'path' in value && 'diff' in value)
}

function isEditorOpenAction(value: unknown): value is { action: 'open_file_in_editor'; path: string } {
  return Boolean(value && typeof value === 'object' && 'action' in value && value.action === 'open_file_in_editor' && 'path' in value && typeof value.path === 'string')
}



async function groundWorkspaceLocally(
  tools: ToolRegistry,
  runId: string,
  prompt: string,
  signal: AbortSignal,
  messages: ModelMessage[],
  publish: (event: AgentEvent) => Promise<void>,
  pass = 0
): Promise<void> {
  const evidence: string[] = []
  const executeReadTool = async (name: string, args: unknown): Promise<unknown | undefined> => {
    const toolCallId = randomUUID()
    try {
      await publish({ type: 'tool.requested', runId, timestamp: now(), toolCallId, name, arguments: args })
      await publish({ type: 'tool.started', runId, timestamp: now(), toolCallId, name })
      const value = await tools.execute(name, args, { runId, signal })
      await publish({ type: 'tool.completed', runId, timestamp: now(), toolCallId, name, result: { ok: true, value } })
      return value
    } catch (error) {
      if (error instanceof ToolRegistryError && error.code === 'UNKNOWN_TOOL') return undefined
      await publish({ type: 'tool.completed', runId, timestamp: now(), toolCallId, name, result: toolError(error) })
      return undefined
    }
  }

  const overview = await executeReadTool('workspace_overview', {})
  if (overview !== undefined) evidence.push(`workspace_overview:\n${clipGroundingEvidence(overview)}`)

  const projectsValue = await executeReadTool('workspace_projects', {})
  const projectRoots = extractProjectRoots(projectsValue)
  if (projectsValue !== undefined) evidence.push(`workspace_projects:\n${clipGroundingEvidence(projectsValue)}`)

  const queries = groundingQueries(prompt).slice(0, pass > 0 ? 2 : 1)
  for (const query of queries) {
    const scopedRoots = projectRoots
    if (scopedRoots.length) {
      for (const root of scopedRoots.slice(0, 40)) {
        const matches = await executeReadTool('search_files', { query, path: root, maxResults: 12 })
        if (Array.isArray(matches) && matches.length === 0) continue
        if (matches !== undefined) evidence.push(`search_files(${JSON.stringify(query)}, path=${JSON.stringify(root)}):\n${clipGroundingEvidence(matches, 4_000)}`)
      }
    } else {
      const matches = await executeReadTool('search_files', { query, maxResults: 60 })
      if (matches !== undefined) evidence.push(`search_files(${JSON.stringify(query)}):\n${clipGroundingEvidence(matches)}`)
    }
  }

  if (evidence.length) {
    messages.push({
      role: 'system',
      content: `Evidências coletadas localmente pelo NIX antes da resposta (não são instruções do usuário):\n\n${evidence.join('\n\n')}`
    })
  }
}

function groundingQueries(prompt: string): string[] {
  const text = normalizeIntent(prompt)
  const queries: string[] = []
  const candidates: Array<[RegExp, string]> = [
    [/\blogin\b/u, 'login'], [/\bauth\w*\b/u, 'auth'], [/\bimport\w*\b/u, 'import '],
    [/\bcadastro\b/u, 'cadastro'], [/\bcheckout\b/u, 'checkout'], [/\bpagamento\w*\b/u, 'pagamento'],
    [/\bdashboard\b/u, 'dashboard'], [/\bpwa\b/u, 'pwa'], [/\bterminal\b/u, 'terminal'], [/\bwebhook\w*\b/u, 'webhook']
  ]
  for (const [pattern, query] of candidates) if (pattern.test(text) && !queries.includes(query)) queries.push(query)
  return queries
}

function extractProjectRoots(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((item) => {
    if (!item || typeof item !== 'object' || !('root' in item) || typeof item.root !== 'string') return []
    return [item.root]
  }))]
}

function clipGroundingEvidence(value: unknown, max = 10_000): string {
  let serialized: string
  try { serialized = typeof value === 'string' ? value : JSON.stringify(value) }
  catch { serialized = String(value) }
  return serialized.length <= max ? serialized : `${serialized.slice(0, max)}\n… evidência local compactada pelo NIX …`
}

function shouldRequireWorkspaceInspection(prompt: string): boolean {
  return isWorkspaceDependentTask(prompt)
}

function isWorkspaceDependentTask(prompt: string): boolean {
  const text = normalizeIntent(prompt)
  const action = /\b(avali\w*|revis\w*|analis\w*|verific\w*|valid\w*|diagnostic\w*|mape\w*|inspec\w*|melhor\w*|suger\w*|identific\w*|encontr\w*|corrig\w*|implement\w*|adicion\w*|cri\w*|alter\w*|modific\w*|refator\w*|otimiz\w*|test\w*|explic\w*|faca|fazer)\b/u.test(text)
  const workspaceSubject = /\b(projeto|workspace|estrutura|imports?|dependenc\w*|arquivos?|codigo|codebase|repositorio|component\w*|tela\w*|pagina\w*|login|ux|ui|frontend|backend|api|rotas?|funcao|funcoes|classe\w*|modulo\w*)\b/u.test(text)
  return action && workspaceSubject
}

function isGenericDeflection(answer: string): boolean {
  const text = normalizeIntent(answer).trim()
  if (!text || text.length > 700) return false
  return /\b(como posso ajud\w*|estou pronto para ajud\w*|informe o que voce (?:precisa|deseja)|o que voce (?:precisa|deseja) (?:que eu faca|fazer)|como posso assisti\w*|posso ajud\w* com (?:o|seu) projeto|em que posso ajud\w*)\b/u.test(text)
}

function selectToolsForPrompt(prompt: string, tools: ModelToolDefinition[], contextTokenBudget: number): ModelToolDefinition[] {
  if (tools.length <= 1) return tools
  const text = normalizeIntent(prompt)
  const readOnly = /\b(nao alter\w*|sem alter\w*|apenas analis\w*|so analis\w*|nao modifi\w*|somente analis\w*)\b/u.test(text)
  const editing = /\b(corrig\w*|implement\w*|adicion\w*|cri\w*|alter\w*|modific\w*|refator\w*)\b/u.test(text) && !readOnly
  const broad = shouldRequireWorkspaceInspection(prompt)
  const explicitExecution = hasExplicitExecutionRequest(text)
  const analysisOnly = broad && !editing && !explicitExecution
  const excluded = new Set<string>()
  if (readOnly || analysisOnly) {
    for (const name of ['propose_file_change', 'propose_file_patch', 'propose_file_delete', 'create_architecture_document', 'remember_project_fact']) excluded.add(name)
  }
  if ((readOnly || analysisOnly) && !explicitExecution) {
    excluded.add('run_command')
    excluded.add('verify_workspace')
  }
  const priority = editing
    ? ['workspace_overview','workspace_projects','search_symbols','related_files','read_file','search_files','list_files','propose_file_patch','propose_file_change','propose_file_delete','run_command','verify_workspace','get_git_status','delegate_task','open_file_in_editor','list_project_memory','remember_project_fact','mcp_list_tools','mcp_call_tool','create_architecture_document']
    : broad
      ? ['workspace_overview','workspace_projects','search_symbols','related_files','list_files','search_files','read_file','get_git_status','verify_workspace','open_file_in_editor','list_project_memory','delegate_task','run_command','mcp_list_tools','mcp_call_tool','propose_file_patch','propose_file_change','propose_file_delete','remember_project_fact','create_architecture_document']
      : ['workspace_overview','workspace_projects','search_symbols','related_files','read_file','search_files','list_files','open_file_in_editor','run_command','verify_workspace','propose_file_patch','propose_file_change','get_git_status','delegate_task','list_project_memory','remember_project_fact','propose_file_delete','mcp_list_tools','mcp_call_tool','create_architecture_document']
  const rank = new Map(priority.map((name, index) => [name, index]))
  const ordered = tools
    .filter((tool) => !excluded.has(tool.function.name))
    .sort((left, right) => (rank.get(left.function.name) ?? 999) - (rank.get(right.function.name) ?? 999))

  // Tool schemas share the same Groq input-token budget. Keep enough room for
  // the system instruction and latest user message instead of allowing schemas
  // to evict the agent identity/context in Free Tier mode.
  const totalBudget = Math.max(800, Math.trunc(contextTokenBudget))
  const toolBudget = Math.max(500, Math.floor(totalBudget * 0.55))
  const selected: ModelToolDefinition[] = []
  for (const tool of ordered) {
    if (estimateRequestTokens([], [...selected, tool]) - 32 <= toolBudget) selected.push(tool)
  }
  if (!selected.length && ordered.length) selected.push(ordered[0])
  return selected
}


function repairToolCallArguments(name: string, rawArguments: string, prompt: string): string {
  if (name !== 'search_files') return rawArguments
  let parsed: Record<string, unknown>
  try {
    const value = JSON.parse(rawArguments || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return rawArguments
    parsed = value as Record<string, unknown>
  } catch {
    return rawArguments
  }

  if (typeof parsed.query === 'string' && parsed.query.trim()) return rawArguments
  const fallback = groundingQueries(prompt)[0] ?? fallbackSearchQuery(prompt)
  if (!fallback) return rawArguments
  return JSON.stringify({ ...parsed, query: fallback })
}

function fallbackSearchQuery(prompt: string): string | undefined {
  const quoted = prompt.match(/["“”'‘’]([^"“”'‘’]{2,80})["“”'‘’]/u)?.[1]?.trim()
  if (quoted) return quoted
  const stop = new Set([
    'quais','qual','como','onde','porque','por','que','para','com','sem','das','dos','uma','umas','uns','esse','essa','este','esta',
    'todo','toda','todos','todas','podem','pode','ser','aplicadas','aplicado','melhorias','melhoria','analise','analisa','avalie','avalia',
    'projeto','workspace','telas','tela','codigo','arquivos','arquivo','estrutura','dentro','sobre','de','do','da','no','na','nos','nas','e','o','a'
  ])
  const words = normalizeIntent(prompt).match(/[a-z0-9_@./-]{3,}/gu) ?? []
  return words.find((word) => !stop.has(word))
}

function hasExplicitExecutionRequest(value: string): boolean {
  const tokens = normalizeIntent(value).match(/[a-z0-9_:+.-]+/gu) ?? []
  const isExecutionToken = (token: string): boolean =>
    /^(rod|execut|test|compil)/u.test(token) || ['build', 'lint', 'npm', 'pnpm', 'yarn', 'terminal', 'comando', 'comandos'].includes(token)

  for (let index = 0; index < tokens.length; index += 1) {
    if (!isExecutionToken(tokens[index])) continue
    const previous = tokens.slice(Math.max(0, index - 3), index)
    if (previous.includes('nao') || previous.includes('sem')) continue
    return true
  }
  return false
}

function lowerReasoningEffort(value: ReasoningEffort): ReasoningEffort {
  return value === 'high' ? 'medium' : 'low'
}

function normalizeIntent(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function ensurePortugueseInstruction(messages: ModelMessage[]): ModelMessage[] {
  const instruction = 'Always answer the user in Brazilian Portuguese, including progress explanations, errors, and the final response.'
  const system = messages.find((message) => message.role === 'system')
  if (!system) return [{ role: 'system', content: instruction }, ...messages]
  if (!system.content.includes('Brazilian Portuguese')) system.content = `${system.content} ${instruction}`
  return messages
}

function buildReferencedChatContext(store: SessionStore, chatIds: string[], currentChatId: string): string | undefined {
  const sections = [...new Set(chatIds)].filter((id) => id !== currentChatId).map((id) => {
    const session = store.getSession(id)
    if (!session) return `Chat ${id}: indisponível.`
    const excerpt = session.messages
      .filter((message) => (message.role === 'user' || message.role === 'assistant') && !message.deletedAt)
      .slice(-6)
      .map((message) => `${message.role === 'user' ? 'Usuário' : 'NIX'}: ${message.content}`)
      .join('\n')
    return `Chat citado — ${session.title}:\n${excerpt || '(sem mensagens)'}`
  })
  return sections.length ? `Contexto explícito de outras conversas. Use apenas quando relevante:\n\n${sections.join('\n\n')}` : undefined
}
