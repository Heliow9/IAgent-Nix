import { useStore } from 'zustand'

import { ideStore, type IdeStore } from '../../store/ide-store'

export function EditorTabs({ store = ideStore }: { store?: IdeStore }): React.JSX.Element {
  const tabs = useStore(store, (state) => state.openTabs)
  const activePath = useStore(store, (state) => state.activePath)
  const buffers = useStore(store, (state) => state.buffers)
  const openFile = useStore(store, (state) => state.openFile)
  const closeFile = useStore(store, (state) => state.closeFile)

  return (
    <div className="editor-tabs" role="tablist" aria-label="Arquivos abertos">
      {tabs.map((path) => {
        const dirty = buffers[path]?.dirty
        const name = path.split('/').at(-1) ?? path
        return (
          <div key={path} className={`editor-tab ${activePath === path ? 'is-active' : ''}`} role="tab" aria-selected={activePath === path}>
            <button type="button" className="tab-label" aria-label={`${name}${dirty ? ', alterado' : ''}`} onClick={() => void openFile(path)}>
              <span>{name}</span>{dirty && <span className="dirty-dot" aria-hidden>●</span>}
            </button>
            <button type="button" className="tab-close" aria-label={`Fechar ${name}`} onClick={() => {
              const decision = dirty && !window.confirm(`Descartar alteracoes em ${name}?`) ? 'cancel' : 'discard'
              void closeFile(path, decision)
            }}>×</button>
          </div>
        )
      })}
    </div>
  )
}
