import { contextBridge, ipcRenderer } from 'electron'

import { agentEventSchema, type DesktopAPI } from '../shared/contracts'

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
  },
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    create: (input) => ipcRenderer.invoke('sessions:create', input),
    appendMessage: (sessionId, role, content) => ipcRenderer.invoke('sessions:appendMessage', { sessionId, role, content }),
    listRuns: (sessionId) => ipcRenderer.invoke('sessions:listRuns', { sessionId }),
    events: (runId) => ipcRenderer.invoke('sessions:events', { runId }),
    onAgentEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
        const parsed = agentEventSchema.safeParse(payload)
        if (parsed.success) listener(parsed.data)
      }
      ipcRenderer.on('agent:event', handler)
      return () => ipcRenderer.removeListener('agent:event', handler)
    }
  },
  conversations: {
    listWorkspaces: () => ipcRenderer.invoke('conversations:listWorkspaces'),
    touchWorkspace: (root) => ipcRenderer.invoke('conversations:touchWorkspace', { root }),
    listChats: (workspaceId, includeArchived = false) => ipcRenderer.invoke('conversations:listChats', { workspaceId, includeArchived }),
    createChat: (workspaceId, title) => ipcRenderer.invoke('conversations:createChat', { workspaceId, title }),
    renameChat: (chatId, title) => ipcRenderer.invoke('conversations:renameChat', { chatId, title }),
    archiveChat: (chatId) => ipcRenderer.invoke('conversations:archiveChat', { chatId })
  },
  settings: {
    models: () => ipcRenderer.invoke('settings:models')
  },
  projects: {
    preview: (input) => ipcRenderer.invoke('projects:preview', input),
    create: (input, confirmationToken) => ipcRenderer.invoke('projects:create', { input, confirmationToken })
  },
  agent: {
    start: (input) => ipcRenderer.invoke('agent:start', input),
    resume: (runId) => ipcRenderer.invoke('agent:resume', { runId }),
    cancel: (runId) => ipcRenderer.invoke('agent:cancel', { runId }),
    resolveApproval: (runId, approvalId, decision) => ipcRenderer.invoke('agent:resolveApproval', { runId, approvalId, decision }),
    listProposals: () => ipcRenderer.invoke('agent:listProposals'),
    applyProposal: (proposalId) => ipcRenderer.invoke('agent:applyProposal', { proposalId }),
    rejectProposal: (proposalId) => ipcRenderer.invoke('agent:rejectProposal', { proposalId })
  },
  terminal: {
    create: (input) => ipcRenderer.invoke('terminal:create', input),
    write: (id, data) => ipcRenderer.invoke('terminal:write', { id, data }),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', { id, cols, rows }),
    dispose: (id) => ipcRenderer.invoke('terminal:dispose', { id }),
    onData: (id, listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }): void => { if (payload.id === id) listener(payload.data) }
      ipcRenderer.on('terminal:data', handler)
      void ipcRenderer.invoke('terminal:subscribe', { id })
      return () => { ipcRenderer.removeListener('terminal:data', handler); void ipcRenderer.invoke('terminal:unsubscribe', { id }) }
    },
    onExit: (id, listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { id: string; exitCode: number }): void => { if (payload.id === id) listener(payload.exitCode) }
      ipcRenderer.on('terminal:exit', handler)
      void ipcRenderer.invoke('terminal:subscribe', { id })
      return () => { ipcRenderer.removeListener('terminal:exit', handler); void ipcRenderer.invoke('terminal:unsubscribe', { id }) }
    }
  }
}

contextBridge.exposeInMainWorld('desktop', desktop)
