export function App(): React.JSX.Element {
  return (
    <main className="welcome-shell">
      <section className="welcome-card">
        <span className="eyebrow">GROQ STUDIO</span>
        <h1>Seu workspace, ampliado por IA.</h1>
        <p>A base segura da IDE esta pronta para receber projetos, ferramentas e agentes.</p>
        <div className="status-row">
          <span className="status-dot" />
          Electron {window.desktop.app.electronVersion} · {window.desktop.app.platform}
        </div>
      </section>
    </main>
  )
}
