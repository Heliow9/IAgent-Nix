import { useState } from 'react'

import { useIdeStore } from '../../store/ide-store'
import { CreateProjectDialog } from '../workspace/CreateProjectDialog'
import { FileTree } from '../workspace/FileTree'
import { Welcome } from '../workspace/Welcome'
import { ActivityBar } from './ActivityBar'
import { ResizablePanel } from './ResizablePanel'
import { EditorArea } from '../editor/EditorArea'

export function IdeShell(): React.JSX.Element {
  const workspaceRoot = useIdeStore((state) => state.workspaceRoot)
  const error = useIdeStore((state) => state.workspaceError)
  const loading = useIdeStore((state) => state.loadingWorkspace)
  const openWorkspace = useIdeStore((state) => state.openWorkspace)
  const activity = useIdeStore((state) => state.selectedActivity)
  const selectActivity = useIdeStore((state) => state.selectActivity)
  const sizes = useIdeStore((state) => state.panelSizes)
  const setSize = useIdeStore((state) => state.setPanelSize)
  const [createOpen, setCreateOpen] = useState(false)

  if (!workspaceRoot) return <><Welcome loading={loading} error={error} onOpen={openWorkspace} onCreate={() => setCreateOpen(true)} /><CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreate={() => setCreateOpen(false)} /></>

  return (
    <div className="ide-shell">
      <ActivityBar active={activity} onSelect={selectActivity} />
      <ResizablePanel size={sizes.sidebar} onSize={(size) => setSize('sidebar', size)} className="sidebar">
        <header className="panel-header"><span>{activity === 'files' ? 'EXPLORADOR' : activity.toUpperCase()}</span><small>{workspaceRoot.split(/[\\/]/).at(-1)}</small></header>
        {activity === 'files' ? <FileTree /> : <div className="empty-panel">Painel {activity} em preparacao</div>}
      </ResizablePanel>
      <section className="workbench">
        <EditorArea />
        <ResizablePanel axis="y" size={sizes.bottom} onSize={(size) => setSize('bottom', size)} className="bottom-panel"><header className="panel-header">TERMINAL</header><div className="terminal-placeholder">Terminal pronto para conectar.</div></ResizablePanel>
      </section>
      <ResizablePanel size={sizes.agent} onSize={(size) => setSize('agent', size)} className="agent-panel"><header className="panel-header"><span>AGENTE</span><small>GROQ</small></header><div className="agent-empty"><span className="agent-spark">✦</span><h3>O que vamos construir?</h3><p>O chat e as aprovacoes entram nas proximas etapas.</p></div></ResizablePanel>
    </div>
  )
}
