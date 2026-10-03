export function ApprovalCard({ summary, onResolve }: { summary: string; onResolve(decision: 'approved' | 'rejected'): void }): React.JSX.Element {
  return (
    <section className="approval-card" role="alertdialog" aria-label="Aprovacao necessaria">
      <span className="eyebrow">APROVACAO NECESSARIA</span>
      <p>{summary}</p>
      <footer><button className="secondary-button" onClick={() => onResolve('rejected')}>Rejeitar</button><button className="primary-button" onClick={() => onResolve('approved')}>Aprovar</button></footer>
    </section>
  )
}
