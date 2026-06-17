import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { reuploadQuotation as reuploadApi } from "../utils/api";
import { compressAndConvertToBase64 } from "../utils/helpers";
import {
  Lock, Eye, EyeOff, Upload, CheckCircle2, AlertTriangle,
  FileText, X, Image, ArrowRight, RefreshCw, ShieldCheck,
  LinkIcon, Clock, Camera
} from "lucide-react";

// ─── Document labels ────────────────────────────────────────
const DOC_LABELS = {
  aadhaar:       "Aadhaar Card",
  aadhaar_front: "Aadhaar Card — Front Side",
  aadhaar_back:  "Aadhaar Card — Back Side (QR Code)",
  pan:           "PAN Card",
  passbook:      "Bank Passbook",
  light_bill:    "Latest Light Bill",
  vera_bill:     "Vera Bill",
  house_photo_1: "House Photo 1",
  house_photo_2: "House Photo 2",
  house_photo_3: "House Photo 3",
  geotag_1:      "Site / Inverter Photo (Geotagged)",
  geotag_2:      "Solar Panels Photo (Geotagged)",
  geotag_3:      "ACDB / Net Meter Photo (Geotagged)",
};

const DOC_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_SIZE_MB = 10;

// ─── File dropzone for a single document ────────────────────
function DocumentZone({ docType, file, onChange, onCoords, disabled = false }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [typeError, setTypeError] = useState("");
  const [gpsLoading, setGpsLoading] = useState(false);
  const [coords, setCoords] = useState(null);

  const label = DOC_LABELS[docType] || docType;
  const isImage = file && file.type && file.type.startsWith("image/");
  const isGeotag = docType.startsWith("geotag_");

  // Create a stable blob URL for image preview — only recreated when `file`
  // changes, and revoked on unmount/change to prevent per-render memory leaks.
  const previewUrl = useMemo(() => {
    if (!file || !isImage) return null;
    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const processFile = async (f) => {
    if (!f) return;
    setTypeError("");
    setGpsLoading(false);
    setCoords(null);

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

    // If geotag is required, prompt and capture geolocation coordinates.
    // Coordinates are passed via onCoords callback — NOT mutated onto the File
    // object, since native File objects should be treated as read-only.
    if (isGeotag) {
      setGpsLoading(true);
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            setCoords({ latitude: lat, longitude: lng });
            setGpsLoading(false);
            // Report both the file and its coordinates to the parent.
            // onCoords is called before onChange so parent state is consistent.
            onCoords(docType, lat, lng);
            onChange(f);
          },
          (error) => {
            console.error("GPS Capture failed:", error);
            setTypeError(
              "GPS Location access is required for geotagged installation photos. " +
              "Please permit location access in your browser settings and try again."
            );
            setGpsLoading(false);
            // Explicitly reset to null so the parent knows this file was rejected.
            onChange(null);
          },
          {
            enableHighAccuracy: true,
            // 5 s timeout — fast enough to avoid long freezes on GPS-less devices
            // while still giving real GPS a fair chance. maximumAge allows a
            // recently cached position to be used immediately (30 s window).
            timeout: 5000,
            maximumAge: 30000,
          }
        );
      } else {
        setTypeError("Geolocation is not supported by your browser. Please use a modern smartphone or browser.");
        setGpsLoading(false);
        onChange(null);
      }
    } else {
      onChange(f);
    }
  };

  return (
    <div style={{ pointerEvents: disabled ? "none" : "auto", opacity: disabled ? 0.6 : 1, transition: "opacity 0.2s" }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          processFile(e.dataTransfer.files[0]);
        }}
        onClick={() => !file && !gpsLoading && inputRef.current?.click()}
        style={{
          border: `2px dashed ${typeError ? "#ef4444" : file ? "#2E7D52" : drag ? "#2E7D52" : "rgba(0,0,0,0.15)"}`,
          borderRadius: 16,
          background: typeError ? "rgba(239,68,68,0.04)" : file ? "rgba(46,125,82,0.04)" : drag ? "rgba(46,125,82,0.06)" : "#fafafa",
          padding: file ? "12px" : "32px 16px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          cursor: file || gpsLoading ? "default" : "pointer",
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

        {gpsLoading ? (
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <RefreshCw size={24} color="#2E7D52" style={{ animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "#2E7D52" }}>Retrieving GPS Coordinates...</span>
          </div>
        ) : file ? (
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
              <div style={{ fontSize: 11, color: "#6b7280" }}>
                {(file.size / 1024).toFixed(0)} KB
                {isGeotag && coords && (
                  <span style={{ color: "#2E7D52", fontWeight: 700, marginLeft: 8, wordBreak: "break-all" }}>
                    📍 Geotagged ({coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)})
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <button
                onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                style={{ background: "#f0f7f4", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "#2E7D52", cursor: "pointer", fontWeight: 600 }}
              >
                Replace
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onChange(null); setTypeError(""); setCoords(null); }}
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
              {isGeotag ? <Camera size={22} /> : <FileText size={22} />}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: typeError ? "#dc2626" : "#111827" }}>{label}</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Click to browse or drag &amp; drop</div>
            <div style={{ fontSize: 10, color: "#9ca3af" }}>
              {isGeotag ? "Requires GPS enablement — JPG, PNG, WebP" : "JPG, PNG, WebP, PDF — max 10MB"}
            </div>
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

// ─── File → base64 package ──────────────────────────────────
// Accepts optional explicit latitude/longitude rather than reading
// them from the File object (File objects are native browser objects
// and should not be mutated — see BUG 3 fix).
async function fileToBase64(file, latitude, longitude) {
  // Compress images (resize + lower JPEG quality), pass PDFs through
  const dataUri = await compressAndConvertToBase64(file);
  // Extract actual MIME from data URI (may differ after compression)
  const mimeMatch = dataUri.match(/^data:([^;]+);base64,/);
  const actualMime = mimeMatch ? mimeMatch[1] : file.type;
  const payload = {
    data: dataUri,
    name: file.name,
    type: actualMime,
    size: file.size,
  };
  if (latitude !== undefined && latitude !== null) {
    payload.latitude = latitude;
    payload.longitude = longitude;
  }
  return payload;
}

// ─── Expired Link Screen ────────────────────────────────────
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
        This quotation re-upload link is no longer valid. It may have already been used,
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
        ✓ Contact your Highlight Pro admin and ask them to send a new quotation re-upload link.<br />
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
export default function QuotationReuploadPage({ token, onDone }) {
  const [step, setStep] = useState("checking");

  // Step 1 state
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  // Session data (returned after verify)
  const [reuploadJwt, setReuploadJwt] = useState(null);
  const [sessionInfo, setSessionInfo] = useState(null); // { quotationNumber, customerName, reason, requiredDocs }

  // Step 2 state
  const [files, setFiles] = useState({}); // { aadhaar: File, geotag_1: File, ... }
  // geoCoords stores GPS coordinates captured by DocumentZone for each geotag
  // slot. Keyed by docType (e.g. "geotag_1"). Coordinates are stored here
  // rather than mutated onto File objects (native objects should be read-only).
  const [geoCoords, setGeoCoords] = useState({}); // { geotag_1: {lat, lng}, ... }
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [converting, setConverting] = useState(false);
  // Per-file progress tracking
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, currentDoc: "" });
  const [uploadStartTime, setUploadStartTime] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  // Elapsed time ticker
  useEffect(() => {
    if (!uploadStartTime) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - uploadStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [uploadStartTime]);

  // Probe the token on mount
  useEffect(() => {
    let cancelled = false;

    const checkTokenValidity = async () => {
      try {
        await reuploadApi.probe(token);
        if (!cancelled) setStep("verify");
      } catch (err) {
        if (cancelled) return;
        if (err.status === 400) {
          setStep("expired");
        } else {
          setStep("verify");
        }
      }
    };

    checkTokenValidity();
    return () => { cancelled = true; };
  }, [token]);

  // Step 1: Verify token + dealer password
  const handleVerify = useCallback(async (e) => {
    e.preventDefault();
    if (!password.trim()) return;
    setVerifying(true);
    setVerifyError("");
    try {
      const res = await reuploadApi.verify(token, password);
      setReuploadJwt(res.reuploadToken);
      setSessionInfo(res.quotation);
      // Pre-initialize files and geoCoords state
      const initial = {};
      (res.quotation.requiredDocs || []).forEach(d => { initial[d] = null; });
      setFiles(initial);
      setGeoCoords({});
      setStep("upload");
    } catch (err) {
      const msg = err.message || "Verification failed. Please try again.";
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

  // Step 2: Submit files
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!sessionInfo?.requiredDocs) return;

    // Check all required docs are provided
    const missing = sessionInfo.requiredDocs.filter(d => !files[d]);
    if (missing.length > 0) {
      setSubmitError(`Please upload all required files: ${missing.map(d => DOC_LABELS[d] || d).join(", ")}`);
      return;
    }

    setSubmitting(true);
    setConverting(true);
    setSubmitError("");
    setUploadStartTime(Date.now());
    setElapsed(0);
    try {
      // Package files into base64 payload sequentially with progress tracking
      const totalFiles = sessionInfo.requiredDocs.length;
      setUploadProgress({ current: 0, total: totalFiles, currentDoc: "" });

      const payload = {};
      for (let i = 0; i < sessionInfo.requiredDocs.length; i++) {
        const docType = sessionInfo.requiredDocs[i];
        const label = DOC_LABELS[docType] || docType;
        setUploadProgress({ current: i + 1, total: totalFiles, currentDoc: label });

        const coords = geoCoords[docType];
        payload[docType] = await fileToBase64(
          files[docType],
          coords?.lat ?? null,
          coords?.lng ?? null
        );
      }

      setConverting(false);
      setUploadProgress(prev => ({ ...prev, currentDoc: "Uploading to server..." }));
      await reuploadApi.submit(reuploadJwt, payload);
      setStep("success");
    } catch (err) {
      const msg = err.message || "Failed to submit documents. Please try again.";
      if (err.status === 401) {
        setSubmitError(
          "Your re-upload session has expired (sessions last 1 hour). Please use the link from your email again to start a new session."
        );
      } else {
        setSubmitError(msg);
      }
    } finally {
      setSubmitting(false);
      setConverting(false);
      setUploadStartTime(null);
    }
  }, [reuploadJwt, sessionInfo, files, geoCoords]);

  const allDocsProvided = sessionInfo?.requiredDocs?.every(d => files[d]) ?? false;

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
            Quotation Files Re-upload
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: `28px clamp(16px, 6vw, 32px) clamp(16px, 6vw, 32px)` }}>

          {/* Step: Checking */}
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
              <div style={{ fontSize: 16, fontWeight: 600, color: "#374151" }}>Validating your secure link...</div>
              <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 6 }}>Please wait a moment.</div>
            </div>
          )}

          {/* Step: Expired */}
          {step === "expired" && <ExpiredLinkScreen onDone={onDone} />}

          {/* Step: Verify */}
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
                <div style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 6 }}>Verify Dealer Identity</div>
                <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6 }}>
                  Enter your dealer account login password to unlock and review the request.
                </div>
              </div>

              {verifyError && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 12px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ wordBreak: "break-word" }}>{verifyError}</span>
                </div>
              )}

              <form onSubmit={handleVerify}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Dealer Password
                </label>
                <div style={{ position: "relative", marginBottom: 16 }}>
                  <input
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setVerifyError(""); }}
                    placeholder="Enter your dealer account password"
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
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(p => !p)}
                    style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#6b7280", display: "flex", alignItems: "center" }}
                  >
                    {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

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

          {/* Step: Upload */}
          {step === "upload" && sessionInfo && (
            <>
              {/* Customer and quotation info */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
                  Quotation: {sessionInfo.quotationNumber}
                </div>
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  Customer: <strong>{sessionInfo.customerName}</strong>
                </div>
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
                  Required Replacements ({sessionInfo.requiredDocs?.length || 0})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {sessionInfo.requiredDocs?.map(docType => (
                    <DocumentZone
                      key={docType}
                      docType={docType}
                      file={files[docType]}
                      onChange={(f) => setFiles(prev => ({ ...prev, [docType]: f }))}
                      onCoords={(dt, lat, lng) =>
                        setGeoCoords(prev => ({ ...prev, [dt]: { lat, lng } }))
                      }
                      disabled={submitting}
                    />
                  ))}
                </div>
              </div>

              {converting && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: "#f0f7f4", border: "1px solid rgba(46,125,82,0.2)",
                  borderRadius: 8, padding: "10px 12px", marginBottom: 16,
                  fontSize: 13, color: "#2E7D52"
                }}>
                  <RefreshCw size={14} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
                  <span>Preparing and tagging documents... Please wait.</span>
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
                          Go back and use your link again
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !allDocsProvided}
                style={{
                  width: "100%",
                  padding: "14px",
                  background: submitting || !allDocsProvided
                    ? (submitting ? "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)" : "#9ca3af")
                    : "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)",
                  color: "white",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: submitting || !allDocsProvided ? "not-allowed" : "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  transition: "all 0.2s",
                  boxShadow: submitting || !allDocsProvided ? "none" : "0 4px 12px rgba(46,125,82,0.3)",
                  opacity: submitting ? 0.9 : 1,
                }}
              >
                {submitting ? (
                  <>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} />
                      {uploadProgress.total > 0
                        ? `Processing ${uploadProgress.current} of ${uploadProgress.total} — ${uploadProgress.currentDoc}`
                        : converting ? "Tagging..." : "Uploading files..."
                      }
                    </span>
                    {uploadProgress.total > 0 && (
                      <div style={{ width: "100%", height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 3, overflow: "hidden", marginTop: 4 }}>
                        <div style={{ height: "100%", width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%`, background: "rgba(255,255,255,0.8)", borderRadius: 3, transition: "width 0.4s ease" }} />
                      </div>
                    )}
                    {elapsed > 2 && <span style={{ fontSize: 11, opacity: 0.7 }}>{elapsed}s elapsed</span>}
                  </>
                ) : (
                  <><Upload size={16} /> Submit Replacement Files</>
                )}
              </button>

              {!allDocsProvided && (
                <div style={{ textAlign: "center", fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
                  Upload all required files to continue
                </div>
              )}
            </>
          )}

          {/* Step: Success */}
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
                Replacements Submitted!
              </div>
              <div style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.7, marginBottom: 28 }}>
                Your replacement documents and geotags have been successfully submitted.
                The quotation is now back under review, and the admin will review them shortly.
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
                ✓ Admin team will review your replacements (1–2 working days)<br />
                ✓ You'll get an email once the quotation status changes
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
