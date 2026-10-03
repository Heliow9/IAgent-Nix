import { contextBridge } from 'electron'

import type { DesktopAPI } from '../shared/contracts'

const desktop: DesktopAPI = {
  app: {
    platform: process.platform,
    electronVersion: process.versions.electron
  }
}

contextBridge.exposeInMainWorld('desktop', desktop)
