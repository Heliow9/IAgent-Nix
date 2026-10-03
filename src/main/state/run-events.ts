import type { AgentEvent } from '../../shared/contracts'

export type RunEventListener = (event: AgentEvent) => void

const MAX_EVENTS_PER_RUN = 200
const MAX_RETAINED_RUNS = 60

export class RunEventBus {
  private readonly events = new Map<string, AgentEvent[]>()
  private readonly listeners = new Set<RunEventListener>()

  publish(event: AgentEvent): void {
    const history = this.events.get(event.runId) ?? []
    history.push(event)
    if (history.length > MAX_EVENTS_PER_RUN) history.splice(0, history.length - MAX_EVENTS_PER_RUN)

    // Refresh insertion order for the run being updated.
    if (this.events.has(event.runId)) this.events.delete(event.runId)
    this.events.set(event.runId, history)
    while (this.events.size > MAX_RETAINED_RUNS) {
      // Prefer evicting the oldest low-information run instead of throwing away
      // a rich diagnostic history just because many one-event runs were created.
      let candidate: string | undefined
      let candidateSize = Number.POSITIVE_INFINITY
      for (const [runId, items] of this.events) {
        if (items.length < candidateSize) {
          candidate = runId
          candidateSize = items.length
        }
      }
      if (!candidate) break
      this.events.delete(candidate)
    }

    for (const listener of this.listeners) listener(event)
  }

  publishTransient(event: AgentEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  subscribe(listener: RunEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  history(runId: string): AgentEvent[] {
    return [...(this.events.get(runId) ?? [])]
  }
}
