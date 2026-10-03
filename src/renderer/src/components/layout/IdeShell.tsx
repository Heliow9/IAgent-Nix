import { useEffect, useState } from 'react'

import { useIdeStore } from '../../store/ide-store'
import { CreateProjectDialog } from '../workspace/CreateProjectDialog'
import { FileTree } from '../workspace/FileTree'
import { Welcome } from '../workspace/Welcome'
import { ActivityBar } from './ActivityBar'
import { ResizablePanel } from './ResizablePanel'
import { SidePanelErrorBoundary } from './SidePanelErrorBoundary'
import { EditorArea } from '../editor/EditorArea'
import { TerminalPanel } from '../terminal/TerminalPanel'
import { AgentPanel } from '../agent/AgentPanel'
import { SearchPanel } from '../panels/SearchPanel'
import { GitPanel } from '../panels/GitPanel'
import { ExecutionCenter } from '../panels/ExecutionCenter'
import { SettingsPanel } from '../panels/SettingsPanel'

export function IdeShell(): React.JSX.Element {
  const workspaceRoot = useIdeStore((state) => state.workspaceRoot)
  const error = useIdeStore((state) => state.workspaceError)
  const loading = useIdeStore((state) => state.loadingWorkspace)
  const openWorkspace = useIdeStore((state) => state.openWorkspace)
  const goToWorkspaceHome = useIdeStore((state) => state.goToWorkspaceHome)
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

  const sidePanel = activity === 'files' ? <FileTree /> : activity === 'search' ? <SearchPanel /> : activity === 'source-control' ? <GitPanel /> : activity === 'agent' ? <ExecutionCenter /> : <SettingsPanel />
  const activityTitle = activity === 'files' ? 'EXPLORADOR' : activity === 'search' ? 'BUSCA' : activity === 'source-control' ? 'GIT' : activity === 'agent' ? 'EXECUÇÕES' : 'CONFIGURAÇÕES'

  return (
    <div className="ide-shell">
      <ActivityBar active={activity} onSelect={selectActivity} onHome={() => { void goToWorkspaceHome() }} />
      <ResizablePanel size={sizes.sidebar} onSize={(size) => setSize('sidebar', size)} className="sidebar">
        <header className="panel-header"><span>{activityTitle}</span><small>{workspaceRoot.split(/[\\/]/).at(-1)}</small></header>
        <SidePanelErrorBoundary key={activity} onRecover={() => selectActivity('files')}>{sidePanel}</SidePanelErrorBoundary>
      </ResizablePanel>
      <section className="workbench">
        <EditorArea />
        <ResizablePanel axis="y" size={sizes.bottom} onSize={(size) => setSize('bottom', size)} className="bottom-panel"><header className="panel-header">TERMINAL</header><TerminalPanel workspaceRoot={workspaceRoot} /></ResizablePanel>
      </section>
      <ResizablePanel size={sizes.agent} edge="start" minSize={520} onSize={(size) => setSize('agent', size)} className="agent-panel"><header className="panel-header"><span>NIX</span><small>GROQ</small></header><AgentPanel /></ResizablePanel>
    </div>
  )
}
