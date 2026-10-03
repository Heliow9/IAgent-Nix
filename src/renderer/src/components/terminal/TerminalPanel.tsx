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
    terminal.focus()
    let terminalId: string | undefined
    const pendingInput: string[] = []
    let writeQueue = Promise.resolve()
    let removeData: (() => void) | undefined
    let removeExit: (() => void) | undefined
    const sendInput = (data: string): void => {
      if (!terminalId) {
        pendingInput.push(data)
        return
      }
      const id = terminalId
      writeQueue = writeQueue
        .then(() => window.desktop.terminal.write(id, data))
        .catch((error: unknown) => { terminal.write(`\r\n[terminal input error] ${error instanceof Error ? error.message : 'unknown error'}\r\n`) })
    }
    const input = terminal.onData(sendInput)
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && (event.code === 'Space' || event.key === ' ') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // Some Electron/xterm combinations can let the browser consume a plain
        // space before onData fires. Forward it explicitly and stop xterm from
        // emitting a duplicate character.
        sendInput(' ')
        return false
      }
      return true
    })
    void window.desktop.terminal.create({ cwd: workspaceRoot, cols: terminal.cols, rows: terminal.rows }).then(({ id }) => {
      terminalId = id
      for (const data of pendingInput.splice(0)) sendInput(data)
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
