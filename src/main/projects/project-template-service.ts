import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export type ProjectTemplate = 'empty' | 'node-typescript' | 'react-typescript'

export interface ProjectTemplateInput {
  name: string
  location: string
  template: ProjectTemplate
}

export interface ProjectPreview {
  projectName: string
  targetPath: string
  template: ProjectTemplate
  files: string[]
  confirmationToken: string
}

export type ProjectTemplateErrorCode =
  | 'INVALID_NAME'
  | 'INVALID_LOCATION'
  | 'CONFIRMATION_MISMATCH'
  | 'TARGET_NOT_EMPTY'

export class ProjectTemplateError extends Error {
  constructor(public readonly code: ProjectTemplateErrorCode, message: string) {
    super(message)
    this.name = 'ProjectTemplateError'
  }
}

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export class ProjectTemplateService {
  preview(input: ProjectTemplateInput): ProjectPreview {
    const projectName = normalizeProjectName(input.name)
    const location = resolve(input.location.trim())
    if (!input.location.trim()) throw new ProjectTemplateError('INVALID_LOCATION', 'Informe o local do novo projeto')
    const targetPath = join(location, projectName)
    const files = Object.keys(templateFiles(input.template, projectName)).sort()
    const tokenPayload = JSON.stringify({ projectName, location, template: input.template, files })
    return {
      projectName,
      targetPath,
      template: input.template,
      files,
      confirmationToken: createHash('sha256').update(tokenPayload).digest('hex')
    }
  }

  async create(input: ProjectTemplateInput, confirmationToken: string): Promise<ProjectPreview> {
    const preview = this.preview(input)
    if (confirmationToken !== preview.confirmationToken) {
      throw new ProjectTemplateError('CONFIRMATION_MISMATCH', 'A revisao do projeto mudou; revise novamente antes de criar')
    }
    const location = resolve(input.location.trim())
    const locationStat = await stat(location).catch(() => undefined)
    if (!locationStat?.isDirectory()) {
      throw new ProjectTemplateError('INVALID_LOCATION', 'O local selecionado precisa ser uma pasta existente')
    }
    if (await exists(preview.targetPath)) {
      const targetStat = await stat(preview.targetPath)
      if (!targetStat.isDirectory() || (await readdir(preview.targetPath)).length > 0) {
        throw new ProjectTemplateError('TARGET_NOT_EMPTY', 'A pasta de destino ja existe e nao esta vazia')
      }
    }

    const stagingPath = join(location, `.${preview.projectName}.${randomUUID()}.tmp`)
    const files = templateFiles(input.template, preview.projectName)
    try {
      await mkdir(stagingPath, { recursive: false })
      for (const [relativePath, content] of Object.entries(files)) {
        const destination = join(stagingPath, relativePath)
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, content, 'utf8')
      }
      if (await exists(preview.targetPath)) await rm(preview.targetPath, { recursive: true })
      await rename(stagingPath, preview.targetPath)
      return preview
    } finally {
      await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

function normalizeProjectName(name: string): string {
  const raw = name.trim()
  if (!raw || raw.includes('..') || /[\\/\0]/.test(raw) || WINDOWS_RESERVED_NAMES.test(raw)) {
    throw new ProjectTemplateError('INVALID_NAME', 'Use um nome de projeto simples, sem caminhos ou nomes reservados')
  }
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!normalized || WINDOWS_RESERVED_NAMES.test(normalized)) {
    throw new ProjectTemplateError('INVALID_NAME', 'O nome nao produz uma pasta valida')
  }
  return normalized
}

function templateFiles(template: ProjectTemplate, name: string): Record<string, string> {
  if (template === 'empty') {
    return { 'README.md': `# ${name}\n\nProjeto criado no Groq Studio.\n` }
  }
  if (template === 'node-typescript') {
    return {
      '.gitignore': 'node_modules/\ndist/\n.env\n',
      'package.json': `${JSON.stringify({ name, version: '0.1.0', private: true, type: 'module', scripts: { dev: 'tsx watch src/index.ts', build: 'tsc', start: 'node dist/index.js' }, devDependencies: { '@types/node': '^24.0.0', tsx: '^4.0.0', typescript: '^5.0.0' } }, null, 2)}\n`,
      'src/index.ts': `console.log('Hello from ${name}')\n`,
      'tsconfig.json': `${JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, outDir: 'dist', rootDir: 'src' }, include: ['src'] }, null, 2)}\n`
    }
  }
  return {
    '.gitignore': 'node_modules/\ndist/\n.env\n',
    'index.html': '<!doctype html>\n<html lang="pt-BR"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>App</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
    'package.json': `${JSON.stringify({ name, version: '0.1.0', private: true, type: 'module', scripts: { dev: 'vite', build: 'tsc && vite build', preview: 'vite preview' }, dependencies: { '@vitejs/plugin-react': '^5.0.0', vite: '^7.0.0', typescript: '^5.0.0', react: '^19.0.0', 'react-dom': '^19.0.0' }, devDependencies: { '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' } }, null, 2)}\n`,
    'src/App.tsx': `import './styles.css'\n\nexport function App() {\n  return <main><h1>${name}</h1><p>Pronto para construir.</p></main>\n}\n`,
    'src/main.tsx': "import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\nimport { App } from './App'\n\ncreateRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)\n",
    'src/styles.css': ':root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; background: #090d14; color: #eef2ff; }\nbody { margin: 0; }\nmain { max-width: 720px; margin: 12vh auto; padding: 2rem; }\n',
    'tsconfig.json': `${JSON.stringify({ compilerOptions: { target: 'ES2022', useDefineForClassFields: true, module: 'ESNext', moduleResolution: 'Bundler', strict: true, jsx: 'react-jsx', noEmit: true }, include: ['src'] }, null, 2)}\n`,
    'vite.config.ts': "import react from '@vitejs/plugin-react'\nimport { defineConfig } from 'vite'\n\nexport default defineConfig({ plugins: [react()] })\n"
  }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}
