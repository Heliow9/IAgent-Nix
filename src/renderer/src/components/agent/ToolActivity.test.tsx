// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { ToolActivity } from './ToolActivity'

describe('ToolActivity', () => {
  test('shows feedback before the first tool call starts', () => {
    render(<ToolActivity status="running" items={[]} />)

    expect(screen.getByText('Analisando solicitação…')).toBeInTheDocument()
  })

  test('groups completed tool calls in one collapsed execution row', () => {
    const { container } = render(<ToolActivity status="completed" items={[
      { id: '1', name: 'list_files', status: 'completed' },
      { id: '2', name: 'search_files', status: 'completed' },
      { id: '3', name: 'read_file', status: 'completed' }
    ]} />)

    const group = container.querySelector('details')
    expect(group).not.toHaveAttribute('open')
    expect(screen.getByText('Execução concluída · 3 etapas')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Execução concluída · 3 etapas'))
    expect(group).toHaveAttribute('open')
    expect(screen.getByText('Listou arquivos')).toBeInTheDocument()
    expect(screen.getByText('Pesquisou no projeto')).toBeInTheDocument()
    expect(screen.getByText('Leu arquivo')).toBeInTheDocument()
  })

  test('shows only the current action in the collapsed running row', () => {
    render(<ToolActivity status="running" items={[
      { id: '1', name: 'list_files', status: 'completed' },
      { id: '2', name: 'read_file', status: 'running', arguments: '{"path":"src/app.ts"}' }
    ]} />)

    expect(screen.getByText('Lendo src/app.ts…')).toBeInTheDocument()
  })

  test('does not claim completion while the agent is preparing its final response', () => {
    render(<ToolActivity status="running" items={[
      { id: '1', name: 'read_file', status: 'completed' }
    ]} />)

    expect(screen.getByText('Processando resposta · 1 etapa')).toBeInTheDocument()
    expect(screen.queryByText(/Execução concluída/)).not.toBeInTheDocument()
  })

  test('marks a structured tool error as failed', () => {
    render(<ToolActivity status="running" items={[
      { id: '1', name: 'search_files', status: 'completed', result: { ok: false, error: { code: 'INVALID_ARGUMENTS', message: 'Invalid' } } }
    ]} />)

    fireEvent.click(screen.getByText('Processando resposta · 1 etapa'))
    expect(screen.getByText('falhou')).toBeInTheDocument()
  })
})
