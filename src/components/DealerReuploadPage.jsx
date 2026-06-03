import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { reupload as reuploadApi } from "../utils/api";
import {
  Lock, Eye, EyeOff, Upload, CheckCircle2, AlertTriangle,
  FileText, X, Image, ArrowRight, RefreshCw, ShieldCheck,
  LinkIcon, Clock
} from "lucide-react";

// ─── Document labels ────────────────────────────────────────
const DOC_LABELS = {
  aadhaar:        "Aadhaar Card",
  aadhaar_front:  "Front Side",
  aadhaar_back:   "Back Side",
  pan:            "PAN Card",
  passport_photo: "Passport Photo",
  other:          "Dealership Agreement",
};

const DOC_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_SIZE_MB = 10;

// ─── File dropzone for a single document ────────────────────
function DocumentZone({ docType, file, onChange }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [typeError, setTypeError] = useState("");

  const label = DOC_LABELS[docType] || docType;
  const isImage = file && file.type && file.type.startsWith("image/");

  // Create a stable blob URL for image preview — recreated only when `file` changes,
  // and revoked on unmount/change to prevent memory leaks.
  const previewUrl = useMemo(() => {
    if (!file || !isImage) return null;
    const url = URL.createObjectURL(file);
    return url;
  }, [file]);

  useEffect(() => {
    // Revoke the blob URL when file changes or component unmounts
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const processFile = (f) => {
    if (!f) return;
    setTypeError("");

    // Validate MIME type
    if (!ALLOWED_MIMES.includes(f.type)) {
      setTypeError(`Invalid file type: ${f.type || "unknown"}. Please upload JPG, PNG, WebP, or PDF.`);
      return;
    }

    // Validate file size
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setTypeError(`File too large (${(f.size / (1024 * 1024)).toFixed(1)} MB). Maximum size is ${MAX_SIZE_MB} MB.`);
      return;
    }

    onChange(f);
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          processFile(e.dataTransfer.files[0]);
        }}
        onClick={() => !file && inputRef.current?.click()}
        style={{
          border: `2px dashed ${typeError ? "#ef4444" : file ? "#2E7D52" : drag ? "#2E7D52" : "rgba(0,0,0,0.15)"}`,
          borderRadius: 16,
          background: typeError ? "rgba(239,68,68,0.04)" : file ? "rgba(46,125,82,0.04)" : drag ? "rgba(46,125,82,0.06)" : "#fafafa",
          padding: file ? "12px" : "32px 16px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          cursor: file ? "default" : "pointer",
          transition: "all 0.2s",
          position: "relative",
          minHeight: 120,
          gap: 8,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={DOC_ACCEPT}
          style={{ display: "none" }}
          onChange={(e) => {
            processFile(e.target.files?.[0]);
            // Reset so the same file can be re-selected after Remove (BUG 2)
            e.target.value = "";
          }}
        />

        {file ? (
          <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {isImage ? (
              <img
                src={previewUrl}
                alt={label}
                style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, flexShrink: 0, border: "1px solid rgba(0,0,0,0.08)" }}
              />
            ) : (
              <div style={{
                width: 64, height: 64, borderRadius: 8, background: "#f0f7f4",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                flexShrink: 0, color: "#2E7D52", gap: 2
              }}>
                <FileText size={24} />
                <span style={{ fontSize: 9, fontWeight: 700 }}>PDF</span>
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#111827", marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 11, color: "#6b7280", wordBreak: "break-all", overflowWrap: "break-word", lineHeight: 1.4 }}>{file.name}</div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>{(file.size / 1024).toFixed(0)} KB</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <button
                onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                style={{ background: "#f0f7f4", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "#2E7D52", cursor: "pointer", fontWeight: 600 }}
              >
                Replace
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onChange(null); setTypeError(""); }}
                style={{ background: "#fee2e2", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "#dc2626", cursor: "pointer", fontWeight: 600 }}
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: typeError ? "#fee2e2" : "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: typeError ? "#dc2626" : "white"
            }}>
              {docType === "passport_photo" ? <Image size={22} /> : <FileText size={22} />}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: typeError ? "#dc2626" : "#111827" }}>{label}</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Click to browse or drag &amp; drop</div>
            <div style={{ fontSize: 10, color: "#9ca3af" }}>JPG, PNG, WebP, PDF — max {MAX_SIZE_MB}MB</div>
          </>
        )}
      </div>
      {typeError && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 6, fontSize: 11, color: "#dc2626" }}>
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ wordBreak: "break-word" }}>{typeError}</span>
        </div>
      )}
    </div>
  );
}

// ─── File → base64 ──────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve({ data: result, name: file.name, type: file.type, size: file.size });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Expired / Invalid Link Screen ──────────────────────────
function ExpiredLinkScreen({ onDone }) {
  return (
    <div style={{ textAlign: "center", padding: "8px 0" }}>
      <div style={{
        width: 72, height: 72, borderRadius: "50%",
        background: "linear-gradient(135deg, #fef2f2, #fee2e2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 20px",
        boxShadow: "0 8px 24px rgba(220,38,38,0.15)"
      }}>
        <Clock size={36} color="#dc2626" />
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#111827", marginBottom: 8 }}>
        Link Expired or Already Used
      </div>
      <div style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.7, marginBottom: 28 }}>
        This re-upload link is no longer valid. It may have already been used,
        or it has expired after 72 hours.
      </div>
      <div style={{
        background: "#fff8e6",
        border: "1px solid #fbbf24",
        borderLeft: "4px solid #f59e0b",
        borderRadius: "0 10px 10px 0",
        padding: "14px 16px",
        marginBottom: 24,
        fontSize: 13,
        color: "#374151",
        lineHeight: 1.6,
        textAlign: "left",
      }}>
        <strong style={{ display: "block", marginBottom: 6, color: "#1f2937" }}>What to do next:</strong>
        ✓ Contact your Highlight Pro admin and ask them to send a new re-upload link.<br />
        ✓ Check your email for a more recent re-upload link.<br />
        ✓ Ensure you are using the link from the latest email (not an older one).
      </div>
      <button
        onClick={onDone}
        style={{
          padding: "12px 32px",
          background: "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)",
          color: "white",
          border: "none",
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(46,125,82,0.25)",
        }}
      >
        Back to Home
      </button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────
export default function DealerReuploadPage({ token, onDone }) {
  // ── Step state: "checking" → "verify" → "upload" → "success" → "expired"
  const [step, setStep] = useState("checking");

  // Step 1 state
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  // Session data (returned after verify)
  const [reuploadJwt, setReuploadJwt] = useState(null);
  const [sessionInfo, setSessionInfo] = useState(null); // { name, email, reason, requiredDocs }

  // Step 2 state
  const [files, setFiles] = useState({}); // { docType: File }
  const [aadhaarMode, setAadhaarMode] = useState("photos"); // "photos" | "pdf"
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [converting, setConverting] = useState(false);

  // ── On mount: probe the token to check if it's already expired/used.
  // Uses the dedicated GET /api/auth/reupload/probe endpoint which checks
  // token validity server-side without requiring a password.
  // This shows the 'Link Expired' screen immediately if the link is dead,
  // rather than letting the dealer type their password before finding out.
  useEffect(() => {
    let cancelled = false;

    const checkTokenValidity = async () => {
      try {
        await reuploadApi.probe(token);
        // Token is valid — show the verify form
        if (!cancelled) setStep("verify");
      } catch (err) {
        if (cancelled) return;
        // Any error from probe (400 = expired/used/not found, network error, etc.)
        // means we can't proceed — show the expired screen.
        // Network errors fall through to verify so user can still try.
        if (err.status === 400) {
          setStep("expired");
        } else {
          // Network issue — show verify form; server will re-validate on submit
          setStep("verify");
        }
      }
    };

    checkTokenValidity();
    return () => { cancelled = true; };
  }, [token]);

  // ── Step 1: Verify token + password ─────────────────────────
  const handleVerify = useCallback(async (e) => {
    e.preventDefault();
    if (!password.trim()) return;
    setVerifying(true);
    setVerifyError("");
    try {
      const res = await reuploadApi.verify(token, password);
      setReuploadJwt(res.reuploadToken);
      setSessionInfo(res.registration);
      // Pre-initialise files state for non-aadhaar docs
      const initial = {};
      (res.registration.requiredDocs || []).forEach(d => {
        if (d !== "aadhaar") initial[d] = null;
      });
      setFiles(initial);
      setAadhaarMode("photos"); // default to two-photo mode
      setStep("upload");
    } catch (err) {
      const msg = err.message || "Verification failed. Please try again.";
      // If the token expired between the mount check and now, show the expired screen
      if (
        err.status === 400 &&
        (msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("expired") || msg.toLowerCase().includes("no longer valid"))
      ) {
        setStep("expired");
      } else {
        setVerifyError(msg);
      }
    } finally {
      setVerifying(false);
    }
  }, [token, password]);

  // ── Step 2: Submit documents ─────────────────────────────────
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!sessionInfo?.requiredDocs) return;

    const aadhaarNeeded = sessionInfo.requiredDocs.includes("aadhaar");
    const aadhaarPdfOk    = aadhaarNeeded && aadhaarMode === "pdf"    && !!files.aadhaar;
    const aadhaarPhotosOk = aadhaarNeeded && aadhaarMode === "photos" && !!files.aadhaar_front && !!files.aadhaar_back;
    const aadhaarOk = !aadhaarNeeded || aadhaarPdfOk || aadhaarPhotosOk;

    if (!aadhaarOk) {
      if (aadhaarMode === "photos") {
        const fm = !files.aadhaar_front, bm = !files.aadhaar_back;
        setSubmitError(fm && bm ? "Please upload both Aadhaar Front and Back photos."
          : fm ? "Please upload the Aadhaar Front photo."
          : "Please upload the Aadhaar Back photo.");
      } else {
        setSubmitError("Please upload the Aadhaar Card PDF or scan.");
      }
      return;
    }

    // Validate other required docs
    const otherDocs = sessionInfo.requiredDocs.filter(d => d !== "aadhaar");
    const missing = otherDocs.filter(d => !files[d]);
    if (missing.length > 0) {
      setSubmitError(`Please upload all required documents: ${missing.map(d => DOC_LABELS[d] || d).join(", ")}`);
      return;
    }

    setSubmitting(true);
    setConverting(true);
    setSubmitError("");
    try {
      // Build payload — Aadhaar key depends on dealer's chosen mode
      const payload = {};

      // Other docs use backend payload keys
      const DOC_TYPE_TO_PAYLOAD_KEY = {
        pan:            "panPhoto",
        passport_photo: "passportPhoto",
        other:          "agreementPhoto",
      };
      for (const docType of otherDocs) {
        const payloadKey = DOC_TYPE_TO_PAYLOAD_KEY[docType];
        if (!payloadKey) throw new Error(`Unknown document type: ${docType}. Please contact support.`);
        payload[payloadKey] = await fileToBase64(files[docType]);
      }

      // Aadhaar — expand to correct keys
      if (aadhaarNeeded) {
        if (aadhaarMode === "photos") {
          payload.aadhaarFront = await fileToBase64(files.aadhaar_front);
          payload.aadhaarBack  = await fileToBase64(files.aadhaar_back);
        } else {
          payload.aadhaarPhoto = await fileToBase64(files.aadhaar);
        }
      }

      setConverting(false);
      await reuploadApi.submit(reuploadJwt, payload);
      setStep("success");
    } catch (err) {
      const msg = err.message || "Failed to submit documents. Please try again.";
      if (err.status === 401) {
        setSubmitError("Your re-upload session has expired (sessions last 1 hour). Please use the link from your email again to start a new session.");
      } else {
        setSubmitError(msg);
      }
    } finally {
      setSubmitting(false);
      setConverting(false);
    }
  }, [reuploadJwt, sessionInfo, files, aadhaarMode]);

  // allDocsProvided: true only when every required doc is actually uploaded
  const allDocsProvided = (() => {
    if (!sessionInfo?.requiredDocs) return false;
    const aadhaarNeeded = sessionInfo.requiredDocs.includes("aadhaar");
    const aadhaarOk = !aadhaarNeeded || (
      aadhaarMode === "photos"
        ? (!!files.aadhaar_front && !!files.aadhaar_back)
        : !!files.aadhaar
    );
    const otherOk = sessionInfo.requiredDocs
      .filter(d => d !== "aadhaar")
      .every(d => !!files[d]);
    return aadhaarOk && otherOk;
  })();

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0f2419 0%, #1a3a27 40%, #0f1f15 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
      fontFamily: "'Segoe UI', Arial, Helvetica, sans-serif",
    }}>
      {/* Background decorative circles */}
      <div style={{ position: "fixed", top: -80, right: -80, width: 300, height: 300, borderRadius: "50%", background: "rgba(46,125,82,0.08)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: -60, left: -60, width: 250, height: 250, borderRadius: "50%", background: "rgba(46,125,82,0.06)", pointerEvents: "none" }} />

      <div style={{
        background: "#ffffff",
        borderRadius: 24,
        width: "100%",
        maxWidth: 520,
        boxShadow: "0 40px 80px rgba(0,0,0,0.35)",
        overflow: "hidden",
        position: "relative",
        zIndex: 1,
      }}>
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)",
          padding: "clamp(16px, 6vw, 32px) clamp(16px, 6vw, 32px) 28px",
          textAlign: "center",
        }}>
          <img
            src="/logo.png"
            alt="Highlight Pro"
            style={{ width: 56, height: 56, objectFit: "contain", background: "white", padding: 6, borderRadius: 14, marginBottom: 16, boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}
          />
          <div style={{ color: "white", fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>Highlight Pro</div>
          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 11, textTransform: "uppercase", letterSpacing: "2px", fontWeight: 600, marginTop: 4 }}>
            Document Re-upload
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: `28px clamp(16px, 6vw, 32px) clamp(16px, 6vw, 32px)` }}>

          {/* ── Step: Checking (initial token probe) ─────── */}
          {step === "checking" && (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "linear-gradient(135deg, #f0f7f4, #dcfce7)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 16px",
              }}>
                <RefreshCw size={24} color="#2E7D52" style={{ animation: "spin 1s linear infinite" }} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#374151" }}>Validating your link...</div>
              <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 6 }}>Please wait a moment.</div>
            </div>
          )}

          {/* ── Step: Expired ──────────────────────────────── */}
          {step === "expired" && <ExpiredLinkScreen onDone={onDone} />}

          {/* ── Step: Verify ──────────────────────────────── */}
          {step === "verify" && (
            <>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: "linear-gradient(135deg, #f0f7f4, #dcfce7)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 12px",
                  boxShadow: "0 4px 12px rgba(46,125,82,0.15)"
                }}>
                  <Lock size={24} color="#2E7D52" />
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 6 }}>Verify Identity</div>
                <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6 }}>
                  Enter the password you used when you first registered as a dealer.
                </div>
              </div>

              {/* Info box */}
              <div style={{
                background: "#fff8e6",
                border: "1px solid #fbbf24",
                borderLeft: "4px solid #f59e0b",
                borderRadius: "0 8px 8px 0",
                padding: "12px 14px",
                marginBottom: 24,
                fontSize: 13,
                color: "#374151",
                lineHeight: 1.6,
              }}>
                <strong style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, color: "#1f2937" }}><ShieldCheck size={14} color="#f59e0b" /> Security Note</strong>
                This is your <strong>registration password</strong> — the one you entered when you first signed up.
                This is not the same as your dealer login (which only activates after admin approval).
              </div>

              <form onSubmit={handleVerify}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Registration Password
                </label>
                <div style={{ position: "relative", marginBottom: 16 }}>
                  <input
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setVerifyError(""); }}
                    placeholder="Enter your registration password"
                    required
                    autoFocus
                    style={{
                      width: "100%",
                      padding: "12px 44px 12px 14px",
                      border: `1.5px solid ${verifyError ? "#ef4444" : "#e5e7eb"}`,
                      borderRadius: 10,
                      fontSize: 14,
                      color: "#111827",
                      background: "#fafafa",
                      outline: "none",
                      boxSizing: "border-box",
                      transition: "border-color 0.2s",
                    }}
                    onFocus={(e) => { if (!verifyError) e.target.style.borderColor = "#2E7D52"; }}
                    onBlur={(e) => { if (!verifyError) e.target.style.borderColor = "#e5e7eb"; }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(p => !p)}
                    style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#6b7280", display: "flex", alignItems: "center" }}
                  >
                    {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                {verifyError && (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 12px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ wordBreak: "break-word" }}>{verifyError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={verifying || !password.trim()}
                  style={{
                    width: "100%",
                    padding: "14px",
                    background: verifying || !password.trim()
                      ? "#9ca3af"
                      : "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)",
                    color: "white",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: verifying || !password.trim() ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    transition: "all 0.2s",
                    boxShadow: verifying || !password.trim() ? "none" : "0 4px 12px rgba(46,125,82,0.3)",
                  }}
                >
                  {verifying ? (
                    <><RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} /> Verifying...</>
                  ) : (
                    <><ShieldCheck size={16} /> Verify &amp; Continue <ArrowRight size={16} /></>
                  )}
                </button>
              </form>
            </>
          )}

          {/* ── Step: Upload ──────────────────────────────── */}
          {step === "upload" && sessionInfo && (
            <>
              {/* Welcome back */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
                  Hello, {sessionInfo.name}
                </div>
                <div style={{ fontSize: 13, color: "#6b7280" }}>{sessionInfo.email}</div>
              </div>

              {/* Admin's reason */}
              <div style={{
                background: "#fff8e6",
                border: "1px solid #fbbf24",
                borderLeft: "4px solid #f59e0b",
                borderRadius: "0 10px 10px 0",
                padding: "14px 16px",
                marginBottom: 24,
                fontSize: 13,
                color: "#374151",
                lineHeight: 1.6,
              }}>
                <strong style={{ display: "block", marginBottom: 6, color: "#1f2937", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Admin's Note
                </strong>
                {sessionInfo.reason}
              </div>

              {/* Document upload zones */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
                  Documents to Re-upload ({sessionInfo.requiredDocs?.length || 0})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

                  {/* ── Aadhaar Card — Two Photos / PDF toggle ── */}
                  {sessionInfo.requiredDocs?.includes("aadhaar") && (
                    <div style={{
                      border: `2px dashed ${
                        (aadhaarMode === "photos" ? (files.aadhaar_front && files.aadhaar_back) : files.aadhaar)
                          ? "#2E7D52" : "rgba(0,0,0,0.15)"
                      }`,
                      borderRadius: 16,
                      background: (aadhaarMode === "photos" ? (files.aadhaar_front && files.aadhaar_back) : files.aadhaar)
                        ? "rgba(46,125,82,0.04)" : "#fafafa",
                      padding: "16px",
                      transition: "all 0.2s",
                    }}>
                      {/* Header + toggle */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#1a5c38" }}>Aadhaar Card</div>
                        <div style={{ display: "inline-flex", background: "rgba(0,0,0,0.06)", borderRadius: 999, padding: 3, gap: 2 }}>
                          {[{ val: "photos", label: "Two Photos" }, { val: "pdf", label: "PDF / Scan" }].map(({ val, label }) => (
                            <button key={val} type="button"
                              onClick={() => { setAadhaarMode(val); setSubmitError(""); }}
                              style={{
                                padding: "4px 12px", borderRadius: 999, border: "none",
                                fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.18s",
                                background: aadhaarMode === val ? "#2E7D52" : "transparent",
                                color: aadhaarMode === val ? "white" : "#6b7280",
                              }}>{label}</button>
                          ))}
                        </div>
                      </div>

                      {aadhaarMode === "photos" ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          <DocumentZone docType="aadhaar_front" file={files.aadhaar_front || null}
                            onChange={(f) => setFiles(prev => ({ ...prev, aadhaar_front: f }))} />
                          <DocumentZone docType="aadhaar_back" file={files.aadhaar_back || null}
                            onChange={(f) => setFiles(prev => ({ ...prev, aadhaar_back: f }))} />
                        </div>
                      ) : (
                        <DocumentZone docType="aadhaar" file={files.aadhaar || null}
                          onChange={(f) => setFiles(prev => ({ ...prev, aadhaar: f }))} />
                      )}
                    </div>
                  )}

                  {/* ── Other documents ── */}
                  {sessionInfo.requiredDocs?.filter(d => d !== "aadhaar").map(docType => (
                    <DocumentZone
                      key={docType}
                      docType={docType}
                      file={files[docType]}
                      onChange={(f) => setFiles(prev => ({ ...prev, [docType]: f }))}
                    />
                  ))}
                </div>
              </div>

              {/* Submission progress indicator */}
              {converting && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: "#f0f7f4", border: "1px solid rgba(46,125,82,0.2)",
                  borderRadius: 8, padding: "10px 12px", marginBottom: 16,
                  fontSize: 13, color: "#2E7D52"
                }}>
                  <RefreshCw size={14} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
                  <span>Preparing documents... Please wait.</span>
                </div>
              )}

              {submitError && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 12px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <span style={{ wordBreak: "break-word" }}>{submitError}</span>
                    {submitError.includes("session has expired") && (
                      <div style={{ marginTop: 8 }}>
                        <button
                          onClick={onDone}
                          style={{ background: "none", border: "none", color: "#2E7D52", fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "underline", padding: 0 }}
                        >
                          Go back and use your re-upload link again
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting || !allDocsProvided}
                style={{
                  width: "100%",
                  padding: "14px",
                  background: submitting || !allDocsProvided
                    ? "#9ca3af"
                    : "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)",
                  color: "white",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: submitting || !allDocsProvided ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  transition: "all 0.2s",
                  boxShadow: submitting || !allDocsProvided ? "none" : "0 4px 12px rgba(46,125,82,0.3)",
                }}
              >
                {submitting ? (
                  <><RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} /> {converting ? "Preparing..." : "Uploading documents..."}</>
                ) : (
                  <><Upload size={16} /> Submit Documents</>
                )}
              </button>

              {!allDocsProvided && (
                <div style={{ textAlign: "center", fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
                  Upload all required documents to continue
                </div>
              )}
            </>
          )}

          {/* ── Step: Success ─────────────────────────────── */}
          {step === "success" && (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{
                width: 72, height: 72, borderRadius: "50%",
                background: "linear-gradient(135deg, #dcfce7, #bbf7d0)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 20px",
                boxShadow: "0 8px 24px rgba(46,125,82,0.2)"
              }}>
                <CheckCircle2 size={36} color="#2E7D52" />
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#111827", marginBottom: 8 }}>
                Documents Submitted!
              </div>
              <div style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.7, marginBottom: 28 }}>
                Your updated documents have been received. Our admin team will review your
                application and you'll receive an email with the decision shortly.
              </div>
              <div style={{
                background: "#f0f7f4",
                border: "1px solid rgba(46,125,82,0.2)",
                borderRadius: 12,
                padding: "14px 16px",
                marginBottom: 24,
                fontSize: 13,
                color: "#374151",
                lineHeight: 1.6,
                textAlign: "left",
              }}>
                <strong style={{ display: "block", marginBottom: 6, color: "#1f2937" }}>What's next?</strong>
                ✓ You'll receive a confirmation email shortly<br />
                ✓ Admin team will review your documents (1–3 working days)<br />
                ✓ You'll get an email with the final decision
              </div>
              <button
                onClick={onDone}
                style={{
                  padding: "12px 32px",
                  background: "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)",
                  color: "white",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(46,125,82,0.25)",
                }}
              >
                Back to Home
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
