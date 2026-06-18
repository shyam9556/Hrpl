import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { dealers as dealersApi, uploads as uploadsApi } from "../utils/api";
import { Loader2, UserPlus, CheckCircle, XCircle, Paperclip, X, User, Phone, MapPin, Store, Download, Eye, FileText, Calendar, RefreshCw, AlertTriangle, Clock, Send, Search } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import ErrorState from "./ErrorState";

// Human-readable tab labels
const TAB_LABELS = {
  All: "All",
  Pending: "Pending",
  Approved: "Approved",
  Rejected: "Rejected",
  ReuploadRequested: "Re-upload Requested",
};

// Color-coded status badge config for the All tab
const STATUS_BADGE_CONFIG = {
  Pending:           { label: "Pending",            bg: "#fef9c3", color: "#854d0e", border: "#fde047" },
  Approved:          { label: "Approved",            bg: "#dcfce7", color: "#166534", border: "#86efac" },
  Rejected:          { label: "Rejected",            bg: "#fee2e2", color: "#991b1b", border: "#fca5a5" },
  ReuploadRequested: { label: "Re-upload Requested", bg: "#fff3cd", color: "#856404", border: "#fcd34d" },
};

// Human-readable document type labels
const DOC_TYPE_LABELS = {
  aadhaar:        "Aadhaar Card",
  aadhaar_front:  "Aadhaar Card (Front)",
  aadhaar_back:   "Aadhaar Card (Back)",
  pan:            "PAN Card",
  passbook:       "Bank Passbook",
  light_bill:     "Light Bill",
  vera_bill:      "Vera Bill",
  passport_photo: "Passport Photo",
  house_photo_1:  "House Photo 1",
  house_photo_2:  "House Photo 2",
  house_photo_3:  "House Photo 3",
  geotag_1:       "Geotag Site Inverter",
  geotag_2:       "Geotag Solar Panels",
  geotag_3:       "Geotag ACDB NetMeter",
  other:          "Dealership Agreement",
};

// Converts spaces/special chars to underscores for safe use in filenames.
function toSafeSegment(str) {
  return (str || "").replace(/[^\w\s]/g, "").trim().replace(/\s+/g, "_") || "unknown";
}

// Build a recognizable filename for a dealer registration document.
// Format: {DocTypeLabel}_{DealerName}.{ext}
// Example: Aadhaar_Card_Rahul_Sharma.jpg
function getFriendlyFilename(doc, dealerName) {
  const label = (DOC_TYPE_LABELS[doc.doc_type] || "Document").replace(/\s+/g, "_");
  const ext   = doc.original_name?.includes(".")
    ? doc.original_name.slice(doc.original_name.lastIndexOf(".")).toLowerCase()
    : "";
  return `${label}_${toSafeSegment(dealerName)}${ext}`;
}

// Secure image component — fetches with Authorization header to avoid JWT in src URL
function SecureImage({ docId, alt, className, style, onClick }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [error, setError] = useState(false);
  const blobUrlRef = useRef(null);

  useEffect(() => {
    let revoked = false;
    uploadsApi.getSecureBlobUrl(docId)
      .then(url => {
        if (!revoked) {
          blobUrlRef.current = url;
          setBlobUrl(url);
        } else {
          URL.revokeObjectURL(url);
        }
      })
      .catch(() => { if (!revoked) setError(true); });
    return () => {
      revoked = true;
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, [docId]);

  if (error) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted)", fontSize: 11 }}>Preview unavailable</div>;
  if (!blobUrl) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted)", fontSize: 11 }}>Loading...</div>;
  return <img src={blobUrl} alt={alt} className={className} style={style} onClick={onClick} />;
}

export default function DealerRegistrationsAdmin({ onClearBadge }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("Pending");
  const [actionLoading, setActionLoading] = useState(null);
  const [selectedRegistration, setSelectedRegistration] = useState(null);
  const [errorDialog, setErrorDialog] = useState({ open: false, message: "" });
  const [actionConfirm, setActionConfirm] = useState(null); // { id, action, name }
  const [docViewerUrl, setDocViewerUrl] = useState(null); // blob URL for full-screen viewer
  const [fetchError, setFetchError] = useState(false);

  // Re-upload request modal state
  const [reuploadModal, setReuploadModal] = useState(null); // { id, name, email }
  const [reuploadReason, setReuploadReason] = useState("");
  const [reuploadDocs, setReuploadDocs] = useState({
    aadhaar: false, pan: false, passport_photo: false, other: false,
  });
  const [reuploadLoading, setReuploadLoading] = useState(false);
  const [reuploadSuccess, setReuploadSuccess] = useState(false);

  // Cross-tab review items: registrations with needs_review_after_reupload = 1
  // Fetched independently of the current tab filter so banners appear on ALL tabs.
  const [reviewItems, setReviewItems] = useState([]);

  // Reject modal state
  const [rejectModal, setRejectModal] = useState(null); // { id, name, email }
  const [rejectReason, setRejectReason] = useState("");
  const [rejectLoading, setRejectLoading] = useState(false);
  const [rejectSuccess, setRejectSuccess] = useState(false);
  // IMP-3: timer refs — cleared if admin manually clicks Done before auto-dismiss fires
  const rejectTimerRef  = useRef(null);
  const reuploadTimerRef = useRef(null);

  // Doc count badge tooltip — stores { id, docs, x, y } for fixed-position rendering
  // outside the overflow-clipped table-scroll-wrap
  const [docTooltip, setDocTooltip] = useState(null);

  // Clear the sidebar notification badge as soon as admin opens this page
  useEffect(() => { onClearBadge?.(); }, [onClearBadge]);

  // Revoke docViewerUrl blob URL on unmount to prevent memory leaks.
  // If the admin navigates away while the full-screen viewer is open,
  // the blob URL must be explicitly released by the browser.
  // Also clears any pending auto-dismiss timers (IMP-3) to prevent stale setState.
  useEffect(() => {
    return () => {
      if (docViewerUrl) URL.revokeObjectURL(docViewerUrl);
      clearTimeout(rejectTimerRef.current);
      clearTimeout(reuploadTimerRef.current);
    };
  // We intentionally only run cleanup on unmount — the open/close handlers
  // already revoke the URL on normal close. This is the safety net.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [search, setSearch] = useState("");
  // Reset search when switching tabs
  useEffect(() => { setSearch(""); }, [tab]);

  // ── Stats (for summary boxes) ──────────────────────────
  const [stats, setStats] = useState(null);
  const fetchStats = useCallback(async () => {
    try {
      const res = await dealersApi.getStats();
      if (res.success) setStats(res.stats);
    } catch { /* non-critical */ }
  }, []);

  const fetchReviewItems = useCallback(async () => {
    try {
      // IMP-4: Use the lightweight needs-review endpoint instead of fetching all
      // registrations — avoids loading full document joins just for banners.
      const res = await dealersApi.needsReview();
      setReviewItems(res.registrations || []);
    } catch (err) {
      // Log so production issues (e.g. missing DB tables/columns) are visible in DevTools
      console.error("[fetchReviewItems:registrations] Failed:", err?.message || err);
    }
  }, []);

  const fetchRegistrations = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setFetchError(false);
      const res = await dealersApi.registrations(tab);
      setList(res.registrations || []);
      // After loading Pending tab, clear the badge — admin has now seen the list
      if (tab === "Pending") onClearBadge?.();
      // Refresh stats whenever list refreshes
      fetchStats();
    } catch (err) {
      console.error("Fetch registrations error:", err);
      setFetchError(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tab, onClearBadge, fetchStats]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchReviewItems(); }, [fetchReviewItems]);

  useEffect(() => { fetchRegistrations(); }, [fetchRegistrations]);

  // ── SSE: Real-time notification for all registration mutations ─────────────
  useEffect(() => {
    const onNew = () => {
      fetchRegistrations(true);
      fetchStats();
    };
    const onChanged = () => {
      fetchRegistrations(true);
      fetchStats();
      fetchReviewItems();
    };
    window.addEventListener("hp:sse:registration:new", onNew);
    window.addEventListener("hp:sse:registration:status_changed", onChanged);
    // dealer:reuploadRequested fires when admin sends a re-upload request —
    // status changes to ReuploadRequested; other admin sessions should see it.
    window.addEventListener("hp:sse:dealer:reuploadRequested", onChanged);
    // document:uploaded fires when dealer submits registration reupload docs
    // (auth.js /reupload/submit saves files). Refresh so doc panel shows new files.
    window.addEventListener("hp:sse:document:uploaded", onChanged);
    // document:deleted fires when admin deletes a doc from the registration panel.
    window.addEventListener("hp:sse:document:deleted", onChanged);
    return () => {
      window.removeEventListener("hp:sse:registration:new", onNew);
      window.removeEventListener("hp:sse:registration:status_changed", onChanged);
      window.removeEventListener("hp:sse:dealer:reuploadRequested", onChanged);
      window.removeEventListener("hp:sse:document:uploaded", onChanged);
      window.removeEventListener("hp:sse:document:deleted", onChanged);
    };
  }, [fetchRegistrations, fetchStats, fetchReviewItems]);


  useEffect(() => {
    if (selectedRegistration) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [selectedRegistration]);

  // Approve only — Reject now uses its own modal with a reason
  const handleAction = async (id, action) => {
    if (action !== "approve") return; // safety guard
    setActionLoading(id);
    setSelectedRegistration(null);
    try {
      await dealersApi.approve(id);
      // Await both refreshes so actionLoading stays active until the
      // updated list is in state — avoids a flash of stale data.
      await fetchRegistrations(true);
      await fetchReviewItems();
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to approve registration." });
    } finally {
      setActionLoading(null);
    }
  };

  const openRejectModal = (reg) => {
    setRejectModal({ id: reg.id, name: reg.name, email: reg.email });
    setRejectReason("");
    setRejectSuccess(false);
    setSelectedRegistration(null);
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      setErrorDialog({ open: true, message: "Please provide a reason for rejection." });
      return;
    }
    setRejectLoading(true);
    try {
      await dealersApi.reject(rejectModal.id, rejectReason.trim());
      setRejectSuccess(true);
      // IMP-3: store timer ID so manual "Done" can cancel it before it fires
      rejectTimerRef.current = setTimeout(() => {
        rejectTimerRef.current = null;
        setRejectModal(null);
      }, 2500);
      await fetchRegistrations(true);
      await fetchReviewItems();
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to reject registration." });
    } finally {
      setRejectLoading(false);
    }
  };

  const openReuploadModal = (reg) => {
    setReuploadModal({ id: reg.id, name: reg.name, email: reg.email });

    // Pre-fill reason from the last re-upload request (so admin can amend, not retype)
    setReuploadReason(reg.reupload_reason || "");

    // Pre-populate previously requested docs when admin clicks "Send Again"
    // on a ReuploadRequested registration, so they don't have to re-select everything.
    if (reg.reupload_required_docs) {
      const prevDocs = reg.reupload_required_docs.split(",").map(d => d.trim());
      setReuploadDocs({
        aadhaar:        prevDocs.includes("aadhaar"),
        pan:            prevDocs.includes("pan"),
        passport_photo: prevDocs.includes("passport_photo"),
        other:          prevDocs.includes("other"),
      });
    } else {
      setReuploadDocs({ aadhaar: false, pan: false, passport_photo: false, other: false });
    }

    setReuploadSuccess(false);
    setSelectedRegistration(null);
  };

  const handleRequestReupload = async () => {
    const selectedDocs = Object.entries(reuploadDocs)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (!reuploadReason.trim()) {
      setErrorDialog({ open: true, message: "Please provide a reason for requesting re-upload." });
      return;
    }
    if (selectedDocs.length === 0) {
      setErrorDialog({ open: true, message: "Please select at least one document to re-upload." });
      return;
    }
    setReuploadLoading(true);
    try {
      await dealersApi.requestReupload(reuploadModal.id, reuploadReason.trim(), selectedDocs);
      setReuploadSuccess(true);
      // IMP-3: store timer ID so manual "Done" can cancel it before it fires
      reuploadTimerRef.current = setTimeout(() => {
        reuploadTimerRef.current = null;
        setReuploadModal(null);
      }, 2500);
      await fetchRegistrations(true);
      await fetchReviewItems();
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to send re-upload request." });
    } finally {
      setReuploadLoading(false);
    }
  };

  // Download all documents for a registration as a single ZIP archive.
  // dealerName is passed to generate a recognizable ZIP filename.
  // Falls back to sequential downloads if ZIP fails.
  const handleDownloadAll = useCallback(async (documents, dealerName) => {
    if (!documents || documents.length === 0) return;
    try {
      const ids = documents.map(d => d.id);
      const zipName = `Dealer_Docs_${toSafeSegment(dealerName)}.zip`;
      await uploadsApi.downloadZip(ids, zipName);
    } catch (zipErr) {
      console.warn("[Download] ZIP failed, falling back to sequential:", zipErr.message);
      // Graceful fallback: download one by one with friendly names
      for (const doc of documents) {
        try {
          await uploadsApi.downloadSecure(doc.id, getFriendlyFilename(doc, dealerName));
          await new Promise(resolve => setTimeout(resolve, 400));
        } catch (err) {
          console.error("[Download] Failed for doc", doc.id, err.message);
        }
      }
    }
  }, []);

  // IMP-5: single memoised filter — used by both the search badge and the table render
  const filteredList = useMemo(() => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(r =>
      r.name?.toLowerCase().includes(q) ||
      r.email?.toLowerCase().includes(q) ||
      r.location?.toLowerCase().includes(q) ||
      r.company_name?.toLowerCase().includes(q) ||
      r.mobile?.includes(q)
    );
  }, [list, search]);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Dealer Registrations</div>
        <div className="page-sub">Review and manage new dealer registration applications</div>
      </div>

      {/* ── Stat Boxes ────────────────────────────────────────────────────────────── */}
      <div className="stat-grid-6">
        {[
          { label: "Total",           value: stats?.total,             color: "#1a1a1a",  bg: "#f8f9fa",  border: "#e2e8f0",  accent: "#94a3b8", tab: "All" },
          { label: "Pending",         value: stats?.pending,           color: "#92400e",  bg: "#fffbeb",  border: "#fde68a",  accent: "#f59e0b", tab: "Pending" },
          { label: "Approved",        value: stats?.approved,          color: "#166534",  bg: "#f0fdf4",  border: "#bbf7d0",  accent: "#22c55e", tab: "Approved" },
          { label: "Rejected",        value: stats?.rejected,          color: "#991b1b",  bg: "#fef2f2",  border: "#fecaca",  accent: "#ef4444", tab: "Rejected" },
          { label: "Re-upload Req.",  value: stats?.reuploadRequested, color: "#7c2d12",  bg: "#fff7ed",  border: "#fed7aa",  accent: "#f97316", tab: "ReuploadRequested" },
          { label: "Awaiting Review", value: stats?.needsReview,       color: "#78350f",  bg: "linear-gradient(135deg,#fffbeb,#fef3c7)", border: "#fcd34d", accent: "#f59e0b", tab: "Pending", highlight: true },
        ].map(({ label, value, color, bg, border, accent, highlight, tab: targetTab }) => (
          <div
            key={label}
            onClick={() => setTab(targetTab)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTab(targetTab); } }}
            role="button"
            tabIndex={0}
            title={`View ${label} registrations`}
            aria-label={`View ${label} registrations (${value ?? 0})`}
            aria-pressed={tab === targetTab}
            style={{
              background: bg,
              border: `1px solid ${border}`,
              borderRadius: 12,
              padding: "14px 16px",
              borderTop: `3px solid ${accent}`,
              boxShadow: highlight
                ? "0 2px 12px rgba(245,158,11,0.15)"
                : "0 1px 4px rgba(0,0,0,0.04)",
              transition: "transform 0.15s, box-shadow 0.15s",
              cursor: "pointer",
              minWidth: 0,
              outline: tab === targetTab ? `2px solid ${accent}` : "none",
              outlineOffset: 2,
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = highlight ? "0 6px 18px rgba(245,158,11,0.22)" : "0 4px 12px rgba(0,0,0,0.08)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = highlight ? "0 2px 12px rgba(245,158,11,0.15)" : "0 1px 4px rgba(0,0,0,0.04)"; }}
          >
            <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: "var(--mono)", lineHeight: 1, letterSpacing: -1 }}>
              {value ?? <span style={{ fontSize: 18, opacity: 0.3 }}>—</span>}
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 6, wordBreak: "break-word" }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Tabs + Search */}
      <div className="admin-filter-bar">
        {/* Scrollable Tabs */}
        <div className="hide-scrollbar" style={{ display: "flex", overflowX: "auto", gap: 8, WebkitOverflowScrolling: "touch", paddingBottom: 4, flex: 1, minWidth: 0 }}>
          {["All", "Pending", "Approved", "Rejected", "ReuploadRequested"].map(s => {
            // Badge: Pending shows count of re-submitted dealers needing review;
            // Re-upload shows total count of dealers waiting to submit.
            const badgeCount =
              s === "Pending"           ? reviewItems.length :
              s === "ReuploadRequested" ? (stats?.reuploadRequested || 0) : 0;
            return (
              <button key={s} className={`btn-sm ${tab === s ? "primary" : ""}`} onClick={() => setTab(s)} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5 }}>
                {s === "ReuploadRequested" ? "Re-upload" : TAB_LABELS[s] || s}
                {badgeCount > 0 && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    minWidth: 16, height: 16, borderRadius: 9999,
                    background: tab === s ? "rgba(255,255,255,0.3)" : "#f97316",
                    color: "white",
                    fontSize: 10, fontWeight: 800, padding: "0 4px",
                  }}>
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="filter-search-box"
          onFocusCapture={e => e.currentTarget.style.borderColor = "var(--primary, #2E7D52)"}
          onBlurCapture={e => e.currentTarget.style.borderColor = "var(--border, #e2e8f0)"}
        >
          <Search size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search name, email, location..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              border: "none", outline: "none", background: "transparent",
              flex: 1, fontSize: 13, color: "var(--text)", minWidth: 0,
            }}
          />
          {search && (
            <>
              {/* IMP-5: uses memoised filteredList — no duplicate filter computation */}
              <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
                {filteredList.length}
              </span>
              <button
                onClick={() => setSearch("")}
                style={{ border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--muted)", display: "flex", alignItems: "center", flexShrink: 0 }}
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Tab Context Note ─────────────────────────────── */}
      {!loading && !fetchError && (() => {
        const notes = {
          Pending: {
            icon: <AlertTriangle size={13} style={{ color: "#b45309", flexShrink: 0 }} />,
            bg: "#fffbeb", border: "#fde68a", color: "#78350f",
            text: <>Review each application and <strong>Approve</strong>, <strong>Reject</strong>, or <strong>Request Re-upload</strong> of specific documents.
              {list.some(r => r.reupload_count > 0) && <> — Registrations marked <em>Re-uploaded</em> have submitted fresh documents and are awaiting your re-review.</>}
            </>,
          },
          ReuploadRequested: {
            icon: <RefreshCw size={13} style={{ color: "#b45309", flexShrink: 0 }} />,
            bg: "#fffbeb", border: "#fde68a", color: "#78350f",
            text: <>These dealers were emailed a secure re-upload link (valid 72 hrs). Once they submit, the registration moves back to <strong>Pending</strong> automatically. Use the <strong>Send Again</strong> icon to resend an expired link, or <strong>Reject</strong> to close the application.</>
          },
          Rejected: {
            icon: <XCircle size={13} style={{ color: "#b91c1c", flexShrink: 0 }} />,
            bg: "#fef2f2", border: "#fecaca", color: "#7f1d1d",
            text: <>The dealer was notified by email. To give them another chance, use the <strong>re-upload icon</strong> in the Actions column — they can resubmit corrected documents and the application will return to <strong>Pending</strong>.</>
          },
          Approved: {
            icon: <CheckCircle size={13} style={{ color: "#166534", flexShrink: 0 }} />,
            bg: "#f0fdf4", border: "#bbf7d0", color: "#14532d",
            text: <>Dealer accounts have been created and welcome emails sent. To manage accounts, go to the <strong>Dealers</strong> section in the sidebar.</>
          },
        };
        const note = notes[tab];
        if (!note) return null;
        return (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: note.bg, border: `1px solid ${note.border}`,
            borderRadius: 8, padding: "8px 12px",
            marginBottom: 14, fontSize: 12, color: note.color, lineHeight: 1.5,
          }}>
            {note.icon}
            <span>{note.text}</span>
          </div>
        );
      })()}

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
          <div style={{ marginBottom: 8 }}><Loader2 size={32} className="animate-spin" /></div>Loading...
        </div>
      ) : fetchError ? (
        <ErrorState
          title="Failed to load registrations."
          message="Could not connect to the server. Please check your connection."
          onRetry={() => { setFetchError(false); fetchRegistrations(); }}
          compact
        />
      ) : (() => {
        // IMP-5: uses memoised filteredList from useMemo above
        if (list.length === 0) return (
          <div className="card" style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
            <div style={{ marginBottom: 12 }}><UserPlus size={48} strokeWidth={1} /></div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {tab === "All" ? "No registrations found" : `No ${TAB_LABELS[tab] || tab} registrations`}
            </div>
          </div>
        );
        if (filteredList.length === 0) return (
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
        );

        // ── Sort by urgency for Pending and Re-upload tabs ────────────────────────────
        // Pending   : re-uploaded docs (flag=1) float to top, new applications below
        // Re-upload : responded (submitted docs) first, expired links second, active last
        const isExpiredFn = r => r.reupload_expires_at && new Date(r.reupload_expires_at) < new Date();

        // For the Re-upload tab, responded registrations have status=Pending
        // (needs_review_after_reupload=1) so they are NOT in filteredList
        // (which only contains status=ReuploadRequested rows).
        // Pull them from reviewItems and merge in as the first section.
        const respondedRegRows = tab === "ReuploadRequested"
          ? reviewItems.filter(r => r.needs_review_after_reupload)
          : [];
        const respondedRegIds = new Set(respondedRegRows.map(r => r.id));

        const displayList =
          tab === "Pending"
            ? [
                ...filteredList.filter(r =>  r.needs_review_after_reupload),
                ...filteredList.filter(r => !r.needs_review_after_reupload),
              ]
          : tab === "ReuploadRequested"
            ? [
                ...respondedRegRows,
                ...filteredList.filter(r => isExpiredFn(r) && !respondedRegIds.has(r.id)),
                ...filteredList.filter(r => !isExpiredFn(r) && !respondedRegIds.has(r.id)),
              ]
          : filteredList;

        // Counts used to position section headers at the right index
        const regPendingDocsCount = tab === "Pending"           ? filteredList.filter(r =>  r.needs_review_after_reupload).length : 0;
        const regPendingNewCount  = tab === "Pending"           ? filteredList.filter(r => !r.needs_review_after_reupload).length : 0;
        const respondedRegCount   = tab === "ReuploadRequested" ? respondedRegRows.length : 0;
        const expiredCount        = tab === "ReuploadRequested" ? filteredList.filter(r =>  isExpiredFn(r) && !respondedRegIds.has(r.id)).length : 0;
        const activeCount         = tab === "ReuploadRequested" ? filteredList.filter(r => !isExpiredFn(r) && !respondedRegIds.has(r.id)).length : 0;

        // Dynamic colSpan: 4 fixed cols + conditional cols per tab
        const regColSpan = 4
          + (tab === "All"               ? 1 : 0)  // Status column
          + (tab === "ReuploadRequested" ? 1 : 0)  // Re-upload Sent column
          + 1                                       // Documents column
          + (tab !== "Approved"          ? 1 : 0); // Actions column

        return (
        <div className="card">

          {/* ── Action Required Banners ─────────────────────────────────────────────────
               Fetched independently of the active tab so banners are visible
               on ALL tabs — same cross-tab pattern used in Quotations.
               Clicking “Review Now” opens the registration detail modal.
          ─────────────────────────────────────────────────────────────────── */}
          {reviewItems.map(reg => (
            <div key={`banner-${reg.id}`} style={{
              display: "flex", alignItems: "flex-start", gap: 12,
              background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
              border: "1px solid #fcd34d",
              borderLeft: "4px solid #f59e0b",
              borderRadius: 10, padding: "13px 18px",
              margin: "0 0 10px 0",
              boxShadow: "0 2px 12px rgba(245,158,11,0.13)",
              animation: "fadeInDown 0.25s ease",
            }}>
              {/* Icon */}
              <div style={{
                width: 34, height: 34, borderRadius: 8,
                background: "rgba(245,158,11,0.15)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                <AlertTriangle size={17} color="#d97706" strokeWidth={2.5} />
              </div>
              
              {/* Right Column: Text + Button */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                {/* Text */}
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#92400e", letterSpacing: 0.1 }}>
                    Action Required — Documents Re-uploaded
                  </div>
                  <div style={{ fontSize: 12, color: "#b45309", marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--mono, monospace)", fontWeight: 600 }}>{reg.name}</span>
                    <span style={{ color: "#d97706" }}>·</span>
                    <span>{reg.email}</span>
                    {reg.reupload_count > 0 && (
                      <span style={{
                        background: "rgba(245,158,11,0.2)", color: "#92400e",
                        fontSize: 10, fontWeight: 700,
                        padding: "1px 7px", borderRadius: 20,
                        border: "1px solid rgba(245,158,11,0.35)",
                      }}>
                        Re-upload #{reg.reupload_count}
                      </span>
                    )}
                  </div>
                </div>
                {/* CTA */}
                <button
                  onClick={() => setSelectedRegistration(reg)}
                  style={{
                    flexShrink: 0,
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "#f59e0b", color: "white",
                    border: "none", borderRadius: 8,
                    padding: "8px 18px", fontWeight: 700, fontSize: 12,
                    cursor: "pointer", whiteSpace: "nowrap",
                    boxShadow: "0 2px 8px rgba(245,158,11,0.4)",
                    transition: "background 0.15s, transform 0.1s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "#d97706"}
                  onMouseLeave={e => e.currentTarget.style.background = "#f59e0b"}
                >
                  <Eye size={13} strokeWidth={2.5} />
                  Review Now
                </button>
              </div>
            </div>
          ))}

          <div className="table-scroll-wrap">
          <table style={{ minWidth: "680px" }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Company / Location</th>
                <th>Submitted</th>
                {tab === "All" && <th>Status</th>}
                {tab === "ReuploadRequested" && <th>Re-upload Sent</th>}
                <th>Documents</th>
                {tab !== "Approved" && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {displayList.flatMap((reg, idx) => {
                const isDocsReview = !!reg.needs_review_after_reupload;
                const isExpired    = isExpiredFn(reg);
                const isResponded  = respondedRegIds.has(reg.id);
                // Amber tint for urgent rows: re-uploaded on Pending, expired on Re-upload, or responded on Re-upload
                const regRowNeedsAmberTint =
                  (tab === "Pending"           && isDocsReview) ||
                  (tab === "ReuploadRequested" && (isExpired || isResponded));
                const rows = [];

                // ── Pending tab sections ─────────────────────────────────────────
                if (tab === "Pending") {
                  if (idx === 0 && regPendingDocsCount > 0) {
                    rows.push(
                      <tr key="hdr-reg-docs-review" style={{ background: "rgba(245,158,11,0.06)", pointerEvents: "none" }}>
                        <td colSpan={regColSpan} style={{ padding: "7px 18px", fontSize: 11, fontWeight: 700, color: "#b45309", borderBottom: "1px solid rgba(245,158,11,0.18)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <CheckCircle size={12} /> Documents Re-uploaded — Review Required ({regPendingDocsCount})
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  if (!isDocsReview && idx === regPendingDocsCount && regPendingNewCount > 0 && regPendingDocsCount > 0) {
                    rows.push(
                      <tr key="hdr-reg-new-apps" style={{ background: "var(--bg, #f8fafc)", pointerEvents: "none" }}>
                        <td colSpan={regColSpan} style={{ padding: "7px 18px", fontSize: 11, fontWeight: 700, color: "var(--muted)", borderBottom: "1px solid var(--border)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <UserPlus size={12} /> New Applications ({regPendingNewCount})
                          </div>
                        </td>
                      </tr>
                    );
                  }
                }

                // ── Re-upload tab sections ──────────────────────────────────────
                if (tab === "ReuploadRequested") {
                  // 1. Dealer Responded — submitted docs, awaiting admin review
                  if (idx === 0 && respondedRegCount > 0) {
                    rows.push(
                      <tr key="hdr-reg-responded" style={{ background: "rgba(245,158,11,0.06)", pointerEvents: "none" }}>
                        <td colSpan={regColSpan} style={{ padding: "7px 18px", fontSize: 11, fontWeight: 700, color: "#b45309", borderBottom: "1px solid rgba(245,158,11,0.18)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <CheckCircle size={12} /> Dealer Responded — Review Required ({respondedRegCount})
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  // 2. Expired links — dealer hasn't submitted, link expired
                  if (!isResponded && idx === respondedRegCount && expiredCount > 0) {
                    rows.push(
                      <tr key="hdr-reg-expired" style={{ background: "rgba(220,38,38,0.04)", pointerEvents: "none" }}>
                        <td colSpan={regColSpan} style={{ padding: "7px 18px", fontSize: 11, fontWeight: 700, color: "#b91c1c", borderBottom: "1px solid rgba(220,38,38,0.15)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <AlertTriangle size={12} /> Link Expired — Resend Required ({expiredCount})
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  // 3. Active links — dealer hasn't submitted yet
                  if (!isResponded && !isExpired && idx === (respondedRegCount + expiredCount) && activeCount > 0 && (respondedRegCount > 0 || expiredCount > 0)) {
                    rows.push(
                      <tr key="hdr-reg-active" style={{ background: "var(--bg, #f8fafc)", pointerEvents: "none" }}>
                        <td colSpan={regColSpan} style={{ padding: "7px 18px", fontSize: 11, fontWeight: 700, color: "var(--muted)", borderBottom: "1px solid var(--border)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <Clock size={12} /> Awaiting Dealer Response ({activeCount})
                          </div>
                        </td>
                      </tr>
                    );
                  }
                }

                rows.push(
                <tr
                  key={reg.id}
                  className="table-row-hover"
                  style={{ cursor: "pointer", ...(regRowNeedsAmberTint ? { background: "rgba(245,158,11,0.025)" } : {}) }}
                  onClick={() => setSelectedRegistration(reg)}
                >
                  {/* Name cell */}
                  <td style={{ fontWeight: 500 }}>{reg.name}</td>
                  <td>
                    <div>{reg.email}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{reg.mobile || "—"}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{reg.company_name || "—"}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{reg.location || "—"}</div>
                  </td>
                  {/* Submitted date — also shows Re-uploaded indicator if dealer has resubmitted */}
                  <td style={{ color: "var(--muted)", fontSize: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span>{new Date(reg.submitted_at || reg.created_at).toLocaleDateString("en-IN")}</span>
                      {reg.reupload_count > 0 && (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 3,
                          fontSize: 10, fontWeight: 700,
                          color: "#856404",
                        }}>
                          <RefreshCw size={9} />
                          Re-uploaded{reg.reupload_count > 1 ? ` ×${reg.reupload_count}` : ""}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Status badge column — All tab only */}
                  {tab === "All" && (
                    <td>
                      {(() => {
                        const cfg = STATUS_BADGE_CONFIG[reg.status];
                        return cfg ? (
                          <span style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            padding: "3px 10px", borderRadius: 20,
                            fontSize: 11, fontWeight: 700,
                            background: cfg.bg, color: cfg.color,
                            border: `1px solid ${cfg.border}`,
                            whiteSpace: reg.status === "ReuploadRequested" ? "pre-line" : "nowrap",
                            textAlign: "center", lineHeight: 1.35,
                          }}>
                            {reg.status === "ReuploadRequested" ? "Re-upload\nRequested" : cfg.label}
                          </span>
                        ) : <span style={{ color: "var(--muted)", fontSize: 11 }}>{reg.status}</span>;
                      })()}
                    </td>
                  )}

                  {/* Re-upload Sent column — ReuploadRequested tab ONLY */}
                  {tab === "ReuploadRequested" && (
                    <td style={{ fontSize: 11 }}>
                      {reg.reupload_requested_at ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--muted)" }}>
                            <Clock size={10} />
                            {new Date(reg.reupload_requested_at).toLocaleDateString("en-IN")}
                          </div>
                          {reg.reupload_expires_at && new Date(reg.reupload_expires_at) < new Date() ? (
                            <span style={{ color: "#dc2626", fontWeight: 600, fontSize: 10 }}>Link Expired</span>
                          ) : (
                            reg.reupload_requested_at && <span style={{ color: "#2E7D52", fontWeight: 600, fontSize: 10 }}>Link Active</span>
                          )}
                        </div>
                      ) : <span style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                  )}
                  <td>
                    {reg.documents && reg.documents.length > 0 ? (
                      <div
                        style={{ display: 'inline-block' }}
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setDocTooltip({
                            id: reg.id,
                            docs: reg.documents,
                            x: rect.left,
                            y: rect.top,
                          });
                        }}
                        onMouseLeave={() => setDocTooltip(null)}
                      >
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          fontSize: 11, fontWeight: 600,
                          color: '#3b82f6', background: '#eff6ff',
                          border: '1px solid rgba(59,130,246,0.18)',
                          padding: '3px 9px', borderRadius: 6,
                          cursor: 'default', userSelect: 'none',
                        }}>
                          <Paperclip size={10} style={{ flexShrink: 0 }} />
                          {reg.documents.length} {reg.documents.length === 1 ? 'doc' : 'docs'}
                        </span>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
                    )}
                  </td>
                  {tab !== "Approved" && (
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>

                        {/* effectiveStatus drives action icons */}
                        {(() => {
                          const effectiveStatus = tab === "All" ? reg.status : tab;
                          return (
                            <>
                              {effectiveStatus === "Pending" && (
                                <>
                                  <button
                                    title="Approve"
                                    disabled={actionLoading === reg.id}
                                    onClick={(e) => { e.stopPropagation(); setActionConfirm({ id: reg.id, action: "approve", name: reg.name }); }}
                                    style={{
                                      width: 28, height: 28, borderRadius: 7, border: "none", cursor: "pointer",
                                      display: "flex", alignItems: "center", justifyContent: "center",
                                      background: "#dcfce7", color: "#166534", flexShrink: 0,
                                      opacity: actionLoading === reg.id ? 0.5 : 1,
                                    }}
                                  >
                                    {actionLoading === reg.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                                  </button>
                                  <button
                                    title="Request Re-upload"
                                    onClick={(e) => { e.stopPropagation(); openReuploadModal(reg); }}
                                    style={{
                                      width: 28, height: 28, borderRadius: 7, border: "none", cursor: "pointer",
                                      display: "flex", alignItems: "center", justifyContent: "center",
                                      background: "#fff3cd", color: "#856404", flexShrink: 0,
                                    }}
                                  >
                                    <RefreshCw size={13} />
                                  </button>
                                  <button
                                    title="Reject"
                                    disabled={actionLoading === reg.id}
                                    onClick={(e) => { e.stopPropagation(); openRejectModal(reg); }}
                                    style={{
                                      width: 28, height: 28, borderRadius: 7, border: "none", cursor: "pointer",
                                      display: "flex", alignItems: "center", justifyContent: "center",
                                      background: "#fee2e2", color: "#991b1b", flexShrink: 0,
                                      opacity: actionLoading === reg.id ? 0.5 : 1,
                                    }}
                                  >
                                    <XCircle size={13} />
                                  </button>
                                </>
                              )}
                              {effectiveStatus === "Rejected" && (
                                <button
                                  title="Request Re-upload"
                                  onClick={(e) => { e.stopPropagation(); openReuploadModal(reg); }}
                                  style={{
                                    width: 28, height: 28, borderRadius: 7, border: "none", cursor: "pointer",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    background: "#fff3cd", color: "#856404", flexShrink: 0,
                                  }}
                                >
                                  <RefreshCw size={13} />
                                </button>
                              )}
                              {effectiveStatus === "ReuploadRequested" && (
                                <>
                                  <button
                                    title="Send Re-upload Link Again"
                                    onClick={(e) => { e.stopPropagation(); openReuploadModal(reg); }}
                                    style={{
                                      width: 28, height: 28, borderRadius: 7, border: "none", cursor: "pointer",
                                      display: "flex", alignItems: "center", justifyContent: "center",
                                      background: "#fff3cd", color: "#856404", flexShrink: 0,
                                    }}
                                  >
                                    <Send size={13} />
                                  </button>
                                  <button
                                    title="Reject Registration"
                                    disabled={actionLoading === reg.id}
                                    onClick={(e) => { e.stopPropagation(); openRejectModal(reg); }}
                                    style={{
                                      width: 28, height: 28, borderRadius: 7, border: "none", cursor: "pointer",
                                      display: "flex", alignItems: "center", justifyContent: "center",
                                      background: "#fee2e2", color: "#991b1b", flexShrink: 0,
                                      opacity: actionLoading === reg.id ? 0.5 : 1,
                                    }}
                                  >
                                    <XCircle size={13} />
                                  </button>
                                </>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </td>
                  )}
                </tr>
                );
                return rows;
              })}
            </tbody>
          </table>
          </div>
        </div>
        );
      })()}

      {/* ── Document count tooltip rendered at viewport level ──────────────────
          Uses position:fixed so it's never clipped by table-scroll-wrap's
          overflow-x:auto. Coordinates are captured from getBoundingClientRect()
          on mouse-enter of the badge. */}
      {docTooltip && (
        <div
          style={{
            position: 'fixed',
            bottom: `calc(100vh - ${docTooltip.y}px + 6px)`,
            left: docTooltip.x,
            background: '#1e293b',
            color: 'white',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 11,
            whiteSpace: 'nowrap',
            zIndex: 9999,
            boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
            pointerEvents: 'none',
            lineHeight: 1.8,
            animation: 'fadeIn 0.12s ease',
          }}
        >
          {docTooltip.docs.map(doc => (
            <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Paperclip size={9} style={{ opacity: 0.45, flexShrink: 0 }} />
              {DOC_TYPE_LABELS[doc.doc_type] || doc.original_name}
            </div>
          ))}
        </div>
      )}


      {/* Detailed Dealer Registration Modal */}
      {selectedRegistration && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(15, 23, 42, 0.4)",
            backdropFilter: "blur(8px)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
            padding: "env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px) 16px"
          }}
          onClick={() => setSelectedRegistration(null)}
        >
          <div
            style={{
              background: "var(--card, white)",
              borderRadius: 20,
              width: "100%",
              maxWidth: 700,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              border: "1px solid rgba(0,0,0,0.06)",
              position: "relative"
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                padding: "16px 20px",
                borderBottom: "1px solid rgba(0,0,0,0.06)",
                position: "sticky",
                top: 0,
                background: "var(--card, white)",
                zIndex: 10
              }}
            >
              <div style={{ paddingRight: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px 10px", flexWrap: "wrap", marginBottom: 6 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", lineHeight: 1.3 }}>
                    Dealer Registration Details
                  </span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span className={`badge ${
                      selectedRegistration.status === "Approved" ? "badge-green" :
                      selectedRegistration.status === "Rejected" ? "badge-red" :
                      selectedRegistration.status === "ReuploadRequested" ? "badge-sun" :
                      "badge-sun"
                    }`}>
                      {TAB_LABELS[selectedRegistration.status] || selectedRegistration.status}
                    </span>
                    {selectedRegistration.reupload_count > 0 && (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "3px 10px", borderRadius: 20,
                        fontSize: 11, fontWeight: 700,
                        background: "#fff3cd", color: "#856404",
                        border: "1px solid #fcd34d",
                      }}>
                        <RefreshCw size={11} />
                        Re-uploaded {selectedRegistration.reupload_count > 1 ? `×${selectedRegistration.reupload_count}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
                  <Calendar size={12} />
                  <span>Submitted on {new Date(selectedRegistration.submitted_at || selectedRegistration.created_at).toLocaleDateString("en-IN")}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedRegistration(null)}
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  borderRadius: "50%",
                  width: 32,
                  height: 32,
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  cursor: "pointer",
                  color: "var(--text)",
                  transition: "all 0.2s"
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: 24 }}>
              {/* Row 1: Dealer Profile & Business details */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginBottom: 24 }}>
                {/* Profile info */}
                <div style={{ background: "#f8fafc", padding: 16, borderRadius: 16, border: "1px solid rgba(0,0,0,0.03)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Personal Profile
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                      <User size={14} style={{ color: "var(--green)" }} />
                      <strong>{selectedRegistration.name}</strong>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <Phone size={14} style={{ color: "var(--green)" }} />
                      <span>{selectedRegistration.mobile || "—"}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <FileText size={14} style={{ color: "var(--green)" }} />
                      <span>{selectedRegistration.email}</span>
                    </div>
                  </div>
                </div>

                {/* Business info */}
                <div style={{ background: "#f8fafc", padding: 16, borderRadius: 16, border: "1px solid rgba(0,0,0,0.03)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Business Information
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                      <Store size={14} style={{ color: "var(--green)" }} />
                      <strong>{selectedRegistration.company_name || "—"}</strong>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <MapPin size={14} style={{ color: "var(--green)" }} />
                      <span>{selectedRegistration.location || "—"}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Rejection reason panel — shown for Rejected registrations */}
              {selectedRegistration.status === "Rejected" && selectedRegistration.rejection_reason && (
                <div style={{
                  background: "#fef2f2",
                  border: "1px solid #fca5a5",
                  borderLeft: "4px solid #dc2626",
                  borderRadius: "0 12px 12px 0",
                  padding: "14px 16px",
                  marginBottom: 16,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
                    Rejection Reason
                  </div>
                  {/* IMP-7: var(--text) instead of hardcoded #374151 — dark-mode safe */}
                  <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
                    {selectedRegistration.rejection_reason}
                  </div>
                </div>
              )}

              {/* Re-upload context panel — shown for ReuploadRequested registrations */}
              {selectedRegistration.status === "ReuploadRequested" && (
                <div style={{
                  background: "#fffbeb",
                  border: "1px solid #fbbf24",
                  borderLeft: "4px solid #f59e0b",
                  borderRadius: "0 12px 12px 0",
                  padding: "14px 16px",
                  marginBottom: 16,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#856404", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
                    Re-upload Request Sent
                  </div>
                  {selectedRegistration.reupload_requested_at && (
                    <div style={{ fontSize: 12, color: "var(--text)", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                      <Clock size={12} />
                      Sent on {new Date(selectedRegistration.reupload_requested_at).toLocaleString("en-IN")}
                      {selectedRegistration.reupload_expires_at && (
                        <span style={{
                          marginLeft: 6, fontSize: 11, fontWeight: 700,
                          color: new Date(selectedRegistration.reupload_expires_at) < new Date() ? "var(--red, #dc2626)" : "var(--green, #2E7D52)",
                        }}>
                          ({new Date(selectedRegistration.reupload_expires_at) < new Date() ? "Link Expired" : "Link Active"})
                        </span>
                      )}
                    </div>
                  )}
                  {selectedRegistration.reupload_required_docs && (
                    <div style={{ fontSize: 12, color: "var(--text)", marginBottom: 4 }}>
                      <strong>Documents requested:</strong>{" "}
                      {selectedRegistration.reupload_required_docs.split(",").map(d => DOC_TYPE_LABELS[d] || d).join(", ")}
                    </div>
                  )}
                  {selectedRegistration.reupload_reason && (
                    <div style={{ fontSize: 12, color: "var(--text)", marginTop: 6, padding: "8px 10px", background: "rgba(0,0,0,0.03)", borderRadius: 8 }}>
                      <strong>Note to dealer:</strong>{" "}{selectedRegistration.reupload_reason}
                    </div>
                  )}
                </div>
              )}

              {/* Verification Documents Section */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Verification Documents
                  </div>
                  {selectedRegistration.documents && selectedRegistration.documents.length > 0 && (
                    <button
                      className="btn-sm primary"
                      style={{
                        padding: "4px 10px",
                        fontSize: 11,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        borderRadius: 6
                      }}
                      onClick={() => handleDownloadAll(selectedRegistration.documents, selectedRegistration.name)}
                    >
                      <Download size={12} /> Download All
                    </button>
                  )}
                </div>

                {selectedRegistration.documents && selectedRegistration.documents.length > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
                    {selectedRegistration.documents.map(doc => {
                      const isImage = doc.mime_type.startsWith("image/");
                      return (
                        <div key={doc.id} className="doc-preview-card" style={{ cursor: "default" }}>
                          <div className="doc-image-container"
                            onClick={() => {
                              if (isImage) {
                                uploadsApi.getSecureBlobUrl(doc.id)
                                  .then(url => setDocViewerUrl(url))
                                  .catch(() => {});
                              } else {
                                uploadsApi.getSecureBlobUrl(doc.id)
                                  .then(url => { window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000); })
                                  .catch(() => {});
                              }
                            }}
                            style={{ cursor: "pointer" }}
                          >
                            {isImage ? (
                              <SecureImage
                                docId={doc.id}
                                className="doc-image-preview"
                                alt={doc.original_name}
                              />
                            ) : (
                              <div className="doc-pdf-placeholder">
                                <FileText size={32} />
                                <span>PDF</span>
                              </div>
                            )}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                            <div className="doc-info" style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                              <div className="doc-name" title={doc.original_name}>
                                {DOC_TYPE_LABELS[doc.doc_type] || doc.original_name}
                              </div>
                              <div className="doc-meta">
                                {(doc.file_size_bytes / 1024).toFixed(0)} KB
                              </div>
                            </div>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  // Use downloadSecure so browser saves with correct filename
                                  await uploadsApi.downloadSecure(doc.id, getFriendlyFilename(doc, selectedRegistration.name));
                                } catch (err) {
                                  console.error("Download failed:", err.message);
                                  setErrorDialog({ open: true, message: err.message || "Could not download the document. Please try again." });
                                }
                              }}
                              title="Download"
                              style={{
                                color: "var(--green)",
                                background: "var(--green-light)",
                                width: 28,
                                height: 28,
                                borderRadius: 8,
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                cursor: "pointer",
                                transition: "all 0.2s",
                                flexShrink: 0,
                                border: "none"
                              }}
                            >
                              <Download size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: "20px", background: "#f8fafc", borderRadius: 12, border: "1px dashed rgba(0,0,0,0.08)", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                    No verification documents uploaded for this registration.
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                flexWrap: "wrap",
                gap: 12,
                padding: "16px 24px",
                borderTop: "1px solid rgba(0,0,0,0.06)",
                background: "var(--bg, #f8fafc)",
                position: "sticky",
                bottom: 0,
                zIndex: 10,
                borderBottomLeftRadius: 20,
                borderBottomRightRadius: 20
              }}
            >
              {selectedRegistration.status === "Pending" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", width: "100%" }}>
                  <button
                    className="btn-sm"
                    style={{ flex: "1 1 auto", justifyContent: "center", background: "var(--green)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                    disabled={actionLoading === selectedRegistration.id}
                    onClick={() => {
                      setActionConfirm({ id: selectedRegistration.id, action: "approve", name: selectedRegistration.name });
                      setSelectedRegistration(null);
                    }}
                  >
                    <CheckCircle size={14} /> Approve Request
                  </button>
                  <button
                    className="btn-sm"
                    style={{ flex: "1 1 auto", justifyContent: "center", background: "#fff3cd", color: "#856404", border: "1px solid #fbbf24", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                    onClick={() => openReuploadModal(selectedRegistration)}
                  >
                    <RefreshCw size={14} /> Request Re-upload
                  </button>
                  <button
                    className="btn-sm danger"
                    style={{ flex: "1 1 auto", justifyContent: "center", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                    disabled={actionLoading === selectedRegistration.id}
                    onClick={() => openRejectModal(selectedRegistration)}
                  >
                    <XCircle size={14} /> Reject Request
                  </button>
                </div>
              )}

              {/* Show Approve/Reject buttons for ReuploadRequested registrations. */}
              {selectedRegistration.status === "ReuploadRequested" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", width: "100%" }}>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                    justifyContent: "center",
                    background: "#fffbeb",
                    border: "1px solid #fbbf24",
                    borderRadius: 10,
                    padding: "10px 14px",
                    fontSize: 12,
                    color: "#856404",
                    flex: "1 1 auto"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Clock size={14} style={{ flexShrink: 0 }} />
                      <span style={{ lineHeight: 1.4, textAlign: "center" }}>
                        Waiting for dealer to re-upload documents.
                        {selectedRegistration.reupload_expires_at && new Date(selectedRegistration.reupload_expires_at) < new Date() && (
                          <strong style={{ color: "#dc2626", marginLeft: 4 }}>Link has expired.</strong>
                        )}
                      </span>
                    </div>
                    <button
                      style={{
                        flexShrink: 0, padding: "6px 12px",
                        background: "#f59e0b", color: "white",
                        border: "none", borderRadius: 7,
                        fontSize: 11, fontWeight: 700, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 5,
                      }}
                      onClick={() => openReuploadModal(selectedRegistration)}
                    >
                      <Send size={11} /> Send Again
                    </button>
                  </div>
                  <button
                    className="btn-sm danger"
                    style={{ flex: "1 1 auto", justifyContent: "center", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                    disabled={actionLoading === selectedRegistration.id}
                    onClick={() => openRejectModal(selectedRegistration)}
                  >
                    <XCircle size={14} /> Reject
                  </button>
                </div>
              )}
              {selectedRegistration.status === "Rejected" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", width: "100%" }}>
                  <button
                    className="btn-sm"
                    style={{ flex: "1 1 auto", justifyContent: "center", background: "#fff3cd", color: "#856404", border: "1px solid #fbbf24", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                    onClick={() => openReuploadModal(selectedRegistration)}
                  >
                    <RefreshCw size={14} /> Request Re-upload
                  </button>
                </div>
              )}

            </div>
          </div>
        </div>
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
      {actionConfirm && actionConfirm.action === "approve" && (
        <ConfirmDialog
          open={true}
          title="Approve Dealer?"
          message={`Are you sure you want to approve the registration for "${actionConfirm.name}"? A dealer account will be created and they will receive login access.`}
          variant="info"
          confirmText="Approve"
          onConfirm={() => {
            const { id, action } = actionConfirm;
            setActionConfirm(null);
            handleAction(id, action);
          }}
          onCancel={() => setActionConfirm(null)}
        />
      )}
      {/* Full-screen image viewer for secure blob URLs */}
      {docViewerUrl && (
        <div
          onClick={() => { URL.revokeObjectURL(docViewerUrl); setDocViewerUrl(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}
        >
          <img
            src={docViewerUrl}
            alt="Document preview"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8, boxShadow: "0 25px 60px rgba(0,0,0,0.5)", cursor: "default" }}
          />
          <button
            onClick={() => { URL.revokeObjectURL(docViewerUrl); setDocViewerUrl(null); }}
            style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", color: "white", cursor: "pointer", fontSize: 20 }}
          >
            <X size={20} />
          </button>
        </div>
      )}

      {/* Re-upload Request Modal */}
      {reuploadModal && (
        <div
          style={{
            position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
            background: "rgba(15,23,42,0.5)", backdropFilter: "blur(8px)",
            display: "flex", justifyContent: "center", alignItems: "center",
            zIndex: 1500, padding: "env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px) 16px",
          }}
          onClick={() => { if (!reuploadLoading) { clearTimeout(reuploadTimerRef.current); setReuploadModal(null); } }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "var(--card, white)", borderRadius: 20, width: "100%", maxWidth: 480,
              boxShadow: "0 25px 60px rgba(0,0,0,0.25)", overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "20px 24px", borderBottom: "1px solid rgba(0,0,0,0.06)",
              background: reuploadSuccess ? "#f0fdf4" : "#fffbeb",
            }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", display: "flex", alignItems: "center", gap: 8 }}>
                  <RefreshCw size={16} color="#856404" />
                  {reuploadSuccess ? "Request Sent" : "Request Document Re-upload"}
                </div>
                {!reuploadSuccess && (
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    {reuploadModal.name} — {reuploadModal.email}
                  </div>
                )}
              </div>
              {!reuploadLoading && (
                <button
                  onClick={() => { clearTimeout(reuploadTimerRef.current); setReuploadModal(null); }}
                  style={{ background: "#f1f5f9", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", justifyContent: "center", alignItems: "center", cursor: "pointer", color: "var(--text)" }}
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Modal Body */}
            <div style={{ padding: 24 }}>
              {reuploadSuccess ? (
                <div style={{ textAlign: "center", padding: "8px 0" }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: "50%",
                    background: "linear-gradient(135deg, #dcfce7, #bbf7d0)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    margin: "0 auto 16px",
                  }}>
                    <CheckCircle size={28} color="#2E7D52" />
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>Request Sent Successfully</div>
                  <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginBottom: 16 }}>
                    An email with a secure re-upload link has been sent to <strong>{reuploadModal.email}</strong>.
                    The registration is now marked as <strong>Re-upload Requested</strong>.
                  </div>
                  {/* IMP-3: countdown bar shows auto-dismiss in 2.5s */}
                  <div style={{ height: 3, background: "var(--border, #e2e8f0)", borderRadius: 99, overflow: "hidden", marginBottom: 16 }}>
                    <div style={{
                      height: "100%", background: "var(--green, #2E7D52)", borderRadius: 99,
                      animation: "shrinkWidth 2.5s linear forwards",
                    }} />
                  </div>
                  <button
                    onClick={() => { clearTimeout(reuploadTimerRef.current); setReuploadModal(null); }}
                    style={{ padding: "10px 24px", background: "var(--green)", color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  {/* Documents to re-upload — Aadhaar grouped, others below */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>Select Documents to Re-upload</div>

                      {/* ── Aadhaar Card ── single option, dealer decides format */}
                    {[
                      { key: "aadhaar", label: "Aadhaar Card" },
                      { key: "pan",            label: "PAN Card" },
                      { key: "passport_photo", label: "Passport Photo" },
                      { key: "other",          label: "Dealership Agreement" },
                    ].map(({ key, label }) => (
                      <label
                        key={key}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                          border: `1.5px solid ${reuploadDocs[key] ? "#2E7D52" : "rgba(0,0,0,0.08)"}`,
                          borderRadius: 10, marginBottom: 8, cursor: "pointer",
                          background: reuploadDocs[key] ? "rgba(46,125,82,0.04)" : "#fafafa",
                          transition: "all 0.15s",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={reuploadDocs[key]}
                          onChange={(e) => setReuploadDocs(p => ({ ...p, [key]: e.target.checked }))}
                          style={{ width: 16, height: 16, accentColor: "#2E7D52", cursor: "pointer" }}
                        />
                        <FileText size={14} color={reuploadDocs[key] ? "#2E7D52" : "#6b7280"} />
                        <span style={{ fontSize: 13, fontWeight: 500, color: reuploadDocs[key] ? "#1C3A2A" : "#374151" }}>{label}</span>
                      </label>
                    ))}
                  </div>

                  {/* Reason */}
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
                      Reason / Note for Dealer *
                    </label>
                    <textarea
                      value={reuploadReason}
                      onChange={(e) => setReuploadReason(e.target.value)}
                      placeholder="e.g. The Aadhaar card photo is blurry and unreadable. Please re-upload a clear, well-lit photo."
                      rows={4}
                      style={{
                        width: "100%", padding: "12px 14px",
                        border: "1.5px solid #e5e7eb", borderRadius: 10,
                        fontSize: 13, color: "#111827", resize: "vertical",
                        background: "#fafafa", outline: "none", boxSizing: "border-box",
                        fontFamily: "inherit", lineHeight: 1.6,
                      }}
                      onFocus={e => e.target.style.borderColor = "#2E7D52"}
                      onBlur={e => e.target.style.borderColor = "#e5e7eb"}
                    />
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>This note will be shown to the dealer in the email.</div>
                  </div>

                  {/* Info box */}
                  <div style={{
                    background: "#fff8e6", border: "1px solid #fbbf24",
                    borderLeft: "4px solid #f59e0b", borderRadius: "0 8px 8px 0",
                    padding: "10px 12px", marginBottom: 20, fontSize: 12, color: "#374151", lineHeight: 1.6,
                  }}>
                    <AlertTriangle size={12} style={{ display: "inline", marginRight: 4, color: "#f59e0b" }} />
                    The registration will be marked <strong>Re-upload Requested</strong> and moved out of the Rejected tab.
                    The dealer will receive a secure email link valid for <strong>72 hours</strong>.
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button
                      onClick={() => setReuploadModal(null)}
                      disabled={reuploadLoading}
                      style={{ padding: "10px 18px", background: "var(--card, white)", color: "#374151", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleRequestReupload}
                      disabled={reuploadLoading || !reuploadReason.trim() || !Object.values(reuploadDocs).some(Boolean)}
                      style={{
                        padding: "10px 18px",
                        background: reuploadLoading || !reuploadReason.trim() || !Object.values(reuploadDocs).some(Boolean)
                          ? "#9ca3af"
                          : "#f59e0b",
                        color: "white",
                        border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600,
                        cursor: reuploadLoading || !reuploadReason.trim() || !Object.values(reuploadDocs).some(Boolean) ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", gap: 6,
                      }}
                    >
                      {reuploadLoading
                        ? <><Loader2 size={14} className="animate-spin" /> Sending...</>
                        : <><RefreshCw size={14} /> Send Re-upload Request</>
                      }
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Reject Registration Modal */}
      {rejectModal && (
        <div
          style={{
            position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
            background: "rgba(15,23,42,0.5)", backdropFilter: "blur(8px)",
            display: "flex", justifyContent: "center", alignItems: "center",
            zIndex: 1500, padding: "env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px) 16px",
          }}
          onClick={() => { if (!rejectLoading) { clearTimeout(rejectTimerRef.current); setRejectModal(null); } }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "var(--card, white)", borderRadius: 20, width: "100%", maxWidth: 480,
              boxShadow: "0 25px 60px rgba(0,0,0,0.25)", overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "20px 24px", borderBottom: "1px solid rgba(0,0,0,0.06)",
              background: rejectSuccess ? "#f0fdf4" : "#fff5f5",
            }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", display: "flex", alignItems: "center", gap: 8 }}>
                  <XCircle size={16} color={rejectSuccess ? "#2E7D52" : "#dc2626"} />
                  {rejectSuccess ? "Registration Rejected" : "Reject Registration"}
                </div>
                {!rejectSuccess && (
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    {rejectModal.name} — {rejectModal.email}
                  </div>
                )}
              </div>
              {!rejectLoading && (
                <button
                  onClick={() => { clearTimeout(rejectTimerRef.current); setRejectModal(null); }}
                  style={{ background: "#f1f5f9", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", justifyContent: "center", alignItems: "center", cursor: "pointer", color: "var(--text)" }}
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Modal Body */}
            <div style={{ padding: 24 }}>
              {rejectSuccess ? (
                <div style={{ textAlign: "center", padding: "8px 0" }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: "50%",
                    background: "linear-gradient(135deg, #dcfce7, #bbf7d0)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    margin: "0 auto 16px",
                  }}>
                    <CheckCircle size={28} color="#2E7D52" />
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
                    Registration Rejected
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginBottom: 16 }}>
                    The registration for <strong>{rejectModal.name}</strong> has been rejected.<br />
                    A notification email with the reason has been sent to <strong>{rejectModal.email}</strong>.
                  </div>
                  {/* IMP-3: countdown bar — auto-dismiss in 2.5s */}
                  <div style={{ height: 3, background: "var(--border, #e2e8f0)", borderRadius: 99, overflow: "hidden", marginBottom: 16 }}>
                    <div style={{
                      height: "100%", background: "var(--green, #2E7D52)", borderRadius: 99,
                      animation: "shrinkWidth 2.5s linear forwards",
                    }} />
                  </div>
                  <button
                    onClick={() => { clearTimeout(rejectTimerRef.current); setRejectModal(null); }}
                    style={{ padding: "10px 24px", background: "var(--green)", color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  {/* Warning banner */}
                  <div style={{
                    background: "#fef2f2", border: "1px solid #fca5a5",
                    borderLeft: "4px solid #dc2626", borderRadius: "0 10px 10px 0",
                    padding: "12px 14px", marginBottom: 20, fontSize: 13,
                    color: "#374151", lineHeight: 1.6,
                  }}>
                    <strong style={{ display: "block", marginBottom: 4, color: "#991b1b" }}>
                      This action cannot be undone
                    </strong>
                    The dealer will receive an email with your rejection reason. You can still send
                    them a re-upload request later if needed.
                  </div>

                  {/* Reason textarea */}
                  <div style={{ marginBottom: 20 }}>
                    <label style={{
                      display: "block", fontSize: 12, fontWeight: 700, color: "#374151",
                      textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8,
                    }}>
                      Reason for Rejection *
                    </label>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="e.g. The submitted documents are not valid. The Aadhaar card number is not visible clearly."
                      rows={4}
                      autoFocus
                      style={{
                        width: "100%", padding: "12px 14px",
                        border: "1.5px solid #e5e7eb", borderRadius: 10,
                        fontSize: 13, color: "#111827", resize: "vertical",
                        background: "#fafafa", outline: "none", boxSizing: "border-box",
                        fontFamily: "inherit", lineHeight: 1.6,
                      }}
                      onFocus={e => e.target.style.borderColor = "#dc2626"}
                      onBlur={e => e.target.style.borderColor = "#e5e7eb"}
                    />
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                      This reason will be shown to the dealer in the rejection email.
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button
                      onClick={() => setRejectModal(null)}
                      disabled={rejectLoading}
                      style={{
                        padding: "10px 18px", background: "var(--card, white)", color: "#374151",
                        border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8,
                        fontSize: 13, fontWeight: 600, cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleReject}
                      disabled={rejectLoading || !rejectReason.trim()}
                      style={{
                        padding: "10px 18px",
                        background: rejectLoading || !rejectReason.trim() ? "#9ca3af" : "#dc2626",
                        color: "white",
                        border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600,
                        cursor: rejectLoading || !rejectReason.trim() ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", gap: 6,
                        transition: "background 0.2s",
                      }}
                    >
                      {rejectLoading
                        ? <><Loader2 size={14} className="animate-spin" /> Rejecting...</>
                        : <><XCircle size={14} /> Reject Registration</>
                      }
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
