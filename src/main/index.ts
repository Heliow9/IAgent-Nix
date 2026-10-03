import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'node:path'

import { ChangeService } from '../agent/changes/change-service'
import { GroqProvider } from '../agent/providers/groq-provider'
import { ContextBuilder } from '../agent/context/context-builder'
import { TaskRouter } from '../agent/router/task-router'
import { AgentRunner } from '../agent/runtime/agent-runner'
import { ApprovalPolicy } from '../agent/runtime/approval-policy'
import { ToolRegistry } from '../agent/tools/tool-registry'
import { registerWorkspaceTools } from '../agent/tools/workspace-tools'
import { registerIntelligenceTools } from '../agent/tools/intelligence-tools'
import { VerificationEngine } from '../agent/verification/verification-engine'
import { SubagentService } from '../agent/orchestration/subagent-service'
import { SkillEngine } from '../agent/skills/skill-engine'
import { registerAgentIpc } from './ipc/agent-ipc'
import { registerSessionIpc } from './ipc/session-ipc'
import { registerSettingsIpc } from './ipc/settings-ipc'
import { registerProjectIpc } from './ipc/project-ipc'
import { registerWorkspaceIpc, type WorkspaceAccess } from './ipc/workspace-ipc'
import { RunEventBus } from './state/run-events'
import { SessionStore } from './state/session-store'
import { WorkspaceError } from './workspace/workspace-service'
import { TerminalService } from './terminal/terminal-service'
import { registerTerminalIpc } from './ipc/terminal-ipc'
import { ChatTitleService } from '../agent/titles/chat-title-service'
import { RunScheduler } from '../agent/runtime/run-scheduler'
import { SettingsStore } from './state/settings-store'
import { WorkspaceIntelligenceService } from './intelligence/workspace-intelligence'
import { ProjectMemoryService } from './memory/project-memory'
import { McpService } from './mcp/mcp-service'
import { registerIntelligenceIpc } from './ipc/intelligence-ipc'
import { registerGitIpc } from './ipc/git-ipc'
import { registerCapabilitiesIpc } from './ipc/capabilities-ipc'
import { registerGroqIpc } from './ipc/groq-ipc'

try { process.loadEnvFile?.() } catch { /* .env is optional */ }

let mcpGlobal: McpService | undefined

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#090d14',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.setMenuBarVisibility(false)
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
  Menu.setApplicationMenu(null)
  const store = await SessionStore.open(join(app.getPath('userData'), 'state'))
  const settingsStore = await SettingsStore.open(join(app.getPath('userData'), 'settings', 'nix.json'))
  const intelligence = new WorkspaceIntelligenceService()
  const memory = new ProjectMemoryService(join(app.getPath('userData'), 'project-memory'))
  const skills = new SkillEngine()
  const mcp = new McpService(join(app.getPath('userData'), 'settings', 'mcp.json'))
  mcpGlobal = mcp
  await mcp.load()
  await store.recoverInterruptedRuns()
  const eventBus = new RunEventBus()
  const workspaceAccess: WorkspaceAccess = {}
  const requireWorkspace = () => {
    if (!workspaceAccess.current) throw new WorkspaceError('NOT_OPEN', 'No workspace is open')
    return workspaceAccess.current
  }
  const changes = new ChangeService(requireWorkspace, undefined, store)
  const tools = new ToolRegistry()
  registerWorkspaceTools(tools, requireWorkspace, changes)
  const provider = new GroqProvider({
    getSettings: () => settingsStore.get(),
    usageFilePath: join(app.getPath('userData'), 'state', 'groq-usage.json')
  })
  const models = settingsStore.get()
  const verification = new VerificationEngine(() => requireWorkspace().root)
  const subagents = new SubagentService(provider, models.deepModel, () => settingsStore.get())
  registerIntelligenceTools(tools, requireWorkspace, intelligence, memory, verification, subagents, mcp)
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
    applyProposal: (proposalId) => changes.apply(proposalId),
    titleService: new ChatTitleService(provider, models.fastModel, () => settingsStore.get()),
    skills, memory, intelligence, verification,
    getWorkspaceRoot: () => requireWorkspace().root,
    getSettings: () => settingsStore.get()
  })
  const scheduler = new RunScheduler(runner, store, eventBus, models.maxConcurrentRuns)
  await scheduler.recover()
  registerSessionIpc(store, eventBus)
  registerSettingsIpc(settingsStore)
  registerGroqIpc(provider)
  registerProjectIpc()
  registerWorkspaceIpc(workspaceAccess, async (root) => { intelligence.setRoot(root); skills.setWorkspace(root); await Promise.allSettled([intelligence.rebuild(root), skills.reload()]) })
  registerIntelligenceIpc(workspaceAccess, intelligence)
  registerGitIpc(workspaceAccess)
  registerCapabilitiesIpc(workspaceAccess, memory, skills, mcp)
  registerAgentIpc(scheduler, changes)
  registerTerminalIpc(new TerminalService({ getWorkspaceRoot: () => requireWorkspace().root }))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => mcpGlobal?.close())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
