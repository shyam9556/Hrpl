import { useState, useEffect, useCallback } from "react";
import { dealers as dealersApi } from "../utils/api";
import { Loader2, Store, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import ErrorState from "./ErrorState";

export default function DealersList() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [errorDialog, setErrorDialog] = useState({ open: false, message: "" });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const PAGE_SIZE = 20;

  const fetchDealers = useCallback(async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      setFetchError(false);
      const res = await dealersApi.list();
      setList(res.dealers || []);
    } catch (err) {
      console.error("Fetch dealers error:", err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDealers(); }, [fetchDealers]);
  useEffect(() => { setPage(1); }, [search]);

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
      <div className="page-header">
        <div className="page-title">Dealers</div>
        <div className="page-sub">Manage approved dealer accounts</div>
      </div>

      {/* Search bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "var(--card, white)", border: "1px solid var(--border, #e2e8f0)",
          borderRadius: 10, padding: "8px 14px", maxWidth: 380,
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}>
          <Search size={15} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search by name, email, location..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              border: "none", outline: "none", background: "transparent",
              flex: 1, fontSize: 13, color: "var(--text)",
            }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--muted)", display: "flex" }}>
              <X size={14} />
            </button>
          )}
        </div>
        {search && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
            {filteredList.length === 0
              ? `No results for "${search}"`
              : `${filteredList.length} result${filteredList.length !== 1 ? "s" : ""} for "${search}"`}
          </div>
        )}
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
        <div className="card" style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
          <div style={{ marginBottom: 12 }}><Search size={48} strokeWidth={1} /></div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>No dealers match "{search}"</div>
          <button onClick={() => setSearch("")} style={{ marginTop: 12, fontSize: 13, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
            Clear search
          </button>
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Location</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Joined</th>
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
                    <td>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredList.length > PAGE_SIZE && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--border, #e2e8f0)" }}>
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
    </div>
  );
}
