import { ipcMain } from 'electron'

import type { GroqProvider } from '../../agent/providers/groq-provider'

export function registerGroqIpc(provider: Pick<GroqProvider, 'getQuotaSnapshot'>): void {
  ipcMain.handle('groq:quota', () => provider.getQuotaSnapshot())
}
