// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import type { DesktopAPI } from '../../../../shared/contracts'
import { createIdeStore } from '../../store/ide-store'
import { EditorArea } from './EditorArea'

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, language, onChange }: { value: string; language: string; onChange(value: string): void }) => (
    <textarea aria-label="Editor de codigo" data-language={language} value={value} onChange={(event) => onChange(event.target.value)} />
  )
}))

describe('EditorArea', () => {
  test('loads a file, chooses its language and marks unsaved edits', async () => {
    const store = createIdeStore({ desktop: () => desktop() })
    await store.getState().openWorkspace('C:/project')
    await store.getState().openFile('src/app.ts')

    render(<EditorArea store={store} />)
    const editor = screen.getByRole('textbox', { name: /editor de codigo/i })
    expect(editor).toHaveAttribute('data-language', 'typescript')
    expect(editor).toHaveValue('export const value = 1\n')

    fireEvent.change(editor, { target: { value: 'export const value = 2\n' } })
    expect(screen.getByLabelText(/app\.ts, alterado/i)).toBeInTheDocument()
  })

  test('saves with the original hash when Ctrl+S is pressed', async () => {
    const saveText = vi.fn(async () => ({ hash: 'hash-2' }))
    const store = createIdeStore({ desktop: () => desktop({ saveText }) })
    await store.getState().openWorkspace('C:/project')
    await store.getState().openFile('src/app.ts')
    render(<EditorArea store={store} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'changed' } })

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await waitFor(() => expect(saveText).toHaveBeenCalledWith('src/app.ts', 'changed', 'hash-1'))
    expect(store.getState().buffers['src/app.ts'].dirty).toBe(false)
  })

  test('shows a conflict without replacing the unsaved buffer', async () => {
    const store = createIdeStore({ desktop: () => desktop({
      saveText: async () => { throw Object.assign(new Error('Changed externally'), { code: 'CONTENT_CONFLICT' }) }
    }) })
    await store.getState().openWorkspace('C:/project')
    await store.getState().openFile('src/app.ts')
    store.getState().updateBuffer('src/app.ts', 'my version')

    await store.getState().saveFile('src/app.ts')
    render(<EditorArea store={store} />)

    expect(screen.getByText(/changed externally/i)).toBeInTheDocument()
    expect(store.getState().buffers['src/app.ts'].content).toBe('my version')
  })

  test('refuses binary files as text', async () => {
    const store = createIdeStore({ desktop: () => desktop({
      readText: async () => { throw Object.assign(new Error('Binary files cannot be opened as text'), { code: 'BINARY_FILE' }) }
    }) })
    await store.getState().openWorkspace('C:/project')
    await store.getState().openFile('assets/logo.png')
    render(<EditorArea store={store} />)

    expect(screen.getByText(/binary files cannot be opened as text/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  test('keeps a dirty tab on cancel and closes it on discard', async () => {
    const store = createIdeStore({ desktop: () => desktop() })
    await store.getState().openWorkspace('C:/project')
    await store.getState().openFile('src/app.ts')
    store.getState().updateBuffer('src/app.ts', 'dirty')

    await store.getState().closeFile('src/app.ts', 'cancel')
    expect(store.getState().openTabs).toContain('src/app.ts')
    await store.getState().closeFile('src/app.ts', 'discard')
    expect(store.getState().openTabs).not.toContain('src/app.ts')
  })
})

function desktop(workspace: Partial<DesktopAPI['workspace']> = {}): DesktopAPI {
  return {
    app: { platform: 'win32', electronVersion: '38' },
    workspace: {
      open: async (root) => ({ root }), createFolder: async () => undefined, list: async () => [],
      readText: async () => ({ content: 'export const value = 1\n', hash: 'hash-1', totalLines: 2 }),
      saveText: async () => ({ hash: 'hash-2' }), search: async () => [], ...workspace
    },
    sessions: { list: async () => [], create: async () => { throw new Error('unused') }, appendMessage: async () => { throw new Error('unused') }, listRuns: async () => [], events: async () => [], onAgentEvent: () => () => undefined },
    settings: { models: async () => ({ fastModel: 'fast', deepModel: 'deep' }) },
    projects: { preview: async () => { throw new Error('unused') }, create: async () => { throw new Error('unused') } },
    agent: { start: async () => ({ runId: 'run' }), resume: async (runId) => ({ runId }), cancel: async () => undefined, resolveApproval: async () => undefined, listProposals: async () => [], applyProposal: async () => { throw new Error('unused') }, rejectProposal: async () => { throw new Error('unused') } },
    terminal: { create: async () => ({ id: 'terminal' }), write: async () => undefined, resize: async () => undefined, dispose: async () => undefined, onData: () => () => undefined, onExit: () => () => undefined }
  }
}
