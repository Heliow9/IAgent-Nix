import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { z } from 'zod'

import { RunEventBus } from '../../main/state/run-events'
import { SessionStore } from '../../main/state/session-store'
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

  test('completes a final answer and persists the assistant message', async () => {
    const { runner, bus } = createRunner(sequenceProvider([[{ type: 'text-delta', delta: 'Done' }, { type: 'completed' }]]))

    const { runId } = runner.start({ sessionId, prompt: 'Finish', permissionMode: 'ask' })
    await waitForTerminal(bus, runId)

    expect(store.getRun(runId)?.status).toBe('completed')
    expect(store.listSessions()[0].messages.map((message) => message.content)).toEqual(['Finish', 'Done'])
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
