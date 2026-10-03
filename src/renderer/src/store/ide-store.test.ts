import { describe, expect, test, vi } from 'vitest'

import type { DesktopAPI, SessionRecord, WorkspaceRecord } from '../../../shared/contracts'
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

  test('loads the five most recent workspaces for the welcome screen', async () => {
    const workspaces = Array.from({ length: 7 }, (_, index): WorkspaceRecord => ({
      id: `00000000-0000-4000-8000-00000000000${index}`, name: `Projeto ${index}`,
      localRootPath: `C:/project-${index}`, createdAt: '2026-10-03T12:00:00.000Z',
      updatedAt: `2026-10-03T12:00:0${index}.000Z`, lastOpenedAt: `2026-10-03T12:00:0${index}.000Z`,
      revision: 1, deletedAt: null
    })).reverse()
    const store = createIdeStore({ desktop: () => fakeDesktop({}, { conversations: { listWorkspaces: async () => workspaces } }), storage: memoryStorage() })

    await store.getState().loadKnownWorkspaces()

    expect(store.getState().recentWorkspaces).toEqual(workspaces.slice(0, 5))
    expect(store.getState().knownWorkspaces).toHaveLength(7)
  })

  test('records a workspace as recent as soon as it opens', async () => {
    const touchWorkspace = vi.fn(async (root: string): Promise<WorkspaceRecord> => ({
      id: '00000000-0000-4000-8000-000000000001', name: 'Project', localRootPath: root,
      createdAt: '2026-10-03T12:00:00.000Z', updatedAt: '2026-10-03T12:00:00.000Z',
      lastOpenedAt: '2026-10-03T12:00:00.000Z', revision: 1, deletedAt: null
    }))
    const store = createIdeStore({ desktop: () => fakeDesktop({ open: async () => ({ root: 'C:/project' }) }, {
      conversations: { touchWorkspace, listChats: async () => [], createChat: async () => { throw new Error('unused') } }
    }), storage: memoryStorage() })

    await store.getState().openWorkspace('C:/project')

    expect(touchWorkspace).toHaveBeenCalledWith('C:/project')
    expect(store.getState().recentWorkspaces[0]?.localRootPath).toBe('C:/project')
  })

  test('switches between independent chats without mixing their messages', async () => {
    const workspaceRecord: WorkspaceRecord = {
      id: '00000000-0000-4000-8000-000000000001', name: 'Project', localRootPath: 'C:/project',
      createdAt: '2026-10-03T12:00:00.000Z', updatedAt: '2026-10-03T12:00:00.000Z',
      lastOpenedAt: '2026-10-03T12:00:00.000Z', revision: 1, deletedAt: null
    }
    const sessions: SessionRecord[] = ['Chat um', 'Chat dois'].map((title, index) => ({
      id: `00000000-0000-4000-8000-00000000001${index}`, title, workspaceRoot: 'C:/project', permissionMode: 'ask',
      messages: [{ id: `message-${index}`, role: 'user', content: `Mensagem ${index + 1}`, createdAt: '2026-10-03T12:00:00.000Z' }],
      createdAt: '2026-10-03T12:00:00.000Z', updatedAt: `2026-10-03T12:00:0${index}.000Z`
    }))
    const chats = sessions.map((session, index) => ({
      id: session.id, workspaceId: workspaceRecord.id, title: session.title, titleSource: 'manual' as const, status: 'active' as const,
      summary: '', createdAt: session.createdAt, updatedAt: session.updatedAt, revision: index + 1, deletedAt: null
    })).reverse()
    const store = createIdeStore({ desktop: () => fakeDesktop({ open: async () => ({ root: 'C:/project' }) }, {
      sessions: { list: async () => sessions },
      conversations: { touchWorkspace: async () => workspaceRecord, listChats: async () => chats }
    }), storage: memoryStorage() })

    await store.getState().openWorkspace('C:/project')
    expect(store.getState().conversationMessages[0].content).toBe('Mensagem 2')

    await store.getState().selectChat(sessions[0].id)

    expect(store.getState().selectedChatId).toBe(sessions[0].id)
    expect(store.getState().conversationMessages.map((message) => message.content)).toEqual(['Mensagem 1'])
  })

  test('routes live events to the originating chat after the user switches chats', () => {
    const store = createIdeStore({ desktop: () => fakeDesktop(), storage: memoryStorage() })
    store.setState({
      selectedChatId: 'chat-2', activeSessionId: 'chat-2', conversationMessages: [], agentRuns: {},
      runChatIds: { 'run-1': 'chat-1' },
      chatViews: {
        'chat-1': { messages: [], activeRunId: 'run-1', agentRuns: { 'run-1': { id: 'run-1', status: 'running', assistantText: '', tools: [], approvals: [], proposals: [], resumable: false } } },
        'chat-2': { messages: [], agentRuns: {} }
      }
    })

    store.getState().reduceAgentEvent({ type: 'assistant.completed', runId: 'run-1', timestamp: '2026-10-03T12:00:00.000Z', content: 'Resposta do chat um' })

    expect(store.getState().conversationMessages).toEqual([])
    expect(store.getState().chatViews['chat-1'].messages[0].content).toBe('Resposta do chat um')
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

  test('ignores orphan proposal events when reopening a workspace', async () => {
    const session: SessionRecord = {
      id: 'session-1', title: 'Project', workspaceRoot: 'C:/project', permissionMode: 'ask', messages: [],
      createdAt: '2026-10-03T12:00:00.000Z', updatedAt: '2026-10-03T12:00:01.000Z'
    }
    const desktop = fakeDesktop({ open: async () => ({ root: 'C:/project' }) }, {
      sessions: {
        list: async () => [session],
        listRuns: async () => [{ id: 'run-1', sessionId: session.id, status: 'completed', resumable: false, createdAt: session.createdAt, updatedAt: session.updatedAt }],
        events: async () => [
          { type: 'file.proposed', runId: 'run-1', timestamp: session.updatedAt, proposalId: 'orphan-proposal', path: 'src/a.ts', diff: '+value' }
        ]
      },
      agent: { listProposals: async () => [] }
    })
    const store = createIdeStore({ desktop: () => desktop, storage: memoryStorage() })

    await store.getState().openWorkspace('C:/project')

    expect(store.getState().agentRuns['run-1'].proposals).toEqual([])
  })

  test('removes a proposal that expired before rejection', async () => {
    const rejectProposal = vi.fn(async () => { throw new Error('Unknown proposal: stale-proposal') })
    const store = createIdeStore({
      desktop: () => fakeDesktop({}, { agent: { rejectProposal, listProposals: async () => [] } }),
      storage: memoryStorage()
    })
    store.setState({
      agentRuns: {
        'run-1': {
          id: 'run-1', status: 'completed', assistantText: '', tools: [], approvals: [], resumable: false,
          proposals: [{ id: 'stale-proposal', runId: 'run-1', kind: 'write', path: 'src/a.ts', diff: '+value', status: 'pending' }]
        }
      }
    })

    await expect(store.getState().rejectProposal('stale-proposal')).rejects.toThrow('Unknown proposal')

    expect(rejectProposal).toHaveBeenCalledWith('stale-proposal')
    expect(store.getState().agentRuns['run-1'].proposals).toEqual([])
  })

  test('removes a proposal that expired before application', async () => {
    const applyProposal = vi.fn(async () => { throw new Error('Unknown proposal: stale-proposal') })
    const store = createIdeStore({
      desktop: () => fakeDesktop({}, { agent: { applyProposal, listProposals: async () => [] } }),
      storage: memoryStorage()
    })
    store.setState({
      agentRuns: {
        'run-1': {
          id: 'run-1', status: 'completed', assistantText: '', tools: [], approvals: [], resumable: false,
          proposals: [{ id: 'stale-proposal', runId: 'run-1', kind: 'write', path: 'src/a.ts', diff: '+value', status: 'pending' }]
        }
      }
    })

    await expect(store.getState().applyProposal('stale-proposal')).rejects.toThrow('Unknown proposal')

    expect(applyProposal).toHaveBeenCalledWith('stale-proposal')
    expect(store.getState().agentRuns['run-1'].proposals).toEqual([])
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

  test('previews an agent proposal as live typing when the target file is open', async () => {
    vi.useFakeTimers()
    try {
      const proposal = {
        id: 'proposal-live', runId: 'run-1', kind: 'write' as const, path: 'src/app.ts',
        content: 'export const value = 2\n', diff: '-1\n+2', status: 'pending' as const
      }
      const store = createIdeStore({
        desktop: () => fakeDesktop({ readText: async () => ({ content: 'export const value = 1\n', hash: 'hash-1', totalLines: 1 }) }, {
          agent: { listProposals: async () => [proposal] }
        }),
        storage: memoryStorage()
      })
      await store.getState().openFile('src/app.ts')

      store.getState().reduceAgentEvent({
        type: 'file.proposed', runId: 'run-1', timestamp: '2026-10-03T12:00:00.000Z',
        proposalId: proposal.id, path: proposal.path, diff: proposal.diff
      })
      await Promise.resolve()
      await vi.runAllTimersAsync()

      expect(store.getState().buffers['src/app.ts']).toMatchObject({
        content: 'export const value = 1\n',
        agentPreviewContent: 'export const value = 2\n',
        agentPreviewing: false,
        agentPreviewProposalId: proposal.id
      })
    } finally {
      vi.useRealTimers()
    }
  })

  test('tracks queue position and clears it when execution starts', () => {
    const store = createIdeStore({ desktop: () => fakeDesktop(), storage: memoryStorage() })

    store.getState().reduceAgentEvent({ type: 'run.queued', runId: 'run-1', timestamp: '2026-10-03T12:00:00.000Z', queuePosition: 3 })
    expect(store.getState().agentRuns['run-1']).toMatchObject({ status: 'queued', queuePosition: 3 })

    store.getState().reduceAgentEvent({ type: 'run.started', runId: 'run-1', timestamp: '2026-10-03T12:00:01.000Z' })
    expect(store.getState().agentRuns['run-1']).toMatchObject({ status: 'running', queuePosition: undefined })
  })

  test('reloads a clean open buffer after the agent applies its proposal', async () => {
    const readText = vi.fn()
      .mockResolvedValueOnce({ content: 'old\n', hash: 'hash-old', totalLines: 1 })
      .mockResolvedValueOnce({ content: 'new from NIX\n', hash: 'hash-new', totalLines: 1 })
    const store = createIdeStore({ desktop: () => fakeDesktop({ readText }), storage: memoryStorage() })
    await store.getState().openFile('src/app.ts')

    store.getState().reduceAgentEvent({
      type: 'file.applied', runId: 'run-1', timestamp: '2026-10-03T12:00:00.000Z',
      proposalId: 'proposal-1', path: 'src/app.ts'
    })

    await vi.waitFor(() => expect(store.getState().buffers['src/app.ts'].content).toBe('new from NIX\n'))
    expect(store.getState().buffers['src/app.ts']).toMatchObject({ hash: 'hash-new', dirty: false })
  })

  test('preserves unsaved local edits and reports an applied external change immediately', async () => {
    const store = createIdeStore({ desktop: () => fakeDesktop({
      readText: async () => ({ content: 'old\n', hash: 'hash-old', totalLines: 1 })
    }), storage: memoryStorage() })
    await store.getState().openFile('src/app.ts')
    store.getState().updateBuffer('src/app.ts', 'my unsaved version\n')

    store.getState().reduceAgentEvent({
      type: 'file.applied', runId: 'run-1', timestamp: '2026-10-03T12:00:00.000Z',
      proposalId: 'proposal-1', path: 'src/app.ts'
    })

    expect(store.getState().buffers['src/app.ts'].content).toBe('my unsaved version\n')
    expect(store.getState().buffers['src/app.ts'].saveError?.message).toMatch(/nix salvou.*disco/i)
  })
})

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }
}

function fakeDesktop(workspace: Partial<DesktopAPI['workspace']> = {}, services: {
  sessions?: Partial<DesktopAPI['sessions']>
  agent?: Partial<DesktopAPI['agent']>
  conversations?: Partial<NonNullable<DesktopAPI['conversations']>>
} = {}): DesktopAPI {
  return {
    app: { platform: 'win32', electronVersion: '38' },
    workspace: {
      open: async (root: string) => ({ root }), createFolder: async () => undefined, list: async () => [],
      readText: async () => ({ content: '', hash: '', totalLines: 0 }), saveText: async () => ({ hash: '' }),
      search: async () => [], resolveImport: async () => ({ kind: 'unresolved' }), ...workspace
    },
    sessions: { list: async () => [], create: async () => { throw new Error('unused') }, appendMessage: async () => { throw new Error('unused') }, listRuns: async () => [], events: async () => [], onAgentEvent: () => () => undefined, ...services.sessions },
    conversations: {
      listWorkspaces: async () => [], touchWorkspace: async () => { throw new Error('unused') }, listChats: async () => [],
      createChat: async () => { throw new Error('unused') }, renameChat: async () => { throw new Error('unused') }, archiveChat: async () => { throw new Error('unused') },
      ...services.conversations
    },
    settings: { models: async () => ({ fastModel: 'fast', deepModel: 'deep' }) },
    projects: { preview: async () => { throw new Error('unused') }, create: async () => { throw new Error('unused') } },
    agent: { start: async () => ({ runId: 'run' }), resume: async (runId: string) => ({ runId }), cancel: async () => undefined, resolveApproval: async () => undefined, resolveAllApprovals: async () => undefined, listProposals: async () => [], applyProposal: async () => { throw new Error('unused') }, rejectProposal: async () => { throw new Error('unused') }, ...services.agent },
    terminal: fakeTerminal()
  } as unknown as DesktopAPI
}

function fakeTerminal(): DesktopAPI['terminal'] {
  return { create: async () => ({ id: 'terminal' }), write: async () => undefined, resize: async () => undefined, dispose: async () => undefined, onData: () => () => undefined, onExit: () => () => undefined }
}
