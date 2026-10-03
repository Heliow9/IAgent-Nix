import { ipcMain } from 'electron'
import { z } from 'zod'

import {
  listWorkspaceRequestSchema,
  openWorkspaceRequestSchema,
  readTextRequestSchema,
  saveTextRequestSchema
} from '../../shared/contracts'
import { WorkspaceError, WorkspaceService } from '../workspace/workspace-service'

const createFolderRequestSchema = z.object({ path: z.string().min(1) })
const searchRequestSchema = z.object({ query: z.string().min(1), maxResults: z.number().int().positive().max(500).default(100) })

export function registerWorkspaceIpc(): void {
  let workspace: WorkspaceService | undefined
  const current = (): WorkspaceService => {
    if (!workspace) throw new WorkspaceError('NOT_OPEN', 'No workspace is open')
    return workspace
  }

  ipcMain.handle('workspace:open', async (_event, payload) => {
    const input = openWorkspaceRequestSchema.parse(payload)
    workspace = await WorkspaceService.open(input.root)
    return { root: workspace.root }
  })
  ipcMain.handle('workspace:list', (_event, payload) => current().list(listWorkspaceRequestSchema.parse(payload).path))
  ipcMain.handle('workspace:readText', (_event, payload) => {
    const input = readTextRequestSchema.parse(payload)
    return current().readText(input.path, input)
  })
  ipcMain.handle('workspace:saveText', (_event, payload) => {
    const input = saveTextRequestSchema.parse(payload)
    return current().writeTextAtomic(input.path, input.content, input.expectedHash)
  })
  ipcMain.handle('workspace:createFolder', (_event, payload) => current().createFolder(createFolderRequestSchema.parse(payload).path))
  ipcMain.handle('workspace:search', (_event, payload) => {
    const input = searchRequestSchema.parse(payload)
    return current().search(input.query, { maxResults: input.maxResults })
  })
}
