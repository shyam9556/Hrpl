import { Component } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Global Error Boundary
 *
 * Catches any unhandled JavaScript errors in the React component tree.
 * Without this, any crash in any component results in a completely blank
 * white screen with no recovery path for the user.
 *
 * Wrap the root <App> with this in main.jsx.
 *
 * React requires this to be a CLASS component — functional components
 * cannot be error boundaries as of React 19.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // In production, log to your error monitoring service (e.g. Sentry)
    console.error("[ErrorBoundary] Unhandled React error:", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #102A1C 0%, #1C3A2A 40%, #2E7D52 80%, #E29613 100%)",
            padding: "2rem",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          <div
            style={{
              background: "rgba(255,255,255,0.96)",
              borderRadius: 24,
              padding: "2.5rem 2rem",
              maxWidth: 480,
              width: "100%",
              textAlign: "center",
              boxShadow: "0 24px 70px rgba(0,0,0,0.25)",
            }}
          >
            {/* Icon */}
            <div style={{ marginBottom: 16, color: "#d97706" }}>
              <AlertTriangle size={52} strokeWidth={1.5} />
            </div>

            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "#1a1a1a",
                marginBottom: 8,
                letterSpacing: "-0.02em",
              }}
            >
              Something went wrong
            </h1>

            <p
              style={{
                fontSize: 14,
                color: "#6B6560",
                lineHeight: 1.6,
                marginBottom: 28,
              }}
            >
              An unexpected error occurred. This has been noted and our team
              will look into it. Please reload the page to continue.
            </p>

            <button
              onClick={this.handleReload}
              style={{
                width: "100%",
                padding: "13px",
                background: "#2E7D52",
                color: "white",
                border: "none",
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 600,
                fontFamily: "'DM Sans', sans-serif",
                cursor: "pointer",
                marginBottom: 12,
                boxShadow: "0 4px 12px rgba(46,125,82,0.25)",
              }}
            >
              Reload Page
            </button>

            {/* Show technical error in development only */}
            {import.meta.env.DEV && this.state.error && (
              <details
                style={{
                  marginTop: 16,
                  textAlign: "left",
                  background: "#FFF5F5",
                  border: "1px solid #FCA5A5",
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <summary
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#C0392B",
                    cursor: "pointer",
                    marginBottom: 8,
                  }}
                >
                  Developer Details (dev only)
                </summary>
                <pre
                  style={{
                    fontSize: 11,
                    color: "#C0392B",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    margin: 0,
                  }}
                >
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
