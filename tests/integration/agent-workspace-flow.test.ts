import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { ChangeService } from '../../src/agent/changes/change-service'
import type { ModelEvent, ModelProvider } from '../../src/agent/providers/model-provider'
import { AgentRunner } from '../../src/agent/runtime/agent-runner'
import { ApprovalPolicy } from '../../src/agent/runtime/approval-policy'
import { ToolRegistry } from '../../src/agent/tools/tool-registry'
import { registerWorkspaceTools } from '../../src/agent/tools/workspace-tools'
import { RunEventBus } from '../../src/main/state/run-events'
import { SessionStore } from '../../src/main/state/session-store'
import { WorkspaceService } from '../../src/main/workspace/workspace-service'

describe('agent workspace integration', () => {
  const cleanup: string[] = []
  afterEach(async () => { const { rm } = await import('node:fs/promises'); await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

  test('reads, proposes, receives approval, applies and persists a completed run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'groq-ide-integration-workspace-'))
    const statePath = await mkdtemp(join(tmpdir(), 'groq-ide-integration-state-'))
    cleanup.push(root, statePath)
    await writeFile(join(root, 'app.ts'), 'export const value = 1\n', 'utf8')
    const workspace = await WorkspaceService.open(root)
    const store = await SessionStore.open(statePath)
    const session = await store.createSession({ title: 'Integration', workspaceRoot: root })
    const bus = new RunEventBus()
    const changes = new ChangeService(() => workspace)
    const tools = new ToolRegistry()
    registerWorkspaceTools(tools, () => workspace, changes)
    const provider = providerSequence([
      [{ type: 'tool-call', id: 'read-1', name: 'read_file', arguments: '{"path":"app.ts"}' }, { type: 'completed' }],
      [{ type: 'tool-call', id: 'write-1', name: 'propose_file_change', arguments: '{"path":"app.ts","content":"export const value = 2\\n"}' }, { type: 'completed' }],
      [{ type: 'text-delta', delta: 'Alteracao proposta.' }, { type: 'completed' }]
    ])
    const runner = new AgentRunner({ provider, tools, store, eventBus: bus, approvalPolicy: new ApprovalPolicy(), deepModel: 'fake' })

    const { runId } = runner.start({ sessionId: session.id, prompt: 'Change value to 2', permissionMode: 'ask' })
    const approval = await waitFor(bus, runId, 'approval.requested')
    runner.resolveApproval(runId, approval.approvalId, 'approved')
    await waitFor(bus, runId, 'run.completed')
    const proposal = changes.list()[0]
    await changes.apply(proposal.id)

    expect(await readFile(join(root, 'app.ts'), 'utf8')).toBe('export const value = 2\n')
    const reloaded = await SessionStore.open(statePath)
    expect(reloaded.getRun(runId)?.status).toBe('completed')
    expect(reloaded.getEvents(runId).map((event) => event.type)).toContain('file.proposed')
  })
})

function providerSequence(sequence: ModelEvent[][]): ModelProvider {
  let index = 0
  return { async * stream() { for (const event of sequence[index++] ?? []) yield event } }
}

async function waitFor<T extends string>(bus: RunEventBus, runId: string, type: T): Promise<any> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const event = bus.history(runId).find((item) => item.type === type)
    if (event) return event
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Timed out waiting for ${type}`)
}
