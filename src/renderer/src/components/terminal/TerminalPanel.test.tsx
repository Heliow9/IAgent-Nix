// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { TerminalPanel } from './TerminalPanel'

const terminal = {
  open: vi.fn(), write: vi.fn(), dispose: vi.fn(), loadAddon: vi.fn(), onData: vi.fn(), focus: vi.fn(),
  attachCustomKeyEventHandler: vi.fn(), cols: 80, rows: 24
}
vi.mock('@xterm/xterm', () => ({ Terminal: vi.fn(() => terminal) }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: vi.fn(() => ({ fit: vi.fn() })) }))

describe('TerminalPanel', () => {
  afterEach(() => vi.clearAllMocks())

  test('connects xterm data and disposes the PTY on unmount', async () => {
    let dataListener: (data: string) => void = () => undefined
    const dispose = vi.fn(async () => undefined)
    const write = vi.fn(async () => undefined)
    const onData = vi.fn((_id: string, listener: (data: string) => void) => { dataListener = listener; return () => undefined })
    Object.defineProperty(window, 'desktop', { configurable: true, value: {
      terminal: { create: vi.fn(async () => ({ id: 'terminal-1' })), write, resize: vi.fn(), dispose, onData, onExit: vi.fn(() => () => undefined) }
    } })
    terminal.onData.mockImplementation((listener: (data: string) => void) => { listener('typed'); return { dispose: vi.fn() } })

    const view = render(<TerminalPanel workspaceRoot="C:/project" />)
    await waitFor(() => expect(onData).toHaveBeenCalled())
    dataListener('output')
    expect(terminal.write).toHaveBeenCalledWith('output')
    expect(write).toHaveBeenCalledWith('terminal-1', 'typed')

    view.unmount()
    await waitFor(() => expect(dispose).toHaveBeenCalledWith('terminal-1'))
  })

  test('forwards a plain space even when Electron consumes it before xterm onData', async () => {
    let keyHandler: ((event: KeyboardEvent) => boolean) | undefined
    const write = vi.fn(async () => undefined)
    terminal.attachCustomKeyEventHandler.mockImplementation((handler: (event: KeyboardEvent) => boolean) => { keyHandler = handler })
    terminal.onData.mockImplementation(() => ({ dispose: vi.fn() }))
    Object.defineProperty(window, 'desktop', { configurable: true, value: {
      terminal: { create: vi.fn(async () => ({ id: 'terminal-1' })), write, resize: vi.fn(), dispose: vi.fn(), onData: vi.fn(() => () => undefined), onExit: vi.fn(() => () => undefined) }
    } })

    render(<TerminalPanel workspaceRoot="C:/project" />)
    await waitFor(() => expect(terminal.attachCustomKeyEventHandler).toHaveBeenCalled())
    await waitFor(() => expect(window.desktop.terminal.create).toHaveBeenCalled())
    keyHandler?.({ type: 'keydown', code: 'Space', key: ' ', ctrlKey: false, metaKey: false, altKey: false } as KeyboardEvent)

    await waitFor(() => expect(write).toHaveBeenCalledWith('terminal-1', ' '))
  })
})
