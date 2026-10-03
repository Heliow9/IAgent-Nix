import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

import type { AgentEvent, ChatMessage, DesktopAPI, FileProposal, PermissionMode, RunStatus, WorkspaceEntry } from '../../../shared/contracts'
import type { ToolActivityItem } from '../components/agent/ToolActivity'
import { languageForPath } from '../lib/languages'

export type ActivityId = 'files' | 'search' | 'source-control' | 'agent' | 'settings'
export type PanelId = 'sidebar' | 'bottom' | 'agent'

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface PersistedLayout {
  selectedActivity: ActivityId
  panelSizes: Record<PanelId, number>
}

export interface IdeState {
  workspaceRoot?: string
  workspaceError?: { code: string; message: string }
  loadingWorkspace: boolean
  loadingDirectories: string[]
  entriesByDirectory: Record<string, WorkspaceEntry[]>
  selectedActivity: ActivityId
  panelSizes: Record<PanelId, number>
  openTabs: string[]
  buffers: Record<string, EditorBuffer>
  loadingFiles: string[]
  activePath?: string
  activeSessionId?: string
  activeRunId?: string
  permissionMode: PermissionMode
  conversationMessages: ChatMessage[]
  agentRuns: Record<string, AgentRunView>
  openWorkspace(root: string): Promise<void>
  loadDirectory(path: string): Promise<void>
  selectFile(path: string): void
  openFile(path: string, reload?: boolean): Promise<void>
  updateBuffer(path: string, content: string): void
  saveFile(path: string): Promise<void>
  closeFile(path: string, decision: 'save' | 'discard' | 'cancel'): Promise<void>
  sendAgentMessage(prompt: string): Promise<void>
  resumeAgentRun(): Promise<void>
  cancelAgentRun(): Promise<void>
  reduceAgentEvent(event: AgentEvent): void
  resolveAgentApproval(runId: string, approvalId: string, decision: 'approved' | 'rejected'): Promise<void>
  applyProposal(proposalId: string): Promise<void>
  rejectProposal(proposalId: string): Promise<void>
  setPermissionMode(mode: PermissionMode): void
  selectActivity(activity: ActivityId): void
  setPanelSize(panel: PanelId, size: number): void
}

export interface AgentRunView {
  id: string
  status: RunStatus
  assistantText: string
  tools: ToolActivityItem[]
  approvals: Array<{ id: string; summary: string; status: 'pending' | 'approved' | 'rejected' }>
  proposals: FileProposal[]
  resumable: boolean
  error?: string
}

export interface EditorBuffer {
  path: string
  content: string
  savedContent: string
  hash?: string
  language: string
  dirty: boolean
  error?: { code: string; message: string }
  saveError?: { code: string; message: string }
}

interface StoreOptions {
  desktop?: () => DesktopAPI
  storage?: KeyValueStorage
}

const STORAGE_KEY = 'groq-studio.layout.v1'
const defaultLayout: PersistedLayout = {
  selectedActivity: 'files',
  panelSizes: { sidebar: 272, bottom: 220, agent: 360 }
}

export type IdeStore = StoreApi<IdeState>

export function createIdeStore(options: StoreOptions = {}): IdeStore {
  const storage = options.storage
  const layout = readLayout(storage)
  const desktop = options.desktop ?? (() => window.desktop)
  const saveLayout = (state: Pick<IdeState, 'selectedActivity' | 'panelSizes'>): void => {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ selectedActivity: state.selectedActivity, panelSizes: state.panelSizes }))
  }
  return createStore<IdeState>((set, get) => ({
    loadingWorkspace: false,
    loadingDirectories: [],
    entriesByDirectory: {},
    selectedActivity: layout.selectedActivity,
    panelSizes: layout.panelSizes,
    openTabs: [],
    buffers: {},
    loadingFiles: [],
    permissionMode: 'ask',
    conversationMessages: [],
    agentRuns: {},
    async openWorkspace(root) {
      set({ loadingWorkspace: true, workspaceError: undefined })
      try {
        const opened = await desktop().workspace.open(root)
        const entries = await desktop().workspace.list('')
        const sessions = await desktop().sessions.list()
        const session = sessions.find((item) => sameWorkspace(item.workspaceRoot, opened.root))
        const hydrated = session ? await hydrateConversation(desktop(), session.id) : undefined
        set({
          workspaceRoot: opened.root,
          entriesByDirectory: { '': entries },
          loadingWorkspace: false,
          openTabs: [],
          buffers: {},
          loadingFiles: [],
          activePath: undefined,
          activeSessionId: session?.id,
          activeRunId: hydrated?.activeRunId,
          conversationMessages: session?.messages ?? [],
          agentRuns: hydrated?.agentRuns ?? {}
        })
      } catch (error) {
        set({ loadingWorkspace: false, workspaceError: normalizeError(error) })
      }
    },
    async loadDirectory(path) {
      if (get().entriesByDirectory[path]) return
      set((state) => ({ loadingDirectories: [...state.loadingDirectories, path] }))
      try {
        const entries = await desktop().workspace.list(path)
        set((state) => ({ entriesByDirectory: { ...state.entriesByDirectory, [path]: entries } }))
      } catch (error) {
        set({ workspaceError: normalizeError(error) })
      } finally {
        set((state) => ({ loadingDirectories: state.loadingDirectories.filter((item) => item !== path) }))
      }
    },
    selectFile(path) {
      set((state) => ({ activePath: path, openTabs: state.openTabs.includes(path) ? state.openTabs : [...state.openTabs, path] }))
      void get().openFile(path)
    },
    async openFile(path, reload = false) {
      set((state) => ({ activePath: path, openTabs: state.openTabs.includes(path) ? state.openTabs : [...state.openTabs, path] }))
      if (get().buffers[path] && !reload) return
      set((state) => ({ loadingFiles: [...state.loadingFiles.filter((item) => item !== path), path] }))
      try {
        const result = await desktop().workspace.readText(path)
        set((state) => ({ buffers: { ...state.buffers, [path]: {
          path, content: result.content, savedContent: result.content, hash: result.hash,
          language: languageForPath(path), dirty: false
        } } }))
      } catch (error) {
        set((state) => ({ buffers: { ...state.buffers, [path]: {
          path, content: '', savedContent: '', language: languageForPath(path), dirty: false,
          error: normalizeError(error)
        } } }))
      } finally {
        set((state) => ({ loadingFiles: state.loadingFiles.filter((item) => item !== path) }))
      }
    },
    updateBuffer(path, content) {
      const buffer = get().buffers[path]
      if (!buffer || buffer.error) return
      set((state) => ({ buffers: { ...state.buffers, [path]: {
        ...buffer, content, dirty: content !== buffer.savedContent, saveError: undefined
      } } }))
    },
    async saveFile(path) {
      const buffer = get().buffers[path]
      if (!buffer || buffer.error || !buffer.dirty) return
      try {
        const result = await desktop().workspace.saveText(path, buffer.content, buffer.hash)
        set((state) => ({ buffers: { ...state.buffers, [path]: {
          ...buffer, hash: result.hash, savedContent: buffer.content, dirty: false, saveError: undefined
        } } }))
      } catch (error) {
        set((state) => ({ buffers: { ...state.buffers, [path]: { ...buffer, saveError: normalizeError(error) } } }))
      }
    },
    async closeFile(path, decision) {
      const buffer = get().buffers[path]
      if (buffer?.dirty && decision === 'cancel') return
      if (buffer?.dirty && decision === 'save') {
        await get().saveFile(path)
        if (get().buffers[path]?.dirty) return
      }
      set((state) => {
        const openTabs = state.openTabs.filter((item) => item !== path)
        const buffers = { ...state.buffers }
        delete buffers[path]
        return { openTabs, buffers, activePath: state.activePath === path ? openTabs.at(-1) : state.activePath }
      })
    },
    async sendAgentMessage(prompt) {
      const workspaceRoot = get().workspaceRoot
      if (!workspaceRoot) throw new Error('Open a workspace before starting the agent')
      let sessionId = get().activeSessionId
      if (!sessionId) {
        const sessions = await desktop().sessions.list()
        const existing = sessions.find((session) => session.workspaceRoot === workspaceRoot)
        sessionId = existing?.id ?? (await desktop().sessions.create({ title: workspaceRoot.split(/[\\/]/).at(-1) ?? 'Workspace', workspaceRoot })).id
        set({ activeSessionId: sessionId })
      }
      const optimisticMessage: ChatMessage = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        role: 'user', content: prompt, createdAt: new Date().toISOString()
      }
      set((state) => ({ conversationMessages: [...state.conversationMessages, optimisticMessage] }))
      const result = await desktop().agent.start({
        sessionId, prompt, permissionMode: get().permissionMode,
        attachedFiles: get().activePath ? [get().activePath!] : []
      })
      set((state) => ({ activeRunId: result.runId, agentRuns: { ...state.agentRuns, [result.runId]: emptyAgentRun(result.runId) } }))
    },
    async resumeAgentRun() {
      const runId = get().activeRunId
      if (!runId) return
      await desktop().agent.resume(runId)
      set((state) => ({ agentRuns: { ...state.agentRuns, [runId]: {
        ...(state.agentRuns[runId] ?? emptyAgentRun(runId)), status: 'running', resumable: false, error: undefined
      } } }))
    },
    async cancelAgentRun() {
      const runId = get().activeRunId
      if (runId) await desktop().agent.cancel(runId)
    },
    reduceAgentEvent(event) {
      if (event.type === 'editor.open.requested') {
        get().selectFile(event.path)
        return
      }
      set((state) => {
        const run = reduceRun(state.agentRuns[event.runId] ?? emptyAgentRun(event.runId), event)
        const alreadyHasAnswer = state.conversationMessages.some((message) => message.id === `${event.runId}-assistant`)
        const conversationMessages = event.type === 'assistant.completed' && !alreadyHasAnswer
          ? [...state.conversationMessages, { id: `${event.runId}-assistant`, role: 'assistant' as const, content: event.content, createdAt: event.timestamp }]
          : state.conversationMessages
        return { activeRunId: state.activeRunId ?? event.runId, conversationMessages, agentRuns: { ...state.agentRuns, [event.runId]: run } }
      })
    },
    async resolveAgentApproval(runId, approvalId, decision) {
      await desktop().agent.resolveApproval(runId, approvalId, decision)
    },
    async applyProposal(proposalId) {
      const updated = await desktop().agent.applyProposal(proposalId)
      set((state) => ({ agentRuns: mapProposal(state.agentRuns, proposalId, updated) }))
    },
    async rejectProposal(proposalId) {
      const updated = await desktop().agent.rejectProposal(proposalId)
      set((state) => ({ agentRuns: mapProposal(state.agentRuns, proposalId, updated) }))
    },
    setPermissionMode(permissionMode) { set({ permissionMode }) },
    selectActivity(selectedActivity) {
      set({ selectedActivity })
      saveLayout({ selectedActivity, panelSizes: get().panelSizes })
    },
    setPanelSize(panel, size) {
      const panelSizes = { ...get().panelSizes, [panel]: Math.round(size) }
      set({ panelSizes })
      saveLayout({ selectedActivity: get().selectedActivity, panelSizes })
    }
  }))
}

function emptyAgentRun(id: string): AgentRunView {
  return { id, status: 'queued', assistantText: '', tools: [], approvals: [], proposals: [], resumable: false }
}

function reduceRun(current: AgentRunView, event: AgentEvent): AgentRunView {
  const run: AgentRunView = { ...current, tools: [...current.tools], approvals: [...current.approvals], proposals: [...current.proposals] }
  if (event.type === 'run.started' || event.type === 'run.resumed') { run.status = 'running'; run.resumable = false; run.error = undefined }
  else if (event.type === 'assistant.delta') run.assistantText += event.delta
  else if (event.type === 'assistant.completed') run.assistantText = event.content
  else if (event.type === 'tool.requested') run.tools.push({ id: event.toolCallId, name: event.name, status: 'requested', arguments: event.arguments })
  else if (event.type === 'tool.started') run.tools = updateTool(run.tools, event.toolCallId, { status: 'running' })
  else if (event.type === 'tool.completed') run.tools = updateTool(run.tools, event.toolCallId, { status: 'completed', result: event.result })
  else if (event.type === 'approval.requested') { run.status = 'waiting_approval'; run.approvals.push({ id: event.approvalId, summary: event.summary, status: 'pending' }) }
  else if (event.type === 'approval.resolved') { run.status = 'running'; run.approvals = run.approvals.map((item) => item.id === event.approvalId ? { ...item, status: event.decision } : item) }
  else if (event.type === 'file.proposed' && !run.proposals.some((item) => item.id === event.proposalId)) run.proposals.push({ id: event.proposalId, runId: event.runId, kind: 'write', path: event.path, diff: event.diff, status: 'pending' })
  else if (event.type === 'file.applied') run.proposals = run.proposals.map((item) => item.id === event.proposalId ? { ...item, status: 'applied' } : item)
  else if (event.type === 'run.completed') { run.status = 'completed'; run.resumable = false }
  else if (event.type === 'run.cancelled') { run.status = 'cancelled'; run.resumable = false }
  else if (event.type === 'run.failed') { run.status = 'failed'; run.error = event.message; run.resumable = event.resumable }
  return run
}

async function hydrateConversation(desktop: DesktopAPI, sessionId: string): Promise<{ activeRunId?: string; agentRuns: Record<string, AgentRunView> }> {
  const [summaries, proposals] = await Promise.all([desktop.sessions.listRuns(sessionId), desktop.agent.listProposals()])
  const events = await Promise.all(summaries.map((run) => desktop.sessions.events(run.id)))
  const agentRuns: Record<string, AgentRunView> = {}
  summaries.forEach((summary, index) => {
    let view = emptyAgentRun(summary.id)
    for (const event of events[index]) view = reduceRun(view, event)
    view.status = summary.status
    view.resumable = summary.resumable
    view.proposals = mergeProposals(view.proposals, proposals.filter((proposal) => proposal.runId === summary.id))
    agentRuns[summary.id] = view
  })
  return { activeRunId: summaries.at(-1)?.id, agentRuns }
}

function mergeProposals(fromEvents: FileProposal[], persisted: FileProposal[]): FileProposal[] {
  const values = new Map(fromEvents.map((proposal) => [proposal.id, proposal]))
  for (const proposal of persisted) values.set(proposal.id, proposal)
  return [...values.values()]
}

function sameWorkspace(left: string, right: string): boolean {
  return left.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() === right.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
}

function updateTool(items: ToolActivityItem[], id: string, update: Partial<ToolActivityItem>): ToolActivityItem[] {
  return items.map((item) => item.id === id ? { ...item, ...update } : item)
}

function mapProposal(runs: Record<string, AgentRunView>, proposalId: string, proposal: FileProposal): Record<string, AgentRunView> {
  return Object.fromEntries(Object.entries(runs).map(([id, run]) => [id, {
    ...run,
    proposals: run.proposals.map((item) => item.id === proposalId ? proposal : item)
  }]))
}

const browserStorage = typeof window !== 'undefined' ? window.localStorage : undefined
export const ideStore = createIdeStore({ storage: browserStorage })

export function useIdeStore<T>(selector: (state: IdeState) => T): T {
  return useStore(ideStore, selector)
}

function readLayout(storage?: KeyValueStorage): PersistedLayout {
  if (!storage) return structuredClone(defaultLayout)
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? '') as Partial<PersistedLayout>
    return {
      selectedActivity: value.selectedActivity ?? defaultLayout.selectedActivity,
      panelSizes: { ...defaultLayout.panelSizes, ...value.panelSizes }
    }
  } catch {
    return structuredClone(defaultLayout)
  }
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : 'WORKSPACE_ERROR'
    return { code, message: error.message }
  }
  return { code: 'WORKSPACE_ERROR', message: 'Nao foi possivel abrir o workspace.' }
}
