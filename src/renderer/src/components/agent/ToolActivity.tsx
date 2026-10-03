export interface ToolActivityItem {
  id: string
  name: string
  status: 'requested' | 'running' | 'completed'
  result?: unknown
}

export function ToolActivity({ items }: { items: ToolActivityItem[] }): React.JSX.Element | null {
  if (!items.length) return null
  return (
    <section className="tool-activity" aria-label="Atividade de ferramentas">
      {items.map((item) => <div className="tool-row" key={item.id}>
        <span className={`tool-status ${item.status}`} aria-hidden>{item.status === 'completed' ? '✓' : item.status === 'running' ? '●' : '○'}</span>
        <span>{item.name}</span><small>{item.status}</small>
      </div>)}
    </section>
  )
}
