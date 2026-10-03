import { useState } from 'react'

export function Welcome({ loading, error, onOpen, onCreate }: {
  loading: boolean
  error?: { code: string; message: string }
  onOpen(path: string): Promise<void>
  onCreate(): void
}): React.JSX.Element {
  const [path, setPath] = useState('')
  return (
    <main className="welcome-view">
      <section className="welcome-copy">
        <span className="eyebrow">GROQ STUDIO · LOCAL FIRST</span>
        <h1>Construa software em conversa com seu projeto.</h1>
        <p>Abra uma pasta para editar codigo, desenhar arquiteturas e executar um agente Groq com revisao de cada mudanca.</p>
        <div className="open-row">
          <input aria-label="Caminho do projeto" placeholder="C:\projetos\meu-app" value={path} onChange={(event) => setPath(event.target.value)} />
          <button className="primary-button" disabled={!path.trim() || loading} onClick={() => void onOpen(path.trim())}>
            {loading ? 'Abrindo…' : 'Abrir pasta'}
          </button>
          <button className="secondary-button" onClick={onCreate}>Novo projeto</button>
        </div>
        {error && <div className="error-banner"><strong>{error.code}</strong><span>{error.message}</span></div>}
      </section>
      <aside className="welcome-orbit" aria-hidden><span>AGENT</span><span>CODE</span><span>ARCH</span></aside>
    </main>
  )
}
