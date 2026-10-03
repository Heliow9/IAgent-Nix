import type { ActivityId } from '../../store/ide-store'

const activities: Array<{ id: ActivityId; label: string; glyph: string }> = [
  { id: 'files', label: 'Arquivos', glyph: '◇' },
  { id: 'search', label: 'Buscar', glyph: '⌕' },
  { id: 'source-control', label: 'Git', glyph: '⑂' },
  { id: 'agent', label: 'Agente', glyph: '✦' },
  { id: 'settings', label: 'Configuracoes', glyph: '⚙' }
]

export function ActivityBar({ active, onSelect }: { active: ActivityId; onSelect: (id: ActivityId) => void }): React.JSX.Element {
  return (
    <nav className="activity-bar" aria-label="Atividades">
      <div className="brand-mark">G</div>
      {activities.map((activity) => (
        <button key={activity.id} type="button" title={activity.label} aria-label={activity.label}
          className={active === activity.id ? 'is-active' : ''} onClick={() => onSelect(activity.id)}>
          <span aria-hidden>{activity.glyph}</span>
        </button>
      ))}
    </nav>
  )
}
