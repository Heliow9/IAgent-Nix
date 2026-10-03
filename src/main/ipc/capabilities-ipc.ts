import { ipcMain } from 'electron'
import { z } from 'zod'

import type { McpServerConfig, ProjectMemoryItem } from '../../shared/contracts'
import type { ProjectMemoryService } from '../memory/project-memory'
import type { McpService } from '../mcp/mcp-service'
import type { SkillEngine } from '../../agent/skills/skill-engine'
import type { WorkspaceAccess } from './workspace-ipc'

export function registerCapabilitiesIpc(access: WorkspaceAccess, memory: ProjectMemoryService, skills: SkillEngine, mcp: McpService): void {
  const root = (): string => { if (!access.current) throw new Error('No workspace is open'); return access.current.root }
  ipcMain.handle('memory:list', () => memory.list(root()))
  ipcMain.handle('memory:add', (_e, payload) => { const input = z.object({ category: z.enum(['architecture','decision','convention','issue','fact']), text: z.string().min(1).max(4000) }).parse(payload); return memory.add(root(), input.category as ProjectMemoryItem['category'], input.text) })
  ipcMain.handle('memory:remove', (_e, payload) => { const { id } = z.object({ id: z.string().min(1) }).parse(payload); return memory.remove(root(), id) })
  ipcMain.handle('skills:list', () => skills.list())
  ipcMain.handle('skills:reload', () => { skills.setWorkspace(root()); return skills.reload() })
  ipcMain.handle('mcp:servers', () => mcp.servers())
  ipcMain.handle('mcp:configure', (_e, payload) => mcp.configure(z.array(z.object({ id: z.string().min(1), name: z.string().min(1), command: z.string().min(1), args: z.array(z.string()).default([]), enabled: z.boolean().default(true) })).parse(payload) as McpServerConfig[]))
  ipcMain.handle('mcp:tools', (_e, payload) => { const { serverId } = z.object({ serverId: z.string().min(1) }).parse(payload); return mcp.listTools(serverId) })
}
