import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { RunEventBus } from '../../main/state/run-events'
import { SessionStore } from '../../main/state/session-store'
import type { PermissionMode } from '../../shared/contracts'
import { RunScheduler, type SchedulableRunner } from './run-scheduler'

describe('RunScheduler', () => {
  let directory: string
  let store: SessionStore
  let sessionId: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nix-scheduler-'))
    store = await SessionStore.open(directory)
    sessionId = (await store.createSession({ title: 'Chat', workspaceRoot: 'C:/work' })).id
  })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  test('runs two tasks and promotes the third in FIFO order', async () => {
    const runner = fakeRunner()
    const scheduler = new RunScheduler(runner, store, new RunEventBus(), 2)

    const first = await scheduler.start(input('Primeira'))
    const second = await scheduler.start(input('Segunda'))
    const third = await scheduler.start(input('Terceira'))

    expect(runner.startPrepared).toHaveBeenCalledTimes(2)
    expect(first.status).toBe('running')
    expect(second.status).toBe('running')
    expect(third).toMatchObject({ status: 'queued', queuePosition: 1 })

    runner.settle(first.runId)
    await vi.waitFor(() => expect(runner.startPrepared).toHaveBeenCalledTimes(3))
    expect(runner.startPrepared.mock.calls[2][0]).toBe(third.runId)
  })

  test('cancels a queued task without starting the provider', async () => {
    const runner = fakeRunner()
    const scheduler = new RunScheduler(runner, store, new RunEventBus(), 2)
    await scheduler.start(input('Primeira'))
    await scheduler.start(input('Segunda'))
    const third = await scheduler.start(input('Terceira'))

    await scheduler.cancel(third.runId)

    expect(store.getRun(third.runId)?.status).toBe('cancelled')
    expect(runner.cancel).not.toHaveBeenCalledWith(third.runId)
  })

  function input(prompt: string): { sessionId: string; prompt: string; permissionMode: PermissionMode; attachedFiles: string[]; referencedChatIds: string[] } {
    return { sessionId, prompt, permissionMode: 'ask', attachedFiles: [], referencedChatIds: [] }
  }
})

function fakeRunner(): SchedulableRunner & { settle(runId: string): void; startPrepared: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
  let listener: ((runId: string) => void) | undefined
  return {
    startPrepared: vi.fn(), resume: vi.fn(), cancel: vi.fn(), resolveApproval: vi.fn(), resolveAllApprovals: vi.fn(),
    onSettled(next) { listener = next; return () => { listener = undefined } },
    settle(runId) { listener?.(runId) }
  }
}
