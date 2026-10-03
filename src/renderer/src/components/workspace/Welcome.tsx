import { useState } from 'react'
import type { WorkspaceRecord } from '../../../../shared/contracts'
import nixLogo from '../../assets/nix-logo.png'

export function Welcome({ loading, error, onOpen, onCreate, recentWorkspaces, allWorkspaces }: {
  loading: boolean
  error?: { code: string; message: string }
  onOpen(path: string): Promise<void>
  onCreate(): void
  recentWorkspaces?: WorkspaceRecord[]
  allWorkspaces?: WorkspaceRecord[]
}): React.JSX.Element {
  const [path, setPath] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')
  const filtered = (allWorkspaces ?? []).filter((workspace) => `${workspace.name} ${workspace.localRootPath}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <main className="welcome-view">
      <section className="welcome-copy">
        <div className="welcome-brand"><img src={nixLogo} alt="NIX" /><span className="eyebrow">NIX · GROQ ENGINE · LOCAL FIRST</span></div>
        <h1>Construa software em conversa com seu projeto.</h1>
        <p>Abra uma pasta para editar codigo, desenhar arquiteturas e executar um agente Groq com revisao de cada mudanca.</p>
        <div className="open-row">
          <input aria-label="Caminho do projeto" placeholder="C:\projetos\meu-app" value={path} onChange={(event) => setPath(event.target.value)} />
          <button className="primary-button" disabled={!path.trim() || loading} onClick={() => void onOpen(path.trim())}>
            {loading ? 'Abrindo…' : 'Abrir pasta'}
          </button>
          <button className="secondary-button" onClick={onCreate}>Novo projeto</button>
        </div>
        {!!recentWorkspaces?.length && <section className="recent-workspaces">
          <header><h2>Projetos recentes</h2>{(allWorkspaces?.length ?? 0) > 5 && <button type="button" onClick={() => setShowAll(true)}>Mostrar todos</button>}</header>
          <div className="recent-grid">{recentWorkspaces.map((workspace) => <button type="button" className="recent-workspace" key={workspace.id} onClick={() => void onOpen(workspace.localRootPath)}>
            <strong>{workspace.name}</strong><span>{workspace.localRootPath}</span>
          </button>)}</div>
        </section>}
        {error && <div className="error-banner"><strong>{error.code}</strong><span>{error.message}</span></div>}
      </section>
      <aside className="welcome-orbit" aria-hidden><span>AGENT</span><span>CODE</span><span>ARCH</span></aside>
      {showAll && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setShowAll(false)}><section className="dialog workspaces-dialog" role="dialog" aria-modal="true" aria-label="Todos os projetos" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className="eyebrow">WORKSPACES</span><h2>Todos os projetos</h2></div><button type="button" aria-label="Fechar" onClick={() => setShowAll(false)}>×</button></header>
        <input autoFocus aria-label="Buscar projetos" placeholder="Buscar por nome ou caminho" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="workspace-search-results">{filtered.map((workspace) => <button type="button" key={workspace.id} onClick={() => void onOpen(workspace.localRootPath)}><strong>{workspace.name}</strong><span>{workspace.localRootPath}</span></button>)}</div>
      </section></div>}
    </main>
  )
}
