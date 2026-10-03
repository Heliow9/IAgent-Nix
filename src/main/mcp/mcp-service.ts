import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { McpServerConfig, McpServerStatus } from '../../shared/contracts'

interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }
interface Connection { process: ChildProcessWithoutNullStreams; pending: Map<string | number, Pending>; buffer: string; initialized: boolean }

export class McpService {
  private configs: McpServerConfig[] = []
  private connections = new Map<string, Connection>()

  constructor(private readonly configPath: string) {}

  async load(): Promise<void> {
    try { this.configs = JSON.parse(await readFile(this.configPath, 'utf8')) as McpServerConfig[] } catch { this.configs = [] }
  }

  async configure(configs: McpServerConfig[]): Promise<McpServerStatus[]> {
    this.configs = configs.map((item) => ({ ...item, args: item.args ?? [], enabled: item.enabled !== false }))
    await mkdir(dirname(this.configPath), { recursive: true })
    const tmp = `${this.configPath}.tmp`; await writeFile(tmp, JSON.stringify(this.configs, null, 2), 'utf8'); await rename(tmp, this.configPath)
    for (const id of [...this.connections.keys()]) if (!this.configs.find((item) => item.id === id && item.enabled)) this.disconnect(id)
    return this.servers()
  }

  async servers(): Promise<McpServerStatus[]> {
    return Promise.all(this.configs.map(async (config) => {
      if (!config.enabled) return { ...config, connected: false }
      try { const tools = await this.listTools(config.id); return { ...config, connected: true, toolCount: tools.length } }
      catch (error) { return { ...config, connected: false, error: error instanceof Error ? error.message : String(error) } }
    }))
  }

  async listTools(serverId: string): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    const result = await this.request(serverId, 'tools/list', {}) as { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> }
    return result.tools ?? []
  }

  async callTool(serverId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request(serverId, 'tools/call', { name, arguments: args })
  }

  close(): void { for (const id of [...this.connections.keys()]) this.disconnect(id) }

  private async connect(serverId: string): Promise<Connection> {
    const existing = this.connections.get(serverId)
    if (existing) return existing
    const config = this.configs.find((item) => item.id === serverId && item.enabled)
    if (!config) throw new Error(`MCP server not configured or disabled: ${serverId}`)
    const child = spawn(config.command, config.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: process.env })
    const connection: Connection = { process: child, pending: new Map(), buffer: '', initialized: false }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consume(connection, chunk))
    child.stderr.setEncoding('utf8')
    let stderr = ''
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4000) })
    child.on('exit', (code) => {
      this.connections.delete(serverId)
      for (const pending of connection.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(`MCP ${config.name} exited (${code ?? 'unknown'}): ${stderr}`)) }
      connection.pending.clear()
    })
    this.connections.set(serverId, connection)
    await this.rawRequest(connection, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'NIX', version: '0.2.0' } })
    connection.process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
    connection.initialized = true
    return connection
  }

  private async request(serverId: string, method: string, params: unknown): Promise<unknown> {
    const connection = await this.connect(serverId)
    return this.rawRequest(connection, method, params)
  }

  private rawRequest(connection: Connection, method: string, params: unknown): Promise<unknown> {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { connection.pending.delete(id); reject(new Error(`MCP timeout calling ${method}`)) }, 15_000)
      connection.pending.set(id, { resolve, reject, timer })
      connection.process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  private consume(connection: Connection, chunk: string): void {
    connection.buffer += chunk
    while (true) {
      const newline = connection.buffer.indexOf('\n')
      if (newline < 0) break
      const line = connection.buffer.slice(0, newline).trim(); connection.buffer = connection.buffer.slice(newline + 1)
      if (!line) continue
      try {
        const message = JSON.parse(line) as { id?: string | number; result?: unknown; error?: { message?: string } }
        if (message.id === undefined) continue
        const pending = connection.pending.get(message.id); if (!pending) continue
        connection.pending.delete(message.id); clearTimeout(pending.timer)
        if (message.error) pending.reject(new Error(message.error.message ?? 'MCP error'))
        else pending.resolve(message.result)
      } catch { /* ignore protocol noise */ }
    }
  }

  private disconnect(id: string): void {
    const connection = this.connections.get(id); if (!connection) return
    connection.process.kill(); this.connections.delete(id)
  }
}
