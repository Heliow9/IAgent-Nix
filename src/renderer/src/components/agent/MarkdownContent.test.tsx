// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { MarkdownContent } from './MarkdownContent'

describe('MarkdownContent', () => {
  test('renders headings, tables, lists and fenced code as structured content', () => {
    render(<MarkdownContent content={'## Melhorias\n\n| Item | Motivo |\n|---|---|\n| Tema | Clareza |\n\n- Primeiro\n- Segundo\n\n```ts\nconst value = 1\n```'} />)

    expect(screen.getByRole('heading', { name: 'Melhorias' })).toBeVisible()
    expect(screen.getByRole('table')).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('const value = 1')).toBeVisible()
  })

  test('opens relative workspace links inside the editor instead of a new window', () => {
    const onOpenPath = vi.fn()
    render(<MarkdownContent content={'Abra [este import](src/lib/imports.ts).'} onOpenPath={onOpenPath} />)

    fireEvent.click(screen.getByRole('link', { name: /este import/i }))

    expect(onOpenPath).toHaveBeenCalledWith('src/lib/imports.ts')
  })

  test('opens file-looking inline code from agent tables in the editor', () => {
    const onOpenPath = vi.fn()
    render(<MarkdownContent content={"| Arquivo | Import |\n|---|---|\n| `src/app.ts` | `import router from './routes/user.js'` |"} onOpenPath={onOpenPath} />)

    fireEvent.click(screen.getByRole('button', { name: /abrir src\/app\.ts/i }))

    expect(onOpenPath).toHaveBeenCalledWith('src/app.ts')
  })


  test('resolves an import shown in a file/import table and opens the imported file', async () => {
    const onOpenPath = vi.fn()
    const resolveImport = vi.fn(async () => ({ kind: 'workspace' as const, path: 'src/app.ts' }))
    render(<MarkdownContent
      content={"| Arquivo | Import |\n|---|---|\n| `src/index.ts` | `import app from './app.js';` |"}
      onOpenPath={onOpenPath}
      resolveImport={resolveImport}
    />)

    fireEvent.click(screen.getByRole('button', { name: /abrir import \.\/app\.js/i }))

    expect(resolveImport).toHaveBeenCalledWith('src/index.ts', './app.js')
    expect(await screen.findByRole('button', { name: /abrir import \.\/app\.js/i })).toBeInTheDocument()
    await waitFor(() => expect(onOpenPath).toHaveBeenCalledWith('src/app.ts'))
  })

})
