import React, { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: 40,
          textAlign: "center",
          background: "#f7f9fb",
          color: "#1a1a2e",
        }}>
          <span className="material-symbols" style={{ fontSize: 64, color: "var(--error)", marginBottom: 16 }}>error</span>
          <h2 style={{ margin: "0 0 8px" }}>Something went wrong</h2>
          <p style={{ color: "var(--on-surface-variant)", margin: "0 0 24px", maxWidth: 500 }}>
            An unexpected error occurred. Please try restarting the application.
          </p>
          <details style={{ textAlign: "left", maxWidth: 600, fontSize: 12, background: "#fff", padding: 16, borderRadius: 8, border: "1px solid var(--outline-variant)" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>Error Details</summary>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0, color: "var(--on-surface-variant)" }}>
              {this.state.error?.message}
              {"\n\n"}
              {this.state.error?.stack}
            </pre>
          </details>
          <button
            className="primary-button"
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{ marginTop: 24, padding: "12px 32px", borderRadius: 8, fontSize: 14 }}
          >
            <span className="material-symbols" style={{ fontSize: 18 }}>refresh</span>
            Reload Application
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
