import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { AgentEvent } from '../../shared/contracts'
import { RunEventBus } from './run-events'
import { SessionStore } from './session-store'

describe('SessionStore', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'groq-ide-state-'))
  })

  afterEach(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(directory, { recursive: true, force: true })
  })

  test('persists sessions and messages across a restart using valid atomic JSON', async () => {
    const first = await SessionStore.open(directory)
    const session = await first.createSession({ title: 'My project', workspaceRoot: 'C:/work' })
    await first.appendMessage(session.id, { role: 'user', content: 'Build it' })

    const second = await SessionStore.open(directory)
    const [loaded] = second.listSessions()
    const files = await readdir(directory)

    expect(loaded).toMatchObject({ id: session.id, title: 'My project', workspaceRoot: 'C:/work' })
    expect(loaded.messages).toHaveLength(1)
    expect(JSON.parse(await readFile(join(directory, 'sessions.json'), 'utf8'))).toMatchObject({ version: 2 })
    expect(files.some((file) => file.endsWith('.tmp'))).toBe(false)
  })

  test('quarantines a corrupt store and starts with empty state', async () => {
    await writeFile(join(directory, 'sessions.json'), '{broken', 'utf8')

    const store = await SessionStore.open(directory)
    const files = await readdir(directory)

    expect(store.listSessions()).toEqual([])
    expect(files.some((file) => file.startsWith('sessions.json.corrupt-'))).toBe(true)
  })

  test('recovers interrupted runs and rejects unresolved approvals', async () => {
    const store = await SessionStore.open(directory)
    const session = await store.createSession({ title: 'Recovery', workspaceRoot: 'C:/work' })
    await store.createRun({ id: 'run-running', sessionId: session.id, status: 'running' })
    await store.createRun({ id: 'run-waiting', sessionId: session.id, status: 'waiting_approval' })
    await store.appendEvent('run-waiting', event({
      type: 'approval.requested',
      approvalId: 'approval-1',
      summary: 'Delete file'
    }, 'run-waiting'))

    await store.recoverInterruptedRuns()

    expect(store.getRun('run-running')?.status).toBe('failed')
    expect(store.getRun('run-waiting')?.status).toBe('failed')
    expect(store.getEvents('run-waiting').map((item) => item.type)).toEqual([
      'approval.requested',
      'approval.resolved',
      'run.failed'
    ])
    expect(store.getEvents('run-waiting')[1]).toMatchObject({ decision: 'rejected' })
  })

  test('persists a safe agent checkpoint and exposes a resumable failed run after restart', async () => {
    const first = await SessionStore.open(directory)
    const session = await first.createSession({ title: 'Resume', workspaceRoot: 'C:/work' })
    await first.createRun({ id: 'run-resume', sessionId: session.id, status: 'running' })
    await first.saveCheckpoint('run-resume', {
      sessionId: session.id,
      prompt: 'Continue the implementation',
      permissionMode: 'ask',
      model: 'deep-model',
      messages: [{ role: 'system', content: 'System' }, { role: 'user', content: 'Continue the implementation' }],
      safeToResume: true
    })

    const second = await SessionStore.open(directory)
    await second.recoverInterruptedRuns()

    expect(second.getCheckpoint('run-resume')).toMatchObject({ prompt: 'Continue the implementation', safeToResume: true })
    expect(second.listRuns(session.id)).toEqual([expect.objectContaining({ id: 'run-resume', status: 'failed', resumable: true })])
    expect(second.getEvents('run-resume').at(-1)).toMatchObject({ type: 'run.failed', resumable: true })
  })

  test('does not advertise an unsafe checkpoint as resumable', async () => {
    const store = await SessionStore.open(directory)
    const session = await store.createSession({ title: 'Unsafe', workspaceRoot: 'C:/work' })
    await store.createRun({ id: 'run-unsafe', sessionId: session.id, status: 'running' })
    await store.saveCheckpoint('run-unsafe', {
      sessionId: session.id, prompt: 'Run command', permissionMode: 'ask', model: 'deep-model',
      messages: [{ role: 'user', content: 'Run command' }], safeToResume: false
    })

    await store.recoverInterruptedRuns()

    expect(store.listRuns(session.id)[0]).toMatchObject({ status: 'failed', resumable: false })
  })

  test('persists file proposals so they can be applied after restart', async () => {
    const first = await SessionStore.open(directory)
    await first.upsertProposal({ id: 'proposal-1', runId: 'run-1', kind: 'write', path: 'src/app.ts', content: 'new', diff: '+new', status: 'pending' })

    const second = await SessionStore.open(directory)
    expect(second.listProposals()).toEqual([expect.objectContaining({ id: 'proposal-1', status: 'pending' })])
    await second.upsertProposal({ ...second.listProposals()[0], status: 'applied' })

    expect((await SessionStore.open(directory)).listProposals()[0].status).toBe('applied')
  })

  test('migrates v1 sessions into deduplicated workspace and chat records', async () => {
    const createdAt = '2026-10-03T12:00:00.000Z'
    await writeFile(join(directory, 'sessions.json'), JSON.stringify({
      version: 1,
      sessions: [
        { id: 'chat-1', title: 'Primeiro', workspaceRoot: 'C:/Work/', permissionMode: 'ask', messages: [], createdAt, updatedAt: createdAt },
        { id: 'chat-2', title: 'Segundo', workspaceRoot: 'c:\\work', permissionMode: 'ask', messages: [], createdAt, updatedAt: createdAt }
      ],
      runs: [], events: {}, checkpoints: {}, proposals: []
    }), 'utf8')

    const store = await SessionStore.open(directory)

    expect(store.listWorkspaces()).toHaveLength(1)
    expect(store.listChats(store.listWorkspaces()[0].id, true).map((chat) => chat.id)).toEqual(['chat-1', 'chat-2'])
    expect(JSON.parse(await readFile(join(directory, 'sessions.json'), 'utf8')).version).toBe(2)
  })

  test('orders recent workspaces and keeps only five in the preview query', async () => {
    const store = await SessionStore.open(directory)
    for (let index = 0; index < 6; index += 1) await store.touchWorkspace(`C:/project-${index}`)

    await store.touchWorkspace('C:/project-0')

    expect(store.listWorkspaces(5).map((workspace) => workspace.localRootPath)).toEqual([
      'C:/project-0', 'C:/project-5', 'C:/project-4', 'C:/project-3', 'C:/project-2'
    ])
  })

  test('creates, renames and archives independent chats without overwriting manual titles', async () => {
    const store = await SessionStore.open(directory)
    const workspace = await store.touchWorkspace('C:/work')
    const chat = await store.createChat(workspace.id, 'Novo chat')

    await store.renameChat(chat.id, 'Folha de pagamento', 'manual')
    await store.renameChat(chat.id, 'Título do modelo', 'generated')
    await store.archiveChat(chat.id)

    expect(store.getSession(chat.id)?.title).toBe('Folha de pagamento')
    expect(store.listChats(workspace.id)).toEqual([])
    expect(store.listChats(workspace.id, true)[0]).toMatchObject({ status: 'archived', titleSource: 'manual' })
  })
})

describe('RunEventBus', () => {
  test('delivers and retains events in publication order', () => {
    const bus = new RunEventBus()
    const delivered: string[] = []
    const unsubscribe = bus.subscribe((item) => delivered.push(item.type))

    bus.publish(event({ type: 'run.started' }))
    bus.publish(event({ type: 'assistant.delta', delta: 'Hello' }))
    unsubscribe()
    bus.publish(event({ type: 'run.completed' }))

    expect(delivered).toEqual(['run.started', 'assistant.delta'])
    expect(bus.history('run-1').map((item) => item.type)).toEqual([
      'run.started',
      'assistant.delta',
      'run.completed'
    ])
  })
})

type AgentEventInput = AgentEvent extends infer Event
  ? Event extends AgentEvent
    ? Omit<Event, 'runId' | 'timestamp'>
    : never
  : never

function event(
  value: AgentEventInput,
  runId = 'run-1'
): AgentEvent {
  return {
    ...value,
    runId,
    timestamp: '2026-10-03T12:00:00.000Z'
  } as AgentEvent
}
