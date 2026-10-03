import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

import { ChangeService } from '../agent/changes/change-service'
import { GroqProvider } from '../agent/providers/groq-provider'
import { ContextBuilder } from '../agent/context/context-builder'
import { TaskRouter } from '../agent/router/task-router'
import { AgentRunner } from '../agent/runtime/agent-runner'
import { ApprovalPolicy } from '../agent/runtime/approval-policy'
import { ToolRegistry } from '../agent/tools/tool-registry'
import { registerWorkspaceTools } from '../agent/tools/workspace-tools'
import { registerAgentIpc } from './ipc/agent-ipc'
import { registerSessionIpc } from './ipc/session-ipc'
import { registerSettingsIpc, resolveModelSettings } from './ipc/settings-ipc'
import { registerProjectIpc } from './ipc/project-ipc'
import { registerWorkspaceIpc, type WorkspaceAccess } from './ipc/workspace-ipc'
import { RunEventBus } from './state/run-events'
import { SessionStore } from './state/session-store'
import { WorkspaceError } from './workspace/workspace-service'
import { TerminalService } from './terminal/terminal-service'
import { registerTerminalIpc } from './ipc/terminal-ipc'

try { process.loadEnvFile?.() } catch { /* .env is optional */ }

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
  const eventBus = new RunEventBus()
  const workspaceAccess: WorkspaceAccess = {}
  const requireWorkspace = () => {
    if (!workspaceAccess.current) throw new WorkspaceError('NOT_OPEN', 'No workspace is open')
    return workspaceAccess.current
  }
  const changes = new ChangeService(requireWorkspace)
  const tools = new ToolRegistry()
  registerWorkspaceTools(tools, requireWorkspace, changes)
  const provider = new GroqProvider()
  const models = resolveModelSettings()
  const runner = new AgentRunner({
    provider,
    tools,
    store,
    eventBus,
    approvalPolicy: new ApprovalPolicy(),
    deepModel: models.deepModel,
    fastModel: models.fastModel,
    router: new TaskRouter(provider, models.fastModel),
    contextBuilder: new ContextBuilder(),
    loadAttachment: async (path) => ({ path, content: (await requireWorkspace().readText(path)).content }),
    applyProposal: (proposalId) => changes.apply(proposalId)
  })
  registerSessionIpc(store, eventBus)
  registerSettingsIpc()
  registerProjectIpc()
  registerWorkspaceIpc(workspaceAccess)
  registerAgentIpc(runner, changes)
  registerTerminalIpc(new TerminalService({ getWorkspaceRoot: () => requireWorkspace().root }))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
