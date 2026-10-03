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
    onAgentEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
        const parsed = agentEventSchema.safeParse(payload)
        if (parsed.success) listener(parsed.data)
      }
      ipcRenderer.on('agent:event', handler)
      return () => ipcRenderer.removeListener('agent:event', handler)
    }
  },
  settings: {
    models: () => ipcRenderer.invoke('settings:models')
  },
  agent: {
    start: (input) => ipcRenderer.invoke('agent:start', input),
    cancel: (runId) => ipcRenderer.invoke('agent:cancel', { runId }),
    resolveApproval: (runId, approvalId, decision) => ipcRenderer.invoke('agent:resolveApproval', { runId, approvalId, decision }),
    listProposals: () => ipcRenderer.invoke('agent:listProposals'),
    applyProposal: (proposalId) => ipcRenderer.invoke('agent:applyProposal', { proposalId }),
    rejectProposal: (proposalId) => ipcRenderer.invoke('agent:rejectProposal', { proposalId })
  }
}

contextBridge.exposeInMainWorld('desktop', desktop)
