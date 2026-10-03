import Editor from '@monaco-editor/react'
import { useEffect } from 'react'
import { useStore } from 'zustand'

import { ideStore, type IdeStore } from '../../store/ide-store'
import { EditorTabs } from './EditorTabs'
import { MermaidPreview } from '../preview/MermaidPreview'

export function EditorArea({ store = ideStore }: { store?: IdeStore }): React.JSX.Element {
  const activePath = useStore(store, (state) => state.activePath)
  const buffer = useStore(store, (state) => activePath ? state.buffers[activePath] : undefined)
  const loadingFiles = useStore(store, (state) => state.loadingFiles)
  const updateBuffer = useStore(store, (state) => state.updateBuffer)
  const saveFile = useStore(store, (state) => state.saveFile)

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

  return (
    <section className="editor-area">
      <EditorTabs store={store} />
      {!activePath && <div className="editor-placeholder"><span className="eyebrow">EDITOR</span><h2>Selecione um arquivo</h2><p>Abra um arquivo no explorador para comecar.</p></div>}
      {activePath && loadingFiles.includes(activePath) && <div className="editor-state">Carregando {activePath}…</div>}
      {activePath && buffer?.error && <div className="editor-state error"><strong>{buffer.error.code}</strong><p>{buffer.error.message}</p></div>}
      {activePath && buffer && !buffer.error && (
        <>
          {buffer.saveError && <div className="save-conflict"><span>{buffer.saveError.message}</span><button type="button" onClick={() => void store.getState().openFile(activePath, true)}>Recarregar do disco</button></div>}
          <div className={`editor-content ${mermaidCode(activePath, buffer.content) ? 'with-preview' : ''}`}>
            <Editor path={activePath} language={buffer.language} value={buffer.content} theme="vs-dark"
              onChange={(value) => updateBuffer(activePath, value ?? '')}
              options={{ minimap: { enabled: true }, fontSize: 13, fontFamily: 'Cascadia Code, Consolas, monospace', automaticLayout: true, padding: { top: 14 } }} />
            {mermaidCode(activePath, buffer.content) && <MermaidPreview code={mermaidCode(activePath, buffer.content)!} />}
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
