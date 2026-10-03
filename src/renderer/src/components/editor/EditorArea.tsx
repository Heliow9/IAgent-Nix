import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'

import { ideStore, type IdeStore } from '../../store/ide-store'
import { importSpecifierAtPosition, importTokensInLine } from '../../lib/import-navigation'
import { configureMonacoLanguages } from '../../lib/monaco-language-config'
import { EditorTabs } from './EditorTabs'
import { MermaidPreview } from '../preview/MermaidPreview'

export function EditorArea({ store = ideStore }: { store?: IdeStore }): React.JSX.Element {
  const activePath = useStore(store, (state) => state.activePath)
  const buffer = useStore(store, (state) => activePath ? state.buffers[activePath] : undefined)
  const loadingFiles = useStore(store, (state) => state.loadingFiles)
  const updateBuffer = useStore(store, (state) => state.updateBuffer)
  const saveFile = useStore(store, (state) => state.saveFile)
  const selectFile = useStore(store, (state) => state.selectFile)
  const activePathRef = useRef(activePath)
  const importDisposables = useRef<Array<{ dispose(): void }>>([])
  const [importNotice, setImportNotice] = useState<string>()
  activePathRef.current = activePath

  useEffect(() => {
    const save = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && activePath) {
        event.preventDefault()
        void saveFile(activePath)
      }
    }
    window.addEventListener('keydown', save)
    return () => window.removeEventListener('keydown', save)
  }, [activePath, saveFile])

  useEffect(() => { setImportNotice(undefined) }, [activePath])

  useEffect(() => () => {
    importDisposables.current.forEach((item) => item.dispose())
    importDisposables.current = []
  }, [])

  const beforeMount: BeforeMount = (monaco) => {
    configureMonacoLanguages(monaco)
  }

  const onMount: OnMount = (editor, monaco) => {
    importDisposables.current.forEach((item) => item.dispose())
    const decorations = editor.createDecorationsCollection()
    const refreshDecorations = (): void => {
      const model = editor.getModel()
      if (!model) return
      const next: Array<Parameters<typeof decorations.set>[0][number]> = []
      for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber += 1) {
        for (const token of importTokensInLine(model.getLineContent(lineNumber))) {
          next.push({
            range: new monaco.Range(lineNumber, token.startColumn, lineNumber, token.endColumn),
            options: {
              inlineClassName: 'monaco-import-link',
              hoverMessage: { value: 'Abrir arquivo importado: **Ctrl/Cmd + clique** ou **duplo clique**.' }
            }
          })
        }
      }
      decorations.set(next)
    }
    refreshDecorations()
    const contentDisposable = editor.onDidChangeModelContent(refreshDecorations)
    const mouseDisposable = editor.onMouseDown((event) => {
      const position = event.target.position
      const model = editor.getModel()
      const fromPath = activePathRef.current
      if (!position || !model || !fromPath) return
      const specifier = importSpecifierAtPosition(model.getLineContent(position.lineNumber), position.column)
      if (!specifier) return
      const detail = (event.event.browserEvent as MouseEvent | undefined)?.detail ?? 0
      if (!event.event.ctrlKey && !event.event.metaKey && detail < 2) return
      event.event.preventDefault()
      event.event.stopPropagation()
      void window.desktop.workspace.resolveImport(fromPath, specifier).then((resolution) => {
        if (resolution.kind === 'workspace' && resolution.path) {
          setImportNotice(undefined)
          selectFile(resolution.path)
        } else if (resolution.kind === 'external') {
          setImportNotice(`“${specifier}” é um pacote externo; não há arquivo local do workspace para abrir.`)
        } else {
          setImportNotice(`Não encontrei o arquivo local referente a “${specifier}”.`)
        }
      }).catch((error: unknown) => setImportNotice(error instanceof Error ? error.message : 'Não foi possível abrir o import.'))
    })
    importDisposables.current = [{ dispose: () => decorations.clear() }, contentDisposable, mouseDisposable]
  }

  return (
    <section className="editor-area">
      <EditorTabs store={store} />
      {!activePath && <div className="editor-placeholder"><span className="eyebrow">EDITOR</span><h2>Selecione um arquivo</h2><p>Abra um arquivo no explorador para comecar.</p></div>}
      {activePath && loadingFiles.includes(activePath) && <div className="editor-state">Carregando {activePath}…</div>}
      {activePath && buffer?.error && <div className="editor-state error"><strong>{buffer.error.code}</strong><p>{buffer.error.message}</p></div>}
      {activePath && buffer && !buffer.error && (
        <>
          {importNotice && <div className="editor-import-notice" role="status">{importNotice}<button type="button" aria-label="Fechar aviso de import" onClick={() => setImportNotice(undefined)}>×</button></div>}
          {buffer.saveError && <div className="save-conflict"><span>{buffer.saveError.message}</span><button type="button" onClick={() => void store.getState().openFile(activePath, true)}>Recarregar do disco</button></div>}
          {buffer.agentPreviewProposalId && <div className="agent-editing-banner"><span className={buffer.agentPreviewing ? 'agent-typing-dot' : 'agent-typing-dot complete'} /> <strong>NIX está editando</strong><span>{buffer.agentPreviewing ? 'Acompanhe a alteração em tempo real…' : 'Prévia pronta para aprovação'}</span></div>}
          <div className={`editor-content ${mermaidCode(activePath, buffer.agentPreviewContent ?? buffer.content) ? 'with-preview' : ''}`}>
            <Editor path={activePath} language={buffer.language} beforeMount={beforeMount} value={buffer.agentPreviewContent ?? buffer.content} theme="vs-dark" onMount={onMount}
              onChange={(value) => updateBuffer(activePath, value ?? '')}
              options={{ readOnly: Boolean(buffer.agentPreviewProposalId), minimap: { enabled: true }, fontSize: 13, fontFamily: 'Cascadia Code, Consolas, monospace', automaticLayout: true, padding: { top: 14 } }} />
            {mermaidCode(activePath, buffer.agentPreviewContent ?? buffer.content) && <MermaidPreview code={mermaidCode(activePath, buffer.agentPreviewContent ?? buffer.content)!} />}
          </div>
        </>
      )}
    </section>
  )
}

function mermaidCode(path: string, content: string): string | undefined {
  if (path.toLowerCase().endsWith('.mmd')) return content
  if (path.toLowerCase().endsWith('.md')) return content.match(/```mermaid\s*([\s\S]*?)```/i)?.[1]?.trim()
  return undefined
}
