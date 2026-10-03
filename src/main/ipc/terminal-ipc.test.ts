import { beforeEach, describe, expect, test, vi } from 'vitest'

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>())
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler)) } }))

import { registerTerminalIpc } from './terminal-ipc'

describe('registerTerminalIpc', () => {
  beforeEach(() => handlers.clear())

  test('does not send late PTY events after the renderer is destroyed', async () => {
    let onData: (data: string) => void = () => undefined
    let destroyed: () => void = () => undefined
    let isDestroyed = false
    const unsubscribe = vi.fn()
    const service = {
      create: vi.fn(async () => ({ id: 'terminal-1' })),
      dispose: vi.fn(), write: vi.fn(), resize: vi.fn(),
      onData: vi.fn((_id: string, listener: (data: string) => void) => { onData = listener; return unsubscribe }),
      onExit: vi.fn(() => unsubscribe)
    }
    const sender = {
      id: 7,
      once: vi.fn((_event: string, listener: () => void) => { destroyed = listener }),
      isDestroyed: vi.fn(() => isDestroyed),
      send: vi.fn(() => { if (isDestroyed) throw new Error('Object has been destroyed') })
    }
    registerTerminalIpc(service as never)
    await handlers.get('terminal:create')!({ sender }, { cwd: 'C:/work', cols: 80, rows: 24 })
    await handlers.get('terminal:subscribe')!({ sender }, { id: 'terminal-1' })

    isDestroyed = true
    destroyed()

    expect(() => onData('late output')).not.toThrow()
    expect(unsubscribe).toHaveBeenCalled()
    expect(sender.send).not.toHaveBeenCalled()
  })
})
