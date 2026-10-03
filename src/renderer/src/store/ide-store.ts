import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

import type { AgentEvent, ChatMessage, ChatRecord, DesktopAPI, FileProposal, PermissionMode, RunStatus, WorkspaceEntry, WorkspaceRecord } from '../../../shared/contracts'
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
  currentWorkspaceId?: string
  knownWorkspaces: WorkspaceRecord[]
  recentWorkspaces: WorkspaceRecord[]
  chats: ChatRecord[]
  selectedChatId?: string
  chatViews: Record<string, ChatView>
  runChatIds: Record<string, string>
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
  loadKnownWorkspaces(): Promise<void>
  createChat(): Promise<void>
  selectChat(chatId: string): Promise<void>
  renameChat(chatId: string, title: string): Promise<void>
  archiveChat(chatId: string): Promise<void>
  openWorkspace(root: string): Promise<void>
  goToWorkspaceHome(): Promise<void>
  loadDirectory(path: string): Promise<void>
  selectFile(path: string): void
  openFile(path: string, reload?: boolean): Promise<void>
  updateBuffer(path: string, content: string): void
  saveFile(path: string): Promise<void>
  closeFile(path: string, decision: 'save' | 'discard' | 'cancel'): Promise<void>
  sendAgentMessage(prompt: string, referencedChatIds?: string[]): Promise<void>
  resumeAgentRun(): Promise<void>
  cancelAgentRun(): Promise<void>
  reduceAgentEvent(event: AgentEvent): void
  resolveAgentApproval(runId: string, approvalId: string, decision: 'approved' | 'rejected'): Promise<void>
  resolveAllAgentApprovals(runId: string, decision: 'approved' | 'rejected'): Promise<void>
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
  queuePosition?: number
  configuration?: { model: string; reasoningEffort: 'low' | 'medium' | 'high'; contextTokenBudget: number; freeTierMode: boolean }
  error?: string
}

export interface ChatView {
  messages: ChatMessage[]
  agentRuns: Record<string, AgentRunView>
  activeRunId?: string
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
  agentPreviewContent?: string
  agentPreviewProposalId?: string
  agentPreviewing?: boolean
}

interface StoreOptions {
  desktop?: () => DesktopAPI
  storage?: KeyValueStorage
}

const STORAGE_KEY = 'groq-studio.layout.v1'
const defaultLayout: PersistedLayout = {
  selectedActivity: 'files',
  panelSizes: { sidebar: 272, bottom: 220, agent: 560 }
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
    knownWorkspaces: [],
    recentWorkspaces: [],
    chats: [],
    chatViews: {},
    runChatIds: {},
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
    async loadKnownWorkspaces() {
      const conversations = desktop().conversations
      if (!conversations) return
      const knownWorkspaces = await conversations.listWorkspaces()
      set({ knownWorkspaces, recentWorkspaces: knownWorkspaces.slice(0, 5) })
    },
    async createChat() {
      const workspaceId = get().currentWorkspaceId
      const api = desktop().conversations
      if (!workspaceId || !api) return
      const chat = await api.createChat(workspaceId)
      const view: ChatView = { messages: [], agentRuns: {} }
      set((state) => ({
        chats: [chat, ...state.chats], selectedChatId: chat.id, activeSessionId: chat.id,
        conversationMessages: [], agentRuns: {}, activeRunId: undefined,
        chatViews: { ...state.chatViews, [chat.id]: view }
      }))
    },
    async selectChat(chatId) {
      const existing = get().chatViews[chatId]
      if (existing) {
        set({ selectedChatId: chatId, activeSessionId: chatId, conversationMessages: existing.messages, agentRuns: existing.agentRuns, activeRunId: existing.activeRunId })
        return
      }
      const session = (await desktop().sessions.list()).find((item) => item.id === chatId)
      if (!session) return
      const hydrated = await hydrateConversation(desktop(), chatId)
      const view: ChatView = { messages: session.messages, agentRuns: hydrated.agentRuns, activeRunId: hydrated.activeRunId }
      set((state) => ({
        selectedChatId: chatId, activeSessionId: chatId, conversationMessages: view.messages,
        agentRuns: view.agentRuns, activeRunId: view.activeRunId, chatViews: { ...state.chatViews, [chatId]: view },
        runChatIds: { ...state.runChatIds, ...Object.fromEntries(Object.keys(view.agentRuns).map((runId) => [runId, chatId])) }
      }))
    },
    async renameChat(chatId, title) {
      const updated = await desktop().conversations?.renameChat(chatId, title)
      if (updated) set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? updated : chat) }))
    },
    async archiveChat(chatId) {
      const updated = await desktop().conversations?.archiveChat(chatId)
      if (!updated) return
      const next = get().chats.find((chat) => chat.id !== chatId && chat.status === 'active')
      set((state) => ({ chats: state.chats.map((chat) => chat.id === chatId ? updated : chat) }))
      if (get().selectedChatId === chatId) {
        if (next) await get().selectChat(next.id)
        else await get().createChat()
      }
    },
    async goToWorkspaceHome() {
      const activeRunId = get().activeRunId
      const activeRun = activeRunId ? get().agentRuns[activeRunId] : undefined
      if (activeRunId && activeRun && ['queued', 'running', 'waiting_approval'].includes(activeRun.status)) {
        try { await desktop().agent.cancel(activeRunId) } catch { /* navigation should still be possible */ }
      }
      set({
        workspaceRoot: undefined,
        currentWorkspaceId: undefined,
        chats: [],
        selectedChatId: undefined,
        chatViews: {},
        runChatIds: {},
        workspaceError: undefined,
        loadingWorkspace: false,
        loadingDirectories: [],
        entriesByDirectory: {},
        openTabs: [],
        buffers: {},
        loadingFiles: [],
        activePath: undefined,
        activeSessionId: undefined,
        activeRunId: undefined,
        conversationMessages: [],
        agentRuns: {},
        selectedActivity: 'files'
      })
      await get().loadKnownWorkspaces()
    },
    async openWorkspace(root) {
      set({ loadingWorkspace: true, workspaceError: undefined })
      try {
        const opened = await desktop().workspace.open(root)
        const entries = await desktop().workspace.list('')
        const conversationApi = desktop().conversations
        let workspaceRecord: WorkspaceRecord | undefined
        let chats: ChatRecord[] = []
        if (conversationApi) {
          try {
            workspaceRecord = await conversationApi.touchWorkspace(opened.root)
            chats = await conversationApi.listChats(workspaceRecord.id, true)
          } catch { /* recent-workspace persistence must not prevent opening a local folder */ }
        }
        const sessions = await desktop().sessions.list()
        const selectedChat = chats.find((item) => item.status === 'active')
        const session = selectedChat
          ? sessions.find((item) => item.id === selectedChat.id)
          : sessions.find((item) => sameWorkspace(item.workspaceRoot, opened.root))
        const hydrated = session ? await hydrateConversation(desktop(), session.id) : undefined
        const initialView: ChatView | undefined = session ? { messages: session.messages, agentRuns: hydrated?.agentRuns ?? {}, activeRunId: hydrated?.activeRunId } : undefined
        set({
          workspaceRoot: opened.root,
          currentWorkspaceId: workspaceRecord?.id,
          chats,
          knownWorkspaces: workspaceRecord
            ? [workspaceRecord, ...get().knownWorkspaces.filter((item) => item.id !== workspaceRecord.id)]
            : get().knownWorkspaces,
          recentWorkspaces: workspaceRecord
            ? [workspaceRecord, ...get().recentWorkspaces.filter((item) => item.id !== workspaceRecord.id)].slice(0, 5)
            : get().recentWorkspaces,
          entriesByDirectory: { '': entries },
          loadingWorkspace: false,
          openTabs: [],
          buffers: {},
          loadingFiles: [],
          activePath: undefined,
          activeSessionId: session?.id,
          selectedChatId: session?.id,
          activeRunId: hydrated?.activeRunId,
          conversationMessages: session?.messages ?? [],
          agentRuns: hydrated?.agentRuns ?? {},
          chatViews: session && initialView ? { [session.id]: initialView } : {},
          runChatIds: session && hydrated ? Object.fromEntries(Object.keys(hydrated.agentRuns).map((runId) => [runId, session.id])) : {}
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
    async sendAgentMessage(prompt, referencedChatIds = []) {
      const workspaceRoot = get().workspaceRoot
      if (!workspaceRoot) throw new Error('Open a workspace before starting the agent')
      let sessionId = get().selectedChatId ?? get().activeSessionId
      if (!sessionId) {
        const workspaceId = get().currentWorkspaceId
        const conversations = desktop().conversations
        const created = workspaceId && conversations
          ? await conversations.createChat(workspaceId, provisionalTitle(prompt))
          : undefined
        sessionId = created?.id ?? (await desktop().sessions.create({ title: provisionalTitle(prompt), workspaceRoot })).id
        set((state) => ({ activeSessionId: sessionId, selectedChatId: sessionId, chats: created ? [created, ...state.chats] : state.chats }))
      }
      const optimisticMessage: ChatMessage = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        chatId: sessionId, role: 'user', content: prompt, referencedChatIds, createdAt: new Date().toISOString()
      }
      set((state) => {
        const conversationMessages = [...state.conversationMessages, optimisticMessage]
        return {
          conversationMessages,
          chatViews: { ...state.chatViews, [sessionId!]: { messages: conversationMessages, agentRuns: state.agentRuns, activeRunId: state.activeRunId } }
        }
      })
      const result = await desktop().agent.start({
        sessionId, prompt, permissionMode: get().permissionMode,
        attachedFiles: get().activePath ? [get().activePath!] : [], referencedChatIds
      })
      set((state) => {
        const agentRuns = { ...state.agentRuns, [result.runId]: { ...emptyAgentRun(result.runId), status: result.status ?? 'queued', queuePosition: result.queuePosition } }
        return {
          activeRunId: result.runId, agentRuns,
          chatViews: { ...state.chatViews, [sessionId!]: { messages: state.conversationMessages, agentRuns, activeRunId: result.runId } },
          runChatIds: { ...state.runChatIds, [result.runId]: sessionId! }
        }
      })
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
      if (event.type === 'chat.title.updated') {
        set((state) => ({ chats: state.chats.map((chat) => chat.id === event.chatId ? { ...chat, title: event.title, titleSource: 'generated' } : chat) }))
        return
      }
      if (event.type === 'editor.open.requested') {
        const chatId = get().runChatIds[event.runId]
        if (!chatId || chatId === get().selectedChatId) get().selectFile(event.path)
        return
      }
      if (event.type === 'file.proposed' && get().openTabs.includes(event.path)) {
        void previewOpenAgentProposal(desktop(), get, set, event.proposalId, event.path)
      }
      if (event.type === 'file.applied') {
        void synchronizeAppliedFile(get, set, event.path, event.proposalId)
      }
      set((state) => {
        const chatId = state.runChatIds[event.runId] ?? state.selectedChatId
        if (!chatId) {
          const run = reduceRun(state.agentRuns[event.runId] ?? emptyAgentRun(event.runId), event)
          const alreadyHasAnswer = state.conversationMessages.some((message) => message.id === `${event.runId}-assistant`)
          const conversationMessages = event.type === 'assistant.completed' && !alreadyHasAnswer
            ? [...state.conversationMessages, { id: `${event.runId}-assistant`, role: 'assistant' as const, content: event.content, createdAt: event.timestamp }]
            : state.conversationMessages
          return { activeRunId: state.activeRunId ?? event.runId, conversationMessages, agentRuns: { ...state.agentRuns, [event.runId]: run } }
        }
        const currentView = state.chatViews[chatId] ?? (chatId === state.selectedChatId
          ? { messages: state.conversationMessages, agentRuns: state.agentRuns, activeRunId: state.activeRunId }
          : { messages: [], agentRuns: {} })
        const run = reduceRun(currentView.agentRuns[event.runId] ?? emptyAgentRun(event.runId), event)
        const alreadyHasAnswer = currentView.messages.some((message) => message.id === `${event.runId}-assistant`)
        const messages = event.type === 'assistant.completed' && !alreadyHasAnswer
          ? [...currentView.messages, { id: `${event.runId}-assistant`, chatId, role: 'assistant' as const, content: event.content, createdAt: event.timestamp }]
          : currentView.messages
        const agentRuns = { ...currentView.agentRuns, [event.runId]: run }
        const view = { messages, agentRuns, activeRunId: currentView.activeRunId ?? event.runId }
        const shared = { chatViews: { ...state.chatViews, [chatId]: view }, runChatIds: { ...state.runChatIds, [event.runId]: chatId } }
        return chatId === state.selectedChatId
          ? { ...shared, activeRunId: view.activeRunId, conversationMessages: messages, agentRuns }
          : shared
      })
    },
    async resolveAgentApproval(runId, approvalId, decision) {
      await desktop().agent.resolveApproval(runId, approvalId, decision)
    },
    async resolveAllAgentApprovals(runId, decision) {
      await desktop().agent.resolveAllApprovals(runId, decision)
    },
    async applyProposal(proposalId) {
      const path = findProposalPath(get().agentRuns, proposalId)
      try {
        const updated = await desktop().agent.applyProposal(proposalId)
        set((state) => ({
          agentRuns: mapProposal(state.agentRuns, proposalId, updated),
          buffers: clearAgentPreview(state.buffers, proposalId)
        }))
        if (path) await synchronizeAppliedFile(get, set, path, proposalId)
      } catch (error) {
        await refreshProposalsAfterFailure(desktop(), set)
        set((state) => ({ buffers: clearAgentPreview(state.buffers, proposalId) }))
        throw error
      }
    },
    async rejectProposal(proposalId) {
      try {
        const updated = await desktop().agent.rejectProposal(proposalId)
        set((state) => ({
          agentRuns: mapProposal(state.agentRuns, proposalId, updated),
          buffers: clearAgentPreview(state.buffers, proposalId)
        }))
      } catch (error) {
        await refreshProposalsAfterFailure(desktop(), set)
        set((state) => ({ buffers: clearAgentPreview(state.buffers, proposalId) }))
        throw error
      }
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
  if (event.type === 'run.queued') { run.status = 'queued'; run.queuePosition = event.queuePosition }
  else if (event.type === 'run.started' || event.type === 'run.resumed') { run.status = 'running'; run.resumable = false; run.error = undefined; run.queuePosition = undefined }
  else if (event.type === 'run.configuration') run.configuration = { model: event.model, reasoningEffort: event.reasoningEffort, contextTokenBudget: event.contextTokenBudget, freeTierMode: event.freeTierMode }
  else if (event.type === 'assistant.delta') run.assistantText += event.delta
  else if (event.type === 'assistant.completed') run.assistantText = event.content
  else if (event.type === 'tool.requested') run.tools.push({ id: event.toolCallId, name: event.name, status: 'requested', arguments: event.arguments })
  else if (event.type === 'tool.started') run.tools = updateTool(run.tools, event.toolCallId, { status: 'running' })
  else if (event.type === 'tool.completed') run.tools = updateTool(run.tools, event.toolCallId, { status: 'completed', result: event.result })
  else if (event.type === 'approval.requested') { run.status = 'waiting_approval'; run.approvals.push({ id: event.approvalId, summary: event.summary, status: 'pending' }) }
  else if (event.type === 'approval.resolved') { run.status = 'running'; run.approvals = run.approvals.map((item) => item.id === event.approvalId ? { ...item, status: event.decision } : item) }
  else if (event.type === 'file.proposed') {
    const existing = run.proposals.find((item) => item.id === event.proposalId)
    if (existing) run.proposals = run.proposals.map((item) => item.id === event.proposalId ? { ...item, path: event.path, diff: event.diff, status: 'pending' } : item)
    else run.proposals.push({ id: event.proposalId, runId: event.runId, kind: 'write', path: event.path, diff: event.diff, status: 'pending' })
  }
  else if (event.type === 'file.applied') run.proposals = run.proposals.map((item) => item.id === event.proposalId ? { ...item, status: 'applied' } : item)
  else if (event.type === 'run.completed') { run.status = 'completed'; run.resumable = false; run.queuePosition = undefined }
  else if (event.type === 'run.cancelled') { run.status = 'cancelled'; run.resumable = false; run.queuePosition = undefined }
  else if (event.type === 'run.failed') { run.status = 'failed'; run.error = event.message; run.resumable = event.resumable; run.queuePosition = undefined }
  return run
}

async function previewOpenAgentProposal(
  desktop: DesktopAPI,
  get: () => IdeState,
  set: (partial: Partial<IdeState> | ((state: IdeState) => Partial<IdeState>)) => void,
  proposalId: string,
  path: string
): Promise<void> {
  try {
    const proposal = (await desktop.agent.listProposals()).find((item) => item.id === proposalId)
    if (!proposal?.content || proposal.kind !== 'write' || proposal.status !== 'pending' || !get().openTabs.includes(path) || !get().buffers[path]) return
    const content = proposal.content
    const chunkSize = Math.max(1, Math.ceil(content.length / 120))
    let cursor = 0
    set((state) => ({ buffers: { ...state.buffers, [path]: {
      ...state.buffers[path], agentPreviewContent: '', agentPreviewProposalId: proposalId, agentPreviewing: true
    } } }))
    const writeNextChunk = (): void => {
      const buffer = get().buffers[path]
      if (!buffer || buffer.agentPreviewProposalId !== proposalId) return
      cursor = Math.min(content.length, cursor + chunkSize)
      set((state) => ({ buffers: { ...state.buffers, [path]: {
        ...state.buffers[path], agentPreviewContent: content.slice(0, cursor), agentPreviewing: cursor < content.length
      } } }))
      if (cursor < content.length) globalThis.setTimeout(writeNextChunk, 12)
    }
    writeNextChunk()
  } catch {
    // The proposal card remains usable even if its live editor preview cannot be loaded.
  }
}

function clearAgentPreview(buffers: Record<string, EditorBuffer>, proposalId: string): Record<string, EditorBuffer> {
  return Object.fromEntries(Object.entries(buffers).map(([path, buffer]) => {
    if (buffer.agentPreviewProposalId !== proposalId) return [path, buffer]
    const { agentPreviewContent: _content, agentPreviewProposalId: _id, agentPreviewing: _typing, ...rest } = buffer
    return [path, rest]
  }))
}

async function synchronizeAppliedFile(
  get: () => IdeState,
  set: (partial: Partial<IdeState> | ((state: IdeState) => Partial<IdeState>)) => void,
  path: string,
  proposalId: string
): Promise<void> {
  const buffer = get().buffers[path]
  if (!buffer) return
  if (buffer.dirty) {
    set((state) => ({ buffers: { ...clearAgentPreview(state.buffers, proposalId), [path]: {
      ...clearAgentPreview(state.buffers, proposalId)[path],
      saveError: {
        code: 'CONTENT_CONFLICT',
        message: 'O NIX salvou uma nova versão no disco, mas suas alterações locais ainda não foram salvas. Recarregue para usar a versão do NIX.'
      }
    } } }))
    return
  }
  set((state) => ({ buffers: clearAgentPreview(state.buffers, proposalId) }))
  await get().openFile(path, true)
}

function findProposalPath(runs: Record<string, AgentRunView>, proposalId: string): string | undefined {
  return Object.values(runs).flatMap((run) => run.proposals).find((proposal) => proposal.id === proposalId)?.path
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
    view.proposals = proposals.filter((proposal) => proposal.runId === summary.id)
    agentRuns[summary.id] = view
  })
  return { activeRunId: summaries.at(-1)?.id, agentRuns }
}

async function refreshProposalsAfterFailure(
  desktop: DesktopAPI,
  set: (partial: Partial<IdeState> | ((state: IdeState) => Partial<IdeState>)) => void
): Promise<void> {
  try {
    const proposals = await desktop.agent.listProposals()
    set((state) => ({ agentRuns: reconcileProposals(state.agentRuns, proposals) }))
  } catch {
    // Preserve the original apply/reject error when the recovery request also fails.
  }
}

function reconcileProposals(runs: Record<string, AgentRunView>, proposals: FileProposal[]): Record<string, AgentRunView> {
  return Object.fromEntries(Object.entries(runs).map(([id, run]) => [id, {
    ...run,
    proposals: proposals.filter((proposal) => proposal.runId === id)
  }]))
}

function sameWorkspace(left: string, right: string): boolean {
  return left.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() === right.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
}

function provisionalTitle(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim()
  return compact.length > 52 ? `${compact.slice(0, 49).trimEnd()}…` : compact || 'Novo chat'
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
