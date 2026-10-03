// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import type { AgentEvent, DesktopAPI, SessionRecord } from '../../../../shared/contracts'
import { createIdeStore } from '../../store/ide-store'
import { AgentPanel } from './AgentPanel'

describe('AgentPanel', () => {
  test('streams assistant text, shows tool activity and can cancel the run', async () => {
    const harness = createHarness()
    const view = render(<AgentPanel desktop={harness.desktop} store={harness.store} />)

    fireEvent.change(screen.getByRole('textbox', { name: /mensagem para o agente/i }), { target: { value: 'Build it' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await waitFor(() => expect(harness.start).toHaveBeenCalled())
    act(() => {
      harness.emit(event({ type: 'run.started' }))
      harness.emit(event({ type: 'assistant.delta', delta: 'Working' }))
      harness.emit(event({ type: 'tool.requested', toolCallId: 'call-1', name: 'read_file', arguments: '{}' }))
      harness.emit(event({ type: 'tool.started', toolCallId: 'call-1', name: 'read_file' }))
    })

    expect(await screen.findByText('Working')).toBeInTheDocument()
    expect(screen.getByText('read_file')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /parar/i }))
    expect(harness.cancel).toHaveBeenCalledWith('run-1')

    view.unmount()
    expect(harness.unsubscribe).toHaveBeenCalled()
  })

  test('keeps approval blocking until accepted or rejected', async () => {
    const harness = createHarness()
    render(<AgentPanel desktop={harness.desktop} store={harness.store} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Change file' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await waitFor(() => expect(harness.start).toHaveBeenCalled())
    act(() => { harness.emit(event({ type: 'approval.requested', approvalId: 'approval-1', summary: 'Alterar src/app.ts' })) })

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Alterar src/app.ts')
    fireEvent.click(screen.getByRole('button', { name: /aprovar/i }))
    expect(harness.resolveApproval).toHaveBeenCalledWith('run-1', 'approval-1', 'approved')
  })
})

function createHarness() {
  let listener: (event: AgentEvent) => void = () => undefined
  const unsubscribe = vi.fn()
  const start = vi.fn(async () => ({ runId: 'run-1' }))
  const cancel = vi.fn(async () => undefined)
  const resolveApproval = vi.fn(async () => undefined)
  const session: SessionRecord = {
    id: 'session-1', title: 'Project', workspaceRoot: 'C:/project', permissionMode: 'ask', messages: [],
    createdAt: '2026-10-03T12:00:00.000Z', updatedAt: '2026-10-03T12:00:00.000Z'
  }
  const desktop = {
    app: { platform: 'win32', electronVersion: '38' },
    workspace: { open: async (root: string) => ({ root }), createFolder: async () => undefined, list: async () => [], readText: async () => ({ content: '', hash: '', totalLines: 0 }), saveText: async () => ({ hash: '' }), search: async () => [] },
    sessions: { list: async () => [session], create: async () => session, appendMessage: async () => { throw new Error('unused') }, onAgentEvent: (next: (event: AgentEvent) => void) => { listener = next; return unsubscribe } },
    settings: { models: async () => ({ fastModel: 'fast', deepModel: 'deep' }) },
    agent: { start, cancel, resolveApproval, listProposals: async () => [], applyProposal: async () => { throw new Error('unused') }, rejectProposal: async () => { throw new Error('unused') } },
    terminal: { create: async () => ({ id: 'terminal' }), write: async () => undefined, resize: async () => undefined, dispose: async () => undefined, onData: () => () => undefined, onExit: () => () => undefined }
  } as DesktopAPI
  const store = createIdeStore({ desktop: () => desktop })
  store.setState({ workspaceRoot: 'C:/project' })
  return { desktop, store, start, cancel, resolveApproval, unsubscribe, emit: (item: AgentEvent) => listener(item) }
}

type AgentEventInput = AgentEvent extends infer Event ? Event extends AgentEvent ? Omit<Event, 'runId' | 'timestamp'> : never : never
function event(value: AgentEventInput): AgentEvent {
  return { ...value, runId: 'run-1', timestamp: '2026-10-03T12:00:00.000Z' } as AgentEvent
}
