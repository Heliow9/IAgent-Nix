// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import type { FileProposal } from '../../../../shared/contracts'
import { DiffViewer } from './DiffViewer'

const proposal: FileProposal = {
  id: 'proposal-1', kind: 'write', path: 'src/app.ts', status: 'pending',
  diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new'
}

describe('DiffViewer', () => {
  test('renders additions and removals and applies a pending proposal', async () => {
    let applied = false
    render(<DiffViewer proposal={proposal} onApply={async () => { applied = true }} onReject={async () => undefined} />)

    expect(screen.getByText('-old')).toHaveClass('diff-remove')
    expect(screen.getByText('+new')).toHaveClass('diff-add')
    fireEvent.click(screen.getByRole('button', { name: /aplicar/i }))
    await waitFor(() => expect(applied).toBe(true))
  })

  test('shows an apply conflict without hiding the diff', async () => {
    render(<DiffViewer proposal={proposal} onApply={async () => { throw Object.assign(new Error('Arquivo mudou no disco'), { code: 'CONTENT_CONFLICT' }) }} onReject={async () => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: /aplicar/i }))

    expect(await screen.findByText(/arquivo mudou no disco/i)).toBeInTheDocument()
    expect(screen.getByText('+new')).toBeInTheDocument()
  })
})
