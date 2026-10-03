import type { AgentEvent } from '../../shared/contracts'

export type RunEventListener = (event: AgentEvent) => void

export class RunEventBus {
  private readonly events = new Map<string, AgentEvent[]>()
  private readonly listeners = new Set<RunEventListener>()

  publish(event: AgentEvent): void {
    const history = this.events.get(event.runId) ?? []
    history.push(event)
    this.events.set(event.runId, history)
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
