// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { MermaidPreview } from './MermaidPreview'

const { initialize, renderDiagram } = vi.hoisted(() => ({ initialize: vi.fn(), renderDiagram: vi.fn() }))
vi.mock('mermaid', () => ({ default: { initialize, render: renderDiagram } }))

describe('MermaidPreview', () => {
  beforeEach(() => {
    renderDiagram.mockReset()
  })

  test('uses strict security and strips executable labels before rendering', async () => {
    renderDiagram.mockResolvedValue({ svg: '<svg aria-label="diagram"></svg>' })
    render(<MermaidPreview code={'graph TD\nA[<script>alert(1)</script>]-->B'} />)

    await waitFor(() => expect(renderDiagram).toHaveBeenCalled())
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict' }))
    expect(renderDiagram.mock.calls[0][1]).not.toContain('<script>')
    expect(screen.getByLabelText('diagram')).toBeInTheDocument()
  })

  test('displays Mermaid syntax errors', async () => {
    renderDiagram.mockRejectedValue(new Error('Parse error on line 2'))
    render(<MermaidPreview code="graph ???" />)

    expect(await screen.findByText(/parse error on line 2/i)).toBeInTheDocument()
  })
})
