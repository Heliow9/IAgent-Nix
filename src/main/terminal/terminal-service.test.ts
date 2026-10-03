import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { TerminalService, type PtyAdapter, type PtyProcess } from './terminal-service'

describe('TerminalService', () => {
  let root: string
  let adapter: FakePtyAdapter
  let service: TerminalService

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'groq-ide-terminal-'))
    adapter = new FakePtyAdapter()
    service = new TerminalService({ adapter, getWorkspaceRoot: () => root, platform: 'win32', environment: { COMSPEC: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' } })
  })

  afterEach(async () => {
    vi.useRealTimers()
    service.disposeAll()
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  })

  test('enforces the workspace cwd and selects PowerShell on Windows', async () => {
    await expect(service.create({ cwd: join(root, '..'), cols: 80, rows: 24 })).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })

    await service.create({ cwd: root, cols: 80, rows: 24 })
    expect(adapter.lastSpawn).toMatchObject({ file: expect.stringContaining('powershell.exe'), options: { cwd: await realpath(root), cols: 80, rows: 24 } })
  })

  test('streams data and replays bounded output to late subscribers', async () => {
    const { id } = await service.create({ cwd: root, cols: 80, rows: 24 })
    adapter.process.emitData('hello')
    const received: string[] = []

    const unsubscribe = service.onData(id, (data) => received.push(data))
    adapter.process.emitData(' world')
    unsubscribe()

    expect(received).toEqual(['hello', ' world'])
  })

  test('forwards input and resize to the PTY', async () => {
    const { id } = await service.create({ cwd: root, cols: 80, rows: 24 })

    service.write(id, 'npm test\r')
    service.resize(id, 120, 40)

    expect(adapter.process.writes).toEqual(['npm test\r'])
    expect(adapter.process.sizes).toEqual([[120, 40]])
  })

  test('reports normal exit and disposes the terminal record', async () => {
    const { id } = await service.create({ cwd: root, cols: 80, rows: 24 })
    const exits: number[] = []
    service.onExit(id, (code) => exits.push(code))

    adapter.process.emitExit(0)

    expect(exits).toEqual([0])
    expect(() => service.write(id, 'x')).toThrow('Unknown terminal')
  })

  test('kills the PTY on timeout and explicit disposal', async () => {
    vi.useFakeTimers()
    const timed = await service.create({ cwd: root, cols: 80, rows: 24, timeoutMs: 20 })
    await vi.advanceTimersByTimeAsync(21)
    expect(adapter.process.killCount).toBe(1)

    const secondAdapter = new FakePtyAdapter()
    const second = new TerminalService({ adapter: secondAdapter, getWorkspaceRoot: () => root, platform: 'win32', environment: {} })
    const active = await second.create({ cwd: root, cols: 80, rows: 24 })
    second.dispose(active.id)
    expect(secondAdapter.process.killCount).toBe(1)
  })
})

class FakePtyAdapter implements PtyAdapter {
  process = new FakePty()
  lastSpawn?: { file: string; args: string[]; options: { cwd: string; cols: number; rows: number; env: Record<string, string> } }
  spawn(file: string, args: string[], options: { cwd: string; cols: number; rows: number; env: Record<string, string> }): PtyProcess {
    this.lastSpawn = { file, args, options }
    return this.process
  }
}

class FakePty implements PtyProcess {
  writes: string[] = []
  sizes: Array<[number, number]> = []
  killCount = 0
  private dataListeners: Array<(value: string) => void> = []
  private exitListeners: Array<(event: { exitCode: number }) => void> = []
  write(data: string): void { this.writes.push(data) }
  resize(cols: number, rows: number): void { this.sizes.push([cols, rows]) }
  kill(): void { this.killCount += 1 }
  onData(listener: (value: string) => void): { dispose(): void } { this.dataListeners.push(listener); return { dispose: () => { this.dataListeners = this.dataListeners.filter((item) => item !== listener) } } }
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void } { this.exitListeners.push(listener); return { dispose: () => { this.exitListeners = this.exitListeners.filter((item) => item !== listener) } } }
  emitData(value: string): void { this.dataListeners.forEach((listener) => listener(value)) }
  emitExit(exitCode: number): void { this.exitListeners.forEach((listener) => listener({ exitCode })) }
}
