import { ipcMain } from 'electron'
import { z } from 'zod'

import type { WorkspaceIntelligenceService } from '../intelligence/workspace-intelligence'
import type { WorkspaceAccess } from './workspace-ipc'

export function registerIntelligenceIpc(access: WorkspaceAccess, intelligence: WorkspaceIntelligenceService): void {
  const root = (): string => {
    if (!access.current) throw new Error('No workspace is open')
    intelligence.setRoot(access.current.root)
    return access.current.root
  }
  ipcMain.handle('intelligence:rebuild', () => intelligence.rebuild(root()))
  ipcMain.handle('intelligence:summary', () => { root(); return intelligence.summary() })
  ipcMain.handle('intelligence:searchSymbols', (_event, payload) => {
    root(); const input = z.object({ query: z.string(), maxResults: z.number().int().positive().max(500).default(100) }).parse(payload)
    return intelligence.searchSymbols(input.query, input.maxResults)
  })
  ipcMain.handle('intelligence:relatedFiles', (_event, payload) => {
    root(); const input = z.object({ path: z.string().min(1) }).parse(payload)
    return intelligence.relatedFiles(input.path)
  })
}
