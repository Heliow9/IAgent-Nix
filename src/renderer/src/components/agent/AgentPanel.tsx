import { Fragment, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'

import type { DesktopAPI } from '../../../../shared/contracts'
import { ideStore, type IdeStore } from '../../store/ide-store'
import { DiffViewer } from '../changes/DiffViewer'
import { ApprovalCard } from './ApprovalCard'
import { ToolActivity } from './ToolActivity'

export function AgentPanel({ desktop = window.desktop, store = ideStore }: { desktop?: DesktopAPI; store?: IdeStore }): React.JSX.Element {
  const [prompt, setPrompt] = useState('')
  const scrollEndRef = useRef<HTMLDivElement>(null)
  const activeRunId = useStore(store, (state) => state.activeRunId)
  const run = useStore(store, (state) => activeRunId ? state.agentRuns[activeRunId] : undefined)
  const agentRuns = useStore(store, (state) => state.agentRuns)
  const runs = Object.values(agentRuns)
  const permissionMode = useStore(store, (state) => state.permissionMode)
  const messages = useStore(store, (state) => state.conversationMessages)
  const setPermissionMode = useStore(store, (state) => state.setPermissionMode)
  const sendAgentMessage = useStore(store, (state) => state.sendAgentMessage)
  const reduceAgentEvent = useStore(store, (state) => state.reduceAgentEvent)
  const cancelAgentRun = useStore(store, (state) => state.cancelAgentRun)
  const resumeAgentRun = useStore(store, (state) => state.resumeAgentRun)
  const resolveApproval = useStore(store, (state) => state.resolveAgentApproval)
  const applyProposal = useStore(store, (state) => state.applyProposal)
  const rejectProposal = useStore(store, (state) => state.rejectProposal)

  useEffect(() => desktop.sessions.onAgentEvent(reduceAgentEvent), [desktop, reduceAgentEvent])
  const activityVersion = runs.map((item) => `${item.id}:${item.status}:${item.tools.length}:${item.approvals.length}:${item.proposals.length}`).join('|')
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [messages.length, run?.assistantText, activityVersion, run?.error])
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
        {!run && messages.length === 0 && <div className="agent-empty"><span className="agent-spark">✦</span><h3>O que vamos construir?</h3><p>Peça uma feature, refatoração ou desenho de arquitetura.</p></div>}
        {messages.filter((message) => message.role === 'user' || message.role === 'assistant').map((message) => <article key={message.id} className={`chat-message ${message.role}-message`}><small>{message.role === 'user' ? 'Você' : 'Agente'}</small><MessageContent content={message.content} /></article>)}
        {run?.assistantText && run.status !== 'completed' && <article className="chat-message assistant-message streaming"><small>Agente</small><MessageContent content={run.assistantText} /></article>}
        {runs.map((item) => <ToolActivity key={item.id} items={item.tools} status={item.status} fileCount={item.proposals.filter((proposal) => proposal.status === 'applied').length} />)}
        {runs.flatMap((item) => item.proposals).filter((proposal) => proposal.status === 'pending').map((proposal) => <DiffViewer key={proposal.id} proposal={proposal} onApply={() => applyProposal(proposal.id)} onReject={() => rejectProposal(proposal.id)} />)}
        {runs.flatMap((item) => item.approvals.map((approval) => ({ runId: item.id, approval }))).filter(({ approval }) => approval.status === 'pending').map(({ runId, approval }) => <ApprovalCard key={approval.id} summary={approval.summary} onResolve={(decision) => void resolveApproval(runId, approval.id, decision)} />)}
        {run?.error && <div className="error-banner run-error"><span>{run.error}</span>{run.resumable && <button type="button" className="resume-button" onClick={() => void resumeAgentRun()}>Continuar de onde parou</button>}</div>}
        <div ref={scrollEndRef} aria-hidden />
      </div>
      <form className="agent-composer" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <textarea aria-label="Mensagem para o agente" placeholder="Descreva o que voce quer construir…" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} />
        <footer><span>{permissionMode === 'ask' ? 'Mudancas pedem aprovacao' : 'Edicao automatica no workspace'}</span>{running ? <button type="button" className="stop-button" onClick={() => void cancelAgentRun()}>Parar</button> : <button type="submit" className="send-button" disabled={!prompt.trim()}>Enviar</button>}</footer>
      </form>
    </section>
  )
}

function MessageContent({ content }: { content: string }): React.JSX.Element {
  return <div className="message-content">{content.split(/\r?\n/).map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br />}{inlineMarkdown(line)}</Fragment>)}</div>
}

function inlineMarkdown(line: string): React.ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    return <Fragment key={index}>{part}</Fragment>
  })
}
