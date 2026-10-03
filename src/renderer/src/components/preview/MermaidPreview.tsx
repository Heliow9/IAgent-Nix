import mermaid from 'mermaid'
import { useEffect, useId, useState } from 'react'

export function MermaidPreview({ code }: { code: string }): React.JSX.Element {
  const id = `mermaid-${useId().replaceAll(':', '')}`
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    setError(undefined)
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark', suppressErrorRendering: true })
    void mermaid.render(id, sanitizeMermaidSource(code)).then((result) => {
      if (active) setSvg(sanitizeSvg(result.svg))
    }).catch((cause: unknown) => {
      if (active) { setSvg(''); setError(cause instanceof Error ? cause.message : 'Diagrama Mermaid invalido') }
    })
    return () => { active = false }
  }, [code, id])

  if (error) return <div className="mermaid-error" role="alert">{error}</div>
  return <div className="mermaid-preview" dangerouslySetInnerHTML={{ __html: svg }} />
}

export function sanitizeMermaidSource(source: string): string {
  return source.replace(/<script[\s\S]*?<\/script>/gi, '[removed]').replace(/javascript\s*:/gi, '')
}

function sanitizeSvg(svg: string): string {
  if (typeof DOMParser === 'undefined') return svg.replace(/<script[\s\S]*?<\/script>/gi, '')
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
  document.querySelectorAll('script, foreignObject').forEach((node) => node.remove())
  document.querySelectorAll('*').forEach((node) => {
    for (const attribute of [...node.attributes]) {
      if (attribute.name.toLowerCase().startsWith('on') || /javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name)
    }
  })
  return new XMLSerializer().serializeToString(document.documentElement)
}
