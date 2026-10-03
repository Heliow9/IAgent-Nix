import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { WorkspaceIntelligenceService } from './workspace-intelligence'

describe('WorkspaceIntelligenceService', () => {
  let root: string | undefined

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  test('indexes nested monorepo projects and exposes them in the overview', async () => {
    root = await mkdtemp(join(tmpdir(), 'nix-workspace-intelligence-'))
    await mkdir(join(root, 'apps', 'api', 'src'), { recursive: true })
    await mkdir(join(root, 'apps', 'dashboard', 'src'), { recursive: true })
    await mkdir(join(root, 'apps', 'mobile', 'src'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'payhub-root', scripts: { test: 'vitest' } }), 'utf8')
    await writeFile(join(root, 'apps', 'api', 'package.json'), JSON.stringify({ name: '@payhub/api', scripts: { build: 'tsc' } }), 'utf8')
    await writeFile(join(root, 'apps', 'dashboard', 'package.json'), JSON.stringify({ name: '@payhub/dashboard', scripts: { dev: 'vite' } }), 'utf8')
    await writeFile(join(root, 'apps', 'mobile', 'package.json'), JSON.stringify({ name: '@payhub/mobile', scripts: { start: 'expo start' } }), 'utf8')
    await writeFile(join(root, 'apps', 'api', 'src', 'index.ts'), 'export const api = true\n', 'utf8')
    await writeFile(join(root, 'apps', 'dashboard', 'src', 'Login.tsx'), 'export const Login = () => null\n', 'utf8')
    await writeFile(join(root, 'apps', 'mobile', 'src', 'Login.tsx'), 'export const MobileLogin = () => null\n', 'utf8')

    const intelligence = new WorkspaceIntelligenceService()
    intelligence.setRoot(root)
    const summary = await intelligence.rebuild()
    const projects = await intelligence.projects()
    const overview = await intelligence.overviewText()

    expect(summary.files).toBeGreaterThanOrEqual(7)
    expect(projects.map((project) => project.root)).toEqual(expect.arrayContaining(['.', 'apps/api', 'apps/dashboard', 'apps/mobile']))
    expect(overview).toContain('apps/api')
    expect(overview).toContain('apps/dashboard')
    expect(overview).toContain('apps/mobile')
    expect(overview).toContain('Áreas principais:')
  })
})
