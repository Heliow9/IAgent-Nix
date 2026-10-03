import { ipcMain } from 'electron'

import type { ModelSettings } from '../../shared/contracts'

export function resolveModelSettings(environment: NodeJS.ProcessEnv = process.env): ModelSettings {
  return {
    fastModel: environment.GROQ_FAST_MODEL || 'openai/gpt-oss-20b',
    deepModel: environment.GROQ_DEEP_MODEL || 'openai/gpt-oss-120b'
  }
}

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:models', () => resolveModelSettings())
}
