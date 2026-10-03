import { ipcMain } from 'electron'

import type { ModelSettings, NixSettings } from '../../shared/contracts'
import type { SettingsStore } from '../state/settings-store'

export function resolveModelSettings(environment: NodeJS.ProcessEnv = process.env): ModelSettings {
  return {
    fastModel: environment.GROQ_FAST_MODEL || 'openai/gpt-oss-120b',
    deepModel: environment.GROQ_DEEP_MODEL || 'openai/gpt-oss-120b'
  }
}

export function registerSettingsIpc(store: SettingsStore): void {
  ipcMain.handle('settings:models', () => {
    const value = store.get()
    return { fastModel: value.fastModel, deepModel: value.deepModel }
  })
  ipcMain.handle('settings:get', () => store.get())
  ipcMain.handle('settings:update', (_event, patch: Partial<NixSettings>) => store.update(patch))
}
