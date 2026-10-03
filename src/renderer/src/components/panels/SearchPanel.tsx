import { useState } from 'react'
import { useIdeStore } from '../../store/ide-store'
import type { WorkspaceSymbol } from '../../../../shared/contracts'

export function SearchPanel(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'text'|'symbols'>('text')
  const [results, setResults] = useState<Array<{ path:string; line:number; preview:string }>>([])
  const [symbols, setSymbols] = useState<WorkspaceSymbol[]>([])
  const [busy, setBusy] = useState(false)
  const selectFile = useIdeStore((s) => s.selectFile)
  const run = async (): Promise<void> => {
    if (!query.trim()) return
    setBusy(true)
    try {
      if (mode === 'text') { setResults(await window.desktop.workspace.search(query, 200)); setSymbols([]) }
      else { setSymbols(await window.desktop.intelligence.searchSymbols(query, 200)); setResults([]) }
    } finally { setBusy(false) }
  }
  return <div className="side-tool-panel">
    <div className="side-tool-controls"><input placeholder="Buscar no workspace…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') void run()}}/><select value={mode} onChange={e=>setMode(e.target.value as 'text'|'symbols')}><option value="text">Texto</option><option value="symbols">Símbolos</option></select><button onClick={()=>void run()} disabled={busy}>Buscar</button></div>
    <div className="side-tool-results">
      {results.map((r,i)=><button key={`${r.path}:${r.line}:${i}`} onClick={()=>selectFile(r.path)}><strong>{r.path}:{r.line}</strong><span>{r.preview}</span></button>)}
      {symbols.map((s,i)=><button key={`${s.path}:${s.line}:${i}`} onClick={()=>selectFile(s.path)}><strong>{s.name} <small>{s.kind}</small></strong><span>{s.path}:{s.line}</span></button>)}
      {!busy && !results.length && !symbols.length && <p>Use busca textual ou o índice inteligente de símbolos.</p>}
    </div>
  </div>
}
