// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import type { DesktopAPI } from '../../../../shared/contracts'
import { createIdeStore } from '../../store/ide-store'
import { FileTree } from './FileTree'

describe('FileTree', () => {
  test('lazily expands a folder and selects a file', async () => {
    const desktop = fakeDesktop(async (path) => path === ''
      ? [{ name: 'src', path: 'src', kind: 'directory' }]
      : [{ name: 'app.ts', path: 'src/app.ts', kind: 'file', size: 10 }])
    const store = createIdeStore({ desktop: () => desktop })
    await store.getState().openWorkspace('C:/project')
    render(<FileTree store={store} />)

    fireEvent.click(screen.getByRole('button', { name: /src/i }))
    const file = await screen.findByRole('button', { name: /app\.ts/i })
    fireEvent.click(file)

    expect(store.getState().activePath).toBe('src/app.ts')
    expect(store.getState().openTabs).toEqual(['src/app.ts'])
  })

  test('shows a loading state while a folder is expanding', async () => {
    let resolveList: (value: Awaited<ReturnType<DesktopAPI['workspace']['list']>>) => void = () => undefined
    const pending = new Promise<Awaited<ReturnType<DesktopAPI['workspace']['list']>>>((resolve) => { resolveList = resolve })
    const desktop = fakeDesktop(async (path) => path === ''
      ? [{ name: 'src', path: 'src', kind: 'directory' }]
      : pending)
    const store = createIdeStore({ desktop: () => desktop })
    await store.getState().openWorkspace('C:/project')
    render(<FileTree store={store} />)

    fireEvent.click(screen.getByRole('button', { name: /src/i }))
    expect(await screen.findByText(/carregando src/i)).toBeInTheDocument()
    resolveList([])
    await waitFor(() => expect(screen.queryByText(/carregando src/i)).not.toBeInTheDocument())
  })
})

function fakeDesktop(list: DesktopAPI['workspace']['list']): DesktopAPI {
  return {
    app: { platform: 'win32', electronVersion: '38' },
    workspace: { open: async (root) => ({ root }), createFolder: async () => undefined, list, readText: async () => ({ content: '', hash: '', totalLines: 0 }), saveText: async () => ({ hash: '' }), search: async () => [] },
    sessions: { list: async () => [], create: async () => { throw new Error('unused') }, appendMessage: async () => { throw new Error('unused') }, onAgentEvent: () => () => undefined },
    settings: { models: async () => ({ fastModel: 'fast', deepModel: 'deep' }) },
    projects: { preview: async () => { throw new Error('unused') }, create: async () => { throw new Error('unused') } },
    agent: { start: async () => ({ runId: 'run' }), cancel: async () => undefined, resolveApproval: async () => undefined, listProposals: async () => [], applyProposal: async () => { throw new Error('unused') }, rejectProposal: async () => { throw new Error('unused') } },
    terminal: { create: async () => ({ id: 'terminal' }), write: async () => undefined, resize: async () => undefined, dispose: async () => undefined, onData: () => () => undefined, onExit: () => () => undefined }
  }
}
