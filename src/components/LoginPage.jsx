import { useState } from "react";
import { auth as authApi } from "../utils/api";
import { Store, Shield, Eye, EyeOff, Loader2, CheckCircle, IdCard, CreditCard, User } from "lucide-react";
import UploadZone from "./UploadZone";

export default function LoginPage({ onLogin }) {
  const [role, setRole] = useState("dealer");
  const [mode, setMode] = useState("login"); // 'login' | 'register'
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [location, setLocation] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [aadhaarPhoto, setAadhaarPhoto] = useState(null);
  const [panPhoto, setPanPhoto] = useState(null);
  const [passportPhoto, setPassportPhoto] = useState(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotStatus, setForgotStatus] = useState(""); // "sending", "sent", "error"
  const [forgotMessage, setForgotMessage] = useState("");

  const validateEmail = (mail) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail);
  };

  const handleAuth = async () => {
    setErr("");
    setSuccess("");

    if (mode === "register") {
      if (!name || name.trim().length < 3) {
        setErr("Dealer Name must be at least 3 characters");
        return;
      }
      if (!mobile || !/^\d{10}$/.test(mobile.trim())) {
        setErr("Please enter a valid 10-digit mobile number");
        return;
      }
      if (!email) { setErr("Email is required"); return; }
      if (!validateEmail(email)) { setErr("Please enter a valid email address"); return; }
      if (!location || location.trim().length < 3) {
        setErr("Working location is required (minimum 3 characters)");
        return;
      }
      if (!pass || pass.length < 6) {
        setErr("Password must be at least 6 characters");
        return;
      }

      if (!aadhaarPhoto) {
        setErr("Please upload your Aadhaar Card photo/PDF");
        return;
      }
      if (!panPhoto) {
        setErr("Please upload your PAN Card photo/PDF");
        return;
      }
      if (!passportPhoto) {
        setErr("Please upload your Passport Photo");
        return;
      }

      setIsLoading(true);
      try {
        await authApi.register({
          name: name.trim(),
          email: email.toLowerCase().trim(),
          password: pass,
          mobile: mobile.trim(),
          location: location.trim(),
          companyName: companyName.trim() || undefined,
          aadhaarPhoto,
          panPhoto,
          passportPhoto,
        });

        // Stop loading immediately — then transition to success screen after
        // a brief delay so the user sees the "Processing..." feedback resolve.
        setIsLoading(false);
        setTimeout(() => setIsSubmitted(true), 300);
      } catch (error) {
        setErr(error.message || "Registration failed. Please try again.");
        setIsLoading(false);
      }
    } else {
      if (!email) { setErr("Email is required"); return; }
      if (!validateEmail(email)) { setErr("Please enter a valid email address"); return; }
      if (!pass) { setErr("Password is required"); return; }

      setIsLoading(true);
      try {
        const data = await authApi.login(email.toLowerCase().trim(), pass, role);
        setSuccess("Success! Directing to dashboard...");
        setTimeout(() => {
          setIsLoading(false);
          onLogin(data.user, data.token);
        }, 500);
      } catch (error) {
        setErr(error.message || `Invalid email or password for ${role === "admin" ? "Admin" : "Dealer"} role`);
        setIsLoading(false);
      }
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    const trimmedEmail = forgotEmail.trim().toLowerCase();
    if (!trimmedEmail) {
      setForgotStatus("error");
      setForgotMessage("Please enter your email address.");
      return;
    }
    if (!validateEmail(trimmedEmail)) {
      setForgotStatus("error");
      setForgotMessage("Please enter a valid email address.");
      return;
    }
    setForgotStatus("sending");
    setForgotMessage("");
    try {
      await authApi.forgotPassword(trimmedEmail);
      setForgotStatus("sent");
      setForgotMessage("If an account with this email exists, a password reset link has been sent.");
    } catch (err) {
      setForgotStatus("error");
      setForgotMessage(err.message || "Something went wrong. Please try again.");
    }
  };

  if (isSubmitted) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ maxWidth: 500, textAlign: "center", padding: "2.5rem 2rem" }}>
          <div style={{ marginBottom: 16, color: "var(--green)" }}>
            <CheckCircle size={56} strokeWidth={1.5} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--green)", marginBottom: 10 }}>Application Submitted!</h2>
          <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.6, marginBottom: 24 }}>
            Thank you for applying to be a dealer with <strong>Highlight Pro</strong>. Your registration request has been successfully saved and is pending admin authorization.
          </p>
          <div style={{ background: "var(--green-light)", borderRadius: 12, padding: 16, border: "1px solid var(--green)", marginBottom: 24, textAlign: "left" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--green)", marginBottom: 6 }}>Next Steps in the Review Process:</div>
            <ul style={{ fontSize: 12, color: "var(--muted)", paddingLeft: 16, margin: 0, lineHeight: 1.6 }}>
              <li>The system administrator will verify your identity documents (Aadhaar & PAN card).</li>
              <li>Your working location <strong>({location})</strong> will be reviewed.</li>
              <li>Upon approval, your login account will be activated and you can sign in.</li>
            </ul>
          </div>
          <button
            className="btn-primary"
            onClick={() => {
              setIsSubmitted(false);
              setMode("login");
              setRole("dealer");
              setEmail("");
              setPass("");
              setName("");
              setMobile("");
              setLocation("");
              setCompanyName("");
              setAadhaarPhoto(null);
              setPanPhoto(null);
              setPassportPhoto(null);
              setErr("");
              setSuccess("");
            }}
          >
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: mode === "register" ? 650 : 420 }}>
        <div className="login-logo">
          <div className="login-logo-img-wrap">
            <img src="/logo.png" alt="Highlight Pro" />
          </div>
          <div>
            <div className="login-logo-text">Highlight Pro</div>
            <div className="login-logo-sub">BUSINESS SUITE</div>
          </div>
        </div>

        {mode === "login" && (
          <div className="role-btns">
            <div
              className={`role-btn ${role === "dealer" ? "active" : ""}`}
              onClick={() => !isLoading && setRole("dealer")}
            >
              <div className="role-btn-icon"><Store size={24} /></div>
              <div className="role-btn-label">Dealer Portal</div>
            </div>
            <div
              className={`role-btn ${role === "admin" ? "active" : ""}`}
              onClick={() => !isLoading && setRole("admin")}
            >
              <div className="role-btn-icon"><Shield size={24} /></div>
              <div className="role-btn-label">Admin Control</div>
            </div>
          </div>
        )}

        <div style={{ marginBottom: "1.25rem" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text)" }}>
            {mode === "login"
              ? `Sign in as ${role === "admin" ? "Admin" : "Dealer"}`
              : "Apply for Dealer Account"
            }
          </h2>
          <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px" }}>
            {mode === "login"
              ? "Access solar quotation and management tools"
              : "Submit your credentials to request dealer portal access"
            }
          </p>
        </div>

        {err && <div className="alert alert-red">{err}</div>}
        {success && <div className="alert alert-green">{success}</div>}

        {mode === "register" ? (
          <form onSubmit={e => { e.preventDefault(); handleAuth(); }} autoComplete="off">
            <div className="form-grid" style={{ marginBottom: "1rem" }}>
              <div className="field">
                <label>Dealer / Business Name</label>
                <input
                  placeholder="e.g. Mumbai Solar Enterprise"
                  value={name}
                  disabled={isLoading}
                  autoComplete="name"
                  onChange={e => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Mobile Number</label>
                <input
                  placeholder="e.g. 9876543210"
                  value={mobile}
                  maxLength={10}
                  disabled={isLoading}
                  autoComplete="tel"
                  onChange={e => setMobile(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            </div>

            <div className="form-grid" style={{ marginBottom: "1rem" }}>
              <div className="field">
                <label>Email Address</label>
                <input
                  type="email"
                  placeholder="e.g. dealer@example.com"
                  value={email}
                  disabled={isLoading}
                  autoComplete="email"
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Working Location</label>
                <input
                  placeholder="e.g. Mumbai, Maharashtra"
                  value={location}
                  disabled={isLoading}
                  autoComplete="address-level2"
                  onChange={e => setLocation(e.target.value)}
                />
              </div>
            </div>

            <div className="form-grid" style={{ marginBottom: "1rem" }}>
              <div className="field">
                <label>Company Name (if any)</label>
                <input
                  placeholder="e.g. Acme Solar Corp"
                  value={companyName}
                  disabled={isLoading}
                  autoComplete="organization"
                  onChange={e => setCompanyName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Set Password</label>
                <div className="field-pwd-wrapper">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={pass}
                    disabled={isLoading}
                    autoComplete="new-password"
                    onChange={e => setPass(e.target.value)}
                  />
                  <button
                    type="button"
                    className="pwd-toggle-btn"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 8, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Required Verification Documents (Photos)
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                <UploadZone
                  label="Aadhaar Card"
                  icon={<IdCard size={22} />}
                  file={aadhaarPhoto}
                  onChange={setAadhaarPhoto}
                />
                <UploadZone
                  label="PAN Card"
                  icon={<CreditCard size={22} />}
                  file={panPhoto}
                  onChange={setPanPhoto}
                />
                <UploadZone
                  label="Passport Photo"
                  icon={<User size={22} />}
                  file={passportPhoto}
                  onChange={setPassportPhoto}
                />
              </div>
            </div>

            <button
              type="submit"
              className={`btn-primary`}
              disabled={isLoading}
              style={{ position: "relative" }}
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <span>Submit Registration Application</span>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={e => { e.preventDefault(); handleAuth(); }} autoComplete="on">
            <div className="field">
              <label>Email Address</label>
              <input
                type="email"
                placeholder={role === "admin" ? "admin@highlightpro.in" : "dealer@example.com"}
                value={email}
                disabled={isLoading}
                autoComplete="email"
                onChange={e => setEmail(e.target.value)}
              />
            </div>

            <div className="field">
              <label>Password</label>
              <div className="field-pwd-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={pass}
                  disabled={isLoading}
                  autoComplete="current-password"
                  onChange={e => setPass(e.target.value)}
                />
                <button
                  type="button"
                  className="pwd-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className={`btn-primary ${role === "admin" ? "" : "sun"}`}
              disabled={isLoading}
              style={{ position: "relative" }}
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <span>Sign In</span>
              )}
            </button>

            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button
                type="button"
                onClick={() => { setShowForgotPassword(true); setForgotEmail(email); setForgotStatus(""); setForgotMessage(""); }}
                style={{ fontSize: 13, color: "var(--sun)", cursor: "pointer", fontWeight: 500, background: "none", border: "none", padding: 0, textDecoration: "underline" }}
              >
                Forgot Password?
              </button>
            </div>
          </form>
        )}

        {role === "dealer" && (
          <button
            type="button"
            className="toggle-mode-link"
            onClick={() => {
              if (isLoading) return;
              setMode(mode === "login" ? "register" : "login");
              setErr("");
              setSuccess("");
            }}
          >
            {mode === "login"
              ? "Not a dealer? Apply for account here"
              : "Already have an account? Sign in here"
            }
          </button>
        )}

        {role === "admin" && mode === "register" && (
          <button
            type="button"
            className="toggle-mode-link"
            onClick={() => {
              setMode("login");
              setRole("dealer");
            }}
          >
            Go back to Dealer Sign In
          </button>
        )}
      </div>

      {showForgotPassword && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
        <div style={{ background: "var(--card)", borderRadius: 12, padding: 32, maxWidth: 400, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", border: "1px solid var(--border)" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: 20, color: "var(--text)", fontWeight: 700 }}>Forgot Password</h3>
            <p style={{ margin: "0 0 20px 0", fontSize: 14, color: "var(--muted)" }}>Enter your email to receive a password reset link.</p>
            {forgotStatus === "sent" ? (
              <div>
                <p style={{ color: "var(--green)", fontSize: 14, marginBottom: 16, lineHeight: 1.5 }}>{forgotMessage}</p>
                <button
                  onClick={() => { setShowForgotPassword(false); setForgotStatus(""); setForgotEmail(""); }}
                  className="btn-primary"
                  style={{ width: "100%" }}
                >Back to Login</button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword}>
                <input
                  type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="Enter your email address"
                  required
                  disabled={forgotStatus === "sending"}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 14, marginBottom: 12, boxSizing: "border-box", opacity: forgotStatus === "sending" ? 0.7 : 1, background: "var(--input-bg, var(--bg-secondary))", color: "var(--text)" }}
                />
                {forgotStatus === "error" && <p style={{ color: "#ef4444", fontSize: 13, margin: "0 0 12px 0" }}>{forgotMessage}</p>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => { setShowForgotPassword(false); setForgotStatus(""); }} style={{ flex: 1, padding: 10, borderRadius: 8, background: "var(--bg-secondary)", color: "var(--text)", border: "1px solid var(--border)", cursor: "pointer", fontWeight: 500, fontSize: 14 }}>Cancel</button>
                  <button type="submit" disabled={forgotStatus === "sending"} className="btn-primary sun" style={{ flex: 1, opacity: forgotStatus === "sending" ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    {forgotStatus === "sending" ? <><Loader2 size={14} className="animate-spin" />Sending...</> : "Send Reset Link"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
