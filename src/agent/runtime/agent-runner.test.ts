import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { z } from 'zod'

import { RunEventBus } from '../../main/state/run-events'
import { SessionStore } from '../../main/state/session-store'
import type { NixSettings } from '../../shared/contracts'
import type { ModelEvent, ModelProvider, ModelRequest } from '../providers/model-provider'
import { ToolRegistry } from '../tools/tool-registry'
import { AgentRunner } from './agent-runner'
import { ApprovalPolicy } from './approval-policy'

describe('AgentRunner', () => {
  let directory: string
  let store: SessionStore
  let sessionId: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'groq-ide-runner-'))
    store = await SessionStore.open(directory)
    sessionId = (await store.createSession({ title: 'Agent', workspaceRoot: 'C:/work' })).id
  })

  afterEach(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(directory, { recursive: true, force: true })
  })

  test('uses local routing and automatic HIGH reasoning in Groq Free Tier without an extra router request', async () => {
    const requests: ModelRequest[] = []
    const provider = sequenceProvider([[{ type: 'text-delta', delta: 'Done' }, { type: 'completed' }]], requests)
    const router = {
      route: async () => { throw new Error('remote router should not be called') },
      routeLocal: () => ({ route: 'deep' as const, reasoning: 'high' as const, reason: 'complex', requiredTools: [] })
    }
    const { runner, bus } = createRunner(provider, new ToolRegistry(), {
      router,
      fastModel: 'openai/gpt-oss-120b',
      getSettings: () => freeSettings()
    })

    const { runId } = runner.start({ sessionId, prompt: 'Debug complex integration', permissionMode: 'ask' })
    await waitForTerminal(bus, runId)

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ model: 'deep-model', reasoningEffort: 'high', maxCompletionTokens: 2200, requestClass: 'agent' })
  })

  test('completes a final answer and persists the assistant message', async () => {
    const { runner, bus } = createRunner(sequenceProvider([[{ type: 'text-delta', delta: 'Done' }, { type: 'completed' }]]))

    const { runId } = runner.start({ sessionId, prompt: 'Finish', permissionMode: 'ask' })
    await waitForTerminal(bus, runId)

    expect(store.getRun(runId)?.status).toBe('completed')
    expect(store.listSessions()[0].messages.map((message) => message.content)).toEqual(['Finish', 'Done'])
  })

  test('streams deltas live without persisting or retaining every token', async () => {
    const { runner, bus } = createRunner(sequenceProvider([[
      { type: 'text-delta', delta: 'Primeiro ' }, { type: 'text-delta', delta: 'segundo' }, { type: 'completed' }
    ]]))
    const delivered: string[] = []
    const streamed: string[] = []
    bus.subscribe((item) => {
      delivered.push(item.type)
      if (item.type === 'assistant.delta') streamed.push(item.delta)
    })

    const { runId } = runner.start({ sessionId, prompt: 'Responda', permissionMode: 'ask' })
    await waitForTerminal(bus, runId)

    expect(delivered.filter((type) => type === 'assistant.delta')).toHaveLength(1)
    expect(streamed.join('')).toBe('Primeiro segundo')
    expect(bus.history(runId).some((item) => item.type === 'assistant.delta')).toBe(false)
    expect(store.getEvents(runId).some((item) => item.type === 'assistant.delta')).toBe(false)
    expect(store.listSessions()[0].messages.at(-1)?.content).toBe('Primeiro segundo')
  })

  test('compacts oversized tool output for the Free Tier request and diagnostic event', async () => {
    const largeValue = 'x'.repeat(50_000)
    const requests: ModelRequest[] = []
    const provider = sequenceProvider([
      [{ type: 'tool-call', id: 'large-1', name: 'large_read', arguments: '{}' }, { type: 'completed' }],
      [{ type: 'text-delta', delta: 'Concluído' }, { type: 'completed' }]
    ], requests)
    const tools = new ToolRegistry()
    tools.register({ name: 'large_read', description: 'Read', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'read' }, () => ({ content: largeValue }))
    const { runner, bus } = createRunner(provider, tools)

    const { runId } = runner.start({ sessionId, prompt: 'Leia', permissionMode: 'ask' })
    await waitForTerminal(bus, runId)

    const nextRequest = requests[1].messages.at(-1)?.content ?? ''
    expect(nextRequest).toContain('compactado pelo NIX')
    expect(nextRequest.length).toBeLessThan(largeValue.length)
    const completed = store.getEvents(runId).find((item) => item.type === 'tool.completed')
    expect(JSON.stringify(completed).length).toBeLessThan(15_000)
  })

  test('instructs the model to always answer in Brazilian Portuguese', async () => {
    const requests: ModelRequest[] = []
    const { runner, bus } = createRunner(sequenceProvider([[{ type: 'text-delta', delta: 'Concluído' }, { type: 'completed' }]], requests))

    const { runId } = runner.start({ sessionId, prompt: 'Explain the change', permissionMode: 'ask' })
    await waitForTerminal(bus, runId)

    expect(requests[0].messages[0]).toMatchObject({ role: 'system' })
    expect(requests[0].messages[0].content).toContain('Brazilian Portuguese')
  })

  test('routes the task and includes attached file content in the initial context', async () => {
    const requests: ModelRequest[] = []
    const provider = sequenceProvider([[{ type: 'text-delta', delta: 'Done' }, { type: 'completed' }]], requests)
    const { runner, bus } = createRunner(provider, new ToolRegistry(), {
      router: { route: async () => ({ route: 'fast' as const, reason: 'simple', requiredTools: [] }) },
      fastModel: 'fast-model',
      loadAttachment: async (path: string) => ({ path, content: 'export const active = true' })
    })

    const { runId } = runner.start({ sessionId, prompt: 'Explain this file', permissionMode: 'ask', attachedFiles: ['src/active.ts'] })
    await waitForTerminal(bus, runId)

    expect(requests[0].model).toBe('fast-model')
    expect(requests[0].messages.some((message) => message.content.includes('File: src/active.ts') && message.content.includes('active = true'))).toBe(true)
  })

  test('includes recent conversation history so references remain understandable', async () => {
    const requests: ModelRequest[] = []
    const provider = sequenceProvider([
      [{ type: 'text-delta', delta: 'Falamos sobre src/employee.ts' }, { type: 'completed' }],
      [{ type: 'text-delta', delta: 'Vou abrir o arquivo' }, { type: 'completed' }]
    ], requests)
    const { runner, bus } = createRunner(provider)

    const first = runner.start({ sessionId, prompt: 'Analise src/employee.ts', permissionMode: 'ask' })
    await waitForTerminal(bus, first.runId)
    const second = runner.start({ sessionId, prompt: 'Abra esse arquivo no editor', permissionMode: 'ask' })
    await waitForTerminal(bus, second.runId)

    expect(requests[1].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'Analise src/employee.ts' }),
      expect.objectContaining({ role: 'assistant', content: 'Falamos sobre src/employee.ts' })
    ]))
  })

  test('keeps the previous objective when the user asks a short follow-up such as E na API', async () => {
    const requests: ModelRequest[] = []
    const tools = new ToolRegistry()
    let searchExecutions = 0
    tools.register({ name: 'workspace_overview', description: 'Overview', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'read' }, () => 'overview-contextual')
    tools.register({ name: 'workspace_projects', description: 'Projects', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'read' }, () => [
      { root: 'apps/api', manifest: 'apps/api/package.json' },
      { root: 'apps/dashboard', manifest: 'apps/dashboard/package.json' }
    ])
    tools.register({
      name: 'search_files', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' } }, required: ['query'] },
      schema: z.object({ query: z.string(), path: z.string().optional(), maxResults: z.number().optional() }), phase: 'workspace', effect: 'read'
    }, () => { searchExecutions += 1; return [] })
    const routerInputs: string[] = []
    const router = {
      route: async () => ({ route: 'deep' as const, reasoning: 'medium' as const, reason: 'contextual', requiredTools: [] }),
      routeLocal: (value: string) => {
        routerInputs.push(value)
        return { route: 'deep' as const, reasoning: 'medium' as const, reason: 'contextual', requiredTools: [] }
      }
    }
    const provider = sequenceProvider([[{ type: 'text-delta', delta: 'Na API, mantendo o foco da conversa anterior, eu priorizaria latência, erros e contratos.' }, { type: 'completed' }]], requests)
    const { runner, bus } = createRunner(provider, tools, { router, getSettings: () => freeSettings() })

    const first = runner.start({ sessionId, prompt: 'Quais melhorias de UX podem ser aplicadas nas telas do dashboard PWA?', permissionMode: 'ask' })
    await waitForTerminal(bus, first.runId)
    const second = runner.start({ sessionId, prompt: 'E na API?', permissionMode: 'ask' })
    await waitForTerminal(bus, second.runId)

    expect(routerInputs.at(-1)).toContain('Objetivo anterior do usuário: Quais melhorias de UX')
    expect(routerInputs.at(-1)).toContain('Pergunta atual: E na API?')
    expect(requests.at(-1)?.messages.some((message) => message.role === 'system' && message.content.includes('follow-up elíptico'))).toBe(true)
    expect(requests.at(-1)?.messages.some((message) => message.content.includes('overview-contextual'))).toBe(true)
    // The local grounding for the follow-up must not repeat the previous dashboard/PWA keyword searches.
    expect(searchExecutions).toBeGreaterThanOrEqual(1)
    const followUpEvidence = requests.at(-1)?.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n') ?? ''
    expect(followUpEvidence).not.toContain('search_files("dashboard"')
    expect(followUpEvidence).not.toContain('search_files("pwa"')
  })

  test('emits an editor event instead of sending file content through the chat', async () => {
    const tools = new ToolRegistry()
    tools.register({ name: 'open_file_in_editor', description: 'Open', parameters: {}, schema: z.object({ path: z.string() }), phase: 'workspace', effect: 'read' },
      ({ path }) => ({ action: 'open_file_in_editor', path }))
    const provider = sequenceProvider([
      [{ type: 'tool-call', id: 'open-1', name: 'open_file_in_editor', arguments: '{"path":"src/employee.ts"}' }, { type: 'completed' }],
      [{ type: 'text-delta', delta: 'Arquivo aberto no editor.' }, { type: 'completed' }]
    ])
    const { runner, bus } = createRunner(provider, tools)

    const { runId } = runner.start({ sessionId, prompt: 'Abra o arquivo no editor', permissionMode: 'ask' })
    await waitForTerminal(bus, runId)

    expect(bus.history(runId)).toContainEqual(expect.objectContaining({ type: 'editor.open.requested', path: 'src/employee.ts' }))
  })

  test('feeds a tool result into the next model iteration', async () => {
    const requests: ModelRequest[] = []
    const provider = sequenceProvider([
      [{ type: 'tool-call', id: 'call-1', name: 'echo_value', arguments: '{"value":"hello"}' }, { type: 'completed' }],
      [{ type: 'text-delta', delta: 'Used tool' }, { type: 'completed' }]
    ], requests)
    const tools = new ToolRegistry()
    tools.register({ name: 'echo_value', description: 'Echo', parameters: {}, schema: z.object({ value: z.string() }), phase: 'workspace', effect: 'read' }, ({ value }) => ({ value }))
    const { runner, bus } = createRunner(provider, tools)

    const { runId } = runner.start({ sessionId, prompt: 'Echo', permissionMode: 'ask' })
    await waitForTerminal(bus, runId)

    expect(requests).toHaveLength(2)
    expect(requests[1].messages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'call-1' })
    expect(store.getRun(runId)?.status).toBe('completed')
  })

  test('does not execute the same tool call indefinitely and asks the model to change course', async () => {
    let executions = 0
    const requests: ModelRequest[] = []
    const repeated = () => [{ type: 'tool-call' as const, id: crypto.randomUUID(), name: 'read_value', arguments: '{}' }, { type: 'completed' as const }]
    const provider = sequenceProvider([repeated(), repeated(), repeated(), [{ type: 'text-delta', delta: 'Stopped looping' }, { type: 'completed' }]], requests)
    const tools = new ToolRegistry()
    tools.register({ name: 'read_value', description: 'Read', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'read' }, () => { executions += 1; return { value: 1 } })
    const { runner, bus } = createRunner(provider, tools)

    const { runId } = runner.start({ sessionId, prompt: 'Read once', permissionMode: 'ask' })
    await waitForTerminal(bus, runId)

    expect(executions).toBe(2)
    expect(requests[3].messages.some((message) => message.content.includes('REPEATED_TOOL_CALL'))).toBe(true)
    expect(store.getRun(runId)?.status).toBe('completed')
  })

  test('recovers from a persistent repeated read without failing the run', async () => {
    const requests: ModelRequest[] = []
    const repeated = () => [{ type: 'tool-call' as const, id: crypto.randomUUID(), name: 'read_value', arguments: '{}' }, { type: 'completed' as const }]
    const provider = sequenceProvider([
      repeated(), repeated(), repeated(), repeated(),
      [{ type: 'text-delta', delta: 'Usei o contexto existente e concluí.' }, { type: 'completed' }]
    ], requests)
    const tools = new ToolRegistry()
    tools.register({ name: 'read_value', description: 'Read', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'read' }, () => ({ value: 1 }))
    const { runner, bus } = createRunner(provider, tools)

    const { runId } = runner.start({ sessionId, prompt: 'Read without looping', permissionMode: 'ask' })
    const terminal = await waitForTerminal(bus, runId)

    expect(terminal.type).toBe('run.completed')
    expect(requests[4].tools).toBeUndefined()
    expect(bus.history(runId).find((event) => event.type === 'run.failed')).toBeUndefined()
  })

  test.each([
    ['unknown_tool', '{"value":1}', 'UNKNOWN_TOOL'],
    ['echo_value', '{bad-json', 'INVALID_ARGUMENTS']
  ])('returns structured errors for %s without executing effects', async (toolName, args, errorCode) => {
    const requests: ModelRequest[] = []
    const provider = sequenceProvider([
      [{ type: 'tool-call', id: 'call-1', name: toolName, arguments: args }, { type: 'completed' }],
      [{ type: 'text-delta', delta: 'Recovered' }, { type: 'completed' }]
    ], requests)
    const tools = new ToolRegistry()
    tools.register({ name: 'echo_value', description: 'Echo', parameters: {}, schema: z.object({ value: z.string() }), phase: 'workspace', effect: 'read' }, () => ({ ok: true }))
    const { runner, bus } = createRunner(provider, tools)

    const { runId } = runner.start({ sessionId, prompt: 'Call', permissionMode: 'ask' })
    await waitForTerminal(bus, runId)

    expect(requests[1].messages.at(-1)?.content).toContain(errorCode)
  })

  test('pauses for approval and resumes the same run after approval', async () => {
    let executions = 0
    const tools = new ToolRegistry()
    tools.register({ name: 'propose_file_change', description: 'Write', parameters: {}, schema: z.object({ path: z.string() }), phase: 'workspace', effect: 'write' }, () => { executions += 1; return { ok: true } })
    const provider = sequenceProvider([
      [{ type: 'tool-call', id: 'call-1', name: 'propose_file_change', arguments: '{"path":"a.ts"}' }, { type: 'completed' }],
      [{ type: 'text-delta', delta: 'Applied' }, { type: 'completed' }]
    ])
    const { runner, bus } = createRunner(provider, tools)

    const { runId } = runner.start({ sessionId, prompt: 'Change', permissionMode: 'ask' })
    const approval = await waitForEvent(bus, runId, 'approval.requested')
    expect(store.getRun(runId)?.status).toBe('waiting_approval')
    runner.resolveApproval(runId, approval.approvalId, 'approved')
    await waitForTerminal(bus, runId)

    expect(executions).toBe(1)
    expect(store.getRun(runId)?.status).toBe('completed')
  })

  test('feeds approval rejection back to the model without running the tool', async () => {
    let executions = 0
    const requests: ModelRequest[] = []
    const tools = new ToolRegistry()
    tools.register({ name: 'propose_file_change', description: 'Write', parameters: {}, schema: z.object({ path: z.string() }), phase: 'workspace', effect: 'write' }, () => { executions += 1; return {} })
    const provider = sequenceProvider([
      [{ type: 'tool-call', id: 'call-1', name: 'propose_file_change', arguments: '{"path":"a.ts"}' }, { type: 'completed' }],
      [{ type: 'text-delta', delta: 'Not applied' }, { type: 'completed' }]
    ], requests)
    const { runner, bus } = createRunner(provider, tools)

    const { runId } = runner.start({ sessionId, prompt: 'Change', permissionMode: 'ask' })
    const approval = await waitForEvent(bus, runId, 'approval.requested')
    runner.resolveApproval(runId, approval.approvalId, 'rejected')
    await waitForTerminal(bus, runId)

    expect(executions).toBe(0)
    expect(requests[1].messages.at(-1)?.content).toContain('USER_REJECTED')
  })

  test('can approve every remaining approval in the current run', async () => {
    let executions = 0
    const tools = new ToolRegistry()
    tools.register({ name: 'propose_file_change', description: 'Write', parameters: {}, schema: z.object({ path: z.string() }), phase: 'workspace', effect: 'write' }, () => { executions += 1; return { ok: true } })
    const provider = sequenceProvider([
      [
        { type: 'tool-call', id: 'call-1', name: 'propose_file_change', arguments: '{"path":"a.ts"}' },
        { type: 'tool-call', id: 'call-2', name: 'propose_file_change', arguments: '{"path":"b.ts"}' },
        { type: 'completed' }
      ],
      [{ type: 'text-delta', delta: 'Done' }, { type: 'completed' }]
    ])
    const { runner, bus } = createRunner(provider, tools)

    const { runId } = runner.start({ sessionId, prompt: 'Change both', permissionMode: 'ask' })
    await waitForEvent(bus, runId, 'approval.requested')
    runner.resolveAllApprovals(runId, 'approved')
    await waitForTerminal(bus, runId)

    expect(executions).toBe(2)
    const resolutions = bus.history(runId).filter((event) => event.type === 'approval.resolved')
    expect(resolutions).toHaveLength(2)
    expect(resolutions.every((event) => event.type === 'approval.resolved' && event.decision === 'approved')).toBe(true)
  })

  test('applies write proposals automatically in auto-workspace mode', async () => {
    const applied: string[] = []
    const tools = new ToolRegistry()
    tools.register({ name: 'propose_file_change', description: 'Write', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'write' }, () => ({ id: 'proposal-1', path: 'a.ts', diff: '+new' }))
    const provider = sequenceProvider([
      [{ type: 'tool-call', id: 'call-1', name: 'propose_file_change', arguments: '{}' }, { type: 'completed' }],
      [{ type: 'text-delta', delta: 'Applied' }, { type: 'completed' }]
    ])
    const { runner, bus } = createRunner(provider, tools, { applyProposal: async (id: string) => { applied.push(id) } })

    const { runId } = runner.start({ sessionId, prompt: 'Change', permissionMode: 'auto-workspace' })
    await waitForTerminal(bus, runId)

    expect(applied).toEqual(['proposal-1'])
    expect(bus.history(runId).map((event) => event.type)).toContain('file.applied')
  })

  test('stops after twenty model iterations', async () => {
    let callNumber = 0
    const provider: ModelProvider = {
      async * stream(): AsyncIterable<ModelEvent> {
        yield { type: 'tool-call', id: crypto.randomUUID(), name: 'read_value', arguments: JSON.stringify({ callNumber: callNumber++ }) }
        yield { type: 'completed' }
      }
    }
    const tools = new ToolRegistry()
    tools.register({ name: 'read_value', description: 'Read', parameters: {}, schema: z.object({ callNumber: z.number() }), phase: 'workspace', effect: 'read' }, () => ({ ok: true }))
    const { runner, bus } = createRunner(provider, tools)

    const { runId } = runner.start({ sessionId, prompt: 'Loop', permissionMode: 'ask' })
    const terminal = await waitForTerminal(bus, runId)

    expect(terminal).toMatchObject({ type: 'run.failed', message: expect.stringContaining('20') })
  })

  test('cancels an active model request', async () => {
    const provider: ModelProvider = {
      async * stream(_request, signal): AsyncIterable<ModelEvent> {
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      }
    }
    const { runner, bus } = createRunner(provider)

    const { runId } = runner.start({ sessionId, prompt: 'Wait', permissionMode: 'ask' })
    await waitForEvent(bus, runId, 'run.started')
    runner.cancel(runId)
    const terminal = await waitForTerminal(bus, runId)

    expect(terminal.type).toBe('run.cancelled')
    expect(store.getRun(runId)?.status).toBe('cancelled')
  })

  test('resumes a failed run from its last safe checkpoint without duplicating the user message', async () => {
    let calls = 0
    const provider: ModelProvider = {
      async * stream(): AsyncIterable<ModelEvent> {
        calls += 1
        if (calls === 1) throw new Error('temporary provider failure')
        yield { type: 'text-delta', delta: 'Recovered answer' }
        yield { type: 'completed' }
      }
    }
    const { runner, bus } = createRunner(provider)

    const { runId } = runner.start({ sessionId, prompt: 'Continue me', permissionMode: 'ask' })
    const failed = await waitForEvent(bus, runId, 'run.failed')
    expect(failed.resumable).toBe(true)

    expect(runner.resume(runId)).toEqual({ runId })
    await waitForEvent(bus, runId, 'run.resumed')
    await waitForEvent(bus, runId, 'run.completed')

    expect(store.listSessions()[0].messages.map((message) => message.content)).toEqual(['Continue me', 'Recovered answer'])
    expect(store.getCheckpoint(runId)).toBeUndefined()
  })

  test('adds the Portuguese instruction when resuming a legacy checkpoint', async () => {
    const requests: ModelRequest[] = []
    await store.createRun({ id: 'legacy-run', sessionId, status: 'failed' })
    await store.saveCheckpoint('legacy-run', {
      sessionId, prompt: 'Continue', permissionMode: 'ask', model: 'model', safeToResume: true,
      messages: [{ role: 'system', content: 'You are a coding agent.' }, { role: 'user', content: 'Continue' }]
    })
    const { runner, bus } = createRunner(sequenceProvider([[{ type: 'text-delta', delta: 'Continuando' }, { type: 'completed' }]], requests))

    runner.resume('legacy-run')
    await waitForTerminal(bus, 'legacy-run')

    expect(requests[0].messages[0].content).toContain('Brazilian Portuguese')
  })



  test('grounds broad project analysis locally before the first Groq request', async () => {
    const requests: ModelRequest[] = []
    const tools = new ToolRegistry()
    tools.register({ name: 'workspace_overview', description: 'Overview', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'read' }, () => 'overview-local')
    tools.register({ name: 'propose_file_change', description: 'Write', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'write' }, () => ({ ok: true }))
    const provider = sequenceProvider([
      [{ type: 'text-delta', delta: 'Diagnóstico concluído' }, { type: 'completed' }]
    ], requests)
    const { runner, bus } = createRunner(provider, tools, { getSettings: () => freeSettings() })

    const { runId } = runner.start({
      sessionId,
      prompt: 'Revise toda a estrutura deste projeto e valide os imports. Não altere nenhum arquivo.',
      permissionMode: 'ask'
    })
    await waitForTerminal(bus, runId)

    expect(requests[0].toolChoice).toBe('auto')
    expect(requests[0].tools?.map((tool) => tool.function.name)).not.toContain('propose_file_change')
    expect(requests[0].messages.some((message) => message.content.includes('overview-local'))).toBe(true)
  })

  test('grounds UX evaluation of the project locally without forced Groq tool_choice', async () => {
    const requests: ModelRequest[] = []
    const tools = new ToolRegistry()
    tools.register({ name: 'workspace_overview', description: 'Overview', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'read' }, () => 'overview-ux')
    tools.register({ name: 'workspace_projects', description: 'Projects', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'read' }, () => [
      { root: 'apps/api', manifest: 'apps/api/package.json' },
      { root: 'apps/dashboard', manifest: 'apps/dashboard/package.json' },
      { root: 'apps/mobile', manifest: 'apps/mobile/package.json' }
    ])
    tools.register({ name: 'search_files', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' } }, required: ['query'] }, schema: z.object({ query: z.string(), path: z.string().optional(), maxResults: z.number().optional() }), phase: 'workspace', effect: 'read' }, ({ query, path }) => `found:${query}:${path ?? '.'}`)
    tools.register({ name: 'verify_workspace', description: 'Verify', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'command' }, () => ({ ok: true }))
    tools.register({ name: 'run_command', description: 'Run', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'command' }, () => ({ exitCode: 0 }))
    const provider = sequenceProvider([
      [{ type: 'text-delta', delta: 'A tela de login pode melhorar hierarquia visual e feedback de erro.' }, { type: 'completed' }]
    ], requests)
    const { runner, bus } = createRunner(provider, tools, { getSettings: () => freeSettings() })

    const { runId } = runner.start({
      sessionId,
      prompt: 'Avalia todo esse projeto, me diz o que poderíamos melhorar de UX na tela de login',
      permissionMode: 'ask'
    })
    await waitForTerminal(bus, runId)

    expect(requests[0].toolChoice).toBe('auto')
    expect(requests[0].messages.some((message) => message.content.includes('overview-ux'))).toBe(true)
    expect(requests[0].messages.some((message) => message.content.includes('apps/api'))).toBe(true)
    expect(requests[0].messages.some((message) => message.content.includes('found:login:apps/dashboard'))).toBe(true)
    expect(requests[0].messages.some((message) => message.content.includes('found:login:apps/mobile'))).toBe(true)
    expect(requests[0].tools?.map((tool) => tool.function.name)).not.toContain('verify_workspace')
    expect(requests[0].tools?.map((tool) => tool.function.name)).not.toContain('run_command')
  })

  test('retries a generic non-answer using local grounding instead of required tool_choice', async () => {
    const requests: ModelRequest[] = []
    const tools = new ToolRegistry()
    tools.register({ name: 'workspace_overview', description: 'Overview', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'read' }, () => 'overview')
    tools.register({ name: 'search_files', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, schema: z.object({ query: z.string(), maxResults: z.number().optional() }), phase: 'workspace', effect: 'read' }, ({ query }) => `found:${query}`)
    const provider = sequenceProvider([
      [{ type: 'text-delta', delta: 'Estou pronto para ajudar! Como posso ajudar você com o projeto hoje?' }, { type: 'completed' }],
      [{ type: 'tool-call', id: 'search-1', name: 'search_files', arguments: '{"query":"login"}' }, { type: 'completed' }],
      [{ type: 'text-delta', delta: 'Analisei o workspace e encontrei pontos específicos na tela de login.' }, { type: 'completed' }]
    ], requests)
    const { runner, bus } = createRunner(provider, tools, { getSettings: () => freeSettings() })

    const { runId } = runner.start({
      sessionId,
      prompt: 'Avalia todo esse projeto e sugere melhorias de UX na tela de login',
      permissionMode: 'ask'
    })
    await waitForTerminal(bus, runId)

    expect(requests[0].toolChoice).toBe('auto')
    expect(requests[1].toolChoice).toBe('auto')
    expect(store.getSession(sessionId)?.messages.at(-1)?.content).toContain('Analisei o workspace')
  })



  test('repairs an empty search_files query from the user prompt instead of failing the run', async () => {
    const requests: ModelRequest[] = []
    const tools = new ToolRegistry()
    tools.register({
      name: 'workspace_overview', description: 'Overview', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'read'
    }, () => 'overview')
    tools.register({
      name: 'workspace_projects', description: 'Projects', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'read'
    }, () => [{ root: 'apps/dashboard', manifest: 'apps/dashboard/package.json' }])
    tools.register({
      name: 'search_files', description: 'Search',
      parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1 } }, required: ['query'] },
      schema: z.object({ query: z.string().min(1), path: z.string().optional(), maxResults: z.number().optional() }),
      phase: 'workspace', effect: 'read'
    }, ({ query, path }) => `found:${query}:${path ?? '.'}`)
    const provider = sequenceProvider([
      [{ type: 'tool-call', id: 'search-empty', name: 'search_files', arguments: '{"query":""}' }, { type: 'completed' }],
      [{ type: 'text-delta', delta: 'Encontrei melhorias de UX no dashboard PWA.' }, { type: 'completed' }]
    ], requests)
    const { runner, bus } = createRunner(provider, tools, { getSettings: () => freeSettings() })

    const { runId } = runner.start({
      sessionId,
      prompt: 'Quais as melhorias de UX podem ser aplicadas nas telas do dashboard PWA?',
      permissionMode: 'ask'
    })
    await waitForTerminal(bus, runId)

    expect(requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('found:dashboard'))).toBe(true)
    expect(store.getRun(runId)?.status).toBe('completed')
  })

  test('retries an empty model response with lower reasoning and no extra tools', async () => {
    const requests: ModelRequest[] = []
    const tools = new ToolRegistry()
    tools.register({ name: 'workspace_overview', description: 'Overview', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'read' }, () => 'overview')
    const provider = sequenceProvider([
      [{ type: 'completed' }],
      [{ type: 'text-delta', delta: 'Resposta recuperada a partir do contexto já coletado.' }, { type: 'completed' }]
    ], requests)
    const { runner, bus } = createRunner(provider, tools, { getSettings: () => freeSettings() })

    const { runId } = runner.start({
      sessionId,
      prompt: 'Analise este projeto e recomende melhorias de UX.',
      permissionMode: 'ask'
    })
    await waitForTerminal(bus, runId)

    expect(requests).toHaveLength(2)
    expect(requests[1].tools).toBeUndefined()
    expect(requests[1].reasoningEffort).toBe('low')
    expect(store.getSession(sessionId)?.messages.at(-1)?.content).toContain('Resposta recuperada')
  })

  test('understands negated execution requests and does not offer test or command tools', async () => {
    const requests: ModelRequest[] = []
    const tools = new ToolRegistry()
    tools.register({ name: 'workspace_overview', description: 'Overview', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'read' }, () => 'overview')
    tools.register({ name: 'run_command', description: 'Run', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'command' }, () => ({ exitCode: 0 }))
    tools.register({ name: 'verify_workspace', description: 'Verify', parameters: {}, schema: z.object({}), phase: 'workspace', effect: 'command' }, () => ({ ok: true }))
    const provider = sequenceProvider([[{ type: 'text-delta', delta: 'Análise concluída sem executar testes.' }, { type: 'completed' }]], requests)
    const { runner, bus } = createRunner(provider, tools, { getSettings: () => freeSettings() })

    const { runId } = runner.start({
      sessionId,
      prompt: 'Analise todo o workspace. Não altere arquivos e não execute testes.',
      permissionMode: 'ask'
    })
    await waitForTerminal(bus, runId)

    expect(requests[0].tools?.map((tool) => tool.function.name)).not.toContain('run_command')
    expect(requests[0].tools?.map((tool) => tool.function.name)).not.toContain('verify_workspace')
  })

  test('refuses to resume from a checkpoint captured during an unsafe effect', async () => {
    const { runner } = createRunner(sequenceProvider([]))
    await store.createRun({ id: 'unsafe-run', sessionId, status: 'failed' })
    await store.saveCheckpoint('unsafe-run', {
      sessionId, prompt: 'Unsafe', permissionMode: 'ask', model: 'deep-model',
      messages: [{ role: 'user', content: 'Unsafe' }], safeToResume: false
    })

    expect(() => runner.resume('unsafe-run')).toThrow(/safe checkpoint/i)
  })

  function createRunner(provider: ModelProvider, tools = new ToolRegistry(), extra: Record<string, unknown> = {}): { runner: AgentRunner; bus: RunEventBus } {
    const bus = new RunEventBus()
    return {
      bus,
      runner: new AgentRunner({ provider, tools, store, eventBus: bus, approvalPolicy: new ApprovalPolicy(), deepModel: 'deep-model', ...extra })
    }
  }
})

function sequenceProvider(sequences: ModelEvent[][], requests: ModelRequest[] = []): ModelProvider {
  let index = 0
  return {
    async * stream(request): AsyncIterable<ModelEvent> {
      requests.push(structuredClone(request))
      for (const event of sequences[index++] ?? [{ type: 'text-delta', delta: 'Fallback' }, { type: 'completed' }]) yield event
    }
  }
}

async function waitForEvent<T extends string>(bus: RunEventBus, runId: string, type: T): Promise<Extract<ReturnType<RunEventBus['history']>[number], { type: T }>> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    const found = bus.history(runId).find((event) => event.type === type)
    if (found) return found as Extract<typeof found, { type: T }>
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Timed out waiting for ${type}`)
}

async function waitForTerminal(bus: RunEventBus, runId: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const found = bus.history(runId).find((event) => ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type))
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Timed out waiting for terminal event. History: ${JSON.stringify(bus.history(runId))}`)
}

function freeSettings(): NixSettings {
  return {
    fastModel: 'openai/gpt-oss-120b', deepModel: 'openai/gpt-oss-120b', contextMaxCharacters: 140_000,
    contextTokenBudget: 3_600, maxCompletionTokens: 2_200, maxConcurrentRuns: 1, autoVerify: true,
    skillMode: 'auto', superpowersEnabled: true, modelRouting: 'auto', reasoningMode: 'auto',
    groqFreeTierMode: true, quotaProtection: 'adaptive', groqDailyTokenLimit: 200_000
  }
}
