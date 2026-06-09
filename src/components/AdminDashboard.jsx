import { useState, useEffect, useCallback } from "react";
import { dashboard as dashboardApi, quotations as quotationsApi } from "../utils/api";
import { fmt } from "../utils/helpers";
import {
  Loader2, FileText, Clock, CheckCircle, IndianRupee, Wallet,
  Users, Store, UserPlus, RefreshCw, X, User, Phone, MapPin, Zap,
  RefreshCw as ReuploadIcon,
} from "lucide-react";
import ErrorState from "./ErrorState";
import { t } from "../utils/i18n";

// ─── Status badge helper (matches DealerRequestsAdmin logic exactly) ──────────
function StatusBadge({ status }) {
  const label =
    status === "ReuploadRequested" ? "Re-upload" :
    status === "Approved"         ? "Approved"  :
    status === "Rejected"         ? "Rejected"  :
    status || "—";

  const cls =
    status === "Approved" ? "badge-green" :
    status === "Rejected" ? "badge-red"   :
    "badge-sun";

  return (
    <span className={`badge ${cls}`} style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px" }}>
      {label}
    </span>
  );
}

// ─── Quotation Detail Modal ───────────────────────────────────────────────────
function QuotationDetailModal({ quotationSummary, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!quotationSummary?.id) return;
    setLoading(true);
    setError(null);
    quotationsApi.get(quotationSummary.id)
      .then(res => {
        // API may return { quotation: {...} } or the object directly
        setDetail(res.quotation || res);
      })
      .catch(err => {
        console.error("Failed to load quotation detail:", err);
        setError(err.message || "Failed to load quotation details.");
      })
      .finally(() => setLoading(false));
  }, [quotationSummary?.id]);

  // Close on backdrop click
  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const q = detail;

  return (
    <div
      onClick={handleBackdrop}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(3px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        animation: "fadeIn 0.15s ease",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--card-bg, #ffffff)",
          borderRadius: 20,
          width: "100%",
          maxWidth: 680,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
          position: "relative",
          animation: "slideUp 0.2s ease",
        }}
      >
        {/* ── Modal Header ── */}
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "16px 20px",
          borderBottom: "1px solid rgba(0,0,0,0.07)",
          position: "sticky",
          top: 0,
          background: "var(--card-bg, #ffffff)",
          zIndex: 10,
          borderRadius: "20px 20px 0 0",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--mono)", color: "var(--text)" }}>
                {quotationSummary.quotation_number}
              </span>
              {/* Use loaded detail status (live) once available; fall back to summary while loading */}
              <StatusBadge status={detail?.status ?? quotationSummary.status} />
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {t("Submitted on")} {new Date(quotationSummary.created_at).toLocaleDateString("en-IN")}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "var(--light, #f1f5f9)",
              border: "none",
              borderRadius: "50%",
              width: 34,
              height: 34,
              minWidth: 34,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              cursor: "pointer",
              color: "var(--text)",
              flexShrink: 0,
              transition: "all 0.2s",
            }}
            title="Close"
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Modal Body ── */}
        <div style={{ padding: 24 }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)" }}>
              <div style={{ marginBottom: 8 }}><Loader2 size={28} className="animate-spin" /></div>
              <div style={{ fontSize: 13 }}>Loading quotation details…</div>
            </div>
          ) : error ? (
            <div style={{
              textAlign: "center", padding: "32px 20px",
              background: "rgba(220,38,38,0.05)", borderRadius: 12,
              border: "1px solid rgba(220,38,38,0.1)", color: "#dc2626",
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Could not load details</div>
              <div style={{ fontSize: 13 }}>{error}</div>
            </div>
          ) : q ? (
            <>
              {/* Re-upload active banner */}
              {q.status === "ReuploadRequested" && (
                <div style={{
                  background: "#fffbeb", border: "1.5px solid #fbbf24",
                  borderRadius: 14, padding: 14, marginBottom: 20,
                  display: "flex", gap: 12, alignItems: "flex-start",
                }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: "50%", background: "#fff3cd",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#d97706", flexShrink: 0,
                  }}>
                    <ReuploadIcon size={16} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", marginBottom: 2 }}>
                      Re-upload Request Active
                    </div>
                    {q.reupload_reason && (
                      <div style={{ fontSize: 12, color: "#b45309" }}>
                        <strong>Reason:</strong> {q.reupload_reason}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Customer & Dealer */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 20 }}>
                <div style={{ background: "var(--light, #f8fafc)", padding: 16, borderRadius: 14, border: "1px solid rgba(0,0,0,0.04)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {t("Customer Details")}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }}>
                      <User size={14} style={{ color: "var(--primary)", flexShrink: 0 }} />
                      {q.customer_name || "—"}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
                      <Phone size={13} style={{ color: "var(--primary)", flexShrink: 0 }} />
                      {q.customer_phone || "—"}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
                      <MapPin size={13} style={{ color: "var(--primary)", flexShrink: 0 }} />
                      {q.customer_city || "—"}
                    </div>
                  </div>
                </div>

                <div style={{ background: "var(--light, #f8fafc)", padding: 16, borderRadius: 14, border: "1px solid rgba(0,0,0,0.04)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {t("Dealer Information")}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{q.dealer_name || "—"}</div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>Email: {q.dealer_email || "—"}</div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>Phone: {q.dealer_mobile || "—"}</div>
                  </div>
                </div>
              </div>

              {/* System Specifications */}
              <div style={{ background: "var(--light, #f8fafc)", padding: 16, borderRadius: 14, border: "1px solid rgba(0,0,0,0.04)", marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {t("System Specifications")}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>Capacity</div>
                    <div style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                      <Zap size={13} style={{ color: "var(--sun)" }} />
                      {Number(q.system_kw).toFixed(2)} kW
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>Total Cost</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--green)", fontFamily: "var(--mono)", marginTop: 2 }}>
                      {fmt(q.total)}
                    </div>
                  </div>
                  {q.panel_brand && (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>Solar Panels</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                        {q.panel_brand} {q.panel_watt}W ({q.panel_count} pcs)
                      </div>
                    </div>
                  )}
                  {q.inverter_brand && (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>Inverter</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                        {q.inverter_brand} {q.inverter_kw != null ? Number(q.inverter_kw).toFixed(2) : "—"} kW
                      </div>
                    </div>
                  )}
                  {q.structure_height && (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>Structure & Height</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{q.structure_height}</div>
                    </div>
                  )}
                  {q.delivery_status && q.status === "Approved" && (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>Delivery</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{q.delivery_status}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer hint */}
              <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", paddingTop: 4 }}>
                {t("Go to the Quotations page for full actions (Approve, Reject, Documents, etc.)")}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Main AdminDashboard ──────────────────────────────────────────────────────
export default function AdminDashboard({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [recentQuotations, setRecentQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedQuotation, setSelectedQuotation] = useState(null); // summary obj for modal

  const fetchDashboard = useCallback(() => {
    setLoading(true);
    setError(null);
    dashboardApi.get()
      .then(res => {
        setStats(res.dashboard?.stats || null);
        setRecentQuotations(res.dashboard?.recentQuotations || []);
      })
      .catch(err => {
        console.error("Dashboard error:", err);
        setError("Failed to load dashboard data.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Close modal on Escape key
  useEffect(() => {
    if (!selectedQuotation) return;
    const handler = (e) => { if (e.key === "Escape") setSelectedQuotation(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedQuotation]);

  // ── Auto-refresh every 60 seconds while dashboard is visible ──────────────
  useEffect(() => {
    const id = setInterval(() => fetchDashboard(), 60_000);
    return () => clearInterval(id);
  }, [fetchDashboard]);

  // ── SSE: Refresh instantly on relevant real-time events ────────────────────
  // The global SSE bus in App.jsx dispatches these window events.
  useEffect(() => {
    const handler = () => fetchDashboard();
    const events = [
      "hp:sse:quotation:new",
      "hp:sse:quotation:status_changed",
      "hp:sse:registration:new",
      "hp:sse:registration:status_changed",
    ];
    events.forEach(e => window.addEventListener(e, handler));
    return () => events.forEach(e => window.removeEventListener(e, handler));
  }, [fetchDashboard]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
        <div style={{ marginBottom: 8 }}><Loader2 size={32} className="animate-spin" /></div>
        Loading dashboard...
      </div>
    );
  }

  if (error || !stats) {
    return (
      <ErrorState
        title={error || "Failed to load dashboard data."}
        message="The dashboard could not be loaded. Please check your connection and try again."
        onRetry={fetchDashboard}
      />
    );
  }

  const statCards = [
    { label: t("Total Quotations"),      value: stats.totalQuotations,      icon: FileText,    color: "var(--text)",  page: "requests" },
    { label: t("Pending"),               value: stats.pendingQuotations,    icon: Clock,       color: "var(--sun)",  page: "requests" },
    { label: t("Approved"),              value: stats.approvedQuotations,   icon: CheckCircle, color: "var(--green)",page: "requests" },
    { label: t("Total Revenue"),         value: fmt(stats.totalRevenue),    icon: IndianRupee, color: "var(--green)",page: "reports" },
    { label: t("Effective Revenue"),     value: fmt(stats.effectiveRevenue),icon: Wallet,      color: "var(--green)",page: "reports" },
    { label: t("Customers"),             value: stats.totalCustomers,       icon: Users,       color: "var(--text)",  page: "customers" },
    { label: t("Dealers"),               value: stats.totalDealers,         icon: Store,       color: "var(--text)",  page: "dealers" },
    { label: t("Pending Registrations"), value: stats.pendingRegistrations, icon: UserPlus,    color: "var(--sun)",  page: "dealer_registrations" },
  ];

  return (
    <div>
      {/* ── Page Header ── */}
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="page-title">{t("Dashboard")}</div>
          <div className="page-sub">{t("Business overview and key metrics")}</div>
        </div>
        <button
          onClick={fetchDashboard}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 8,
            background: "var(--bg-secondary, #f1f5f9)",
            border: "1px solid var(--border)",
            color: "var(--text)", fontSize: 13, fontWeight: 500,
            cursor: "pointer", transition: "all 0.2s",
          }}
          title="Refresh dashboard data"
          aria-label="Refresh dashboard"
        >
          <RefreshCw size={14} />
          {t("Refresh")}
        </button>
      </div>

      {/* ── Stat Cards ── */}
      <div className="stats-row">
        {statCards.map(s => {
          const Icon = s.icon;
          return (
            <div
              className="stat-card"
              key={s.label}
              onClick={() => onNavigate?.(s.page)}
              style={{ cursor: onNavigate ? "pointer" : "default", transition: "transform 0.15s, box-shadow 0.15s" }}
              onMouseEnter={e => { if (onNavigate) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.08)"; } }}
              onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}
              role={onNavigate ? "button" : undefined}
              tabIndex={onNavigate ? 0 : undefined}
              onKeyDown={e => { if (onNavigate && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onNavigate(s.page); } }}
              aria-label={onNavigate ? `Navigate to ${s.label}` : undefined}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div className="stat-label">{s.label}</div>
                <Icon size={16} style={{ color: s.color, opacity: 0.6 }} />
              </div>
              <div className="stat-val" style={{ color: s.color }}>{s.value}</div>
            </div>
          );
        })}
      </div>

      {/* ── Recent Quotations Table ── */}
      <div className="card">
        <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{t("Recent Quotations")}</span>
          {onNavigate && (
            <button
              onClick={() => onNavigate("requests")}
              style={{
                background: "none", border: "none",
                color: "var(--primary)", fontSize: 12, fontWeight: 600,
                cursor: "pointer", padding: "4px 8px", borderRadius: 6,
                transition: "background 0.15s",
              }}
              onMouseOver={e => { e.currentTarget.style.background = "var(--primary-light, #eff6ff)"; }}
              onMouseOut={e => { e.currentTarget.style.background = "none"; }}
            >
              {t("View All →")}
            </button>
          )}
        </div>

        {recentQuotations.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 14 }}>{t("No quotations yet")}</div>
        ) : (
          <div className="table-scroll-wrap">
            <table style={{ minWidth: "560px" }}>
              <thead>
                <tr>
                  <th>{t("Quotation #")}</th>
                  <th>{t("Customer")}</th>
                  <th>{t("System")}</th>
                  <th>{t("Total")}</th>
                  <th>{t("Status")}</th>
                  <th>{t("Date")}</th>
                </tr>
              </thead>
              <tbody>
                {recentQuotations.map(q => (
                  <tr
                    key={q.id}
                    style={{ cursor: "pointer", transition: "background 0.15s" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.025)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = ""; }}
                    onClick={() => setSelectedQuotation(q)}
                    title="Click to view quotation details"
                  >
                    <td style={{ fontWeight: 500, fontFamily: "var(--mono)" }}>{q.quotation_number}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{q.customer_name || "—"}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{q.dealer_name}</div>
                    </td>
                    <td>{Number(q.system_kw).toFixed(2)} kW</td>
                    <td style={{ fontFamily: "var(--mono)", fontWeight: 600, color: "var(--green)" }}>
                      {fmt(q.total)}
                    </td>
                    <td>
                      <StatusBadge status={q.status} />
                    </td>
                    <td style={{ color: "var(--muted)" }}>
                      {new Date(q.created_at).toLocaleDateString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Quotation Detail Modal ── */}
      {selectedQuotation && (
        <QuotationDetailModal
          quotationSummary={selectedQuotation}
          onClose={() => setSelectedQuotation(null)}
        />
      )}
    </div>
  );
}
