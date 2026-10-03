import { Component, type ErrorInfo, type ReactNode } from 'react'

interface SidePanelErrorBoundaryProps {
  children: ReactNode
  onRecover: () => void
}

interface SidePanelErrorBoundaryState {
  error?: Error
}

export class SidePanelErrorBoundary extends Component<SidePanelErrorBoundaryProps, SidePanelErrorBoundaryState> {
  state: SidePanelErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error): SidePanelErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('NIX side panel render error', error, info)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div className="side-panel-error" role="alert">
        <strong>Este painel encontrou um erro.</strong>
        <p>{this.state.error.message}</p>
        <button type="button" onClick={this.props.onRecover}>Voltar ao Explorador</button>
      </div>
    )
  }
}
