// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { CreateProjectDialog } from './CreateProjectDialog'

describe('CreateProjectDialog', () => {
  test('previews all files before creating the project', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      projectName: 'meu-app', targetPath: 'C:\\work\\meu-app', template: 'node-typescript',
      files: ['package.json', 'src/index.ts'], confirmationToken: 'token'
    })
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(<CreateProjectDialog open onClose={vi.fn()} onPreview={onPreview} onConfirm={onConfirm} />)

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Meu App' } })
    fireEvent.change(screen.getByLabelText('Local'), { target: { value: 'C:\\work' } })
    fireEvent.click(screen.getByRole('button', { name: /revisar criacao/i }))

    expect(await screen.findByText('src/index.ts')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /criar e abrir/i }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ name: 'Meu App' }), 'token'))
  })
})
