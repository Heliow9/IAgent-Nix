// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import type { WorkspaceRecord } from '../../../../shared/contracts'
import { Welcome } from './Welcome'

const workspaces = Array.from({ length: 6 }, (_, index): WorkspaceRecord => ({
  id: `00000000-0000-4000-8000-00000000000${index}`, name: `Projeto ${index}`,
  localRootPath: `C:/workspace-${index}`, createdAt: '2026-10-03T12:00:00.000Z',
  updatedAt: '2026-10-03T12:00:00.000Z', lastOpenedAt: '2026-10-03T12:00:00.000Z',
  revision: 1, deletedAt: null
}))

describe('Welcome', () => {
  test('opens a recent workspace and searches the complete list', () => {
    const onOpen = vi.fn().mockResolvedValue(undefined)
    render(<Welcome loading={false} onOpen={onOpen} onCreate={vi.fn()} recentWorkspaces={workspaces.slice(0, 5)} allWorkspaces={workspaces} />)

    fireEvent.click(screen.getByRole('button', { name: /projeto 0/i }))
    expect(onOpen).toHaveBeenCalledWith('C:/workspace-0')

    fireEvent.click(screen.getByRole('button', { name: /mostrar todos/i }))
    fireEvent.change(screen.getByLabelText(/buscar projetos/i), { target: { value: 'Projeto 5' } })
    expect(screen.getByRole('button', { name: /projeto 5/i })).toBeVisible()
  })
})
