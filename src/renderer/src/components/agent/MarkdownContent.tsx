import { Fragment, memo } from 'react'

import type { ImportResolution } from '../../../../shared/contracts'
import { importTokensInLine } from '../../lib/import-navigation'

export const MarkdownContent = memo(function MarkdownContent({ content, onOpenPath, resolveImport }: {
  content: string
  onOpenPath?: (path: string) => void
  resolveImport?: (fromPath: string, specifier: string) => Promise<ImportResolution>
}): React.JSX.Element {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index += 1; continue }
    if (line.trimStart().startsWith('```')) {
      const language = line.trim().slice(3).trim()
      const code: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trimStart().startsWith('```')) code.push(lines[index++])
      if (index < lines.length) index += 1
      blocks.push(<pre className="markdown-code" key={`code-${index}`}><code data-language={language}>{code.join('\n')}</code></pre>)
      continue
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const text = inlineMarkdown(heading[2], onOpenPath, resolveImport)
      blocks.push(level === 1 ? <h1 key={index}>{text}</h1> : level === 2 ? <h2 key={index}>{text}</h2> : level === 3 ? <h3 key={index}>{text}</h3> : <h4 key={index}>{text}</h4>)
      index += 1
      continue
    }
    if (isTableRow(line) && isTableDivider(lines[index + 1])) {
      const headers = tableCells(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && isTableRow(lines[index])) rows.push(tableCells(lines[index++]))
      blocks.push(<div className="markdown-table-wrap" key={`table-${index}`}><table><thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{inlineMarkdown(cell, onOpenPath, resolveImport)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => {
        const sourcePath = inlineWorkspacePath(stripInlineCode(row[0] ?? ''))
        return <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inlineMarkdown(cell, onOpenPath, resolveImport, cellIndex === 0 ? undefined : sourcePath)}</td>)}</tr>
      })}</tbody></table></div>)
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*[-*]\s+/, ''))
      blocks.push(<ul key={`ul-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item, onOpenPath, resolveImport)}</li>)}</ul>)
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*\d+[.)]\s+/, ''))
      blocks.push(<ol key={`ol-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item, onOpenPath, resolveImport)}</li>)}</ol>)
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) paragraph.push(lines[index++])
    blocks.push(<p key={`p-${index}`}>{paragraph.map((item, itemIndex) => <Fragment key={itemIndex}>{itemIndex > 0 && <br />}{inlineMarkdown(item, onOpenPath, resolveImport)}</Fragment>)}</p>)
  }
  return <div className="message-content markdown-content">{blocks}</div>
})

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index]
  return /^#{1,4}\s+/.test(line) || line.trimStart().startsWith('```') || /^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line) || (isTableRow(line) && isTableDivider(lines[index + 1]))
}

function isTableRow(line?: string): boolean { return Boolean(line?.trim().startsWith('|') && line.trim().endsWith('|')) }
function isTableDivider(line?: string): boolean { return Boolean(line && /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line)) }
function tableCells(line: string): string[] { return line.trim().slice(1, -1).split('|').map((cell) => cell.trim()) }

function inlineMarkdown(
  line: string,
  onOpenPath?: (path: string) => void,
  resolveImport?: (fromPath: string, specifier: string) => Promise<ImportResolution>,
  sourcePath?: string
): React.ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) {
      const code = part.slice(1, -1)
      const imported = sourcePath
        ? importTokensInLine(code)[0]?.specifier ?? (/^\.{1,2}[\\/]/.test(code.trim()) ? code.trim() : undefined)
        : undefined
      if (imported && sourcePath && onOpenPath) {
        const resolver = resolveImport ?? ((fromPath: string, specifier: string) => window.desktop.workspace.resolveImport(fromPath, specifier))
        return <button type="button" className="markdown-file-code" key={index} aria-label={`Abrir import ${imported}`} title={`Resolver ${imported} a partir de ${sourcePath}`} onClick={() => {
          void resolver(sourcePath, imported).then((resolution) => {
            if (resolution.kind === 'workspace' && resolution.path) onOpenPath(resolution.path)
          })
        }}><code>{code}</code></button>
      }
      const workspacePath = inlineWorkspacePath(code)
      if (workspacePath && onOpenPath) {
        return <button type="button" className="markdown-file-code" key={index} aria-label={`Abrir ${workspacePath}`} title={`Abrir ${workspacePath}`} onClick={() => onOpenPath(workspacePath)}><code>{code}</code></button>
      }
      return <code key={index}>{code}</code>
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (link) {
      const workspacePath = relativeWorkspaceLink(link[2])
      if (workspacePath && onOpenPath) return <a key={index} href={link[2]} onClick={(event) => { event.preventDefault(); onOpenPath(workspacePath) }}>{link[1]}</a>
      return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>
    }
    return <Fragment key={index}>{part}</Fragment>
  })
}

function relativeWorkspaceLink(href: string): string | undefined {
  const value = href.trim()
  if (!value || value.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return undefined
  const withoutAnchor = value.split('#', 1)[0].split('?', 1)[0]
  const withoutPosition = withoutAnchor.replace(/:(\d+)(?::\d+)?$/, '')
  const normalized = withoutPosition.replace(/^\.\//, '').replaceAll('\\', '/')
  return normalized && !normalized.startsWith('../') ? normalized : undefined
}


function inlineWorkspacePath(value: string): string | undefined {
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '')
  if (!normalized || normalized.includes(' ') || normalized.startsWith('../') || normalized.startsWith('/')) return undefined
  // Conservative on purpose: turn file-looking inline code into an editor link,
  // but leave commands, URLs, API routes and arbitrary identifiers untouched.
  if (!/^(?:[\w.@+-]+\/)*[\w.@+-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|sass|less|md|mmd|html|yml|yaml|toml|xml|sql)$/i.test(normalized)) return undefined
  return normalized
}

function stripInlineCode(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('`') && trimmed.endsWith('`') ? trimmed.slice(1, -1) : trimmed
}
