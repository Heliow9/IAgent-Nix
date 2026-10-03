// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import type { ChatRecord } from '../../../../shared/contracts'
import { ChatSidebar } from './ChatSidebar'

const chats: ChatRecord[] = [{
  id: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
  title: 'Cadastro de funcionários', titleSource: 'generated', status: 'active', summary: '',
  createdAt: '2026-10-03T12:00:00.000Z', updatedAt: '2026-10-03T12:00:00.000Z', revision: 1, deletedAt: null
}]

describe('ChatSidebar', () => {
  test('collapses and exposes chat creation and selection', () => {
    const onCreate = vi.fn()
    const onSelect = vi.fn()
    render(<ChatSidebar chats={chats} selectedChatId={chats[0].id} onCreate={onCreate} onSelect={onSelect} onRename={vi.fn()} onArchive={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /novo chat/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cadastro de funcionários' }))
    fireEvent.click(screen.getByRole('button', { name: /recolher conversas/i }))

    expect(onCreate).toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith(chats[0].id)
    expect(screen.queryByText('Cadastro de funcionários')).not.toBeInTheDocument()
  })
})
