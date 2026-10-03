import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

import { registerWorkspaceIpc } from './ipc/workspace-ipc'
import { registerSessionIpc } from './ipc/session-ipc'
import { registerSettingsIpc } from './ipc/settings-ipc'
import { RunEventBus } from './state/run-events'
import { SessionStore } from './state/session-store'

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#090d14',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(async () => {
  const store = await SessionStore.open(join(app.getPath('userData'), 'state'))
  await store.recoverInterruptedRuns()
  registerSessionIpc(store, new RunEventBus())
  registerSettingsIpc()
  registerWorkspaceIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
