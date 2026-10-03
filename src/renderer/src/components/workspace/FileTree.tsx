import { useState } from 'react'
import { useStore } from 'zustand'

import { ideStore, type IdeStore } from '../../store/ide-store'

export function FileTree({ store = ideStore }: { store?: IdeStore }): React.JSX.Element {
  const root = useStore(store, (state) => state.workspaceRoot)
  const entries = useStore(store, (state) => state.entriesByDirectory)
  const loading = useStore(store, (state) => state.loadingDirectories)
  const loadDirectory = useStore(store, (state) => state.loadDirectory)
  const selectFile = useStore(store, (state) => state.selectFile)
  const activePath = useStore(store, (state) => state.activePath)
  const [expanded, setExpanded] = useState<string[]>([])

  if (!root) return <div className="empty-panel">Nenhum projeto aberto</div>

  const toggle = async (path: string): Promise<void> => {
    if (expanded.includes(path)) setExpanded(expanded.filter((item) => item !== path))
    else {
      setExpanded([...expanded, path])
      await loadDirectory(path)
    }
  }

  const renderDirectory = (directory: string, depth: number): React.ReactNode => (
    <ul className="file-list" aria-label={directory || 'Arquivos do projeto'}>
      {(entries[directory] ?? []).map((entry) => (
        <li key={entry.path}>
          <button
            type="button"
            className={`file-row ${activePath === entry.path ? 'is-active' : ''}`}
            style={{ paddingLeft: 12 + depth * 16 }}
            onClick={() => entry.kind === 'directory' ? void toggle(entry.path) : selectFile(entry.path)}
            aria-expanded={entry.kind === 'directory' ? expanded.includes(entry.path) : undefined}
          >
            <span className="file-icon" aria-hidden>{entry.kind === 'directory' ? (expanded.includes(entry.path) ? '▾' : '▸') : '·'}</span>
            {entry.name}
          </button>
          {loading.includes(entry.path) && <div className="tree-loading">Carregando {entry.name}…</div>}
          {entry.kind === 'directory' && expanded.includes(entry.path) && renderDirectory(entry.path, depth + 1)}
        </li>
      ))}
    </ul>
  )

  return <nav className="file-tree">{renderDirectory('', 0)}</nav>
}
