import { randomUUID } from 'node:crypto'

import type { RunEventBus } from '../../main/state/run-events'
import type { SessionStore } from '../../main/state/session-store'
import type { PermissionMode, RunRecord, RunStatus } from '../../shared/contracts'

export interface ScheduledRunInput {
  sessionId: string
  prompt: string
  permissionMode: PermissionMode
  attachedFiles?: string[]
  referencedChatIds?: string[]
}

export interface SchedulableRunner {
  startPrepared(runId: string, input: ScheduledRunInput): void
  resume(runId: string): { runId: string }
  cancel(runId: string): void
  resolveApproval(runId: string, approvalId: string, decision: 'approved' | 'rejected'): void
  resolveAllApprovals(runId: string, decision: 'approved' | 'rejected'): void
  onSettled(listener: (runId: string) => void): () => void
}

export class RunScheduler {
  private readonly active = new Set<string>()
  private promotion: Promise<void> = Promise.resolve()

  constructor(
    private readonly runner: SchedulableRunner,
    private readonly store: SessionStore,
    private readonly eventBus: RunEventBus,
    private readonly concurrency = 2
  ) {
    runner.onSettled((runId) => {
      this.promotion = this.promotion.then(async () => {
        this.active.delete(runId)
        await this.promote()
      })
    })
  }

  async start(input: ScheduledRunInput): Promise<{ runId: string; status: RunStatus; queuePosition?: number }> {
    const runId = randomUUID()
    const queueSequence = this.store.nextQueueSequence()
    const chat = this.store.getChat(input.sessionId)
    if (chat?.titleSource === 'provisional' && chat.title === 'Novo chat') {
      await this.store.renameChat(input.sessionId, provisionalTitle(input.prompt), 'provisional')
    }
    await this.store.appendMessage(input.sessionId, {
      role: 'user', content: input.prompt, attachments: input.attachedFiles, referencedChatIds: input.referencedChatIds
    })
    await this.store.createRun({
      id: runId, sessionId: input.sessionId, status: 'queued', queueSequence,
      prompt: input.prompt, permissionMode: input.permissionMode,
      attachedFiles: input.attachedFiles ?? [], referencedChatIds: input.referencedChatIds ?? []
    })
    if (this.active.size < this.concurrency) {
      await this.dispatch(this.store.getRun(runId)!)
      return { runId, status: 'running' }
    }
    const queuePosition = this.queuePosition(runId)
    await this.publish({ type: 'run.queued', runId, timestamp: now(), queuePosition })
    return { runId, status: 'queued', queuePosition }
  }

  resume(runId: string): { runId: string } {
    if (this.active.size >= this.concurrency) throw new Error('As duas vagas de execução estão ocupadas. Aguarde uma tarefa terminar.')
    this.active.add(runId)
    try { return this.runner.resume(runId) } catch (error) { this.active.delete(runId); throw error }
  }

  async cancel(runId: string): Promise<void> {
    if (this.active.has(runId)) { this.runner.cancel(runId); return }
    const run = this.store.getRun(runId)
    if (!run || run.status !== 'queued') return
    await this.store.setRunStatus(runId, 'cancelled')
    await this.publish({ type: 'run.cancelled', runId, timestamp: now() })
    await this.refreshQueuePositions()
  }

  resolveApproval(runId: string, approvalId: string, decision: 'approved' | 'rejected'): void {
    this.runner.resolveApproval(runId, approvalId, decision)
  }

  resolveAllApprovals(runId: string, decision: 'approved' | 'rejected'): void {
    this.runner.resolveAllApprovals(runId, decision)
  }

  async recover(): Promise<void> {
    await this.promote()
  }

  private async promote(): Promise<void> {
    while (this.active.size < this.concurrency) {
      const next = this.store.listQueuedRuns().find((run) => !this.active.has(run.id))
      if (!next) break
      const session = this.store.getSession(next.sessionId)
      if (!session) {
        await this.store.setRunStatus(next.id, 'cancelled')
        await this.publish({ type: 'run.cancelled', runId: next.id, timestamp: now() })
        continue
      }
      await this.dispatch(next)
    }
    await this.refreshQueuePositions()
  }

  private async dispatch(run: RunRecord): Promise<void> {
    if (!run.prompt || !run.permissionMode) throw new Error(`Queued run ${run.id} does not contain scheduling input`)
    this.active.add(run.id)
    await this.store.setRunStatus(run.id, 'running')
    this.runner.startPrepared(run.id, {
      sessionId: run.sessionId, prompt: run.prompt, permissionMode: run.permissionMode,
      attachedFiles: run.attachedFiles ?? [], referencedChatIds: run.referencedChatIds ?? []
    })
  }

  private queuePosition(runId: string): number {
    return this.store.listQueuedRuns().filter((run) => !this.active.has(run.id)).findIndex((run) => run.id === runId) + 1
  }

  private async refreshQueuePositions(): Promise<void> {
    const queued = this.store.listQueuedRuns().filter((run) => !this.active.has(run.id))
    await Promise.all(queued.map((run, index) => this.publish({ type: 'run.queued', runId: run.id, timestamp: now(), queuePosition: index + 1 })))
  }

  private async publish(event: Parameters<RunEventBus['publish']>[0]): Promise<void> {
    await this.store.appendEvent(event.runId, event)
    this.eventBus.publish(event)
  }
}

function provisionalTitle(prompt: string): string {
  const title = prompt.replace(/\s+/g, ' ').trim()
  return title.length > 48 ? `${title.slice(0, 45).trimEnd()}…` : title || 'Novo chat'
}

function now(): string { return new Date().toISOString() }
