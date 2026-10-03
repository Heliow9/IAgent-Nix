import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentEvent, ChatMessage, FileProposal, PermissionMode, RunRecord, RunStatus, RunSummary, SessionRecord } from '../../shared/contracts'
import type { ModelMessage } from '../../agent/providers/model-provider'

export interface RunCheckpoint {
  sessionId: string
  prompt: string
  permissionMode: PermissionMode
  model: string
  messages: ModelMessage[]
  safeToResume: boolean
}

interface PersistedState {
  version: 1
  sessions: SessionRecord[]
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
      if (!isPersistedState(parsed)) throw new Error('Unsupported session store shape')
      state = normalizeState(parsed)
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
    const now = new Date().toISOString()
    const session: SessionRecord = {
      id: randomUUID(), title: input.title, workspaceRoot: input.workspaceRoot,
      permissionMode: 'ask', messages: [], createdAt: now, updatedAt: now
    }
    this.state.sessions.push(session)
    await this.persist()
    return structuredClone(session)
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
      id: randomUUID(), role: input.role, content: input.content, createdAt: new Date().toISOString()
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
  return { version: 1, sessions: [], runs: [], events: {}, checkpoints: {}, proposals: [] }
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<PersistedState>
  return state.version === 1 && Array.isArray(state.sessions) && Array.isArray(state.runs) && Boolean(state.events) && typeof state.events === 'object'
}

function normalizeState(value: PersistedState): PersistedState {
  return {
    version: 1,
    sessions: value.sessions,
    runs: value.runs,
    events: value.events,
    checkpoints: value.checkpoints && typeof value.checkpoints === 'object' ? value.checkpoints : {},
    proposals: Array.isArray(value.proposals) ? value.proposals : []
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
