import { describe, expect, test, vi } from 'vitest'

import type { DesktopAPI, SessionRecord } from '../../../shared/contracts'
import { createIdeStore, type KeyValueStorage } from './ide-store'

describe('IDE store', () => {
  test('persists panel sizes and selected activity', () => {
    const storage = memoryStorage()
    const first = createIdeStore({ desktop: () => fakeDesktop(), storage })

    first.getState().setPanelSize('sidebar', 340)
    first.getState().selectActivity('agent')
    const second = createIdeStore({ desktop: () => fakeDesktop(), storage })

    expect(second.getState().panelSizes.sidebar).toBe(340)
    expect(second.getState().selectedActivity).toBe('agent')
  })

  test('opens a workspace and loads its root entries', async () => {
    const desktop = fakeDesktop({
      open: async () => ({ root: 'C:/project' }),
      list: async () => [{ name: 'src', path: 'src', kind: 'directory' }]
    })
    const store = createIdeStore({ desktop: () => desktop, storage: memoryStorage() })

    await store.getState().openWorkspace('C:/project')

    expect(store.getState().workspaceRoot).toBe('C:/project')
    expect(store.getState().entriesByDirectory['']).toHaveLength(1)
    expect(store.getState().loadingWorkspace).toBe(false)
  })

  test('keeps structured workspace errors for display', async () => {
    const desktop = fakeDesktop({
      open: async () => { throw Object.assign(new Error('Outside workspace'), { code: 'PATH_OUTSIDE_WORKSPACE' }) }
    })
    const store = createIdeStore({ desktop: () => desktop, storage: memoryStorage() })

    await store.getState().openWorkspace('C:/bad')

    expect(store.getState().workspaceError).toEqual({ code: 'PATH_OUTSIDE_WORKSPACE', message: 'Outside workspace' })
    expect(store.getState().loadingWorkspace).toBe(false)
  })

  test('restores conversation, runs and proposals when reopening a workspace', async () => {
    const session: SessionRecord = {
      id: 'session-1', title: 'Project', workspaceRoot: 'C:/project', permissionMode: 'ask',
      messages: [
        { id: 'message-1', role: 'user', content: 'Adicione a data', createdAt: '2026-10-03T12:00:00.000Z' },
        { id: 'message-2', role: 'assistant', content: 'Comecei a alteração', createdAt: '2026-10-03T12:00:01.000Z' }
      ], createdAt: '2026-10-03T12:00:00.000Z', updatedAt: '2026-10-03T12:00:01.000Z'
    }
    const desktop = fakeDesktop({ open: async () => ({ root: 'C:/project' }) }, {
      sessions: {
        list: async () => [session], listRuns: async () => [{ id: 'run-1', sessionId: session.id, status: 'failed', resumable: true, createdAt: session.createdAt, updatedAt: session.updatedAt }],
        events: async () => [
          { type: 'run.started', runId: 'run-1', timestamp: session.createdAt },
          { type: 'assistant.delta', runId: 'run-1', timestamp: session.updatedAt, delta: 'Parcial' },
          { type: 'run.failed', runId: 'run-1', timestamp: session.updatedAt, message: 'Limite', resumable: true }
        ]
      },
      agent: { listProposals: async () => [{ id: 'proposal-1', runId: 'run-1', kind: 'write', path: 'src/a.ts', diff: '+value', status: 'pending' }] }
    })
    const store = createIdeStore({ desktop: () => desktop, storage: memoryStorage() })

    await store.getState().openWorkspace('C:/project')

    expect(store.getState().conversationMessages.map((message) => message.content)).toEqual(['Adicione a data', 'Comecei a alteração'])
    expect(store.getState().activeRunId).toBe('run-1')
    expect(store.getState().agentRuns['run-1']).toMatchObject({ status: 'failed', assistantText: 'Parcial', resumable: true })
    expect(store.getState().agentRuns['run-1'].proposals[0].id).toBe('proposal-1')
  })

  test('keeps a completed live answer in the visible conversation', () => {
    const store = createIdeStore({ desktop: () => fakeDesktop(), storage: memoryStorage() })
    store.getState().reduceAgentEvent({ type: 'assistant.completed', runId: 'run-1', timestamp: '2026-10-03T12:00:00.000Z', content: 'Concluído' })
    store.getState().reduceAgentEvent({ type: 'run.completed', runId: 'run-1', timestamp: '2026-10-03T12:00:01.000Z' })

    expect(store.getState().conversationMessages).toHaveLength(1)
    expect(store.getState().conversationMessages[0].content).toBe('Concluído')
  })

  test('resumes the active run from its safe checkpoint', async () => {
    const resume = vi.fn(async (runId: string) => ({ runId }))
    const store = createIdeStore({ desktop: () => fakeDesktop({}, { agent: { resume } }), storage: memoryStorage() })
    store.setState({ activeRunId: 'run-1', agentRuns: { 'run-1': { id: 'run-1', status: 'failed', assistantText: '', tools: [], approvals: [], proposals: [], resumable: true, error: 'Limite' } } })

    await store.getState().resumeAgentRun()

    expect(resume).toHaveBeenCalledWith('run-1')
    expect(store.getState().agentRuns['run-1']).toMatchObject({ status: 'running', resumable: false, error: undefined })
  })

  test('opens a file tab when the agent requests the editor', async () => {
    const readText = vi.fn(async () => ({ content: 'export const value = 1', hash: 'hash', totalLines: 1 }))
    const store = createIdeStore({ desktop: () => fakeDesktop({ readText }), storage: memoryStorage() })

    store.getState().reduceAgentEvent({
      type: 'editor.open.requested', runId: 'run-1', timestamp: '2026-10-03T12:00:00.000Z', path: 'src/employee.ts'
    })
    await vi.waitFor(() => expect(readText).toHaveBeenCalledWith('src/employee.ts'))

    expect(store.getState().activePath).toBe('src/employee.ts')
    expect(store.getState().openTabs).toContain('src/employee.ts')
  })
})

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }
}

function fakeDesktop(workspace: Partial<DesktopAPI['workspace']> = {}, services: {
  sessions?: Partial<DesktopAPI['sessions']>
  agent?: Partial<DesktopAPI['agent']>
} = {}): DesktopAPI {
  return {
    app: { platform: 'win32', electronVersion: '38' },
    workspace: {
      open: async (root) => ({ root }), createFolder: async () => undefined, list: async () => [],
      readText: async () => ({ content: '', hash: '', totalLines: 0 }), saveText: async () => ({ hash: '' }),
      search: async () => [], ...workspace
    },
    sessions: { list: async () => [], create: async () => { throw new Error('unused') }, appendMessage: async () => { throw new Error('unused') }, listRuns: async () => [], events: async () => [], onAgentEvent: () => () => undefined, ...services.sessions },
    settings: { models: async () => ({ fastModel: 'fast', deepModel: 'deep' }) },
    projects: { preview: async () => { throw new Error('unused') }, create: async () => { throw new Error('unused') } },
    agent: { start: async () => ({ runId: 'run' }), resume: async (runId) => ({ runId }), cancel: async () => undefined, resolveApproval: async () => undefined, listProposals: async () => [], applyProposal: async () => { throw new Error('unused') }, rejectProposal: async () => { throw new Error('unused') }, ...services.agent },
    terminal: fakeTerminal()
  }
}

function fakeTerminal(): DesktopAPI['terminal'] {
  return { create: async () => ({ id: 'terminal' }), write: async () => undefined, resize: async () => undefined, dispose: async () => undefined, onData: () => () => undefined, onExit: () => () => undefined }
}
