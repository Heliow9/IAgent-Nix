import { describe, expect, test } from 'vitest'

import type { DesktopAPI } from '../../../shared/contracts'
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
})

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }
}

function fakeDesktop(workspace: Partial<DesktopAPI['workspace']> = {}): DesktopAPI {
  return {
    app: { platform: 'win32', electronVersion: '38' },
    workspace: {
      open: async (root) => ({ root }), createFolder: async () => undefined, list: async () => [],
      readText: async () => ({ content: '', hash: '', totalLines: 0 }), saveText: async () => ({ hash: '' }),
      search: async () => [], ...workspace
    },
    sessions: { list: async () => [], create: async () => { throw new Error('unused') }, appendMessage: async () => { throw new Error('unused') }, onAgentEvent: () => () => undefined },
    settings: { models: async () => ({ fastModel: 'fast', deepModel: 'deep' }) },
    projects: { preview: async () => { throw new Error('unused') }, create: async () => { throw new Error('unused') } },
    agent: { start: async () => ({ runId: 'run' }), cancel: async () => undefined, resolveApproval: async () => undefined, listProposals: async () => [], applyProposal: async () => { throw new Error('unused') }, rejectProposal: async () => { throw new Error('unused') } },
    terminal: fakeTerminal()
  }
}

function fakeTerminal(): DesktopAPI['terminal'] {
  return { create: async () => ({ id: 'terminal' }), write: async () => undefined, resize: async () => undefined, dispose: async () => undefined, onData: () => () => undefined, onExit: () => () => undefined }
}
