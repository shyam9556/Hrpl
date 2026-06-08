import { useState, useEffect } from "react";
import { auth as authApi } from "../utils/api";
import { Eye, EyeOff, Loader2, CheckCircle, XCircle, KeyRound } from "lucide-react";

/**
 * ResetPasswordPage
 *
 * Rendered when the app detects a `?token=...` query parameter on load.
 * Handles the full password-reset form: validate token presence, enforce
 * password rules, submit to backend, then redirect to login on success.
 *
 * @param {string}   token     - The raw reset token extracted from the URL
 * @param {Function} onDone    - Called after success so App can clear the token
 *                               and navigate back to the login page.
 */
export default function ResetPasswordPage({ token, onDone }) {
  const [newPassword, setNewPassword]         = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword]       = useState(false);
  const [showConfirm, setShowConfirm]         = useState(false);
  const [isLoading, setIsLoading]             = useState(false);
  const [err, setErr]                         = useState("");
  const [success, setSuccess]                 = useState(false);

  // If for some reason we land here without a token — show error immediately
  const tokenMissing = !token || token.trim().length === 0;

  // Password strength helpers
  const hasMinLength  = newPassword.length >= 8;
  const hasUpperCase  = /[A-Z]/.test(newPassword);
  const hasNumber     = /\d/.test(newPassword);
  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;

  const strengthScore = [hasMinLength, hasUpperCase, hasNumber].filter(Boolean).length;
  const strengthLabel = strengthScore === 0 ? "" : strengthScore === 1 ? "Weak" : strengthScore === 2 ? "Fair" : "Strong";
  const strengthColor = strengthScore === 0 ? "var(--muted, #9ca3af)" : strengthScore === 1 ? "#ef4444" : strengthScore === 2 ? "#f59e0b" : "#22c55e";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr("");

    if (tokenMissing) {
      setErr("Invalid or missing reset token. Please use the link from your email.");
      return;
    }

    if (!hasMinLength) {
      setErr("Password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setErr("Passwords do not match.");
      return;
    }

    setIsLoading(true);
    try {
      await authApi.resetPassword(token.trim(), newPassword);
      setSuccess(true);
      // Auto-redirect to login after 3 seconds
      setTimeout(() => onDone(), 3000);
    } catch (error) {
      setErr(error.message || "Failed to reset password. The link may have expired. Please request a new one.");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Success state ──────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ maxWidth: 420, textAlign: "center", padding: "2.5rem 2rem" }}>
          <div style={{ marginBottom: 16, color: "var(--green)" }}>
            <CheckCircle size={56} strokeWidth={1.5} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--green)", marginBottom: 10 }}>
            Password Reset!
          </h2>
          <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6, marginBottom: 24 }}>
            Your password has been reset successfully. You will be redirected to the login page in a moment.
          </p>
          <button className="btn-primary" onClick={() => onDone()}>
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  // ── Invalid / missing token state ──────────────────────────────────────────
  if (tokenMissing) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ maxWidth: 420, textAlign: "center", padding: "2.5rem 2rem" }}>
          <div style={{ marginBottom: 16, color: "#ef4444" }}>
            <XCircle size={56} strokeWidth={1.5} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>
            Invalid Reset Link
          </h2>
          <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6, marginBottom: 24 }}>
            This password reset link is invalid or has already been used. Please request a new one from the login page.
          </p>
          <button className="btn-primary" onClick={() => onDone()}>
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  // ── Main reset form ────────────────────────────────────────────────────────
  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 420 }}>
        <div className="login-logo">
          <div className="login-logo-img-wrap">
            <img src="/logo.png" alt="Highlight Pro" />
          </div>
          <div>
            <div className="login-logo-text">Highlight Pro</div>
            <div className="login-logo-sub">BUSINESS SUITE</div>
          </div>
        </div>

        <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ color: "var(--sun)" }}>
            <KeyRound size={22} strokeWidth={1.8} />
          </div>
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text)", margin: 0 }}>
              Set New Password
            </h2>
            <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px" }}>
              Choose a strong password for your account
            </p>
          </div>
        </div>

        {err && <div className="alert alert-red">{err}</div>}

        <form onSubmit={handleSubmit}>
          {/* New Password */}
          <div className="field">
            <label>New Password</label>
            <div className="field-pwd-wrapper">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={newPassword}
                disabled={isLoading}
                autoComplete="new-password"
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <button
                type="button"
                className="pwd-toggle-btn"
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? "Hide password" : "Show password"}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {/* Password strength indicator */}
            {newPassword.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      style={{
                        flex: 1, height: 3, borderRadius: 2,
                        background: i <= strengthScore ? strengthColor : "var(--border)",
                        transition: "background 0.2s"
                      }}
                    />
                  ))}
                </div>
                <div style={{ fontSize: 11, color: strengthColor, fontWeight: 600 }}>
                  {strengthLabel}
                  {!hasMinLength && <span style={{ color: "var(--muted)", fontWeight: 400 }}> — min. 8 characters</span>}
                </div>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div className="field">
            <label>Confirm Password</label>
            <div className="field-pwd-wrapper">
              <input
                type={showConfirm ? "text" : "password"}
                placeholder="••••••••"
                value={confirmPassword}
                disabled={isLoading}
                autoComplete="new-password"
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{
                  borderColor: confirmPassword.length > 0
                    ? (passwordsMatch ? "var(--green)" : "#ef4444")
                    : undefined
                }}
              />
              <button
                type="button"
                className="pwd-toggle-btn"
                onClick={() => setShowConfirm(!showConfirm)}
                title={showConfirm ? "Hide confirm password" : "Show confirm password"}
                aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"}
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {confirmPassword.length > 0 && (
              <div style={{ fontSize: 11, marginTop: 4, color: passwordsMatch ? "var(--green)" : "#ef4444", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                {passwordsMatch ? <CheckCircle size={12} /> : <XCircle size={12} />}
                {passwordsMatch ? "Passwords match" : "Passwords do not match"}
              </div>
            )}
          </div>

          <button
            type="submit"
            className="btn-primary sun"
            disabled={isLoading || !hasMinLength || !passwordsMatch}
            style={{ position: "relative", marginTop: 4, opacity: (!hasMinLength || !passwordsMatch) ? 0.6 : 1 }}
          >
            {isLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Resetting Password...</span>
              </>
            ) : (
              <span>Reset Password</span>
            )}
          </button>
        </form>

        <button
          type="button"
          className="toggle-mode-link"
          onClick={() => onDone()}
          style={{ marginTop: 16 }}
        >
          Back to Sign In
        </button>
      </div>
    </div>
  );
}
