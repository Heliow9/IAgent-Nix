import { useEffect, useState } from 'react'

import type { ProjectPreview, ProjectTemplateInput } from '../../../../shared/contracts'

export type ProjectDraft = ProjectTemplateInput

export function CreateProjectDialog({ open, onClose, onPreview, onConfirm }: {
  open: boolean
  onClose(): void
  onPreview(draft: ProjectDraft): Promise<ProjectPreview>
  onConfirm(draft: ProjectDraft, confirmationToken: string): Promise<void>
}): React.JSX.Element | null {
  const [draft, setDraft] = useState<ProjectDraft>({ name: '', location: '', template: 'node-typescript' })
  const [preview, setPreview] = useState<ProjectPreview>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => { setPreview(undefined); setError(undefined) }, [draft])
  if (!open) return null
  const review = async (): Promise<void> => {
    setBusy(true); setError(undefined)
    try { setPreview(await onPreview(draft)) } catch (cause) { setError(messageOf(cause)) } finally { setBusy(false) }
  }
  const create = async (): Promise<void> => {
    if (!preview) return
    setBusy(true); setError(undefined)
    try { await onConfirm(draft, preview.confirmationToken) } catch (cause) { setError(messageOf(cause)); setBusy(false) }
  }
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <span className="eyebrow">NOVO WORKSPACE</span>
        <h2 id="new-project-title">Comece com uma base limpa.</h2>
        {!preview && <><label>Nome<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Local<input value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} /></label>
        <label>Template<select value={draft.template} onChange={(event) => setDraft({ ...draft, template: event.target.value as ProjectDraft['template'] })}>
          <option value="empty">Vazio</option><option value="node-typescript">Node + TypeScript</option><option value="react-typescript">React + TypeScript</option>
        </select></label></>}
        {preview && <div className="project-preview"><strong>{preview.targetPath}</strong><p>Arquivos que serao criados:</p><ul>{preview.files.map((file) => <li key={file}>{file}</li>)}</ul></div>}
        {error && <div className="error-banner">{error}</div>}
        <footer><button className="secondary-button" disabled={busy} onClick={preview ? () => setPreview(undefined) : onClose}>{preview ? 'Voltar' : 'Cancelar'}</button>{preview
          ? <button className="primary-button" disabled={busy} onClick={() => void create()}>{busy ? 'Criando…' : 'Criar e abrir'}</button>
          : <button className="primary-button" disabled={!draft.name || !draft.location || busy} onClick={() => void review()}>{busy ? 'Revisando…' : 'Revisar criacao'}</button>}</footer>
      </section>
    </div>
  )
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : 'Nao foi possivel criar o projeto.' }
