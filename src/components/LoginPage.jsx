import { useState, useEffect, useRef } from "react";
import { auth as authApi } from "../utils/api";
import { Store, Shield, Eye, EyeOff, Loader2, CheckCircle, IdCard, CreditCard, User, XCircle, Download, FileText } from "lucide-react";
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
  const [aadhaarPhoto, setAadhaarPhoto] = useState(null);       // PDF/scan mode
  const [aadhaarFront, setAadhaarFront] = useState(null);       // Two-photo mode — front
  const [aadhaarBack, setAadhaarBack] = useState(null);         // Two-photo mode — back
  const [aadhaarMode, setAadhaarMode] = useState("photos");    // "pdf" | "photos" (default: photos)
  const [panPhoto, setPanPhoto] = useState(null);
  const [passportPhoto, setPassportPhoto] = useState(null);
  const [agreementPhoto, setAgreementPhoto] = useState(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPass, setConfirmPass]   = useState("");
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotStatus, setForgotStatus] = useState(""); // "sending", "sent", "error"
  const [forgotMessage, setForgotMessage] = useState("");

  // ── OTP state (dealer registration email verification) ────────────────────
  // otpState drives every visual state of the OTP sub-flow:
  // idle | sending | sent | send_failed | verifying | otp_wrong |
  // otp_locked | expired | resending | resend_limit | verified
  const [otpState, setOtpState]                       = useState("idle");
  const [otpDigits, setOtpDigits]                     = useState(["","","","","",""]);
  const [otpError, setOtpError]                       = useState("");
  const [resendCooldown, setResendCooldown]           = useState(0);   // seconds left
  const [resendCount, setResendCount]                 = useState(0);   // resends used (max 3)
  const [emailVerifiedToken, setEmailVerifiedToken]   = useState(null);
  const [emailLocked, setEmailLocked]                 = useState(false);
  const [showEmailChangeWarning, setShowEmailChangeWarning] = useState(false);
  const [tokenExpiringSoon, setTokenExpiringSoon]     = useState(false);

  // Refs — DOM refs for the 6 OTP input boxes and timer IDs
  const otpRefs         = useRef([]);
  const cooldownRef     = useRef(null); // setInterval ID for resend countdown
  const expiryRef       = useRef(null); // setTimeout ID for OTP 10-min expiry
  const tokenExpiryRef  = useRef(null); // setTimeout ID for email_verified_token 14-min warning

  // ── Cleanup all OTP timers on unmount ────────────────────────────────────
  useEffect(() => {
    return () => {
      clearInterval(cooldownRef.current);
      clearTimeout(expiryRef.current);
      clearTimeout(tokenExpiryRef.current);
    };
  }, []);

  // ── OTP helpers ──────────────────────────────────────────────────────────
  const validateEmail = (mail) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail);
  };

  // Reset all OTP-related state to idle — called on email change or mode switch
  const resetOtpState = () => {
    clearInterval(cooldownRef.current);
    clearTimeout(expiryRef.current);
    clearTimeout(tokenExpiryRef.current);
    setOtpState("idle");
    setOtpDigits(["","","","","",""]);
    setOtpError("");
    setResendCooldown(0);
    setResendCount(0);
    setEmailVerifiedToken(null);
    setEmailLocked(false);
    setShowEmailChangeWarning(false);
    setTokenExpiringSoon(false);
  };

  // Start 60-second resend cooldown timer
  const startCooldown = () => {
    setResendCooldown(60);
    cooldownRef.current = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  // Start 10-minute OTP expiry timer
  const startExpiryTimer = () => {
    clearTimeout(expiryRef.current);
    expiryRef.current = setTimeout(() => {
      setOtpState("expired");
      setOtpError("Your OTP has expired. Please request a new one.");
      clearInterval(cooldownRef.current);
    }, 10 * 60 * 1000);
  };

  // ── Send OTP ─────────────────────────────────────────────────────────────
  const handleSendOTP = async () => {
    setOtpState("sending");
    setOtpError("");
    try {
      await authApi.sendOTP(email.toLowerCase().trim());
      setOtpState("sent");
      setEmailLocked(true);
      startCooldown();
      startExpiryTimer();
      // Focus first OTP box after brief delay for DOM to render
      setTimeout(() => otpRefs.current[0]?.focus(), 120);
    } catch (err) {
      setOtpState("send_failed");
      setOtpError(err.message || "Failed to send OTP. Please try again.");
      setEmailLocked(false);
    }
  };

  // ── Resend OTP ────────────────────────────────────────────────────────────
  const handleResendOTP = async () => {
    if (resendCount >= 3) { setOtpState("resend_limit"); return; }
    clearInterval(cooldownRef.current);
    clearTimeout(expiryRef.current);
    setOtpState("resending");
    setOtpDigits(["","","","","",""]);
    setOtpError("");
    try {
      await authApi.sendOTP(email.toLowerCase().trim());
      setResendCount(prev => prev + 1);
      setOtpState("sent");
      startCooldown();
      startExpiryTimer();
      setTimeout(() => otpRefs.current[0]?.focus(), 120);
    } catch (err) {
      // Stay in sent state so user can retry resend
      setOtpState("sent");
      setOtpError(err.message || "Resend failed. Please try again.");
    }
  };

  // ── Verify OTP ────────────────────────────────────────────────────────────
  const handleVerifyOTP = async (forceOtpString = null) => {
    const otpString = forceOtpString || otpDigits.join("");
    if (otpString.length < 6) {
      setOtpError("Please enter all 6 digits.");
      return;
    }
    setOtpState("verifying");
    setOtpError("");
    try {
      const data = await authApi.confirmOTP(email.toLowerCase().trim(), otpString);
      // Success — stop timers, save token, transition to verified
      clearTimeout(expiryRef.current);
      clearInterval(cooldownRef.current);
      setEmailVerifiedToken(data.token);
      setOtpState("verified");
      setOtpDigits(["","","","","",""]);
      // Show expiry warning 1 minute before the 15-min token expires
      tokenExpiryRef.current = setTimeout(() => setTokenExpiringSoon(true), 14 * 60 * 1000);
    } catch (err) {
      const isLocked = err.status === 429 || err.data?.locked;
      if (isLocked) {
        setOtpState("otp_locked");
        setOtpError("OTP locked after too many incorrect attempts. Please request a new OTP.");
        setOtpDigits(["","","","","",""]);
      } else if (err.status === 400) {
        const remaining = err.data?.remainingAttempts ?? 0;
        setOtpError(
          remaining > 0
            ? `Incorrect OTP — ${remaining} attempt${remaining === 1 ? "" : "s"} remaining`
            : "OTP is now locked. Please request a new one."
        );
        setOtpDigits(["","","","","",""]);
        // Brief shake stays, then transition back to sent so user can retry
        setTimeout(() => {
          setOtpState(remaining > 0 ? "sent" : "otp_locked");
          if (remaining > 0) otpRefs.current[0]?.focus();
        }, 600);
        setOtpState("otp_wrong"); // triggers shake CSS class immediately
      } else {
        // Network / server error — stay in sent, show message
        setOtpState("sent");
        setOtpError(err.message || "Verification failed. Please try again.");
      }
    }
  };

  // ── OTP box keyboard navigation ───────────────────────────────────────────
  const handleOtpKeyDown = (index, e) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (otpDigits[index] !== "") {
        const next = [...otpDigits]; next[index] = "";
        setOtpDigits(next);
      } else if (index > 0) {
        otpRefs.current[index - 1]?.focus();
        const next = [...otpDigits]; next[index - 1] = "";
        setOtpDigits(next);
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      otpRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  // ── OTP digit change ──────────────────────────────────────────────────────
  const handleOtpDigitChange = (index, value) => {
    const digit = value.replace(/\D/g, "").slice(-1); // accept only last digit
    const next = [...otpDigits];
    next[index] = digit;
    setOtpDigits(next);
    // Move focus to next box
    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
    // Auto-verify once all 6 digits are filled
    if (digit && index === 5) {
      const fullOtp = next.join("");
      if (fullOtp.length === 6) setTimeout(() => handleVerifyOTP(fullOtp), 80);
    }
  };

  // ── OTP paste handler ─────────────────────────────────────────────────────
  const handleOtpPaste = (e) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 0) return;
    e.preventDefault();
    const next = ["","","","","",""];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setOtpDigits(next);
    // Focus last filled box
    const focusIndex = Math.min(pasted.length, 5);
    setTimeout(() => otpRefs.current[focusIndex]?.focus(), 30);
    // Auto-verify if all 6 filled
    if (pasted.length === 6) setTimeout(() => handleVerifyOTP(pasted), 150);
  };

  // ── Confirm email change ──────────────────────────────────────────────────
  const confirmEmailChange = () => {
    resetOtpState();
    setShowEmailChangeWarning(false);
  };

  // ── Render OTP digit boxes ────────────────────────────────────────────────
  const renderOtpBoxes = () => (
    <div className="otp-boxes-row">
      {otpDigits.map((digit, i) => (
        <input
          key={i}
          ref={el => { otpRefs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          pattern="\d*"
          maxLength={1}
          value={digit}
          autoComplete={i === 0 ? "one-time-code" : "off"}
          disabled={
            otpState === "verifying" ||
            otpState === "otp_locked" ||
            otpState === "verified" ||
            otpState === "resending"
          }
          className={[
            "otp-box",
            digit ? "otp-filled" : "",
            otpState === "otp_wrong" ? "otp-error" : "",
          ].join(" ").trim()}
          onChange={e => handleOtpDigitChange(i, e.target.value)}
          onKeyDown={e => handleOtpKeyDown(i, e)}
          onPaste={handleOtpPaste}
        />
      ))}
    </div>
  );

  // Shows OTP section for these states
  const otpSectionVisible = [
    "sent","verifying","otp_wrong","otp_locked","expired","resending","resend_limit"
  ].includes(otpState);

  const handleAuth = async () => {
    setErr("");
    setSuccess("");

    if (mode === "register") {
      // ── Gate: email must be OTP-verified before any other validation ─────
      if (otpState !== "verified") {
        setErr("Please verify your email address first. Click \"Send OTP to Email\" and enter the code sent to your inbox.");
        return;
      }

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
      if (!pass || pass.length < 8) {
        setErr("Password must be at least 8 characters");
        return;
      }
      if (pass !== confirmPass) {
        setErr("Passwords do not match");
        return;
      }

      // Aadhaar validation — depends on selected mode
      if (aadhaarMode === "pdf") {
        if (!aadhaarPhoto) {
          setErr("Please upload your Aadhaar Card photo or PDF");
          return;
        }
      } else {
        if (!aadhaarFront && !aadhaarBack) {
          setErr("Please upload both sides of your Aadhaar Card");
          return;
        }
        if (!aadhaarFront) {
          setErr("Please upload the front side of your Aadhaar Card");
          return;
        }
        if (!aadhaarBack) {
          setErr("Please upload the back side of your Aadhaar Card (QR code side)");
          return;
        }
      }
      if (!panPhoto) {
        setErr("Please upload your PAN Card photo/PDF");
        return;
      }
      if (!passportPhoto) {
        setErr("Please upload your Passport Photo");
        return;
      }
      if (!agreementPhoto) {
        setErr("Please upload your signed Dealership Agreement PDF/Photo");
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
          // Pass email_verified_token so server saves email_verified = 1
          emailVerifiedToken: emailVerifiedToken || null,
          // Aadhaar: send either the single PDF/scan or the two photos depending on mode
          ...(aadhaarMode === "pdf"
            ? { aadhaarPhoto }
            : { aadhaarFront, aadhaarBack }
          ),
          panPhoto,
          passportPhoto,
          agreementPhoto,
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
              setConfirmPass("");
              setName("");
              setMobile("");
              setLocation("");
              setCompanyName("");
              setAadhaarPhoto(null);
              setAadhaarFront(null);
              setAadhaarBack(null);
              setAadhaarMode("photos");
              setPanPhoto(null);
              setPassportPhoto(null);
              setAgreementPhoto(null);
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
      <div className="login-card" style={{ maxWidth: mode === "register" ? "min(650px, 100%)" : 420 }}>
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
              onClick={() => !isLoading && (setRole("dealer"), setErr(""))}
            >
              <div className="role-btn-icon"><Store size={24} /></div>
              <div className="role-btn-label">Dealer Portal</div>
            </div>
            <div
              className={`role-btn ${role === "admin" ? "active" : ""}`}
              onClick={() => !isLoading && (setRole("admin"), setErr(""))}
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

        {err && (
          <div className="alert alert-red" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1 }}>{err}</span>
            <button
              type="button"
              onClick={() => setErr("")}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "inherit", display: "flex", alignItems: "center", flexShrink: 0 }}
              aria-label="Dismiss error"
            >
              <XCircle size={16} />
            </button>
          </div>
        )}
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
              {/* ── Email field with OTP verification ── */}
              <div className={`field ${otpState === "verified" ? "field-email-verified" : ""}`}>
                <label>Email Address</label>
                <div style={{ position: "relative" }}>
                  <input
                    type="email"
                    placeholder="e.g. dealer@example.com"
                    value={email}
                    disabled={isLoading || emailLocked}
                    autoComplete="email"
                    onChange={e => {
                      // If OTP not yet sent, allow free typing
                      if (!emailLocked) setEmail(e.target.value);
                    }}
                    onFocus={() => {
                      // Warn before unlocking email after OTP was sent
                      if (emailLocked) setShowEmailChangeWarning(true);
                    }}
                    style={{
                      paddingRight: otpState === "verified" ? 38 : undefined,
                      cursor: emailLocked ? "not-allowed" : "text",
                    }}
                  />
                  {otpState === "verified" && (
                    <CheckCircle
                      size={17}
                      style={{
                        position: "absolute", right: 12,
                        top: "50%", transform: "translateY(-50%)",
                        color: "var(--green)", pointerEvents: "none",
                      }}
                    />
                  )}
                </div>

                {/* Email verified badge */}
                {otpState === "verified" && (
                  <div className="email-verified-badge">
                    <CheckCircle size={13} />
                    Email Verified
                    <button
                      type="button"
                      onClick={() => setShowEmailChangeWarning(true)}
                      style={{
                        marginLeft: 6, fontSize: 11, color: "var(--muted)",
                        background: "none", border: "none", cursor: "pointer",
                        padding: 0, fontFamily: "inherit", textDecoration: "underline",
                      }}
                    >
                      Change
                    </button>
                  </div>
                )}

                {/* Send OTP button — shown when idle or send_failed */}
                {(otpState === "idle" || otpState === "send_failed") && (
                  <button
                    type="button"
                    onClick={handleSendOTP}
                    disabled={!email || !validateEmail(email) || otpState === "sending" || isLoading}
                    className="btn-primary"
                    style={{ marginTop: 10, padding: "10px", fontSize: 13 }}
                  >
                    {otpState === "sending"
                      ? <><Loader2 size={13} className="animate-spin" style={{ marginRight: 6 }} />Sending OTP...</>
                      : "Send OTP to Email"
                    }
                  </button>
                )}
                {otpState === "send_failed" && otpError && (
                  <p style={{ fontSize: 12, color: "var(--red)", marginTop: 5, fontWeight: 600 }}>
                    {otpError}
                  </p>
                )}
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

            {/* ── Email change warning ── */}
            {showEmailChangeWarning && (
              <div className="otp-email-change-warning">
                <p style={{ fontSize: 12, color: "#92400e", fontWeight: 600, marginBottom: 10 }}>
                  Changing your email will reset the current OTP verification. You will need to verify the new address.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={confirmEmailChange} className="btn-sm danger" style={{ flex: 1 }}>
                    Change Email
                  </button>
                  <button type="button" onClick={() => setShowEmailChangeWarning(false)} className="btn-sm" style={{ flex: 1 }}>
                    Keep Current
                  </button>
                </div>
              </div>
            )}

            {/* ── OTP verification section ── */}
            {otpSectionVisible && (
              <div className="otp-section" style={{ marginBottom: "1rem" }}>
                <p style={{ fontSize: 12, color: "var(--green)", fontWeight: 700, margin: "0 0 1px" }}>
                  OTP sent to <span style={{ fontWeight: 800 }}>{email}</span>
                </p>
                <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>
                  Check your inbox and spam folder. Valid for 10 minutes.
                </p>

                {renderOtpBoxes()}

                {otpError && (
                  <p style={{ fontSize: 11, color: "var(--red)", textAlign: "center", margin: "0 0 8px", fontWeight: 600 }}>
                    {otpError}
                  </p>
                )}

                {!["otp_locked","expired","resend_limit","resending"].includes(otpState) && (
                  <button
                    type="button"
                    onClick={() => handleVerifyOTP()}
                    disabled={otpDigits.join("").length < 6 || otpState === "verifying"}
                    className="btn-primary"
                    style={{ marginBottom: 8, padding: "9px", fontSize: 12 }}
                  >
                    {otpState === "verifying"
                      ? <><Loader2 size={13} className="animate-spin" style={{ marginRight: 5 }} />Verifying...</>
                      : "Verify OTP"
                    }
                  </button>
                )}

                <div className="otp-resend-row">
                  {otpState === "resend_limit" ? (
                    <span style={{ color: "var(--red)", fontSize: 11, fontWeight: 600 }}>
                      Resend limit reached. Refresh the page to try a new email.
                    </span>
                  ) : otpState === "otp_locked" || otpState === "expired" ? (
                    <button
                      type="button"
                      onClick={handleResendOTP}
                      className="otp-resend-btn"
                      style={{ width: "100%", textAlign: "center" }}
                      disabled={otpState === "resending"}
                    >
                      {otpState === "resending"
                        ? <><Loader2 size={11} style={{ display: "inline", marginRight: 4 }} />Sending...</>
                        : "Request New OTP"
                      }
                    </button>
                  ) : (
                    <>
                      <span>
                        {resendCooldown > 0
                          ? `Resend in ${resendCooldown}s`
                          : `${3 - resendCount} resend${3 - resendCount !== 1 ? "s" : ""} left`
                        }
                      </span>
                      <button
                        type="button"
                        onClick={handleResendOTP}
                        disabled={resendCooldown > 0 || otpState === "resending"}
                        className="otp-resend-btn"
                      >
                        {otpState === "resending" ? "Sending..." : "Resend OTP"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Token expiry warning banner — appears 14 min after verification */}
            {tokenExpiringSoon && otpState === "verified" && (
              <div style={{
                background: "#fffbeb", border: "1px solid #f59e0b",
                borderRadius: 8, padding: "8px 12px", marginBottom: "1rem",
                fontSize: 11, color: "#92400e", fontWeight: 600,
              }}>
                Email verification expires soon. Please submit your application now.
              </div>
            )}

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
                {/* Password strength indicator — mirrors ResetPasswordPage */}
                {pass.length > 0 && (() => {
                  const hasMinLength = pass.length >= 8;
                  const hasUpperCase = /[A-Z]/.test(pass);
                  const hasNumber = /\d/.test(pass);
                  const strengthScore = [hasMinLength, hasUpperCase, hasNumber].filter(Boolean).length;
                  const strengthLabel = strengthScore === 0 ? "" : strengthScore === 1 ? "Weak" : strengthScore === 2 ? "Fair" : "Strong";
                  const strengthColor = strengthScore === 0 ? "var(--muted)" : strengthScore === 1 ? "#ef4444" : strengthScore === 2 ? "#f59e0b" : "#22c55e";
                  return (
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
                  );
                })()}
              </div>
            </div>

            {/* Confirm Password — full-width below the grid */}
            <div className="field" style={{ marginBottom: "1rem" }}>
              <label>Confirm Password</label>
              <div className="field-pwd-wrapper">
                <input
                  type={showConfirmPass ? "text" : "password"}
                  placeholder="Re-enter your password"
                  value={confirmPass}
                  disabled={isLoading}
                  autoComplete="new-password"
                  onChange={e => setConfirmPass(e.target.value)}
                />
                <button
                  type="button"
                  className="pwd-toggle-btn"
                  onClick={() => setShowConfirmPass(!showConfirmPass)}
                  title={showConfirmPass ? "Hide confirm password" : "Show confirm password"}
                  aria-label={showConfirmPass ? "Hide confirm password" : "Show confirm password"}
                >
                  {showConfirmPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {confirmPass.length > 0 && (
                <div style={{ fontSize: 11, marginTop: 4, fontWeight: 500,
                  display: "flex", alignItems: "center", gap: 4,
                  color: pass === confirmPass ? "var(--green)" : "#ef4444" }}>
                  {pass === confirmPass
                    ? <><CheckCircle size={12} /> Passwords match</>
                    : <><XCircle size={12} /> Passwords do not match</>
                  }
                </div>
              )}
            </div>

            <div className="agreement-download-row" style={{
              background: "var(--light, #f8fafc)",
              border: "1px solid var(--border, #e2e8f0)",
              borderRadius: 12,
              padding: "12px 16px",
              marginBottom: "1.5rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
            }}>
              <div style={{ textAlign: "left" }}>
                <h4 style={{ fontSize: 13, fontWeight: 700, margin: 0, color: "var(--text)" }}>Dealership Agreement Form</h4>
                <p style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0 0 0" }}>
                  Download, print, fill and sign this document, then upload it below.
                </p>
              </div>
              <a
                href="/Highlight_Renewable_DEALERSHIP_AGREEMENT.pdf"
                download="Highlight_Renewable_DEALERSHIP_AGREEMENT.pdf"
                className="btn-sm primary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 16px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: "none",
                  background: "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)",
                  color: "white",
                  boxShadow: "0 2px 8px rgba(46,125,82,0.2)",
                  whiteSpace: "nowrap",
                  cursor: "pointer"
                }}
              >
                <Download size={14} /> Download PDF
              </a>
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 8, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Required Verification Documents (Photos/PDFs)
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>

                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{
                    background: "var(--light, #f8fafc)",
                    border: "1.5px solid var(--border, #e2e8f0)",
                    borderRadius: 12,
                    padding: "14px 16px",
                    marginBottom: 0,
                  }}>
                    {/* Header row with label + toggle */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <IdCard size={16} style={{ color: "var(--green)" }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Aadhaar Card</span>
                      </div>
                      {/* Mode toggle pill */}
                      <div className="aadhaar-mode-toggle" style={{
                        display: "inline-flex",
                        background: "var(--border, #e2e8f0)",
                        borderRadius: 999,
                        padding: 3,
                        gap: 2,
                      }}>
                        <button
                          type="button"
                          onClick={() => { setAadhaarMode("photos"); setAadhaarPhoto(null); }}
                          style={{
                            padding: "5px 13px",
                            borderRadius: 999,
                            border: "none",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                            transition: "all 0.18s",
                            background: aadhaarMode === "photos" ? "var(--green, #2E7D52)" : "transparent",
                            color: aadhaarMode === "photos" ? "white" : "var(--muted)",
                            boxShadow: aadhaarMode === "photos" ? "0 2px 6px rgba(46,125,82,0.25)" : "none",
                          }}
                        >
                          Two Photos
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAadhaarMode("pdf"); setAadhaarFront(null); setAadhaarBack(null); }}
                          style={{
                            padding: "5px 13px",
                            borderRadius: 999,
                            border: "none",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                            transition: "all 0.18s",
                            background: aadhaarMode === "pdf" ? "var(--green, #2E7D52)" : "transparent",
                            color: aadhaarMode === "pdf" ? "white" : "var(--muted)",
                            boxShadow: aadhaarMode === "pdf" ? "0 2px 6px rgba(46,125,82,0.25)" : "none",
                          }}
                        >
                          PDF / Scan
                        </button>
                      </div>
                    </div>

                    {/* Upload zones */}
                    {aadhaarMode === "photos" ? (
                      <div className="aadhaar-photo-grid">
                        <UploadZone
                          label="Front Side"
                          icon={<IdCard size={22} />}
                          file={aadhaarFront}
                          onChange={setAadhaarFront}
                          disabled={isLoading}
                        />
                        <UploadZone
                          label="Back Side"
                          icon={<IdCard size={22} />}
                          file={aadhaarBack}
                          onChange={setAadhaarBack}
                          disabled={isLoading}
                        />
                      </div>
                    ) : (
                      <UploadZone
                        label="Aadhaar Card"
                        icon={<IdCard size={22} />}
                        file={aadhaarPhoto}
                        onChange={setAadhaarPhoto}
                        disabled={isLoading}
                      />
                    )}
                  </div>
                </div>


                {/* Other documents */}
                <UploadZone
                  label="PAN Card"
                  icon={<CreditCard size={22} />}
                  file={panPhoto}
                  onChange={setPanPhoto}
                  disabled={isLoading}
                />
                <UploadZone
                  label="Passport Photo"
                  icon={<User size={22} />}
                  file={passportPhoto}
                  onChange={setPassportPhoto}
                  disabled={isLoading}
                />
                <UploadZone
                  label="Dealership Agreement"
                  icon={<FileText size={22} />}
                  file={agreementPhoto}
                  onChange={setAgreementPhoto}
                  disabled={isLoading}
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={isLoading || pass.length < 8 || pass !== confirmPass}
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
                placeholder={role === "admin" ? "" : "dealer@example.com"}
                value={email}
                disabled={isLoading}
                autoComplete="email"
                autoFocus
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
                  aria-label={showPassword ? "Hide password" : "Show password"}
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
              resetOtpState();
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
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px) 16px" }}>
        <div style={{ background: "var(--card)", borderRadius: 12, padding: "clamp(20px, 5vw, 32px)", maxWidth: 400, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", border: "1px solid var(--border)" }}>
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
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
