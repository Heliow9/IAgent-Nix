import { contextBridge, ipcRenderer } from 'electron'

import type { DesktopAPI } from '../shared/contracts'

const desktop: DesktopAPI = {
  app: {
    platform: process.platform,
    electronVersion: process.versions.electron
  },
  workspace: {
    open: (root) => ipcRenderer.invoke('workspace:open', { root }),
    createFolder: (path) => ipcRenderer.invoke('workspace:createFolder', { path }),
    list: (path = '') => ipcRenderer.invoke('workspace:list', { path }),
    readText: (path, range = {}) => ipcRenderer.invoke('workspace:readText', { path, ...range }),
    saveText: (path, content, expectedHash) => ipcRenderer.invoke('workspace:saveText', { path, content, expectedHash }),
    search: (query, maxResults = 100) => ipcRenderer.invoke('workspace:search', { query, maxResults })
  }
}

contextBridge.exposeInMainWorld('desktop', desktop)
