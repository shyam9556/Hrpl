import { useRef, useState } from "react";
import { compressAndConvertToBase64 } from "../utils/helpers";
import { Loader2, CheckCircle2, Paperclip, X } from "lucide-react";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
// NOTE: Must match server/src/middleware/upload.js ALLOWED_MIME_TYPES exactly.
// HEIC is excluded — the backend does not accept it.
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export default function UploadZone({ label, icon, file, onChange }) {
  const ref = useRef();
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);

  const validateFile = (f) => {
    if (!ALLOWED_TYPES.includes(f.type)) {
      return "Invalid file type. Use JPG, PNG, WebP, or PDF.";
    }
    if (f.size > MAX_FILE_SIZE) {
      return `File too large (${(f.size / (1024 * 1024)).toFixed(1)}MB). Maximum is 10MB.`;
    }
    return null;
  };

  const processFile = async (selectedFile) => {
    if (!selectedFile) return;

    setError("");
    const validationError = validateFile(selectedFile);
    if (validationError) {
      setError(validationError);
      return;
    }

    // Generate preview for images
    if (selectedFile.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target.result);
      reader.readAsDataURL(selectedFile);
    } else {
      setPreview(null);
    }

    setLoading(true);
    try {
      const base64Data = await compressAndConvertToBase64(selectedFile);

      // IMPORTANT: compressAndConvertToBase64 re-encodes images as JPEG.
      // We must derive the actual MIME type from the resulting data URI,
      // NOT from selectedFile.type — otherwise the server's MIME cross-check
      // (which compares data URI MIME against declared type) will fail.
      const mimeMatch = base64Data.match(/^data:([^;]+);base64,/);
      const actualMime = mimeMatch ? mimeMatch[1] : selectedFile.type;

      onChange({
        name: selectedFile.name,
        type: actualMime,       // use the actual encoded MIME, not the original
        size: selectedFile.size,
        data: base64Data
      });
    } catch (err) {
      console.error("Failed to process file:", err);
      setError("Failed to process file. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    processFile(e.target.files[0]);
    // Reset input so same file can be re-selected
    e.target.value = "";
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const droppedFile = e.dataTransfer?.files?.[0];
    if (droppedFile) processFile(droppedFile);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange(null);
    setPreview(null);
    setError("");
  };

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
        {icon} {label}
      </div>
      <div
        className={`upload-zone ${file ? "has-file" : ""} ${loading ? "loading" : ""} ${dragOver ? "drag-over" : ""}`}
        onClick={() => !loading && ref.current.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={loading ? -1 : 0}
        aria-label={file ? `${label}: ${file.name} selected. Click to change.` : `${label}: Click or drag a file to upload`}
        onKeyDown={(e) => {
          if (!loading && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            ref.current.click();
          }
        }}
        style={{ pointerEvents: loading ? "none" : "auto", position: "relative" }}
      >
        <input
          ref={ref}
          type="file"
          accept="image/jpeg,image/png,image/webp,.pdf"
          style={{ display: "none" }}
          onChange={handleFileChange}
          disabled={loading}
        />

        {/* Clear button when file is selected */}
        {file && !loading && (
          <button
            onClick={handleClear}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              background: "rgba(0,0,0,0.08)",
              border: "none",
              borderRadius: "50%",
              width: 22,
              height: 22,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              cursor: "pointer",
              color: "var(--muted)",
              zIndex: 2,
            }}
            title="Remove file"
          >
            <X size={12} />
          </button>
        )}

        {loading ? (
          <>
            <div className="upload-icon"><Loader2 size={24} className="animate-spin" /></div>
            <div className="upload-label" style={{ color: "var(--muted)" }}>Processing...</div>
            <div className="upload-text">Optimizing file size</div>
          </>
        ) : preview && file ? (
          <>
            <img
              src={preview}
              alt="Preview"
              style={{
                width: "100%",
                height: 80,
                objectFit: "cover",
                borderRadius: 8,
                marginBottom: 6,
              }}
            />
            <div className="upload-label" style={{ fontSize: 11 }}>{file.name}</div>
            <div className="upload-text">{(file.size / 1024).toFixed(0)} KB · Tap to change</div>
          </>
        ) : (
          <>
            <div className="upload-icon" style={{ color: file ? "var(--green)" : "var(--muted)" }}>
              {file ? <CheckCircle2 size={24} /> : <Paperclip size={24} />}
            </div>
            <div className="upload-label">{file ? file.name : dragOver ? "Drop file here" : "Tap or drag to upload"}</div>
            <div className="upload-text">{file ? "Tap to change" : "JPG, PNG, PDF · Max 10MB"}</div>
          </>
        )}
      </div>
      {error && (
        <div style={{ fontSize: 11, color: "var(--red, #ef4444)", marginTop: 4, fontWeight: 500 }}>
          {error}
        </div>
      )}
    </div>
  );
}
