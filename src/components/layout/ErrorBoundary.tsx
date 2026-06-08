import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Catches render errors anywhere in the tree so a
 * single bad component can't take down the whole window with a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-bg p-8 text-center text-fg">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <pre className="max-w-xl overflow-auto rounded-md bg-surface p-4 text-left text-xs text-muted">
          {error.message}
        </pre>
        <button
          onClick={this.reset}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Try again
        </button>
      </div>
    );
  }
}
