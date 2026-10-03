import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'

import * as nodePty from 'node-pty'

export interface PtyProcess {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void }
}

export interface PtyAdapter {
  spawn(file: string, args: string[], options: { cwd: string; cols: number; rows: number; env: Record<string, string> }): PtyProcess
}

interface TerminalRecord {
  process: PtyProcess
  replay: string
  dataListeners: Set<(data: string) => void>
  exitListeners: Set<(code: number) => void>
  timer?: ReturnType<typeof setTimeout>
}

export class TerminalError extends Error {
  constructor(public readonly code: 'PATH_OUTSIDE_WORKSPACE' | 'UNKNOWN_TERMINAL', message: string) {
    super(message)
    this.name = 'TerminalError'
  }
}

export class TerminalService {
  private readonly terminals = new Map<string, TerminalRecord>()
  private readonly replayLimit = 50_000

  constructor(private readonly options: {
    adapter?: PtyAdapter
    getWorkspaceRoot: () => string
    platform?: NodeJS.Platform
    environment?: NodeJS.ProcessEnv
  }) {}

  async create(input: { cwd: string; cols: number; rows: number; timeoutMs?: number }): Promise<{ id: string }> {
    const root = await realpath(this.options.getWorkspaceRoot())
    const cwd = await realpath(input.cwd)
    const fromRoot = relative(root, cwd)
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new TerminalError('PATH_OUTSIDE_WORKSPACE', 'Terminal cwd must stay inside the workspace')
    const platform = this.options.platform ?? process.platform
    const environment = this.options.environment ?? process.env
    const shell = platform === 'win32' ? environment.COMSPEC || 'powershell.exe' : environment.SHELL || '/bin/bash'
    const adapter = this.options.adapter ?? defaultAdapter
    const processHandle = adapter.spawn(shell, [], {
      cwd,
      cols: input.cols,
      rows: input.rows,
      env: stringEnvironment(environment)
    })
    const id = randomUUID()
    const record: TerminalRecord = { process: processHandle, replay: '', dataListeners: new Set(), exitListeners: new Set() }
    processHandle.onData((data) => {
      record.replay = (record.replay + data).slice(-this.replayLimit)
      for (const listener of record.dataListeners) listener(data)
    })
    processHandle.onExit(({ exitCode }) => {
      if (record.timer) clearTimeout(record.timer)
      for (const listener of record.exitListeners) listener(exitCode)
      this.terminals.delete(id)
    })
    if (input.timeoutMs) record.timer = setTimeout(() => this.dispose(id), input.timeoutMs)
    this.terminals.set(id, record)
    return { id }
  }

  write(id: string, data: string): void { this.require(id).process.write(data) }
  resize(id: string, cols: number, rows: number): void { this.require(id).process.resize(cols, rows) }

  onData(id: string, listener: (data: string) => void): () => void {
    const record = this.require(id)
    if (record.replay) listener(record.replay)
    record.dataListeners.add(listener)
    return () => record.dataListeners.delete(listener)
  }

  onExit(id: string, listener: (code: number) => void): () => void {
    const record = this.require(id)
    record.exitListeners.add(listener)
    return () => record.exitListeners.delete(listener)
  }

  dispose(id: string): void {
    const record = this.terminals.get(id)
    if (!record) return
    if (record.timer) clearTimeout(record.timer)
    record.process.kill()
    this.terminals.delete(id)
  }

  disposeAll(): void {
    for (const id of [...this.terminals.keys()]) this.dispose(id)
  }

  private require(id: string): TerminalRecord {
    const record = this.terminals.get(id)
    if (!record) throw new TerminalError('UNKNOWN_TERMINAL', `Unknown terminal: ${id}`)
    return record
  }
}

const defaultAdapter: PtyAdapter = {
  spawn: (file, args, options) => nodePty.spawn(file, args, {
    name: 'xterm-256color', cwd: options.cwd, cols: options.cols, rows: options.rows, env: options.env
  })
}

function stringEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}
