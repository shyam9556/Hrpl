import { useState, useEffect, useCallback, useRef } from "react";
import { dealers as dealersApi } from "../utils/api";
import { Loader2, Store, ChevronLeft, ChevronRight, Search, X, KeyRound, Eye, EyeOff, CheckCircle, XCircle, LockKeyholeOpen, Clock, AlertTriangle } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import ErrorState from "./ErrorState";

// Lockout threshold — must match the failCount >= 10 check in server/src/routes/auth.js.
// After this many failed attempts in 30 min, the dealer cannot log in at all.
const LOCKOUT_THRESHOLD = 10;
// Warning level — shown earlier so admin can spot a dealer struggling before they fully lock out.
const LOCKOUT_WARNING = 5;

export default function DealersList() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [confirmUnlock, setConfirmUnlock] = useState(null); // null | dealer object
  const [errorDialog, setErrorDialog] = useState({ open: false, message: "" });
  const [successDialog, setSuccessDialog] = useState({ open: false, title: "", message: "" });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const PAGE_SIZE = 20;

  // ── Admin Reset Password modal state ─────────────────────────────────────
  const [resetModal, setResetModal]           = useState(null); // null | dealer object
  const [rpNew, setRpNew]                     = useState("");
  const [rpConfirm, setRpConfirm]             = useState("");
  const [rpShowNew, setRpShowNew]             = useState(false);
  const [rpShowConfirm, setRpShowConfirm]     = useState(false);
  const [rpLoading, setRpLoading]             = useState(false);
  const [rpError, setRpError]                 = useState("");
  const [rpSuccess, setRpSuccess]             = useState(false);
  const resetTimerRef = useRef(null);

  const openResetModal = (dealer) => {
    setRpNew(""); setRpConfirm("");
    setRpShowNew(false); setRpShowConfirm(false);
    setRpLoading(false); setRpError(""); setRpSuccess(false);
    setResetModal(dealer);
  };
  const closeResetModal = () => { if (!rpLoading) { clearTimeout(resetTimerRef.current); setResetModal(null); } };

  // ── Escape key handler for reset-password modal ────────────────────────────
  useEffect(() => {
    if (!resetModal) return;
    const handler = (e) => { if (e.key === "Escape") closeResetModal(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // closeResetModal depends on rpLoading, which is stable within this effect
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetModal, rpLoading]);

  // ── Unmount cleanup — clear auto-dismiss timer if component unmounts mid-countdown
  useEffect(() => {
    return () => { clearTimeout(resetTimerRef.current); };
  }, []);

  const handleAdminReset = async (e) => {
    e.preventDefault();
    setRpError("");
    if (rpNew.length < 8)      { setRpError("Password must be at least 8 characters."); return; }
    if (rpNew !== rpConfirm)   { setRpError("Passwords do not match."); return; }
    setRpLoading(true);
    try {
      await dealersApi.adminResetPassword(resetModal.id, rpNew);
      setRpSuccess(true);
      // Auto-close the modal after 2.5s — store timer ID so manual Done can cancel it
      resetTimerRef.current = setTimeout(() => {
        resetTimerRef.current = null;
        setResetModal(null);
      }, 2500);
    } catch (err) {
      setRpError(err.message || "Failed to reset password. Please try again.");
    } finally {
      setRpLoading(false);
    }
  };

  const handleUnlockAccount = async () => {
    const dealer = confirmUnlock;
    setConfirmUnlock(null);
    setActionLoading(`unlock-${dealer.id}`);
    try {
      const res = await dealersApi.unlockAccount(dealer.id);
      // Refresh the list so the LOCKED badge and Unlock button disappear immediately.
      await fetchDealers(false);
      setSuccessDialog({
        open: true,
        title: "Account Unlocked",
        message: res.message || `${dealer.name}'s account has been unlocked successfully.`,
      });
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to unlock account. Please try again." });
    } finally {
      setActionLoading(null);
    }
  };

  const fetchDealers = useCallback(async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      setFetchError(false);
      const res = await dealersApi.list();
      setList(res.dealers || []);
    } catch (err) {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDealers(); }, [fetchDealers]);
  useEffect(() => { setPage(1); }, [search]);

  // ── SSE: Real-time dealer list updates ─────────────────────────────────────
  // dealer:toggled → admin activates/deactivates a dealer from this same view
  // registration:status_changed → a new dealer was just approved; they appear in list
  useEffect(() => {
    const handler = () => fetchDealers(false);
    window.addEventListener("hp:sse:dealer:toggled", handler);
    window.addEventListener("hp:sse:registration:status_changed", handler);
    return () => {
      window.removeEventListener("hp:sse:dealer:toggled", handler);
      window.removeEventListener("hp:sse:registration:status_changed", handler);
    };
  }, [fetchDealers]);


  const handleToggle = async (id) => {
    setConfirmToggle(null);
    setActionLoading(id);
    try {
      await dealersApi.toggleActive(id);
      await fetchDealers(false);
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to toggle dealer status." });
    } finally {
      setActionLoading(null);
    }
  };

  const filteredList = search.trim()
    ? list.filter(d => {
        const q = search.toLowerCase();
        return (
          d.name?.toLowerCase().includes(q) ||
          d.email?.toLowerCase().includes(q) ||
          d.location?.toLowerCase().includes(q) ||
          d.company_name?.toLowerCase().includes(q) ||
          d.mobile?.includes(q)
        );
      })
    : list;

  const totalPages = Math.ceil(filteredList.length / PAGE_SIZE);
  const paginatedList = filteredList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      {/* Page header + Search in one row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="page-header" style={{ margin: 0 }}>
          <div className="page-title">Dealers</div>
          <div className="page-sub">Manage approved dealer accounts</div>
        </div>

        {/* Search bar — fluid on mobile */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--card, white)",
          border: "1.5px solid var(--border, #e2e8f0)",
          borderRadius: 9, padding: "0 12px",
          height: 34, width: "100%", maxWidth: 260, minWidth: 0,
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          transition: "border-color 0.15s",
        }}
          onFocusCapture={e => e.currentTarget.style.borderColor = "var(--primary, #2E7D52)"}
          onBlurCapture={e => e.currentTarget.style.borderColor = "var(--border, #e2e8f0)"}
        >
          <Search size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              border: "none", outline: "none", background: "transparent",
              flex: 1, fontSize: 13, color: "var(--text)", height: "100%",
            }}
          />
          {search && (
            <>
              <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
                {filteredList.length}
              </span>
              <button
                onClick={() => setSearch("")}
                style={{ border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--muted)", display: "flex", alignItems: "center", flexShrink: 0 }}
              >
                <X size={12} />
              </button>
            </>
          )}
        </div>
      </div>


      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
          <div style={{ marginBottom: 8 }}><Loader2 size={32} className="animate-spin" /></div>Loading...
        </div>
      ) : fetchError ? (
        <ErrorState
          title="Failed to load dealers."
          message="Could not connect to the server. Please check your connection."
          onRetry={() => { setFetchError(false); fetchDealers(true); }}
          compact
        />
      ) : list.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
          <div style={{ marginBottom: 12 }}><Store size={48} strokeWidth={1} /></div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>No dealers yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Approved dealer registrations will appear here.</div>
        </div>
      ) : filteredList.length === 0 ? (
        <div className="card" style={{ padding: "20px 24px", display: "flex", alignItems: "center", gap: 12, color: "var(--muted)" }}>
          <Search size={16} strokeWidth={1.5} style={{ flexShrink: 0, opacity: 0.5 }} />
          <span style={{ fontSize: 13 }}>No results for <strong style={{ color: "var(--text)" }}>'{search}'</strong></span>
          <button
            onClick={() => setSearch("")}
            style={{
              marginLeft: "auto", fontSize: 12, padding: "4px 12px",
              background: "var(--card, white)", border: "1px solid var(--border, #e2e8f0)",
              borderRadius: 7, cursor: "pointer", color: "var(--text)", fontWeight: 500,
            }}
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="card">
          <div className="table-scroll-wrap">
            <table style={{ minWidth: "900px" }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Location</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedList.map(d => (
                  <tr key={d.id} style={{ opacity: d.is_active ? 1 : 0.5 }}>
                    <td style={{ fontWeight: 500 }}>{d.name}</td>
                    <td>
                      <div>{d.email}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{d.mobile || "—"}</div>
                    </td>
                    <td>{d.location || "—"}</td>
                    <td>{d.company_name || "—"}</td>
                    <td>
                      <span className={`badge ${d.is_active ? "badge-green" : "badge-red"}`}>
                        {d.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>
                      {new Date(d.created_at).toLocaleDateString("en-IN")}
                    </td>
                    {/* IMP-6/IMP-9: Last Login column with lockout indicator */}
                    <td>
                      {d.last_login_at ? (
                        <div>
                          <div style={{ fontSize: 12, color: "var(--text)", display: "flex", alignItems: "center", gap: 4 }}>
                            <Clock size={11} style={{ opacity: 0.5, flexShrink: 0 }} />
                            {new Date(d.last_login_at).toLocaleDateString("en-IN")}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            {new Date(d.last_login_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>Never</span>
                      )}
                      {/* IMP-1: lockout warning/locked badge — only meaningful counts shown */}
                      {d.failed_attempts >= LOCKOUT_THRESHOLD ? (
                        // Account is actually locked
                        <div style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 3, fontSize: 10, fontWeight: 700, color: "#dc2626" }}>
                          <AlertTriangle size={10} style={{ flexShrink: 0 }} />
                          LOCKED ({d.failed_attempts} attempts)
                        </div>
                      ) : d.failed_attempts >= LOCKOUT_WARNING ? (
                        // Approaching lockout — warning
                        <div style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 3, fontSize: 10, fontWeight: 700, color: "#92400e" }}>
                          <AlertTriangle size={10} style={{ flexShrink: 0 }} />
                          {d.failed_attempts} failed attempt{d.failed_attempts !== 1 ? "s" : ""}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="btn-sm"
                          style={{
                            padding: "4px 12px", fontSize: 11, borderRadius: 6,
                            background: d.is_active ? "var(--red)" : "var(--green)",
                            color: "white", border: "none",
                          }}
                          disabled={actionLoading === d.id}
                          onClick={() => setConfirmToggle(d)}
                        >
                          {actionLoading === d.id ? "..." : (d.is_active ? "Deactivate" : "Activate")}
                        </button>
                        <button
                          className="btn-sm"
                          style={{ padding: "4px 12px", fontSize: 11, borderRadius: 6,
                            display: "flex", alignItems: "center", gap: 4 }}
                          onClick={() => openResetModal(d)}
                        >
                          <KeyRound size={12} /> Reset Pwd
                        </button>
                        {/* IMP-1: Unlock button — only shown when account is actually locked (>= LOCKOUT_THRESHOLD) */}
                        {d.failed_attempts >= LOCKOUT_THRESHOLD && (
                          <button
                            className="btn-sm"
                            title={`Account LOCKED — ${d.failed_attempts} failed attempts in last 30 min. Click to unlock.`}
                            aria-label={`Unlock account for ${d.name}`}
                            disabled={actionLoading === `unlock-${d.id}`}
                            style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6,
                              display: "flex", alignItems: "center", gap: 4,
                              background: "var(--red, #dc2626)", color: "white", border: "none" }}
                            onClick={() => setConfirmUnlock(d)}
                          >
                            {actionLoading === `unlock-${d.id}`
                              ? <Loader2 size={12} className="animate-spin" />
                              : <LockKeyholeOpen size={12} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredList.length > PAGE_SIZE && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--border, #e2e8f0)", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredList.length)} of {filteredList.length}
                {search && ` (filtered from ${list.length})`}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ padding: "4px 12px", fontSize: 12, borderRadius: 8, display: "flex", alignItems: "center", gap: 4 }}><ChevronLeft size={14} /> Prev</button>
                <span style={{ display: "flex", alignItems: "center", fontSize: 12, color: "var(--text)", fontWeight: 600, padding: "0 8px" }}>{page} / {totalPages}</span>
                <button className="btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ padding: "4px 12px", fontSize: 12, borderRadius: 8, display: "flex", alignItems: "center", gap: 4 }}>Next <ChevronRight size={14} /></button>
              </div>
            </div>
          )}
        </div>
      )}

      {confirmToggle && (
        <ConfirmDialog
          open={true}
          title={confirmToggle.is_active ? "Deactivate Dealer?" : "Activate Dealer?"}
          message={`Are you sure you want to ${confirmToggle.is_active ? "deactivate" : "activate"} ${confirmToggle.name}? ${confirmToggle.is_active ? "They will no longer be able to log in." : "They will regain access to the dealer portal."}`}
          variant={confirmToggle.is_active ? "danger" : "info"}
          confirmText={confirmToggle.is_active ? "Deactivate" : "Activate"}
          onConfirm={() => handleToggle(confirmToggle.id)}
          onCancel={() => setConfirmToggle(null)}
        />
      )}
      {confirmUnlock && (
        <ConfirmDialog
          open={true}
          title="Unlock Account?"
          message={`This will clear all failed login attempts for ${confirmUnlock.name} (${confirmUnlock.email}), allowing them to log in immediately. Use this when a legitimate dealer is locked out.`}
          variant="info"
          confirmText="Unlock Account"
          onConfirm={handleUnlockAccount}
          onCancel={() => setConfirmUnlock(null)}
        />
      )}
      <ConfirmDialog
        open={errorDialog.open}
        title="Action Failed"
        message={errorDialog.message}
        variant="danger"
        confirmText="OK"
        hideCancel
        onConfirm={() => setErrorDialog({ open: false, message: "" })}
        onCancel={() => setErrorDialog({ open: false, message: "" })}
      />
      <ConfirmDialog
        open={successDialog.open}
        title={successDialog.title || "Success"}
        message={successDialog.message}
        variant="info"
        confirmText="OK"
        hideCancel
        onConfirm={() => setSuccessDialog({ open: false, title: "", message: "" })}
        onCancel={() => setSuccessDialog({ open: false, title: "", message: "" })}
      />

      {/* ── Admin Reset Password Modal ───────────────────────────────────── */}
      {resetModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999, padding: "env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px) 16px" }}
          onClick={closeResetModal}
        >
          <div
            style={{ background: "var(--card, white)", borderRadius: 16, width: "100%", maxWidth: 400,
              boxShadow: "0 24px 64px rgba(0,0,0,0.3)", overflow: "hidden" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ background: "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)",
              padding: "18px 22px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <KeyRound size={18} color="white" />
                <div>
                  <div style={{ color: "white", fontWeight: 700, fontSize: 15 }}>Reset Dealer Password</div>
                  <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 12, marginTop: 2 }}>{resetModal.name}</div>
                </div>
              </div>
              <button onClick={closeResetModal} disabled={rpLoading}
                style={{ background: "none", border: "none", cursor: rpLoading ? "not-allowed" : "pointer",
                  color: "rgba(255,255,255,0.8)", display: "flex", padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: "22px 22px 26px" }}>
              {rpSuccess ? (
                <div style={{ textAlign: "center", padding: "8px 0" }}>
                  <div style={{ width: 60, height: 60, borderRadius: "50%",
                    background: "linear-gradient(135deg, #dcfce7, #bbf7d0)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    margin: "0 auto 14px", boxShadow: "0 8px 20px rgba(46,125,82,0.2)" }}>
                    <CheckCircle size={30} color="#2E7D52" />
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Password Reset Successfully!</div>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 18 }}>
                    The password for <strong>{resetModal.name}</strong> has been updated immediately.
                    A notification email with a reset link has also been sent to <strong>{resetModal.email}</strong> in case they need to set a different password.
                  </div>
                    <button className="btn-primary" onClick={() => { clearTimeout(resetTimerRef.current); setResetModal(null); }}>Done</button>
                </div>
              ) : (
                <form onSubmit={handleAdminReset}>
                  {/* New Password */}
                  <div className="field" style={{ marginBottom: 14 }}>
                    <label>New Password</label>
                    <div className="field-pwd-wrapper">
                      <input
                        type={rpShowNew ? "text" : "password"}
                        value={rpNew}
                        onChange={e => { setRpNew(e.target.value); setRpError(""); }}
                        placeholder="Min. 8 characters"
                        autoComplete="new-password"
                        disabled={rpLoading}
                        autoFocus
                      />
                      <button type="button" className="pwd-toggle-btn" onClick={() => setRpShowNew(v => !v)}>
                        {rpShowNew ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {/* Strength meter */}
                    {rpNew.length > 0 && (() => {
                      const hasLen   = rpNew.length >= 8;
                      const hasUpper = /[A-Z]/.test(rpNew);
                      const hasNum   = /\d/.test(rpNew);
                      const score    = [hasLen, hasUpper, hasNum].filter(Boolean).length;
                      const label    = score === 0 ? "" : score === 1 ? "Weak" : score === 2 ? "Fair" : "Strong";
                      const color    = score === 0 ? "var(--muted)" : score === 1 ? "#ef4444" : score === 2 ? "#f59e0b" : "#22c55e";
                      return (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                            {[1,2,3].map(i => (
                              <div key={i} style={{ flex: 1, height: 3, borderRadius: 2,
                                background: i <= score ? color : "var(--border)",
                                transition: "background 0.2s" }} />
                            ))}
                          </div>
                          <div style={{ fontSize: 11, color, fontWeight: 600 }}>
                            {label}
                            {!hasLen && <span style={{ color: "var(--muted)", fontWeight: 400 }}> — min. 8 characters</span>}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Confirm Password */}
                  <div className="field" style={{ marginBottom: 16 }}>
                    <label>Confirm Password</label>
                    <div className="field-pwd-wrapper">
                      <input
                        type={rpShowConfirm ? "text" : "password"}
                        value={rpConfirm}
                        onChange={e => { setRpConfirm(e.target.value); setRpError(""); }}
                        placeholder="Re-enter new password"
                        autoComplete="new-password"
                        disabled={rpLoading}
                      />
                      <button type="button" className="pwd-toggle-btn" onClick={() => setRpShowConfirm(v => !v)}>
                        {rpShowConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {rpConfirm.length > 0 && (
                      <div style={{ fontSize: 11, marginTop: 4, fontWeight: 500,
                        display: "flex", alignItems: "center", gap: 4,
                        color: rpNew === rpConfirm ? "var(--green)" : "#ef4444" }}>
                        {rpNew === rpConfirm
                          ? <><CheckCircle size={12} /> Passwords match</>
                          : <><XCircle size={12} /> Passwords do not match</>
                        }
                      </div>
                    )}
                  </div>

                  {/* Error */}
                  {rpError && (
                    <div style={{ background: "#fef2f2", border: "1px solid #fca5a5",
                      borderRadius: 8, padding: "10px 12px", marginBottom: 14,
                      fontSize: 13, color: "#dc2626" }}>
                      {rpError}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 10 }}>
                    <button type="button" onClick={closeResetModal} disabled={rpLoading}
                      style={{ flex: 1, padding: "10px", border: "1.5px solid var(--border)",
                        background: "transparent", borderRadius: 8, fontWeight: 600,
                        fontSize: 14, cursor: rpLoading ? "not-allowed" : "pointer",
                        color: "var(--text)" }}>
                      Cancel
                    </button>
                    <button type="submit" disabled={rpLoading || rpNew.length < 8 || rpNew !== rpConfirm}
                      className="btn-primary" style={{ flex: 2, padding: "10px" }}>
                      {rpLoading
                        ? <><Loader2 size={14} className="animate-spin" /> Resetting...</>
                        : <><KeyRound size={14} /> Reset Password</>
                      }
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
