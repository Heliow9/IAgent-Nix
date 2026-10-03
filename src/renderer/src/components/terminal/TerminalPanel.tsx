import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'

export function TerminalPanel({ workspaceRoot }: { workspaceRoot: string }): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!container.current) return
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: 12,
      theme: { background: '#080d14', foreground: '#c6d0df', cursor: '#61e6b0', selectionBackground: '#29423c' }
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container.current)
    fit.fit()
    let terminalId: string | undefined
    const pendingInput: string[] = []
    let removeData: (() => void) | undefined
    let removeExit: (() => void) | undefined
    const input = terminal.onData((data) => {
      if (terminalId) void window.desktop.terminal.write(terminalId, data)
      else pendingInput.push(data)
    })
    void window.desktop.terminal.create({ cwd: workspaceRoot, cols: terminal.cols, rows: terminal.rows }).then(({ id }) => {
      terminalId = id
      for (const data of pendingInput.splice(0)) void window.desktop.terminal.write(id, data)
      removeData = window.desktop.terminal.onData(id, (data) => terminal.write(data))
      removeExit = window.desktop.terminal.onExit(id, (code) => terminal.write(`\r\n[process exited ${code}]\r\n`))
    }).catch((error: unknown) => terminal.write(`\r\n[terminal error] ${error instanceof Error ? error.message : 'unknown error'}\r\n`))
    const resize = (): void => {
      fit.fit()
      if (terminalId) void window.desktop.terminal.resize(terminalId, terminal.cols, terminal.rows)
    }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize)
    observer?.observe(container.current)
    return () => {
      observer?.disconnect()
      removeData?.()
      removeExit?.()
      input.dispose()
      terminal.dispose()
      if (terminalId) void window.desktop.terminal.dispose(terminalId)
    }
  }, [workspaceRoot])

  return <div className="terminal-host" ref={container} aria-label="Terminal integrado" />
}
