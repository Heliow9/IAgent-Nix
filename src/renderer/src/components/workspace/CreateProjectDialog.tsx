import { useState } from 'react'

export interface ProjectDraft { name: string; location: string; template: 'empty' | 'node-typescript' | 'react-typescript' }

export function CreateProjectDialog({ open, onClose, onCreate }: { open: boolean; onClose(): void; onCreate(draft: ProjectDraft): void }): React.JSX.Element | null {
  const [draft, setDraft] = useState<ProjectDraft>({ name: '', location: '', template: 'node-typescript' })
  if (!open) return null
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <span className="eyebrow">NOVO WORKSPACE</span>
        <h2 id="new-project-title">Comece com uma base limpa.</h2>
        <label>Nome<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Local<input value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} /></label>
        <label>Template<select value={draft.template} onChange={(event) => setDraft({ ...draft, template: event.target.value as ProjectDraft['template'] })}>
          <option value="empty">Vazio</option><option value="node-typescript">Node + TypeScript</option><option value="react-typescript">React + TypeScript</option>
        </select></label>
        <footer><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!draft.name || !draft.location} onClick={() => onCreate(draft)}>Revisar criacao</button></footer>
      </section>
    </div>
  )
}
