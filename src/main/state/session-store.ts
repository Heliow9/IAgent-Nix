import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentEvent, ChatMessage, ChatRecord, FileProposal, PermissionMode, RunRecord, RunStatus, RunSummary, SessionRecord, WorkspaceRecord } from '../../shared/contracts'
import type { ModelMessage } from '../../agent/providers/model-provider'

export interface RunCheckpoint {
  sessionId: string
  prompt: string
  permissionMode: PermissionMode
  model: string
  messages: ModelMessage[]
  safeToResume: boolean
}

interface StoredSession extends SessionRecord {
  workspaceId: string
  titleSource: ChatRecord['titleSource']
  status: ChatRecord['status']
  summary: string
  revision: number
  deletedAt: string | null
}

interface PersistedState {
  version: 2
  workspaces: WorkspaceRecord[]
  sessions: StoredSession[]
  runs: RunRecord[]
  events: Record<string, AgentEvent[]>
  checkpoints: Record<string, RunCheckpoint>
  proposals: FileProposal[]
}

export class SessionStore {
  private readonly filePath: string
  private state: PersistedState
  private writeQueue: Promise<void> = Promise.resolve()

  private constructor(private readonly directory: string, state: PersistedState) {
    this.filePath = join(directory, 'sessions.json')
    this.state = state
  }

  static async open(directory: string): Promise<SessionStore> {
    await mkdir(directory, { recursive: true })
    const filePath = join(directory, 'sessions.json')
    let state = emptyState()
    let needsInitialWrite = false
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
      if (isPersistedStateV2(parsed)) state = normalizeState(parsed)
      else if (isPersistedStateV1(parsed)) { state = migrateV1(parsed); needsInitialWrite = true }
      else throw new Error('Unsupported session store shape')
    } catch (error) {
      if (isMissingFile(error)) needsInitialWrite = true
      else {
        await rename(filePath, `${filePath}.corrupt-${Date.now()}`)
        needsInitialWrite = true
      }
    }
    const store = new SessionStore(directory, state)
    if (needsInitialWrite) await store.persist()
    return store
  }

  async createSession(input: { title: string; workspaceRoot: string }): Promise<SessionRecord> {
    const workspace = await this.touchWorkspace(input.workspaceRoot)
    const chat = await this.createChat(workspace.id, input.title)
    return this.getSession(chat.id)!
  }

  async touchWorkspace(root: string): Promise<WorkspaceRecord> {
    const now = new Date().toISOString()
    const normalized = normalizeWorkspacePath(root)
    let workspace = this.state.workspaces.find((item) => normalizeWorkspacePath(item.localRootPath) === normalized && !item.deletedAt)
    if (workspace) {
      workspace.localRootPath = root
      workspace.name = workspaceName(root)
      workspace.lastOpenedAt = now
      workspace.updatedAt = now
      workspace.revision += 1
    } else {
      workspace = {
        id: randomUUID(), name: workspaceName(root), localRootPath: root,
        createdAt: now, updatedAt: now, lastOpenedAt: now, revision: 1, deletedAt: null
      }
      this.state.workspaces.push(workspace)
    }
    await this.persist()
    return structuredClone(workspace)
  }

  listWorkspaces(limit?: number): WorkspaceRecord[] {
    const workspaces = structuredClone(this.state.workspaces)
      .filter((item) => !item.deletedAt)
      .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt))
    return limit ? workspaces.slice(0, limit) : workspaces
  }

  async createChat(workspaceId: string, title = 'Novo chat'): Promise<ChatRecord> {
    const workspace = this.state.workspaces.find((item) => item.id === workspaceId && !item.deletedAt)
    if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}`)
    const now = new Date().toISOString()
    const session: StoredSession = {
      id: randomUUID(), title, workspaceRoot: workspace.localRootPath, workspaceId,
      titleSource: 'provisional', status: 'active', summary: '', revision: 1, deletedAt: null,
      permissionMode: 'ask', messages: [], createdAt: now, updatedAt: now
    }
    this.state.sessions.push(session)
    await this.persist()
    return chatFromSession(session)
  }

  listChats(workspaceId: string, includeArchived = false): ChatRecord[] {
    return this.state.sessions
      .filter((item) => item.workspaceId === workspaceId && !item.deletedAt && (includeArchived || item.status === 'active'))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(chatFromSession)
  }

  async renameChat(chatId: string, title: string, source: ChatRecord['titleSource'] = 'manual'): Promise<ChatRecord> {
    const session = this.requireSession(chatId) as StoredSession
    if (source === 'generated' && session.titleSource === 'manual') return chatFromSession(session)
    session.title = title.trim() || session.title
    session.titleSource = source
    session.updatedAt = new Date().toISOString()
    session.revision += 1
    await this.persist()
    return chatFromSession(session)
  }

  async archiveChat(chatId: string): Promise<ChatRecord> {
    const session = this.requireSession(chatId) as StoredSession
    session.status = 'archived'
    session.updatedAt = new Date().toISOString()
    session.revision += 1
    await this.persist()
    return chatFromSession(session)
  }

  listSessions(): SessionRecord[] {
    return structuredClone(this.state.sessions).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  getSession(sessionId: string): SessionRecord | undefined {
    const session = this.state.sessions.find((item) => item.id === sessionId)
    return session ? structuredClone(session) : undefined
  }

  async appendMessage(sessionId: string, input: Pick<ChatMessage, 'role' | 'content'>): Promise<ChatMessage> {
    const session = this.requireSession(sessionId)
    const message: ChatMessage = {
      id: randomUUID(), chatId: sessionId, role: input.role, content: input.content,
      attachments: [], referencedChatIds: [], createdAt: new Date().toISOString(), revision: 1, deletedAt: null
    }
    session.messages.push(message)
    session.updatedAt = message.createdAt
    await this.persist()
    return structuredClone(message)
  }

  async createRun(input: Pick<RunRecord, 'id' | 'sessionId' | 'status'>): Promise<RunRecord> {
    this.requireSession(input.sessionId)
    const now = new Date().toISOString()
    const run: RunRecord = { ...input, createdAt: now, updatedAt: now }
    this.state.runs.push(run)
    this.state.events[run.id] = []
    await this.persist()
    return structuredClone(run)
  }

  getRun(runId: string): RunRecord | undefined {
    const run = this.state.runs.find((item) => item.id === runId)
    return run ? structuredClone(run) : undefined
  }

  listRuns(sessionId: string): RunSummary[] {
    return this.state.runs
      .filter((run) => run.sessionId === sessionId)
      .map((run) => ({ ...structuredClone(run), resumable: Boolean(this.state.checkpoints[run.id]?.safeToResume) }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async saveCheckpoint(runId: string, checkpoint: RunCheckpoint): Promise<void> {
    this.requireRun(runId)
    this.state.checkpoints[runId] = structuredClone(checkpoint)
    await this.persist()
  }

  getCheckpoint(runId: string): RunCheckpoint | undefined {
    const checkpoint = this.state.checkpoints[runId]
    return checkpoint ? structuredClone(checkpoint) : undefined
  }

  async clearCheckpoint(runId: string): Promise<void> {
    delete this.state.checkpoints[runId]
    await this.persist()
  }

  listProposals(): FileProposal[] { return structuredClone(this.state.proposals) }

  async upsertProposal(proposal: FileProposal): Promise<void> {
    const index = this.state.proposals.findIndex((item) => item.id === proposal.id)
    if (index >= 0) this.state.proposals[index] = structuredClone(proposal)
    else this.state.proposals.push(structuredClone(proposal))
    await this.persist()
  }

  async setRunStatus(runId: string, status: RunStatus): Promise<void> {
    const run = this.requireRun(runId)
    run.status = status
    run.updatedAt = new Date().toISOString()
    await this.persist()
  }

  async appendEvent(runId: string, event: AgentEvent): Promise<void> {
    this.requireRun(runId)
    if (event.runId !== runId) throw new Error('Event runId does not match target run')
    const events = this.state.events[runId] ?? []
    events.push(event)
    this.state.events[runId] = events
    await this.persist()
  }

  getEvents(runId: string): AgentEvent[] {
    return structuredClone(this.state.events[runId] ?? [])
  }

  async recoverInterruptedRuns(): Promise<void> {
    let changed = false
    for (const run of this.state.runs) {
      if (run.status !== 'running' && run.status !== 'waiting_approval') continue
      const now = new Date().toISOString()
      const events = this.state.events[run.id] ?? []
      const resolved = new Set(events.filter((item) => item.type === 'approval.resolved').map((item) => item.approvalId))
      for (const request of events.filter((item) => item.type === 'approval.requested')) {
        if (!resolved.has(request.approvalId)) events.push({
          type: 'approval.resolved', runId: run.id, timestamp: now,
          approvalId: request.approvalId, decision: 'rejected'
        })
      }
      events.push({
        type: 'run.failed', runId: run.id, timestamp: now,
        message: 'Application closed before the run completed',
        resumable: Boolean(this.state.checkpoints[run.id]?.safeToResume)
      })
      this.state.events[run.id] = events
      run.status = 'failed'
      run.updatedAt = now
      changed = true
    }
    if (changed) await this.persist()
  }

  private requireSession(sessionId: string): SessionRecord {
    const session = this.state.sessions.find((item) => item.id === sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    return session
  }

  private requireRun(runId: string): RunRecord {
    const run = this.state.runs.find((item) => item.id === runId)
    if (!run) throw new Error(`Unknown run: ${runId}`)
    return run
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2)
    this.writeQueue = this.writeQueue.then(async () => {
      const temporary = join(this.directory, `sessions.${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, snapshot, 'utf8')
        await rename(temporary, this.filePath)
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined)
      }
    })
    return this.writeQueue
  }
}

function emptyState(): PersistedState {
  return { version: 2, workspaces: [], sessions: [], runs: [], events: {}, checkpoints: {}, proposals: [] }
}

interface PersistedStateV1 extends Omit<PersistedState, 'version' | 'workspaces' | 'sessions'> {
  version: 1
  sessions: SessionRecord[]
}

function isPersistedStateV2(value: unknown): value is PersistedState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<PersistedState>
  return state.version === 2 && Array.isArray(state.workspaces) && Array.isArray(state.sessions) && Array.isArray(state.runs) && Boolean(state.events) && typeof state.events === 'object'
}

function isPersistedStateV1(value: unknown): value is PersistedStateV1 {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<PersistedStateV1>
  return state.version === 1 && Array.isArray(state.sessions) && Array.isArray(state.runs) && Boolean(state.events) && typeof state.events === 'object'
}

function normalizeState(value: PersistedState): PersistedState {
  return {
    version: 2,
    workspaces: value.workspaces,
    sessions: value.sessions,
    runs: value.runs,
    events: value.events,
    checkpoints: value.checkpoints && typeof value.checkpoints === 'object' ? value.checkpoints : {},
    proposals: Array.isArray(value.proposals) ? value.proposals : []
  }
}

function migrateV1(value: PersistedStateV1): PersistedState {
  const workspaces = new Map<string, WorkspaceRecord>()
  const sessions: StoredSession[] = value.sessions.map((session) => {
    const key = normalizeWorkspacePath(session.workspaceRoot)
    let workspace = workspaces.get(key)
    if (!workspace) {
      workspace = {
        id: randomUUID(), name: workspaceName(session.workspaceRoot), localRootPath: session.workspaceRoot,
        createdAt: session.createdAt, updatedAt: session.updatedAt, lastOpenedAt: session.updatedAt,
        revision: 1, deletedAt: null
      }
      workspaces.set(key, workspace)
    } else if (session.updatedAt > workspace.lastOpenedAt) {
      workspace.updatedAt = session.updatedAt
      workspace.lastOpenedAt = session.updatedAt
    }
    return {
      ...session,
      messages: session.messages.map((message) => ({
        ...message, chatId: session.id, attachments: message.attachments ?? [],
        referencedChatIds: message.referencedChatIds ?? [], revision: message.revision ?? 1,
        deletedAt: message.deletedAt ?? null
      })),
      workspaceId: workspace.id, titleSource: 'manual', status: 'active', summary: '', revision: 1, deletedAt: null
    }
  })
  return {
    version: 2, workspaces: [...workspaces.values()], sessions,
    runs: value.runs, events: value.events,
    checkpoints: value.checkpoints && typeof value.checkpoints === 'object' ? value.checkpoints : {},
    proposals: Array.isArray(value.proposals) ? value.proposals : []
  }
}

function chatFromSession(session: StoredSession): ChatRecord {
  return {
    id: session.id, workspaceId: session.workspaceId, title: session.title,
    titleSource: session.titleSource, status: session.status, summary: session.summary,
    createdAt: session.createdAt, updatedAt: session.updatedAt, revision: session.revision,
    deletedAt: session.deletedAt
  }
}

function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
}

function workspaceName(value: string): string {
  return value.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || value
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
