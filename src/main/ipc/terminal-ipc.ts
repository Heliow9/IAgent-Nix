import { ipcMain } from 'electron'
import { z } from 'zod'

import type { TerminalService } from '../terminal/terminal-service'

const createSchema = z.object({ cwd: z.string().min(1), cols: z.number().int().positive(), rows: z.number().int().positive() })
const idSchema = z.object({ id: z.string().min(1) })
const writeSchema = idSchema.extend({ data: z.string() })
const resizeSchema = idSchema.extend({ cols: z.number().int().positive(), rows: z.number().int().positive() })

export function registerTerminalIpc(service: TerminalService): void {
  const owned = new Map<number, Set<string>>()
  const subscriptions = new Map<string, Array<() => void>>()
  ipcMain.handle('terminal:create', async (event, payload) => {
    const result = await service.create(createSchema.parse(payload))
    const ids = owned.get(event.sender.id) ?? new Set<string>()
    ids.add(result.id)
    owned.set(event.sender.id, ids)
    event.sender.once('destroyed', () => {
      for (const id of owned.get(event.sender.id) ?? []) service.dispose(id)
      owned.delete(event.sender.id)
    })
    return result
  })
  ipcMain.handle('terminal:write', (_event, payload) => { const input = writeSchema.parse(payload); service.write(input.id, input.data) })
  ipcMain.handle('terminal:resize', (_event, payload) => { const input = resizeSchema.parse(payload); service.resize(input.id, input.cols, input.rows) })
  ipcMain.handle('terminal:dispose', (_event, payload) => service.dispose(idSchema.parse(payload).id))
  ipcMain.handle('terminal:subscribe', (event, payload) => {
    const { id } = idSchema.parse(payload)
    if (subscriptions.has(`${event.sender.id}:${id}`)) return
    const unsubscribe = [
      service.onData(id, (data) => event.sender.send('terminal:data', { id, data })),
      service.onExit(id, (exitCode) => event.sender.send('terminal:exit', { id, exitCode }))
    ]
    subscriptions.set(`${event.sender.id}:${id}`, unsubscribe)
  })
  ipcMain.handle('terminal:unsubscribe', (event, payload) => {
    const { id } = idSchema.parse(payload)
    subscriptions.get(`${event.sender.id}:${id}`)?.forEach((unsubscribe) => unsubscribe())
    subscriptions.delete(`${event.sender.id}:${id}`)
  })
}
