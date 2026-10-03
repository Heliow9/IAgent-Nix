export function ApprovalCard({ summary, onResolve, onResolveAll }: {
  summary: string
  onResolve(decision: 'approved' | 'rejected'): void
  onResolveAll?(decision: 'approved' | 'rejected'): void
}): React.JSX.Element {
  return (
    <section className="approval-card" role="alertdialog" aria-label="Aprovacao necessaria">
      <span className="eyebrow">APROVACAO NECESSARIA</span>
      <p>{summary}</p>
      <footer>
        {onResolveAll && <button className="secondary-button subtle" onClick={() => onResolveAll('rejected')}>Recusar todas</button>}
        <button className="secondary-button" onClick={() => onResolve('rejected')}>Rejeitar</button>
        <button className="primary-button" onClick={() => onResolve('approved')}>Aprovar</button>
        {onResolveAll && <button className="primary-button" onClick={() => onResolveAll('approved')}>Aprovar todas</button>}
      </footer>
    </section>
  )
}
