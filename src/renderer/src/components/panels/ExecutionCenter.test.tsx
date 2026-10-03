// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import { ideStore, type AgentRunView } from '../../store/ide-store'
import { ExecutionCenter } from './ExecutionCenter'

afterEach(() => {
  cleanup()
  ideStore.setState({ agentRuns: {} })
})

describe('ExecutionCenter', () => {
  test('renders an empty state and updates when agent runs change without an unstable store selector', () => {
    ideStore.setState({ agentRuns: {} })
    render(<ExecutionCenter />)

    expect(screen.getByText('Nenhuma execução nesta conversa.')).toBeInTheDocument()
    expect(screen.getByText('Executando').previousElementSibling).toHaveTextContent('0')

    const run: AgentRunView = {
      id: 'run-12345678',
      status: 'running',
      assistantText: '',
      tools: [],
      approvals: [],
      proposals: [],
      resumable: false
    }

    act(() => {
      ideStore.setState({ agentRuns: { [run.id]: run } })
    })

    expect(screen.queryByText('Nenhuma execução nesta conversa.')).not.toBeInTheDocument()
    expect(screen.getByText('Executando').previousElementSibling).toHaveTextContent('1')
    expect(screen.getByText(/run-1234/)).toBeInTheDocument()
  })
})
