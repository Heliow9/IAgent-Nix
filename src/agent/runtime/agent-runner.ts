import { randomUUID } from 'node:crypto'

import type { RunEventBus } from '../../main/state/run-events'
import type { RunCheckpoint, SessionStore } from '../../main/state/session-store'
import type { AgentEvent, PermissionMode } from '../../shared/contracts'
import { ContextBuilder } from '../context/context-builder'
import type { ModelMessage, ModelProvider } from '../providers/model-provider'
import type { TaskRoute } from '../router/task-router'
import { ToolRegistry, ToolRegistryError } from '../tools/tool-registry'
import type { ApprovalPolicy } from './approval-policy'

interface AgentRunnerDependencies {
  provider: ModelProvider
  tools: ToolRegistry
  store: SessionStore
  eventBus: RunEventBus
  approvalPolicy: ApprovalPolicy
  deepModel: string
  fastModel?: string
  router?: { route(input: string, signal?: AbortSignal): Promise<TaskRoute> }
  contextBuilder?: ContextBuilder
  loadAttachment?: (path: string) => Promise<{ path: string; content: string }>
  applyProposal?: (proposalId: string) => Promise<unknown>
}

interface StartInput {
  sessionId: string
  prompt: string
  permissionMode: PermissionMode
  attachedFiles?: string[]
}

type ApprovalDecision = 'approved' | 'rejected'

interface ActiveRun {
  controller: AbortController
  pendingApproval?: { id: string; resolve: (decision: ApprovalDecision) => void }
}

export class AgentRunner {
  private readonly active = new Map<string, ActiveRun>()

  constructor(private readonly dependencies: AgentRunnerDependencies) {}

  start(input: StartInput): { runId: string } {
    const runId = randomUUID()
    const active: ActiveRun = { controller: new AbortController() }
    this.active.set(runId, active)
    void this.execute(runId, input, active).catch(() => undefined)
    return { runId }
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
      permissionMode: checkpoint.permissionMode
    }
    void this.execute(runId, input, active, checkpoint).catch(() => undefined)
    return { runId }
  }

  resolveApproval(runId: string, approvalId: string, decision: ApprovalDecision): void {
    const pending = this.active.get(runId)?.pendingApproval
    if (!pending || pending.id !== approvalId) throw new Error('Approval is not pending for this run')
    pending.resolve(decision)
  }

  cancel(runId: string): void {
    const active = this.active.get(runId)
    if (!active) return
    active.controller.abort()
    active.pendingApproval?.resolve('rejected')
  }

  private async execute(runId: string, input: StartInput, active: ActiveRun, restored?: RunCheckpoint): Promise<void> {
    const { store, provider, tools, approvalPolicy, deepModel } = this.dependencies
    try {
      let model: string
      let messages: ModelMessage[]
      if (restored) {
        model = restored.model
        messages = ensurePortugueseInstruction(structuredClone(restored.messages))
      } else {
        const route = await this.dependencies.router?.route(input.prompt, active.controller.signal)
        model = route?.route === 'fast' && this.dependencies.fastModel ? this.dependencies.fastModel : deepModel
        const attachedFiles: Array<{ path: string; content: string }> = []
        for (const path of input.attachedFiles ?? []) {
          try {
            if (this.dependencies.loadAttachment) attachedFiles.push(await this.dependencies.loadAttachment(path))
          } catch { /* an attachment can disappear between selection and send */ }
        }
        const history: ModelMessage[] = (store.getSession(input.sessionId)?.messages ?? [])
          .filter((message) => message.role === 'user' || message.role === 'assistant')
          .map((message) => ({ role: message.role, content: message.content }))
        messages = (this.dependencies.contextBuilder ?? new ContextBuilder()).build({
          systemPrompt: 'You are a careful coding agent inside a visual IDE. Always answer the user in Brazilian Portuguese, including progress explanations, errors, and the final response. Resolve references such as "esse arquivo" from the recent conversation history. When the user asks to open or show a file in the editor, call open_file_in_editor and reply only with a short confirmation; never paste the file content into chat. Always read an existing file before editing it. For localized changes, use propose_file_patch with exact unique search/replace blocks so unrelated code is preserved. Use propose_file_change only for new files or when providing the complete replacement file. Never place unified-diff markers or patch protocol markers inside file content. Inspect the workspace, make bounded proposals, run relevant checks, and finish with a concise summary of what changed, which files were affected, and what validation was executed.',
          history,
          attachedFiles,
          userPrompt: input.prompt,
          maxCharacters: 120_000
        })
      }
      const saveCheckpoint = (safeToResume: boolean): Promise<void> => store.saveCheckpoint(runId, {
        sessionId: input.sessionId,
        prompt: input.prompt,
        permissionMode: input.permissionMode,
        model,
        messages,
        safeToResume
      })
      const toolCallCounts = new Map<string, number>()
      if (!restored) {
        await store.appendMessage(input.sessionId, { role: 'user', content: input.prompt })
        await store.createRun({ id: runId, sessionId: input.sessionId, status: 'queued' })
      }
      await store.setRunStatus(runId, 'running')
      await this.publish({ type: restored ? 'run.resumed' : 'run.started', runId, timestamp: now() })
      await saveCheckpoint(true)

      for (let iteration = 0; iteration < 20; iteration += 1) {
        if (active.controller.signal.aborted) throw abortError()
        let assistantText = ''
        const toolCalls: Array<{ id: string; name: string; arguments: string }> = []
        for await (const event of provider.stream({
          model,
          messages,
          tools: tools.definitionsForPhase('workspace')
        }, active.controller.signal)) {
          if (event.type === 'text-delta') {
            assistantText += event.delta
            await this.publish({ type: 'assistant.delta', runId, timestamp: now(), delta: event.delta })
          } else if (event.type === 'tool-call') toolCalls.push(event)
        }

        if (toolCalls.length === 0) {
          await store.appendMessage(input.sessionId, { role: 'assistant', content: assistantText })
          await this.publish({ type: 'assistant.completed', runId, timestamp: now(), content: assistantText })
          await store.clearCheckpoint(runId)
          await store.setRunStatus(runId, 'completed')
          await this.publish({ type: 'run.completed', runId, timestamp: now() })
          return
        }

        messages.push({ role: 'assistant', content: assistantText, toolCalls })
        await saveCheckpoint(false)
        for (const call of toolCalls) {
          await this.publish({ type: 'tool.requested', runId, timestamp: now(), toolCallId: call.id, name: call.name, arguments: call.arguments })
          const signature = `${call.name}\u0000${call.arguments}`
          const repeatedCount = (toolCallCounts.get(signature) ?? 0) + 1
          toolCallCounts.set(signature, repeatedCount)
          if (repeatedCount > 2) {
            if (repeatedCount > 4) throw new Error(`Agent repeatedly called ${call.name} with the same arguments`)
            const result = {
              ok: false,
              error: {
                code: 'REPEATED_TOOL_CALL',
                message: `Do not call ${call.name} again with identical arguments. Use the existing result, change the arguments, or provide a final answer.`
              }
            }
            messages.push(toolMessage(call, result))
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
            await store.setRunStatus(runId, 'waiting_approval')
            await this.publish({
              type: 'approval.requested', runId, timestamp: now(), approvalId,
              summary: policy.reason ?? `${call.name} requires approval`
            })
            const decision = await this.waitForApproval(active, approvalId)
            active.pendingApproval = undefined
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
            const result = { ok: true, value }
            messages.push(toolMessage(call, result))
            if (isEditorOpenAction(value)) {
              await this.publish({ type: 'editor.open.requested', runId, timestamp: now(), path: value.path })
            }
            if (isProposal(value)) {
              await this.publish({ type: 'file.proposed', runId, timestamp: now(), proposalId: value.id, path: value.path, diff: value.diff })
              if (input.permissionMode === 'auto-workspace' && effect === 'write' && this.dependencies.applyProposal) {
                await this.dependencies.applyProposal(value.id)
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
    await this.dependencies.store.appendEvent(event.runId, event)
    this.dependencies.eventBus.publish(event)
  }
}

function now(): string { return new Date().toISOString() }

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

function ensurePortugueseInstruction(messages: ModelMessage[]): ModelMessage[] {
  const instruction = 'Always answer the user in Brazilian Portuguese, including progress explanations, errors, and the final response.'
  const system = messages.find((message) => message.role === 'system')
  if (!system) return [{ role: 'system', content: instruction }, ...messages]
  if (!system.content.includes('Brazilian Portuguese')) system.content = `${system.content} ${instruction}`
  return messages
}
