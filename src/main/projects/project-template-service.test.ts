import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { ProjectTemplateError, ProjectTemplateService } from './project-template-service'

describe('ProjectTemplateService', () => {
  let location: string
  const service = new ProjectTemplateService()

  beforeEach(async () => { location = await mkdtemp(join(tmpdir(), 'groq-ide-project-')) })
  afterEach(async () => { const { rm } = await import('node:fs/promises'); await rm(location, { recursive: true, force: true }) })

  test('sanitizes a display name into a safe deterministic project directory', () => {
    const first = service.preview({ name: '  Minha Aplicação Web  ', location, template: 'react-typescript' })
    const second = service.preview({ name: '  Minha Aplicação Web  ', location, template: 'react-typescript' })

    expect(first.projectName).toBe('minha-aplicacao-web')
    expect(first.targetPath).toBe(join(location, 'minha-aplicacao-web'))
    expect(first.confirmationToken).toBe(second.confirmationToken)
    expect(first.files).toContain('src/App.tsx')
  })

  test.each(['../escape', 'CON', '...'])('rejects an unsafe project name: %s', (name) => {
    expect(() => service.preview({ name, location, template: 'empty' })).toThrow(ProjectTemplateError)
  })

  test('requires the exact preview token and does not overwrite a non-empty target', async () => {
    const preview = service.preview({ name: 'api', location, template: 'node-typescript' })
    await expect(service.create({ name: 'api', location, template: 'node-typescript' }, 'wrong')).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' })

    await service.create({ name: 'api', location, template: 'node-typescript' }, preview.confirmationToken)
    expect(await readFile(join(location, 'api', 'src', 'index.ts'), 'utf8')).toContain('Hello from api')
    await writeFile(join(location, 'api', 'keep.txt'), 'mine', 'utf8')
    await expect(service.create({ name: 'api', location, template: 'node-typescript' }, preview.confirmationToken)).rejects.toMatchObject({ code: 'TARGET_NOT_EMPTY' })
    expect(await readFile(join(location, 'api', 'keep.txt'), 'utf8')).toBe('mine')
  })
})
