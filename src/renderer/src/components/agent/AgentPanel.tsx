import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'

import type { DesktopAPI } from '../../../../shared/contracts'
import { ideStore, type IdeStore } from '../../store/ide-store'
import { DiffViewer } from '../changes/DiffViewer'
import { ApprovalCard } from './ApprovalCard'
import { ToolActivity } from './ToolActivity'
import { ChatSidebar } from './ChatSidebar'
import { MarkdownContent } from './MarkdownContent'

export function AgentPanel({ desktop = window.desktop, store = ideStore }: { desktop?: DesktopAPI; store?: IdeStore }): React.JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [referencedChatIds, setReferencedChatIds] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRunId = useStore(store, (state) => state.activeRunId)
  const run = useStore(store, (state) => activeRunId ? state.agentRuns[activeRunId] : undefined)
  const agentRuns = useStore(store, (state) => state.agentRuns)
  const runs = Object.values(agentRuns)
  const permissionMode = useStore(store, (state) => state.permissionMode)
  const messages = useStore(store, (state) => state.conversationMessages)
  const activeAnswerPersisted = Boolean(run && messages.some((message) => message.id === `${run.id}-assistant`))
  const setPermissionMode = useStore(store, (state) => state.setPermissionMode)
  const sendAgentMessage = useStore(store, (state) => state.sendAgentMessage)
  const reduceAgentEvent = useStore(store, (state) => state.reduceAgentEvent)
  const cancelAgentRun = useStore(store, (state) => state.cancelAgentRun)
  const resumeAgentRun = useStore(store, (state) => state.resumeAgentRun)
  const resolveApproval = useStore(store, (state) => state.resolveAgentApproval)
  const resolveAllApprovals = useStore(store, (state) => state.resolveAllAgentApprovals)
  const applyProposal = useStore(store, (state) => state.applyProposal)
  const rejectProposal = useStore(store, (state) => state.rejectProposal)
  const chats = useStore(store, (state) => state.chats)
  const selectedChatId = useStore(store, (state) => state.selectedChatId)
  const createChat = useStore(store, (state) => state.createChat)
  const selectChat = useStore(store, (state) => state.selectChat)
  const renameChat = useStore(store, (state) => state.renameChat)
  const archiveChat = useStore(store, (state) => state.archiveChat)
  const selectFile = useStore(store, (state) => state.selectFile)
  const referenceQuery = /(?:^|\s)@([^\s]*)$/.exec(prompt)?.[1]?.toLowerCase()
  const referenceOptions = referenceQuery === undefined ? [] : chats.filter((chat) => chat.id !== selectedChatId && !referencedChatIds.includes(chat.id) && chat.title.toLowerCase().includes(referenceQuery))
  const pendingProposals = runs.flatMap((item) => item.proposals).filter((proposal) => proposal.status === 'pending')
  const [proposalBatchBusy, setProposalBatchBusy] = useState(false)
  const [proposalBatchError, setProposalBatchError] = useState<string>()

  useEffect(() => desktop.sessions.onAgentEvent(reduceAgentEvent), [desktop, reduceAgentEvent])
  const activityVersion = runs.map((item) => `${item.id}:${item.status}:${item.tools.length}:${item.approvals.length}:${item.proposals.length}`).join('|')
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTo?.({ top: element.scrollHeight, behavior: 'auto' })
  }, [messages.length, run?.assistantText, activityVersion, run?.error])
  const running = run && ['queued', 'running', 'waiting_approval'].includes(run.status)
  const submit = async (): Promise<void> => {
    const value = prompt.trim()
    if (!value || running) return
    setPrompt('')
    const references = referencedChatIds
    setReferencedChatIds([])
    await sendAgentMessage(value, references)
  }
  const resolveProposalBatch = async (decision: 'apply' | 'reject'): Promise<void> => {
    if (proposalBatchBusy) return
    setProposalBatchBusy(true)
    setProposalBatchError(undefined)
    try {
      for (const proposal of pendingProposals) {
        if (decision === 'apply') await applyProposal(proposal.id)
        else await rejectProposal(proposal.id)
      }
    } catch (error) {
      setProposalBatchError(error instanceof Error ? error.message : 'Nao foi possivel concluir todas as propostas.')
    } finally {
      setProposalBatchBusy(false)
    }
  }

  return (
    <div className="agent-layout">
      <ChatSidebar chats={chats} selectedChatId={selectedChatId} onCreate={() => void createChat()} onSelect={(id) => void selectChat(id)} onRename={(id, title) => void renameChat(id, title)} onArchive={(id) => void archiveChat(id)} />
      <section className="agent-workspace">
      <header className="agent-toolbar"><div><span className="presence-dot" /> Groq conectado</div><select aria-label="Modo de permissao" value={permissionMode} onChange={(event) => setPermissionMode(event.target.value as typeof permissionMode)}><option value="ask">Perguntar</option><option value="auto-workspace">Auto no workspace</option><option value="autopilot">Autopilot</option></select></header>
      <div className="agent-scroll" ref={scrollRef}>
        {!run && messages.length === 0 && <div className="agent-empty"><span className="agent-spark">✦</span><h3>O que vamos construir?</h3><p>Peça uma feature, refatoração ou desenho de arquitetura.</p></div>}
        {runs.map((item) => <ToolActivity key={item.id} items={item.tools} status={item.status} fileCount={item.proposals.filter((proposal) => proposal.status === 'applied').length} queuePosition={item.queuePosition} configuration={item.configuration} />)}
        {messages.filter((message) => message.role === 'user' || message.role === 'assistant').map((message) => <article key={message.id} className={`chat-message ${message.role}-message`}><small>{message.role === 'user' ? 'Você' : 'NIX'}</small><MarkdownContent content={message.content} onOpenPath={selectFile} resolveImport={desktop.workspace.resolveImport} /></article>)}
        {run?.assistantText && run.status !== 'completed' && !activeAnswerPersisted && <article className="chat-message assistant-message streaming"><small>NIX</small><div className="message-content streaming-content">{run.assistantText}</div></article>}
        {pendingProposals.length > 1 && <section className="proposal-batch-actions" aria-label="Acoes para todas as propostas">
          <div><strong>{pendingProposals.length} alterações aguardando decisão</strong><small>As ações são processadas na ordem em que foram propostas.</small></div>
          <div><button disabled={proposalBatchBusy} className="secondary-button" onClick={() => void resolveProposalBatch('reject')}>Rejeitar todas</button><button disabled={proposalBatchBusy} className="primary-button" onClick={() => void resolveProposalBatch('apply')}>Aplicar todas</button></div>
        </section>}
        {proposalBatchError && <div className="diff-error proposal-batch-error">{proposalBatchError}</div>}
        {pendingProposals.map((proposal) => <DiffViewer key={proposal.id} proposal={proposal} onApply={() => applyProposal(proposal.id)} onReject={() => rejectProposal(proposal.id)} />)}
        {runs.flatMap((item) => item.approvals.map((approval) => ({ runId: item.id, approval }))).filter(({ approval }) => approval.status === 'pending').map(({ runId, approval }) => <ApprovalCard key={approval.id} summary={approval.summary} onResolve={(decision) => void resolveApproval(runId, approval.id, decision)} onResolveAll={(decision) => void resolveAllApprovals(runId, decision)} />)}
        {run?.error && <div className="error-banner run-error"><span>{run.error}</span>{run.resumable && <button type="button" className="resume-button" onClick={() => void resumeAgentRun()}>Continuar de onde parou</button>}</div>}
      </div>
      <form className="agent-composer" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        {!!referencedChatIds.length && <div className="reference-chips">{referencedChatIds.map((id) => {
          const chat = chats.find((item) => item.id === id)
          return <button type="button" key={id} onClick={() => setReferencedChatIds((items) => items.filter((item) => item !== id))}>@{chat?.title ?? 'Chat indisponível'} ×</button>
        })}</div>}
        {!!referenceOptions.length && <div className="chat-reference-picker">{referenceOptions.map((chat) => <button type="button" aria-label={`Referenciar ${chat.title}`} key={chat.id} onClick={() => {
          setReferencedChatIds((items) => [...items, chat.id])
          setPrompt((value) => value.replace(/(?:^|\s)@[^\s]*$/, '').trimEnd())
        }}>{chat.title}<small>{chat.status === 'archived' ? 'Arquivada' : 'Adicionar contexto'}</small></button>)}</div>}
        <textarea aria-label="Mensagem para o agente" placeholder="Descreva o que voce quer construir…" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} />
        <footer><span>{permissionMode === 'ask' ? 'Mudanças pedem aprovação' : permissionMode === 'autopilot' ? 'Autopilot: edita, testa e corrige automaticamente' : 'Edição automática no workspace'}</span>{running ? <button type="button" className="stop-button" onClick={() => void cancelAgentRun()}>Parar</button> : <button type="submit" className="send-button" disabled={!prompt.trim()}>Enviar</button>}</footer>
      </form>
      </section>
    </div>
  )
}
