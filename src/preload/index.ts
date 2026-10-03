import { contextBridge, ipcRenderer } from 'electron'

import { agentEventSchema, type DesktopAPI, type FileProposal } from '../shared/contracts'

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
    search: (query, maxResults = 100) => ipcRenderer.invoke('workspace:search', { query, maxResults }),
    resolveImport: (fromPath, specifier) => ipcRenderer.invoke('workspace:resolveImport', { fromPath, specifier })
  },
  intelligence: {
    rebuild: () => ipcRenderer.invoke('intelligence:rebuild'),
    summary: () => ipcRenderer.invoke('intelligence:summary'),
    searchSymbols: (query, maxResults = 100) => ipcRenderer.invoke('intelligence:searchSymbols', { query, maxResults }),
    relatedFiles: (path) => ipcRenderer.invoke('intelligence:relatedFiles', { path })
  },
  git: {
    status: () => ipcRenderer.invoke('git:status'),
    diff: (path, staged = false) => ipcRenderer.invoke('git:diff', { path, staged }),
    stage: (paths) => ipcRenderer.invoke('git:stage', { paths }),
    unstage: (paths) => ipcRenderer.invoke('git:unstage', { paths }),
    commit: (message) => ipcRenderer.invoke('git:commit', { message }),
    branches: () => ipcRenderer.invoke('git:branches'),
    checkout: (branch) => ipcRenderer.invoke('git:checkout', { branch })
  },
  memory: {
    list: () => ipcRenderer.invoke('memory:list'),
    add: (category, text) => ipcRenderer.invoke('memory:add', { category, text }),
    remove: (id) => ipcRenderer.invoke('memory:remove', { id })
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    reload: () => ipcRenderer.invoke('skills:reload')
  },
  mcp: {
    servers: () => ipcRenderer.invoke('mcp:servers'),
    configure: (servers) => ipcRenderer.invoke('mcp:configure', servers),
    tools: (serverId) => ipcRenderer.invoke('mcp:tools', { serverId })
  },
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    create: (input) => ipcRenderer.invoke('sessions:create', input),
    appendMessage: (sessionId, role, content, referencedChatIds = []) => ipcRenderer.invoke('sessions:appendMessage', { sessionId, role, content, referencedChatIds }),
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
    models: () => ipcRenderer.invoke('settings:models'),
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch)
  },
  groq: {
    quota: () => ipcRenderer.invoke('groq:quota')
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
    resolveAllApprovals: (runId, decision) => ipcRenderer.invoke('agent:resolveAllApprovals', { runId, decision }),
    listProposals: () => ipcRenderer.invoke('agent:listProposals'),
    applyProposal: (proposalId) => unwrapProposalAction<FileProposal>(ipcRenderer.invoke('agent:applyProposal', { proposalId })),
    rejectProposal: (proposalId) => unwrapProposalAction<FileProposal>(ipcRenderer.invoke('agent:rejectProposal', { proposalId }))
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

async function unwrapProposalAction<T>(promise: Promise<unknown>): Promise<T> {
  const result = await promise as { ok?: boolean; value?: T; error?: { code?: string; message?: string } }
  if (result?.ok === true) return result.value as T
  const error = new Error(result?.error?.message ?? 'Nao foi possivel concluir a proposta.')
  Object.assign(error, { code: result?.error?.code ?? 'PROPOSAL_ACTION_FAILED' })
  throw error
}

contextBridge.exposeInMainWorld('desktop', desktop)
