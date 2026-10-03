import { useEffect, useState } from 'react'

import { useIdeStore } from '../../store/ide-store'
import { CreateProjectDialog } from '../workspace/CreateProjectDialog'
import { FileTree } from '../workspace/FileTree'
import { Welcome } from '../workspace/Welcome'
import { ActivityBar } from './ActivityBar'
import { ResizablePanel } from './ResizablePanel'
import { EditorArea } from '../editor/EditorArea'
import { TerminalPanel } from '../terminal/TerminalPanel'
import { AgentPanel } from '../agent/AgentPanel'

export function IdeShell(): React.JSX.Element {
  const workspaceRoot = useIdeStore((state) => state.workspaceRoot)
  const error = useIdeStore((state) => state.workspaceError)
  const loading = useIdeStore((state) => state.loadingWorkspace)
  const openWorkspace = useIdeStore((state) => state.openWorkspace)
  const loadKnownWorkspaces = useIdeStore((state) => state.loadKnownWorkspaces)
  const recentWorkspaces = useIdeStore((state) => state.recentWorkspaces)
  const knownWorkspaces = useIdeStore((state) => state.knownWorkspaces)
  const activity = useIdeStore((state) => state.selectedActivity)
  const selectActivity = useIdeStore((state) => state.selectActivity)
  const sizes = useIdeStore((state) => state.panelSizes)
  const setSize = useIdeStore((state) => state.setPanelSize)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => { void loadKnownWorkspaces() }, [loadKnownWorkspaces])

  if (!workspaceRoot) return <><Welcome loading={loading} error={error} onOpen={openWorkspace} onCreate={() => setCreateOpen(true)} recentWorkspaces={recentWorkspaces} allWorkspaces={knownWorkspaces} /><CreateProjectDialog
    open={createOpen}
    onClose={() => setCreateOpen(false)}
    onPreview={(draft) => window.desktop.projects.preview(draft)}
    onConfirm={async (draft, token) => {
      const project = await window.desktop.projects.create(draft, token)
      setCreateOpen(false)
      await openWorkspace(project.targetPath)
    }}
  /></>

  return (
    <div className="ide-shell">
      <ActivityBar active={activity} onSelect={selectActivity} />
      <ResizablePanel size={sizes.sidebar} onSize={(size) => setSize('sidebar', size)} className="sidebar">
        <header className="panel-header"><span>{activity === 'files' ? 'EXPLORADOR' : activity.toUpperCase()}</span><small>{workspaceRoot.split(/[\\/]/).at(-1)}</small></header>
        {activity === 'files' ? <FileTree /> : <div className="empty-panel">Painel {activity} em preparacao</div>}
      </ResizablePanel>
      <section className="workbench">
        <EditorArea />
        <ResizablePanel axis="y" size={sizes.bottom} onSize={(size) => setSize('bottom', size)} className="bottom-panel"><header className="panel-header">TERMINAL</header><TerminalPanel workspaceRoot={workspaceRoot} /></ResizablePanel>
      </section>
      <ResizablePanel size={sizes.agent} onSize={(size) => setSize('agent', size)} className="agent-panel"><header className="panel-header"><span>AGENTE</span><small>GROQ</small></header><AgentPanel /></ResizablePanel>
    </div>
  )
}
