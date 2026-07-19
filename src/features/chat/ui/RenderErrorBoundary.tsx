import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; label: string; }
interface State { hasError: boolean; error: string; }

export class RenderErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: '' };
  static getDerivedStateFromError(error: Error): State { return { hasError: true, error: error.toString() }; }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) { console.error('Render error', error, errorInfo); }
  render() { return this.state.hasError ? <div style={{ color: 'red' }}>{this.props.label}: {this.state.error}</div> : this.props.children; }
}
