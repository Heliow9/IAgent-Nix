import { BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'

import type { RunEventBus } from '../state/run-events'
import type { SessionStore } from '../state/session-store'

const createSessionSchema = z.object({ title: z.string().min(1), workspaceRoot: z.string().min(1) })
const appendMessageSchema = z.object({
  sessionId: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string()
})

export function registerSessionIpc(store: SessionStore, eventBus: RunEventBus): () => void {
  ipcMain.handle('sessions:list', () => store.listSessions())
  ipcMain.handle('sessions:create', (_event, payload) => store.createSession(createSessionSchema.parse(payload)))
  ipcMain.handle('sessions:appendMessage', (_event, payload) => {
    const input = appendMessageSchema.parse(payload)
    return store.appendMessage(input.sessionId, input)
  })
  return eventBus.subscribe((event) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agent:event', event)
  })
}
