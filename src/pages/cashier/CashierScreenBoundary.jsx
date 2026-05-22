import React from "react";
import { Icon } from "./Icon";

export class CashierScreenBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Cashier screen failed", error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  componentDidUpdate(prevProps) {
    if (prevProps.screenKey !== this.props.screenKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    const canShowDetails =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || import.meta.env.DEV);
    const errorText = this.state.error?.message || String(this.state.error || "");

    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 28,
          background: "var(--ink-25)",
        }}
      >
        <div
          style={{
            width: "min(520px, 100%)",
            background: "var(--ink-0)",
            border: "2px solid var(--color-danger)",
            borderRadius: 18,
            boxShadow: "0 5px 0 #8c2410",
            padding: 22,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: "var(--color-danger-soft)",
                color: "var(--color-danger)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon name="alert-triangle" size={22} />
            </div>
            <div>
              <div className="eyebrow">Screen error</div>
              <h2
                style={{
                  margin: "2px 0 0",
                  fontFamily: "var(--font-display)",
                  fontSize: 24,
                  lineHeight: 1.1,
                }}
              >
                This POS screen could not load
              </h2>
            </div>
          </div>
          <div style={{ marginTop: 12, color: "var(--ink-600)", fontSize: 14 }}>
            Use another menu item to continue working. The error has been logged in the console.
          </div>
          {canShowDetails && errorText && (
            <pre
              style={{
                margin: "14px 0 0",
                maxHeight: 120,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: "var(--ink-25)",
                border: "1px solid var(--ink-200)",
                borderRadius: 10,
                padding: 10,
                fontSize: 12,
                lineHeight: 1.35,
                color: "var(--ink-700)",
              }}
            >
              {errorText}
            </pre>
          )}
          <button
            type="button"
            onClick={this.reset}
            className="a-btn a-btn--secondary a-btn--sm"
            style={{ marginTop: 14, justifyContent: "center" }}
          >
            <Icon name="refresh-cw" size={14} /> Retry screen
          </button>
        </div>
      </div>
    );
  }
}
