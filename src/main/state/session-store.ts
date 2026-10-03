import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentEvent, ChatMessage, RunRecord, RunStatus, SessionRecord } from '../../shared/contracts'

interface PersistedState {
  version: 1
  sessions: SessionRecord[]
  runs: RunRecord[]
  events: Record<string, AgentEvent[]>
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
      state = parsed
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
      events.push({ type: 'run.failed', runId: run.id, timestamp: now, message: 'Application closed before the run completed' })
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
  return { version: 1, sessions: [], runs: [], events: {} }
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<PersistedState>
  return state.version === 1 && Array.isArray(state.sessions) && Array.isArray(state.runs) && Boolean(state.events) && typeof state.events === 'object'
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
