"use client";

import React from "react";

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
};

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Mizan Dashboard Crash:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--canvas, #f3f2ed)",
          color: "var(--ink, #18201c)",
          fontFamily: "var(--font-body, system-ui, sans-serif)",
          padding: "20px"
        }}>
          <div style={{ maxWidth: 400, textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
              <div style={{ background: "var(--ink, #18201c)", color: "#fff", width: 48, height: 48, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 24, fontWeight: "bold" }}>M</span>
              </div>
            </div>
            <h1 style={{ fontSize: 24, margin: "0 0 12px", letterSpacing: "-0.03em" }}>Something broke.</h1>
            <p style={{ margin: "0 0 24px", color: "var(--muted, #677069)", fontSize: 14 }}>
              Your saved data is untouched. Reload the page to continue.
            </p>
            <button 
              onClick={() => window.location.reload()}
              style={{
                background: "var(--primary, #1f5b49)",
                color: "#fff",
                border: "none",
                padding: "10px 20px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Reload workspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
