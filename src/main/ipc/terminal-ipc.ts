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
  const subscriptionKey = (senderId: number, id: string): string => `${senderId}:${id}`
  const assertOwned = (senderId: number, id: string): void => {
    if (!owned.get(senderId)?.has(id)) throw new Error('Terminal does not belong to this renderer')
  }
  const release = (senderId: number, id: string): void => {
    const key = subscriptionKey(senderId, id)
    subscriptions.get(key)?.forEach((unsubscribe) => unsubscribe())
    subscriptions.delete(key)
    owned.get(senderId)?.delete(id)
    service.dispose(id)
  }
  ipcMain.handle('terminal:create', async (event, payload) => {
    const result = await service.create(createSchema.parse(payload))
    const ids = owned.get(event.sender.id) ?? new Set<string>()
    ids.add(result.id)
    owned.set(event.sender.id, ids)
    event.sender.once('destroyed', () => {
      for (const id of [...(owned.get(event.sender.id) ?? [])]) release(event.sender.id, id)
      owned.delete(event.sender.id)
    })
    return result
  })
  ipcMain.handle('terminal:write', (event, payload) => { const input = writeSchema.parse(payload); assertOwned(event.sender.id, input.id); service.write(input.id, input.data) })
  ipcMain.handle('terminal:resize', (event, payload) => { const input = resizeSchema.parse(payload); assertOwned(event.sender.id, input.id); service.resize(input.id, input.cols, input.rows) })
  ipcMain.handle('terminal:dispose', (event, payload) => { const { id } = idSchema.parse(payload); assertOwned(event.sender.id, id); release(event.sender.id, id) })
  ipcMain.handle('terminal:subscribe', (event, payload) => {
    const { id } = idSchema.parse(payload)
    assertOwned(event.sender.id, id)
    const key = subscriptionKey(event.sender.id, id)
    if (subscriptions.has(key)) return
    const send = (channel: string, message: unknown): void => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, message)
    }
    const unsubscribe = [
      service.onData(id, (data) => send('terminal:data', { id, data })),
      service.onExit(id, (exitCode) => send('terminal:exit', { id, exitCode }))
    ]
    subscriptions.set(key, unsubscribe)
  })
  ipcMain.handle('terminal:unsubscribe', (event, payload) => {
    const { id } = idSchema.parse(payload)
    const key = subscriptionKey(event.sender.id, id)
    subscriptions.get(key)?.forEach((unsubscribe) => unsubscribe())
    subscriptions.delete(key)
  })
}
