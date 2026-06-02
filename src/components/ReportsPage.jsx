import { useState, useEffect, useCallback } from "react";
import { reports as reportsApi } from "../utils/api";
import { fmt } from "../utils/helpers";
import { Loader2, TrendingUp, Store, Users, Download } from "lucide-react";
import ErrorState from "./ErrorState";

// ── Utility: export table data to CSV ────────────────────────────────────────
function downloadCsv(filename, headers, rows) {
  const escape = (val) => {
    const s = String(val ?? "");
    // Wrap in quotes if contains comma, newline, or double-quote; escape quotes
    if (s.includes(",") || s.includes("\n") || s.includes('"')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const csv = [headers.map(escape).join(","), ...rows.map(r => r.map(escape).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }); // BOM for Excel UTF-8
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState("revenue");
  const [revenueData, setRevenueData] = useState(null);
  const [dealerData, setDealerData] = useState(null);
  const [customerData, setCustomerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  const [year, setYear] = useState(new Date().getFullYear());

  // Year range: from 2024 up to (current year + 1) so it doesn't cut off new FY early
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: currentYear - 2024 + 2 }, (_, i) => 2024 + i);

  useEffect(() => {
    setLoading(true);
    setError(null);
    if (activeTab === "revenue") {
      reportsApi.revenue(year)
        .then(res => { setRevenueData(res); setError(null); })
        .catch(err => { console.error(err); setError("Failed to load revenue report."); })
        .finally(() => setLoading(false));
    } else if (activeTab === "dealers") {
      reportsApi.dealers()
        .then(res => { setDealerData(res); setError(null); })
        .catch(err => { console.error(err); setError("Failed to load dealer report."); })
        .finally(() => setLoading(false));
    } else if (activeTab === "customers") {
      reportsApi.customers()
        .then(res => { setCustomerData(res); setError(null); })
        .catch(err => { console.error(err); setError("Failed to load customer report."); })
        .finally(() => setLoading(false));
    }
  }, [activeTab, year, retryKey]);

  const tabs = [
    { id: "revenue", label: "Revenue", icon: TrendingUp },
    { id: "dealers", label: "Dealers", icon: Store },
    { id: "customers", label: "Customers", icon: Users },
  ];

  // ── CSV export handlers ───────────────────────────────────────────────────
  const handleExportRevenue = () => {
    if (!revenueData?.monthly?.length) return;
    downloadCsv(
      `revenue-report-${year}.csv`,
      ["Month", "Quotations", "Gross Revenue (₹)", "GST (₹)", "Subsidy (₹)", "Net Revenue (₹)", "kW Sold"],
      revenueData.monthly.map(m => [
        m.month_label,
        m.quotation_count,
        parseFloat(m.gross_revenue).toFixed(2),
        parseFloat(m.total_gst).toFixed(2),
        parseFloat(m.total_subsidy).toFixed(2),
        parseFloat(m.net_revenue).toFixed(2),
        parseFloat(m.total_kw).toFixed(2),
      ])
    );
  };

  const handleExportDealers = () => {
    if (!dealerData?.dealers?.length) return;
    downloadCsv(
      `dealer-performance-report.csv`,
      ["Dealer Name", "Email", "Location", "Status", "Total Quotations", "Approved", "Pending", "Revenue (₹)", "kW Sold", "Unique Customers"],
      dealerData.dealers.map(d => [
        d.name, d.email, d.location || "", d.is_active ? "Active" : "Inactive",
        d.total_quotations, d.approved_quotations, d.pending_quotations,
        parseFloat(d.total_revenue).toFixed(2),
        parseFloat(d.total_kw_sold).toFixed(2),
        d.unique_customers,
      ])
    );
  };

  const handleExportCustomers = () => {
    if (!customerData?.topCustomers?.length) return;
    downloadCsv(
      `customer-report.csv`,
      ["Customer Name", "Phone", "City", "Status", "Quotations", "Total Value (₹)"],
      customerData.topCustomers.map(c => [
        c.name, c.phone || "", c.city || "", c.status,
        c.quotation_count,
        parseFloat(c.total_value).toFixed(2),
      ])
    );
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Reports</div>
        <div className="page-sub">Business analytics and performance insights</div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", overflowX: "auto" }}>
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              className={`btn-sm ${activeTab === t.id ? "primary" : ""}`}
              onClick={() => setActiveTab(t.id)}
              style={{ padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
          <div style={{ marginBottom: 8 }}><Loader2 size={32} className="animate-spin" /></div>
          Loading report...
        </div>
      ) : error ? (
        <ErrorState
          title={error}
          message="Please check your connection and try again."
          onRetry={() => { setError(null); setRetryKey(k => k + 1); }}
        />
      ) : (
        <>
          {/* Revenue Report */}
          {activeTab === "revenue" && revenueData && (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Year:</span>
                <select
                  value={year}
                  onChange={e => setYear(parseInt(e.target.value))}
                  style={{ padding: "6px 12px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--card)", color: "var(--text)" }}
                >
                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                {(revenueData.monthly || []).length > 0 && (
                  <button
                    className="btn-sm"
                    onClick={handleExportRevenue}
                    style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, fontSize: 12 }}
                    title="Export monthly breakdown as CSV"
                  >
                    <Download size={13} /> Export CSV
                  </button>
                )}
              </div>

              <div className="stats-row">
                <div className="stat-card">
                  <div className="stat-label">Total Quotations</div>
                  <div className="stat-val">{revenueData.annual?.totalQuotations ?? 0}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Gross Revenue</div>
                  <div className="stat-val" style={{ fontSize: 18 }}>{fmt(revenueData.annual?.grossRevenue ?? 0)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Net Revenue</div>
                  <div className="stat-val" style={{ fontSize: 18, color: "var(--green)" }}>{fmt(revenueData.annual?.netRevenue ?? 0)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Total kW Sold</div>
                  <div className="stat-val">{Number(revenueData.annual?.totalKw ?? 0).toFixed(1)} kW</div>
                </div>
              </div>

              <div className="card">
                <div className="card-title">Monthly Breakdown</div>
                {(revenueData.monthly || []).length === 0 ? (
                  <div style={{ color: "var(--muted)", fontSize: 14 }}>No approved quotations for {year}.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th>Quotations</th>
                          <th>Gross Revenue</th>
                          <th>GST</th>
                          <th>Subsidy</th>
                          <th>Net Revenue</th>
                          <th>kW Sold</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(revenueData.monthly || []).map(m => (
                          <tr key={m.month}>
                            <td style={{ fontWeight: 500 }}>{m.month_label}</td>
                            <td>{m.quotation_count}</td>
                            <td style={{ fontFamily: "var(--mono)" }}>{fmt(m.gross_revenue)}</td>
                            <td style={{ fontFamily: "var(--mono)", color: "var(--muted)" }}>{fmt(m.total_gst)}</td>
                            <td style={{ fontFamily: "var(--mono)", color: "var(--green)" }}>{fmt(m.total_subsidy)}</td>
                            <td style={{ fontFamily: "var(--mono)", fontWeight: 600, color: "var(--green)" }}>{fmt(m.net_revenue)}</td>
                            <td>{Number(m.total_kw).toFixed(1)} kW</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Dealer Performance */}
          {activeTab === "dealers" && dealerData && (
            <div className="card">
              <div className="card-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <span>Dealer Performance</span>
                {(dealerData.dealers || []).length > 0 && (
                  <button
                    className="btn-sm"
                    onClick={handleExportDealers}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 500 }}
                    title="Export dealer performance as CSV"
                  >
                    <Download size={13} /> Export CSV
                  </button>
                )}
              </div>
              {(dealerData.dealers || []).length === 0 ? (
                <div style={{ color: "var(--muted)", fontSize: 14 }}>No dealers found.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Dealer</th>
                        <th>Location</th>
                        <th>Total Quotations</th>
                        <th>Approved</th>
                        <th>Pending</th>
                        <th>Revenue</th>
                        <th>kW Sold</th>
                        <th>Customers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dealerData.dealers || []).map(d => (
                        <tr key={d.id}>
                          <td>
                            <div style={{ fontWeight: 500 }}>{d.name}</div>
                            <div style={{ fontSize: 11, color: "var(--muted)" }}>{d.email}</div>
                          </td>
                          <td>{d.location || "—"}</td>
                          <td>{d.total_quotations}</td>
                          <td style={{ color: "var(--green)", fontWeight: 500 }}>{d.approved_quotations}</td>
                          <td style={{ color: "var(--sun)" }}>{d.pending_quotations}</td>
                          <td style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{fmt(d.total_revenue)}</td>
                          <td>{Number(d.total_kw_sold).toFixed(1)} kW</td>
                          <td>{d.unique_customers}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Customer Report */}
          {activeTab === "customers" && customerData && (
            <>
              <div className="stats-row">
                {(customerData.statusBreakdown || []).map(s => (
                  <div className="stat-card" key={s.status}>
                    <div className="stat-label">{s.status}</div>
                    <div className="stat-val">{s.count}</div>
                  </div>
                ))}
              </div>

              <div className="card">
                <div className="card-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <span>Top Customers by Quotation Value</span>
                  {(customerData.topCustomers || []).length > 0 && (
                    <button
                      className="btn-sm"
                      onClick={handleExportCustomers}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 500 }}
                      title="Export customer report as CSV"
                    >
                      <Download size={13} /> Export CSV
                    </button>
                  )}
                </div>
                {(customerData.topCustomers || []).length === 0 ? (
                  <div style={{ color: "var(--muted)", fontSize: 14 }}>No customers found.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Customer</th>
                          <th>Phone</th>
                          <th>City</th>
                          <th>Status</th>
                          <th>Quotations</th>
                          <th>Total Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(customerData.topCustomers || []).map(c => (
                          <tr key={c.id}>
                            <td style={{ fontWeight: 500 }}>{c.name}</td>
                            <td>{c.phone || "—"}</td>
                            <td>{c.city || "—"}</td>
                            <td>
                              <span className={`badge ${c.status === "Approved" || c.status === "Installed" ? "badge-green" : c.status === "Lead" ? "badge-sun" : "badge-gray"}`}>
                                {c.status}
                              </span>
                            </td>
                            <td>{c.quotation_count}</td>
                            <td style={{ fontFamily: "var(--mono)", fontWeight: 600, color: "var(--green)" }}>{fmt(c.total_value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
