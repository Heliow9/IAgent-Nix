import { useEffect, useState } from 'react'
import type { GitStatus } from '../../../../shared/contracts'
import { useIdeStore } from '../../store/ide-store'

export function GitPanel(): React.JSX.Element {
  const [status, setStatus] = useState<GitStatus>()
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState('')
  const selectFile = useIdeStore((s)=>s.selectFile)
  const refresh = async()=>{ try{ setStatus(await window.desktop.git.status()); setError(undefined)}catch(e){setError(e instanceof Error?e.message:String(e))} }
  useEffect(()=>{void refresh()},[])
  return <div className="side-tool-panel git-panel">
    {error && <div className="mini-error">{error}</div>}
    {status && <><div className="git-summary"><strong>{status.branch}</strong><span>{status.clean?'Workspace limpo':`${status.files.length} alteração(ões)`}</span></div>
      <div className="side-tool-results">{status.files.map(file=><div className="git-file" key={file.path}><button onClick={()=>selectFile(file.path)}><strong>{file.index}{file.worktree}</strong><span>{file.path}</span></button><div><button title="Stage" onClick={async()=>{await window.desktop.git.stage([file.path]); await refresh()}}>+</button><button title="Unstage" onClick={async()=>{await window.desktop.git.unstage([file.path]); await refresh()}}>−</button></div></div>)}</div>
      <div className="commit-box"><input placeholder="Mensagem do commit" value={message} onChange={e=>setMessage(e.target.value)}/><button disabled={!message.trim()} onClick={async()=>{await window.desktop.git.commit(message.trim()); setMessage(''); await refresh()}}>Commit</button></div></>}
  </div>
}
