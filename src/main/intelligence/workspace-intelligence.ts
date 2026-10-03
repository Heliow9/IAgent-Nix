import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'

import type { WorkspaceImportEdge, WorkspaceIndexSummary, WorkspaceSymbol } from '../../shared/contracts'

const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', '.cache', '.turbo', 'vendor'])
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.py', '.java', '.cs', '.go', '.rs', '.php', '.vue', '.svelte', '.css', '.scss', '.html', '.sql', '.prisma', '.toml', '.yaml', '.yml'])
const PROJECT_MANIFEST_NAMES = new Set(['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'pubspec.yaml', 'composer.json'])
const MAX_FILE_BYTES = 1_500_000
const MAX_FILES = 20_000

interface FileIndex { path: string; imports: WorkspaceImportEdge[]; symbols: WorkspaceSymbol[]; language: string }
export interface WorkspaceProjectDescriptor {
  root: string
  manifest: string
  kind: string
  name?: string
  scripts?: string[]
  files: number
}

export class WorkspaceIntelligenceService {
  private files = new Map<string, FileIndex>()
  private projectsValue: WorkspaceProjectDescriptor[] = []
  private summaryValue: WorkspaceIndexSummary = { files: 0, symbols: 0, imports: 0, indexedAt: new Date(0).toISOString(), languages: {} }
  private root?: string
  private building?: Promise<WorkspaceIndexSummary>

  setRoot(root: string): void {
    const normalized = resolve(root)
    if (this.root !== normalized) {
      this.root = normalized
      this.files.clear()
      this.projectsValue = []
      this.summaryValue = { files: 0, symbols: 0, imports: 0, indexedAt: new Date(0).toISOString(), languages: {} }
    }
  }

  async rebuild(root = this.root): Promise<WorkspaceIndexSummary> {
    if (!root) throw new Error('No workspace is open')
    this.setRoot(root)
    if (this.building) return this.building
    this.building = this.build(root).finally(() => { this.building = undefined })
    return this.building
  }

  async summary(): Promise<WorkspaceIndexSummary> {
    if (this.summaryValue.files === 0 && this.root) await this.rebuild()
    return structuredClone(this.summaryValue)
  }

  async projects(): Promise<WorkspaceProjectDescriptor[]> {
    if (this.summaryValue.files === 0 && this.root) await this.rebuild()
    return structuredClone(this.projectsValue)
  }

  async searchSymbols(query: string, maxResults = 100): Promise<WorkspaceSymbol[]> {
    if (this.summaryValue.files === 0 && this.root) await this.rebuild()
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    return [...this.files.values()].flatMap((file) => file.symbols)
      .filter((symbol) => symbol.name.toLowerCase().includes(needle))
      .sort((a, b) => score(b.name, needle) - score(a.name, needle) || a.path.localeCompare(b.path) || a.line - b.line)
      .slice(0, Math.max(1, Math.min(500, maxResults)))
  }

  async relatedFiles(path: string): Promise<Array<{ path: string; relation: 'imports' | 'imported-by' }>> {
    if (this.summaryValue.files === 0 && this.root) await this.rebuild()
    const normalized = normalize(path)
    const output = new Map<string, 'imports' | 'imported-by'>()
    for (const edge of this.files.get(normalized)?.imports ?? []) if (edge.resolved) output.set(edge.resolved, 'imports')
    for (const file of this.files.values()) {
      if (file.imports.some((edge) => edge.resolved === normalized)) output.set(file.path, 'imported-by')
    }
    return [...output.entries()].map(([relatedPath, relation]) => ({ path: relatedPath, relation }))
  }

  async overviewText(): Promise<string> {
    const summary = await this.summary()
    const top = [...this.files.values()].sort((a, b) => b.symbols.length - a.symbols.length).slice(0, 20)
    const areas = topLevelAreas([...this.files.keys()])
    const projects = await this.projects()
    return [
      `Workspace indexado recursivamente: ${summary.files} arquivos, ${summary.symbols} símbolos, ${summary.imports} imports.`,
      `Linguagens: ${Object.entries(summary.languages).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `${k}:${v}`).join(', ') || 'n/d'}.`,
      `Áreas principais: ${areas.map((area) => `${area.path}:${area.files}`).join(', ') || 'n/d'}.`,
      'Projetos/subprojetos detectados por manifesto:',
      ...(projects.length ? projects.slice(0, 40).map((project) => `- ${project.root} [${project.kind}]${project.name ? ` ${project.name}` : ''} — ${project.files} arquivo(s); manifesto ${project.manifest}${project.scripts?.length ? `; scripts: ${project.scripts.slice(0, 10).join(', ')}` : ''}`) : ['- nenhum manifesto de projeto detectado']),
      'Arquivos com mais símbolos:',
      ...top.map((file) => `- ${file.path} (${file.symbols.length} símbolos)`)
    ].join('\n')
  }

  private async build(root: string): Promise<WorkspaceIndexSummary> {
    const paths: string[] = []
    await walk(root, '', paths)
    const selectedPaths = paths.slice(0, MAX_FILES)
    const allPaths = new Set(selectedPaths)
    const next = new Map<string, FileIndex>()
    const manifestContents = new Map<string, string>()
    const languages: Record<string, number> = {}
    for (const path of selectedPaths) {
      try {
        const absolute = join(root, ...path.split('/'))
        const info = await stat(absolute)
        if (!info.isFile() || info.size > MAX_FILE_BYTES) continue
        const content = await readFile(absolute, 'utf8')
        const language = languageName(path)
        languages[language] = (languages[language] ?? 0) + 1
        const imports = parseImports(path, content, allPaths)
        const symbols = parseSymbols(path, content)
        next.set(path, { path, imports, symbols, language })
        if (PROJECT_MANIFEST_NAMES.has(basename(path))) manifestContents.set(path, content)
      } catch { /* binary/disappeared files are skipped */ }
    }
    this.files = next
    this.projectsValue = buildProjectDescriptors([...next.keys()], manifestContents)
    this.summaryValue = {
      files: next.size,
      symbols: [...next.values()].reduce((sum, file) => sum + file.symbols.length, 0),
      imports: [...next.values()].reduce((sum, file) => sum + file.imports.length, 0),
      indexedAt: new Date().toISOString(),
      languages
    }
    return structuredClone(this.summaryValue)
  }
}

async function walk(root: string, current: string, output: string[]): Promise<void> {
  if (output.length >= MAX_FILES) return
  const absolute = current ? join(root, ...current.split('/')) : root
  let entries
  try { entries = await readdir(absolute, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.nix') {
      if (entry.isDirectory()) continue
    }
    const relativePath = normalize(current ? `${current}/${entry.name}` : entry.name)
    if (entry.isDirectory()) {
      if (!IGNORED.has(entry.name)) await walk(root, relativePath, output)
    } else if (TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase()) || PROJECT_MANIFEST_NAMES.has(entry.name) || entry.name === 'Dockerfile') {
      output.push(relativePath)
      if (output.length >= MAX_FILES) return
    }
  }
}

function buildProjectDescriptors(paths: string[], manifests: Map<string, string>): WorkspaceProjectDescriptor[] {
  const projects = [...manifests.entries()].map(([manifest, content]) => {
    const root = normalize(dirname(manifest)) === '.' ? '.' : normalize(dirname(manifest))
    const kind = manifestKind(basename(manifest))
    let name: string | undefined
    let scripts: string[] | undefined
    if (basename(manifest) === 'package.json') {
      try {
        const pkg = JSON.parse(content) as { name?: unknown; scripts?: unknown }
        if (typeof pkg.name === 'string') name = pkg.name
        if (pkg.scripts && typeof pkg.scripts === 'object') scripts = Object.keys(pkg.scripts as Record<string, unknown>)
      } catch { /* malformed package.json remains discoverable */ }
    }
    const prefix = root === '.' ? '' : `${root}/`
    const files = paths.filter((path) => !prefix || path.startsWith(prefix)).length
    return { root, manifest, kind, name, scripts, files }
  })

  return projects.sort((a, b) => {
    const depthA = a.root === '.' ? 0 : a.root.split('/').length
    const depthB = b.root === '.' ? 0 : b.root.split('/').length
    return depthA - depthB || a.root.localeCompare(b.root) || a.manifest.localeCompare(b.manifest)
  })
}

function topLevelAreas(paths: string[]): Array<{ path: string; files: number }> {
  const counts = new Map<string, number>()
  for (const path of paths) {
    const first = path.includes('/') ? path.split('/')[0] : '(raiz)'
    counts.set(first, (counts.get(first) ?? 0) + 1)
  }
  return [...counts.entries()].map(([path, files]) => ({ path, files })).sort((a, b) => b.files - a.files || a.path.localeCompare(b.path)).slice(0, 30)
}

function manifestKind(name: string): string {
  if (name === 'package.json') return 'Node/JS'
  if (name === 'pyproject.toml' || name === 'requirements.txt') return 'Python'
  if (name === 'go.mod') return 'Go'
  if (name === 'Cargo.toml') return 'Rust'
  if (name === 'pom.xml' || name === 'build.gradle' || name === 'build.gradle.kts') return 'JVM'
  if (name === 'pubspec.yaml') return 'Flutter/Dart'
  if (name === 'composer.json') return 'PHP'
  return 'Projeto'
}

function parseImports(path: string, content: string, allPaths: Set<string>): WorkspaceImportEdge[] {
  const specs = new Set<string>()
  const patterns = [
    /\b(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
  for (const pattern of patterns) for (const match of content.matchAll(pattern)) if (match[1]) specs.add(match[1])
  return [...specs].map((specifier) => ({ from: path, specifier, resolved: resolveImport(path, specifier, allPaths) }))
}

function resolveImport(fromPath: string, specifier: string, allPaths: Set<string>): string | undefined {
  if (!(specifier.startsWith('.') || specifier.startsWith('@/') || specifier.startsWith('~/'))) return undefined
  const baseDir = normalize(fromPath).split('/').slice(0, -1)
  const raw = specifier.startsWith('@/') || specifier.startsWith('~/')
    ? specifier.slice(2)
    : normalize([...baseDir, ...specifier.split('/')].join('/'))
  const collapsed = collapse(raw)
  const candidates = [collapsed, `${collapsed}.ts`, `${collapsed}.tsx`, `${collapsed}.js`, `${collapsed}.jsx`, `${collapsed}.mjs`, `${collapsed}.cjs`, `${collapsed}/index.ts`, `${collapsed}/index.tsx`, `${collapsed}/index.js`, `${collapsed}/index.jsx`]
  return candidates.find((candidate) => allPaths.has(candidate))
}

function parseSymbols(path: string, content: string): WorkspaceSymbol[] {
  const out: WorkspaceSymbol[] = []
  const lines = content.split(/\r?\n/)
  const rules: Array<{ kind: WorkspaceSymbol['kind']; re: RegExp }> = [
    { kind: 'function', re: /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'class', re: /^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'interface', re: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'type', re: /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'const', re: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'variable', re: /^(?:export\s+)?(?:let|var)\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'function', re: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/ },
    { kind: 'function', re: /^def\s+([A-Za-z_][\w]*)\s*\(/ },
    { kind: 'class', re: /^class\s+([A-Za-z_][\w]*)/ }
  ]
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    for (const rule of rules) {
      const match = rule.re.exec(trimmed)
      if (match?.[1]) {
        out.push({ name: match[1], kind: rule.kind, path, line: i + 1, exported: /^export\b/.test(trimmed) })
        break
      }
    }
  }
  return out
}

function languageName(path: string): string {
  const ext = extname(path).toLowerCase()
  if (!ext) return PROJECT_MANIFEST_NAMES.has(basename(path)) ? 'manifest' : 'other'
  return ({ '.ts': 'TypeScript', '.tsx': 'TSX', '.js': 'JavaScript', '.jsx': 'JSX', '.py': 'Python', '.java': 'Java', '.cs': 'C#', '.go': 'Go', '.rs': 'Rust', '.php': 'PHP', '.vue': 'Vue', '.svelte': 'Svelte', '.json': 'JSON', '.md': 'Markdown', '.sql': 'SQL', '.prisma': 'Prisma', '.toml': 'TOML', '.yaml': 'YAML', '.yml': 'YAML' } as Record<string, string>)[ext] ?? (ext.slice(1) || 'other')
}

function normalize(path: string): string { return path.split(sep).join('/').replace(/^\.\//, '') }
function collapse(path: string): string {
  const stack: string[] = []
  for (const part of normalize(path).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}
function score(name: string, needle: string): number { const lower = name.toLowerCase(); return lower === needle ? 100 : lower.startsWith(needle) ? 50 : 10 }
