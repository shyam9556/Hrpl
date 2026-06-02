import { useEffect, useRef } from "react";
import { AlertTriangle, Info, X } from "lucide-react";

/**
 * Reusable confirmation/alert dialog to replace browser confirm()/alert().
 *
 * Props:
 *  - open (bool)       : controls visibility
 *  - title (string)    : dialog heading
 *  - message (string)  : body text
 *  - confirmText (str) : label for confirm button (default "Confirm")
 *  - cancelText (str)  : label for cancel button  (default "Cancel")
 *  - variant (str)     : "danger" | "warning" | "info" (default "warning")
 *  - onConfirm (fn)    : called on confirm click
 *  - onCancel (fn)     : called on cancel / backdrop / Escape
 *  - hideCancel (bool) : if true, only show confirm (like an alert)
 */
export default function ConfirmDialog({
  open,
  title = "Are you sure?",
  message = "",
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "warning",
  onConfirm,
  onCancel,
  hideCancel = false,
}) {
  const dialogRef = useRef(null);

  // Focus trap — auto-focus confirm button on open
  useEffect(() => {
    if (open && dialogRef.current) {
      const btn = dialogRef.current.querySelector("[data-autofocus]");
      if (btn) btn.focus();
    }
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onCancel?.();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  const colors = {
    danger:  { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.18)", icon: "#ef4444", btn: "#ef4444" },
    warning: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.18)", icon: "#f59e0b", btn: "#f59e0b" },
    info:    { bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.18)", icon: "#3b82f6", btn: "#3b82f6" },
  };
  const c = colors[variant] || colors.warning;
  const Icon = variant === "info" ? Info : AlertTriangle;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(6px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
        padding: 16,
        animation: "modalFadeIn 0.15s ease-out",
      }}
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card, #fff)",
          borderRadius: 16,
          padding: "24px 28px",
          maxWidth: 420,
          width: "100%",
          boxShadow: "0 20px 40px -8px rgba(0,0,0,0.18)",
          border: "1px solid rgba(0,0,0,0.06)",
          animation: "modalFadeIn 0.2s ease-out",
        }}
      >
        {/* Icon + Title */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 12 }}>
          <div
            style={{
              background: c.bg,
              border: `1.5px solid ${c.border}`,
              borderRadius: 12,
              width: 40,
              height: 40,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <Icon size={20} color={c.icon} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="confirm-dialog-title" style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.3 }}>{title}</div>
            {message && (
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
                {message}
              </div>
            )}
          </div>
          <button
            onClick={() => onCancel?.()}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
              color: "var(--muted)",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
          {!hideCancel && (
            <button
              onClick={onCancel}
              style={{
                padding: "8px 18px",
                borderRadius: 10,
                border: "1.5px solid var(--border, #e2e8f0)",
                background: "var(--card, #fff)",
                color: "var(--text)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s",
                minWidth: 90,
                flex: "1 1 auto",
              }}
            >
              {cancelText}
            </button>
          )}
          <button
            data-autofocus
            onClick={onConfirm}
            style={{
              padding: "8px 18px",
              borderRadius: 10,
              border: "none",
              background: c.btn,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s",
              minWidth: 90,
              flex: "1 1 auto",
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
