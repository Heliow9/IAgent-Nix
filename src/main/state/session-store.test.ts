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
    expect(JSON.parse(await readFile(join(directory, 'sessions.json'), 'utf8'))).toMatchObject({ version: 1 })
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
