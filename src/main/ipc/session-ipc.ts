import { BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'

import type { RunEventBus } from '../state/run-events'
import type { SessionStore } from '../state/session-store'

const createSessionSchema = z.object({ title: z.string().min(1), workspaceRoot: z.string().min(1) })
const appendMessageSchema = z.object({
  sessionId: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  referencedChatIds: z.array(z.string()).default([])
})
const sessionIdSchema = z.object({ sessionId: z.string().min(1) })
const runIdSchema = z.object({ runId: z.string().min(1) })
const workspaceIdSchema = z.object({ workspaceId: z.string().uuid(), includeArchived: z.boolean().optional() })
const chatIdSchema = z.object({ chatId: z.string().uuid() })

export function registerSessionIpc(store: SessionStore, eventBus: RunEventBus): () => void {
  ipcMain.handle('sessions:list', () => store.listSessions())
  ipcMain.handle('sessions:create', (_event, payload) => store.createSession(createSessionSchema.parse(payload)))
  ipcMain.handle('sessions:appendMessage', (_event, payload) => {
    const input = appendMessageSchema.parse(payload)
    return store.appendMessage(input.sessionId, input)
  })
  ipcMain.handle('sessions:listRuns', (_event, payload) => store.listRuns(sessionIdSchema.parse(payload).sessionId))
  ipcMain.handle('sessions:events', (_event, payload) => store.getEvents(runIdSchema.parse(payload).runId))
  ipcMain.handle('conversations:listWorkspaces', () => store.listWorkspaces())
  ipcMain.handle('conversations:touchWorkspace', (_event, payload) => store.touchWorkspace(z.object({ root: z.string().min(1) }).parse(payload).root))
  ipcMain.handle('conversations:listChats', (_event, payload) => {
    const input = workspaceIdSchema.parse(payload)
    return store.listChats(input.workspaceId, input.includeArchived)
  })
  ipcMain.handle('conversations:createChat', (_event, payload) => {
    const input = z.object({ workspaceId: z.string().uuid(), title: z.string().min(1).optional() }).parse(payload)
    return store.createChat(input.workspaceId, input.title)
  })
  ipcMain.handle('conversations:renameChat', (_event, payload) => {
    const input = chatIdSchema.extend({ title: z.string().min(1) }).parse(payload)
    return store.renameChat(input.chatId, input.title, 'manual')
  })
  ipcMain.handle('conversations:archiveChat', (_event, payload) => store.archiveChat(chatIdSchema.parse(payload).chatId))
  return eventBus.subscribe((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('agent:event', event)
    }
  })
}
