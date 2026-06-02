import { useState, useEffect, useCallback } from "react";
import { customers as customersApi } from "../utils/api";
import { fmt } from "../utils/helpers";
import { Loader2, Users, Pencil, Search, Plus, X, ChevronLeft, ChevronRight } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import ErrorState from "./ErrorState";

// Module-scope Map — Map.get() is immune to prototype-pollution
// (unlike plain object bracket access which triggers security lint rules).
const STATUS_BADGE_MAP = new Map([
  ["Lead",      "badge-sun"],
  ["Quoted",    "badge-gray"],
  ["Approved",  "badge-green"],
  ["Installed", "badge-green"],
  ["Follow-up", "badge-red"],
]);

export default function CustomerManager() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errorDialog, setErrorDialog] = useState({ open: false, message: "" });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [searchTrigger, setSearchTrigger] = useState(0);
  const [fetchError, setFetchError] = useState(false);

  const [form, setForm] = useState({
    name: "", phone: "", email: "", city: "", address: "", status: "Lead", notes: "",
  });

  // Kanban board states and handlers removed as requested

  const fetchCustomers = useCallback(async () => {
    try {
      setFetchError(false);
      const params = { page, limit: 20 };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const res = await customersApi.list(params);
      setList(res.customers || []);
      if (res.pagination) setPagination(res.pagination);
    } catch (err) {
      console.error("Fetch customers error:", err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, searchTrigger]);

  useEffect(() => { setPage(1); }, [statusFilter]);
  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const handleSearch = (e) => {
    if (e.key === "Enter" || e.type === "click") {
      setPage(1);
      setSearchTrigger(t => t + 1);
    }
  };

  // Clear search
  const handleClearSearch = () => {
    setSearch("");
    setPage(1);
    setSearchTrigger(t => t + 1);
  };

  const resetForm = () => {
    setForm({ name: "", phone: "", email: "", city: "", address: "", status: "Lead", notes: "" });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSave = async () => {
    if (!form.name || form.name.trim().length < 2) {
      setErrorDialog({ open: true, message: "Customer name is required (min 2 characters)." });
      return;
    }
    if (form.phone && form.phone.length !== 10) {
      setErrorDialog({ open: true, message: "Phone number must be exactly 10 digits." });
      return;
    }
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) {
      setErrorDialog({ open: true, message: "Please enter a valid email address." });
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await customersApi.update(editingId, form);
      } else {
        await customersApi.create(form);
      }
      resetForm();
      fetchCustomers();
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to save customer." });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (c) => {
    setForm({
      name: c.name, phone: c.phone || "", email: c.email || "",
      city: c.city || "", address: c.address || "", status: c.status, notes: c.notes || "",
    });
    setEditingId(c.id);
    setShowForm(true);
  };

  // Map.get() lookup — no prototype-pollutable bracket access.
  const getStatusBadge = (status) => STATUS_BADGE_MAP.get(status) ?? "badge-gray";

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
        <div style={{ marginBottom: 8 }}><Loader2 size={32} className="animate-spin" /></div>Loading...
      </div>
    );
  }

  if (fetchError) {
    return (
      <ErrorState
        title="Failed to load customers."
        message="Could not connect to the server. Please check your connection."
        onRetry={fetchCustomers}
      />
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="page-title">Customers</div>
          <div className="page-sub">Manage customer profiles and track their journey</div>
        </div>
        <div>
          <button className="btn-primary" style={{ width: "auto", padding: "10px 20px" }} onClick={() => { resetForm(); setShowForm(!showForm); }}>
            {showForm ? <><X size={16} /> Cancel</> : <><Plus size={16} /> Add Customer</>}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card" style={{ border: "1.5px solid var(--green)" }}>
          <div className="card-title" style={{ color: "var(--green)", display: "flex", alignItems: "center", gap: 6 }}>
            <Pencil size={14} />
            {editingId ? "Edit Customer" : "New Customer"}
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Full Name *</label>
              <input placeholder="Ramesh Patel" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Phone</label>
              <input placeholder="9876543210" maxLength={10} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })} />
            </div>
            <div className="field">
              <label>Email</label>
              <input placeholder="email@example.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="field">
              <label>City</label>
              <input placeholder="Ahmedabad" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
            </div>
            <div className="field">
              <label>Address</label>
              <input placeholder="123 Solar Street, Near Water Tank..." value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="field">
              <label>Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                {["Lead", "Quoted", "Approved", "Installed", "Follow-up"].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Notes</label>
              <input placeholder="Interested in 5kW system..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <button className="btn-primary" style={{ width: "auto", padding: "10px 24px", marginTop: 12 }} onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : (editingId ? "Update Customer" : "Add Customer")}
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search by name, phone, or city..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={handleSearch}
          style={{ flex: 1, minWidth: 120, padding: "10px 14px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13 }}
        />
        {search && (
          <button className="btn-sm" onClick={handleClearSearch} style={{ padding: "10px 10px", display: "flex", alignItems: "center" }} title="Clear search">
            <X size={14} />
          </button>
        )}
        <button className="btn-sm" onClick={() => { setPage(1); setSearchTrigger(t => t + 1); }} style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 4 }}>
          <Search size={14} /> Search
        </button>
        {["", "Lead", "Quoted", "Approved", "Installed", "Follow-up"].map(s => (
          <button
            key={s}
            className={`btn-sm ${statusFilter === s ? "primary" : ""}`}
            onClick={() => setStatusFilter(s)}
            style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12 }}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
          <div style={{ marginBottom: 8 }}><Loader2 size={32} className="animate-spin" /></div>Loading...
        </div>
      ) : list.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
          <div style={{ marginBottom: 12 }}><Users size={48} strokeWidth={1} /></div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>No customers found</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Add your first customer to get started.</div>
        </div>
      ) : (
        <div className="card">
          <div className="table-scroll-wrap">
            <table style={{ minWidth: "620px" }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>City</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th>Added</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td>
                      <div>{c.phone || "—"}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{c.email || ""}</div>
                    </td>
                    <td>{c.city || "—"}</td>
                    <td>
                      <span className={`badge ${getStatusBadge(c.status)}`}>{c.status}</span>
                    </td>
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }}>
                      {c.notes || "—"}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>
                      {new Date(c.created_at).toLocaleDateString("en-IN")}
                    </td>
                    <td>
                      <button
                        className="btn-sm"
                        style={{ padding: "4px 10px", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}
                        onClick={() => handleEdit(c)}
                      >
                        <Pencil size={12} /> Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {pagination.totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--border, #e2e8f0)", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, pagination.total)} of {pagination.total}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ padding: "4px 12px", fontSize: 12, borderRadius: 8, display: "flex", alignItems: "center", gap: 4 }}><ChevronLeft size={14} /> Prev</button>
                <span style={{ display: "flex", alignItems: "center", fontSize: 12, color: "var(--text)", fontWeight: 600, padding: "0 8px" }}>{page} / {pagination.totalPages}</span>
                <button className="btn-sm" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)} style={{ padding: "4px 12px", fontSize: 12, borderRadius: 8, display: "flex", alignItems: "center", gap: 4 }}>Next <ChevronRight size={14} /></button>
              </div>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={errorDialog.open}
        title="Error"
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
