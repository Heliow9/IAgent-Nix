import { describe, expect, test } from 'vitest'

import { ToolRegistry } from './tool-registry'
import { registerWorkspaceTools } from './workspace-tools'

describe('workspace tool schemas', () => {
  test('publishes input schemas with defaults optional and accepts a search path hint', () => {
    const registry = new ToolRegistry()
    registerWorkspaceTools(registry, () => ({}) as never, {} as never)

    const search = registry.definitionsForPhase('workspace').find((tool) => tool.function.name === 'search_files')!
    expect(search.function.parameters).toMatchObject({
      properties: { query: expect.any(Object), path: expect.any(Object), maxResults: expect.any(Object) },
      required: ['query'],
      additionalProperties: false
    })
    expect(registry.parse('search_files', '{"query":"needle","path":"src"}')).toEqual({ query: 'needle', path: 'src', maxResults: 100 })

    const command = registry.definitionsForPhase('workspace').find((tool) => tool.function.name === 'run_command')!
    expect((command.function.parameters as { required: string[] }).required).toEqual(['program'])
    expect(registry.definitionsForPhase('workspace').map((tool) => tool.function.name)).toContain('propose_file_patch')
    expect(registry.definitionsForPhase('workspace').map((tool) => tool.function.name)).toContain('open_file_in_editor')
  })
})
