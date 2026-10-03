import { useRef } from 'react'

export function ResizablePanel({ size, onSize, axis = 'x', className = '', children }: {
  size: number
  onSize(size: number): void
  axis?: 'x' | 'y'
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const origin = useRef<{ position: number; size: number } | null>(null)
  const start = (event: React.PointerEvent): void => {
    origin.current = { position: axis === 'x' ? event.clientX : event.clientY, size }
    const move = (next: PointerEvent): void => {
      if (!origin.current) return
      const position = axis === 'x' ? next.clientX : next.clientY
      onSize(Math.max(140, origin.current.size + position - origin.current.position))
    }
    const end = (): void => {
      origin.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }
  return (
    <section className={`resizable-panel ${className}`} style={axis === 'x' ? { width: size } : { height: size }}>
      {children}
      <button type="button" aria-label="Redimensionar painel" className={`resize-handle ${axis}`} onPointerDown={start} />
    </section>
  )
}
