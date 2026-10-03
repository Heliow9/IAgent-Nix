import { useMemo } from 'react'

import { useIdeStore } from '../../store/ide-store'

export function ExecutionCenter(): React.JSX.Element {
  // IMPORTANT: keep the Zustand selector referentially stable. Returning
  // Object.values(...) directly from the selector creates a new array for
  // every getSnapshot call and React 19 treats that as an unstable external
  // store snapshot, which can trigger an infinite render loop.
  const agentRuns = useIdeStore((state) => state.agentRuns)
  const runs = useMemo(() => Object.values(agentRuns), [agentRuns])
  const counts = useMemo(() => runs.reduce<Record<string, number>>((acc, run) => {
    acc[run.status] = (acc[run.status] ?? 0) + 1
    return acc
  }, {}), [runs])

  return (
    <div className="side-tool-panel execution-center">
      <div className="metric-grid">
        <div><strong>{counts.running ?? 0}</strong><span>Executando</span></div>
        <div><strong>{counts.queued ?? 0}</strong><span>Na fila</span></div>
        <div><strong>{counts.waiting_approval ?? 0}</strong><span>Aprovação</span></div>
        <div><strong>{counts.failed ?? 0}</strong><span>Falhas</span></div>
      </div>
      <div className="side-tool-results">
        {runs.slice().reverse().map((run) => (
          <div className="run-card" key={run.id}>
            <strong>{run.status}</strong>
            <span>{run.id.slice(0, 8)} · {run.tools.length} etapa(s) · {run.proposals.length} arquivo(s)</span>
            {run.error && <small>{run.error}</small>}
          </div>
        ))}
        {!runs.length && <p>Nenhuma execução nesta conversa.</p>}
      </div>
    </div>
  )
}
