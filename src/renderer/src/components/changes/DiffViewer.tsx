import { useState } from 'react'

import type { FileProposal } from '../../../../shared/contracts'

export function DiffViewer({ proposal, onApply, onReject }: {
  proposal: FileProposal
  onApply(): Promise<void>
  onReject(): Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const perform = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(undefined)
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nao foi possivel concluir a alteracao.') }
    finally { setBusy(false) }
  }
  return (
    <section className="diff-card">
      <header><span>{proposal.path}</span><small>{proposal.kind}</small></header>
      <pre>{proposal.diff.split('\n').map((line, index) => <code key={`${index}-${line}`} className={line.startsWith('+') && !line.startsWith('+++') ? 'diff-add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-remove' : 'diff-meta'}>{line}{'\n'}</code>)}</pre>
      {error && <div className="diff-error">{error}</div>}
      {proposal.status === 'pending' && <footer><button disabled={busy} className="secondary-button" onClick={() => void perform(onReject)}>Rejeitar</button><button disabled={busy} className="primary-button" onClick={() => void perform(onApply)}>Aplicar</button></footer>}
    </section>
  )
}
