import type { ActivityId } from '../../store/ide-store'
import nixLogo from '../../assets/nix-logo.png'

const activities: Array<{ id: ActivityId; label: string; glyph: string }> = [
  { id: 'files', label: 'Arquivos', glyph: '◇' },
  { id: 'search', label: 'Buscar', glyph: '⌕' },
  { id: 'source-control', label: 'Git', glyph: '⑂' },
  { id: 'agent', label: 'NIX', glyph: '✦' },
  { id: 'settings', label: 'Configuracoes', glyph: '⚙' }
]

export function ActivityBar({ active, onSelect, onHome }: { active: ActivityId; onSelect: (id: ActivityId) => void; onHome: () => void }): React.JSX.Element {
  return (
    <nav className="activity-bar" aria-label="Atividades">
      <button className="brand-mark" type="button" title="Tela inicial" aria-label="Ir para a tela inicial" onClick={onHome}><img src={nixLogo} alt="NIX" /></button>
      {activities.map((activity) => (
        <button key={activity.id} type="button" title={activity.label} aria-label={activity.label}
          className={active === activity.id ? 'is-active' : ''} onClick={() => onSelect(activity.id)}>
          <span aria-hidden>{activity.glyph}</span>
        </button>
      ))}
    </nav>
  )
}
