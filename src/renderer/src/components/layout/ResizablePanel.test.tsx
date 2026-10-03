// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { ResizablePanel } from './ResizablePanel'

describe('ResizablePanel', () => {
  test('grows a right-side panel when its left edge moves left', () => {
    const onSize = vi.fn()
    render(<ResizablePanel size={360} edge="start" onSize={onSize}><div>Chat</div></ResizablePanel>)

    fireEvent.pointerDown(screen.getByRole('button', { name: /redimensionar painel/i }), { clientX: 300 })
    fireEvent.pointerMove(window, { clientX: 250 })

    expect(onSize).toHaveBeenCalledWith(410)
  })

  test('clamps a previously persisted size to the minimum usable width', () => {
    render(<ResizablePanel size={360} minSize={520} onSize={() => undefined}><div>Chat</div></ResizablePanel>)

    expect(screen.getByText('Chat').parentElement).toHaveStyle({ width: '520px' })
  })
})
