import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ProjectMemoryItem } from '../../shared/contracts'

export class ProjectMemoryService {
  constructor(private readonly baseDir: string) {}

  async list(workspaceRoot: string): Promise<ProjectMemoryItem[]> {
    try { return JSON.parse(await readFile(this.pathFor(workspaceRoot), 'utf8')) as ProjectMemoryItem[] } catch { return [] }
  }

  async add(workspaceRoot: string, category: ProjectMemoryItem['category'], text: string): Promise<ProjectMemoryItem> {
    const items = await this.list(workspaceRoot)
    const normalized = text.trim()
    const existing = items.find((item) => item.category === category && item.text.toLowerCase() === normalized.toLowerCase())
    if (existing) return existing
    const now = new Date().toISOString()
    const item: ProjectMemoryItem = { id: randomUUID(), category, text: normalized, createdAt: now, updatedAt: now }
    await this.save(workspaceRoot, [item, ...items].slice(0, 500))
    return item
  }

  async remove(workspaceRoot: string, id: string): Promise<void> {
    await this.save(workspaceRoot, (await this.list(workspaceRoot)).filter((item) => item.id !== id))
  }

  async context(workspaceRoot: string): Promise<string> {
    const items = await this.list(workspaceRoot)
    if (!items.length) return ''
    return ['Memória persistente do projeto (use como contexto; confirme no código quando necessário):', ...items.slice(0, 80).map((item) => `- [${item.category}] ${item.text}`)].join('\n')
  }

  private pathFor(root: string): string {
    const key = createHash('sha256').update(root).digest('hex').slice(0, 24)
    return join(this.baseDir, `${key}.json`)
  }

  private async save(root: string, items: ProjectMemoryItem[]): Promise<void> {
    await mkdir(this.baseDir, { recursive: true })
    const path = this.pathFor(root); const tmp = `${path}.tmp`
    await writeFile(tmp, JSON.stringify(items, null, 2), 'utf8'); await rename(tmp, path)
  }
}
