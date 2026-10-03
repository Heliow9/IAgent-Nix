import { useEffect, useState } from 'react'
import { useStore } from 'zustand'

import type { DesktopAPI } from '../../../../shared/contracts'
import { ideStore, type IdeStore } from '../../store/ide-store'
import { DiffViewer } from '../changes/DiffViewer'
import { ApprovalCard } from './ApprovalCard'
import { ToolActivity } from './ToolActivity'

export function AgentPanel({ desktop = window.desktop, store = ideStore }: { desktop?: DesktopAPI; store?: IdeStore }): React.JSX.Element {
  const [prompt, setPrompt] = useState('')
  const activeRunId = useStore(store, (state) => state.activeRunId)
  const run = useStore(store, (state) => activeRunId ? state.agentRuns[activeRunId] : undefined)
  const permissionMode = useStore(store, (state) => state.permissionMode)
  const setPermissionMode = useStore(store, (state) => state.setPermissionMode)
  const sendAgentMessage = useStore(store, (state) => state.sendAgentMessage)
  const reduceAgentEvent = useStore(store, (state) => state.reduceAgentEvent)
  const cancelAgentRun = useStore(store, (state) => state.cancelAgentRun)
  const resolveApproval = useStore(store, (state) => state.resolveAgentApproval)
  const applyProposal = useStore(store, (state) => state.applyProposal)
  const rejectProposal = useStore(store, (state) => state.rejectProposal)

  useEffect(() => desktop.sessions.onAgentEvent(reduceAgentEvent), [desktop, reduceAgentEvent])
  const running = run && ['queued', 'running', 'waiting_approval'].includes(run.status)
  const submit = async (): Promise<void> => {
    const value = prompt.trim()
    if (!value || running) return
    setPrompt('')
    await sendAgentMessage(value)
  }

  return (
    <section className="agent-workspace">
      <header className="agent-toolbar"><div><span className="presence-dot" /> Groq conectado</div><select aria-label="Modo de permissao" value={permissionMode} onChange={(event) => setPermissionMode(event.target.value as typeof permissionMode)}><option value="ask">Perguntar</option><option value="auto-workspace">Auto no workspace</option></select></header>
      <div className="agent-scroll">
        {!run && <div className="agent-empty"><span className="agent-spark">✦</span><h3>O que vamos construir?</h3><p>Peça uma feature, refatoração ou desenho de arquitetura.</p></div>}
        {run?.assistantText && <article className="assistant-message">{run.assistantText}</article>}
        {run && <ToolActivity items={run.tools} />}
        {run?.approvals.filter((approval) => approval.status === 'pending').map((approval) => <ApprovalCard key={approval.id} summary={approval.summary} onResolve={(decision) => void resolveApproval(run.id, approval.id, decision)} />)}
        {run?.proposals.map((proposal) => <DiffViewer key={proposal.id} proposal={proposal} onApply={() => applyProposal(proposal.id)} onReject={() => rejectProposal(proposal.id)} />)}
        {run?.error && <div className="error-banner">{run.error}</div>}
      </div>
      <form className="agent-composer" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <textarea aria-label="Mensagem para o agente" placeholder="Descreva o que voce quer construir…" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} />
        <footer><span>{permissionMode === 'ask' ? 'Mudancas pedem aprovacao' : 'Edicao automatica no workspace'}</span>{running ? <button type="button" className="stop-button" onClick={() => void cancelAgentRun()}>Parar</button> : <button type="submit" className="send-button" disabled={!prompt.trim()}>Enviar</button>}</footer>
      </form>
    </section>
  )
}
