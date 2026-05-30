import { useState, useEffect, useCallback } from "react";
import { dashboard as dashboardApi } from "../utils/api";
import { fmt } from "../utils/helpers";
import { Loader2, FileText, Clock, CheckCircle, IndianRupee, Wallet, Users, Store, UserPlus, RefreshCw } from "lucide-react";
import ErrorState from "./ErrorState";
import { t } from "../utils/i18n";

export default function AdminDashboard({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [recentQuotations, setRecentQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="page-title">{t("Dashboard")}</div>
          <div className="page-sub">{t("Business overview and key metrics")}</div>
        </div>
        <button
          onClick={fetchDashboard}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            borderRadius: 8,
            background: "var(--bg-secondary, #f1f5f9)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.2s"
          }}
          title="Refresh dashboard data"
          aria-label="Refresh dashboard"
        >
          <RefreshCw size={14} />
          {t("Refresh")}
        </button>
      </div>

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

      <div className="card">
        <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{t("Recent Quotations")}</span>
          {onNavigate && (
            <button
              onClick={() => onNavigate("requests")}
              style={{
                background: "none",
                border: "none",
                color: "var(--primary)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: 6,
                transition: "background 0.15s"
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
          <div style={{ overflowX: "auto" }}>
          <table>
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
                  style={{ cursor: onNavigate ? "pointer" : "default", transition: "background 0.15s" }}
                  onMouseEnter={e => { if (onNavigate) e.currentTarget.style.background = "rgba(0,0,0,0.02)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = ""; }}
                  onClick={() => onNavigate?.("requests")}
                  title={onNavigate ? "Go to Quotations" : undefined}
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
                    <span
                      className={`badge ${
                        q.status === "Approved"
                          ? "badge-green"
                          : q.status === "Rejected"
                          ? "badge-red"
                          : "badge-sun"
                      }`}
                    >
                      {q.status}
                    </span>
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
    </div>
  );
}
