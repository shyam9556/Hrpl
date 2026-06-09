import { useState, useEffect, useCallback, useRef } from "react";
import { inquiries as inquiriesApi } from "../utils/api";
import { 
  Loader2, Search, Plus, X, MessageSquare, PhoneCall, ArrowRight, 
  MapPin, Clock, Edit2, Trash2, CheckCircle2, ChevronRight, FileText, AlertTriangle
} from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";

export default function InquiryManager({ onConvertToQuote }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  
  // Modals & Panels States
  const [showForm, setShowForm] = useState(false);
  const [editingInquiry, setEditingInquiry] = useState(null);
  const [selectedInquiry, setSelectedInquiry] = useState(null);
  const [showFollowupForm, setShowFollowupForm] = useState(false);
  const [followupNotes, setFollowupNotes] = useState("");
  const [followupHistory, setFollowupHistory] = useState([]);
  const [loadingFollowups, setLoadingFollowups] = useState(false);
  const [followupError, setFollowupError] = useState(false);
  
  const [saving, setSaving] = useState(false);
  const [dialogState, setDialogState] = useState({ open: false, title: "", message: "", variant: "info", callback: null });
  const [confirmDelete, setConfirmDelete] = useState({ open: false, id: null });

  // Form State
  const [form, setForm] = useState({
    name: "",
    location: "",
    remark: "",
    status: "New"
  });

  // ── searchRef: always holds the latest search value ────────────────────────────
  // Without this ref, fetchInquiries would capture a stale `search` value
  // from the closure when called by the debounce timer or status filter change.
  const searchRef = useRef(search);
  useEffect(() => { searchRef.current = search; }, [search]);

  const fetchInquiries = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (searchRef.current) params.search = searchRef.current;
      if (statusFilter) params.status = statusFilter;
      const res = await inquiriesApi.list(params);
      setList(res.inquiries || []);
    } catch (err) {
      showError("Error", err.message || "Failed to load inquiries.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]); // Only re-create when statusFilter changes; search is read via ref

  // Fetch when statusFilter changes (fetchInquiries identity changes too)
  useEffect(() => {
    fetchInquiries();
  }, [fetchInquiries]);

  // Debounced auto-search: fires 400ms after user stops typing.
  // Skip the very first render (both search and ref are empty strings).
  useEffect(() => {
    if (!search && !searchRef.current) return;
    const timer = setTimeout(() => fetchInquiries(), 400);
    return () => clearTimeout(timer);
  }, [search, fetchInquiries]);

  useEffect(() => {
    if (selectedInquiry) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [selectedInquiry]);

  const handleSearch = (e) => {
    if (e.key === "Enter" || e.type === "click") {
      fetchInquiries();
    }
  };

  const resetForm = () => {
    setForm({ name: "", location: "", remark: "", status: "New" });
    setEditingInquiry(null);
    setShowForm(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name || form.name.trim().length < 2) {
      showError("Validation Error", "Please enter a valid customer name (min 2 characters).");
      return;
    }
    if (!form.location || form.location.trim().length < 2) {
      showError("Validation Error", "Please enter a valid location details.");
      return;
    }

    setSaving(true);
    try {
      if (editingInquiry) {
        await inquiriesApi.update(editingInquiry.id, form);
        showSuccess("Success", `Inquiry for '${form.name}' updated successfully.`);
      } else {
        await inquiriesApi.create(form);
        showSuccess("Success", `Inquiry for '${form.name}' created successfully.`);
      }
      resetForm();
      fetchInquiries();
    } catch (err) {
      showError("Error", err.message || "Failed to save inquiry.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (inq) => {
    setEditingInquiry(inq);
    setForm({
      name: inq.name,
      location: inq.location,
      remark: inq.remark || "",
      status: inq.status
    });
    setShowForm(true);
    setSelectedInquiry(null); // close detail drawer
  };

  const handleDeleteClick = (id) => {
    setConfirmDelete({ open: true, id });
  };

  const handleDeleteConfirm = async () => {
    const id = confirmDelete.id;
    setConfirmDelete({ open: false, id: null });
    try {
      await inquiriesApi.delete(id);
      fetchInquiries();
      if (selectedInquiry?.id === id) setSelectedInquiry(null);
      showSuccess("Deleted", "Inquiry has been deleted successfully.");
    } catch (err) {
      showError("Delete Failed", err.message || "Could not delete inquiry.");
    }
  };

  const handleOpenDetails = async (inq) => {
    setSelectedInquiry(inq);
    setFollowupNotes("");
    setShowFollowupForm(false);
    await fetchFollowups(inq.id);
  };

  const fetchFollowups = async (inquiryId) => {
    setLoadingFollowups(true);
    setFollowupError(false);
    try {
      const res = await inquiriesApi.getFollowups(inquiryId);
      setFollowupHistory(res.followups || []);
    } catch (err) {
      setFollowupError(true);
    } finally {
      setLoadingFollowups(false);
    }
  };

  const handleSaveFollowup = async (e) => {
    e.preventDefault();
    if (!followupNotes.trim()) return;

    setSaving(true);
    try {
      const res = await inquiriesApi.addFollowup(selectedInquiry.id, followupNotes);
      setFollowupNotes("");
      setShowFollowupForm(false);

      // Refresh list first so cards in the grid show the updated last_followup_date
      await fetchInquiries();
      // Then reload the followup history in the drawer
      await fetchFollowups(selectedInquiry.id);
      // Finally update the selected inquiry header with the freshest data
      if (res.inquiry) {
        setSelectedInquiry(res.inquiry);
      }
    } catch (err) {
      showError("Error", err.message || "Failed to log follow-up.");
    } finally {
      setSaving(false);
    }
  };

  const handleConvert = (inq) => {
    // Quick confirmation
    setDialogState({
      open: true,
      title: "Convert to Quotation",
      message: `Do you want to create a new quotation proposal for ${inq.name}? Location details and name will be pre-filled automatically.`,
      variant: "info",
      callback: () => {
        // Optimistically update the card's status to "Quoted" in local state
        // so when the user navigates back to Inquiries it shows the correct status.
        setList(prev => prev.map(i =>
          i.id === inq.id ? { ...i, status: "Quoted" } : i
        ));
        // Fire-and-forget backend update — navigation proceeds regardless
        inquiriesApi.updateStatus(inq.id, "Quoted").catch(err => {
          console.error("Failed to update inquiry status:", err);
          // Roll back the optimistic update on failure
          setList(prev => prev.map(i =>
            i.id === inq.id ? { ...i, status: inq.status } : i
          ));
          showError("Status Update Failed", "The inquiry status could not be updated to 'Quoted'. Please update it manually.");
        });
        onConvertToQuote({
          customerName: inq.name,
          customerAddress: inq.location,
        });
      }
    });
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case "New":
        return { bg: "rgba(59, 130, 246, 0.08)", color: "#3b82f6", border: "rgba(59, 130, 246, 0.2)" };
      case "Followed Up":
        return { bg: "rgba(245, 158, 11, 0.08)", color: "#f59e0b", border: "rgba(245, 158, 11, 0.2)" };
      case "Quoted":
        return { bg: "rgba(16, 185, 129, 0.08)", color: "#10b981", border: "rgba(16, 185, 129, 0.2)" };
      case "Closed":
        return { bg: "rgba(107, 114, 128, 0.08)", color: "#6b7280", border: "rgba(107, 114, 128, 0.2)" };
      default:
        return { bg: "rgba(107, 114, 128, 0.08)", color: "#6b7280", border: "rgba(107, 114, 128, 0.2)" };
    }
  };

  const showSuccess = (title, message) => {
    setDialogState({ open: true, title, message, variant: "info" });
  };

  const showError = (title, message) => {
    setDialogState({ open: true, title, message, variant: "danger" });
  };

  return (
    <div style={{ position: "relative", minHeight: "80vh" }}>
      {/* Page Header */}
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Inquiries & Follow-ups
            <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "rgba(46,125,82,0.1)", color: "var(--green)" }}>
              {list.length} Total
            </span>
          </div>
          <div className="page-sub">Maintain early inquiries, log follow-up logs, and seamlessly convert them to quotations</div>
        </div>
        <button 
          className="btn-primary" 
          style={{ width: "auto", padding: "10px 20px", display: "flex", alignItems: "center", gap: 8, background: "var(--green)" }} 
          onClick={() => { resetForm(); setShowForm(true); }}
        >
          <Plus size={16} /> Add Inquiry
        </button>
      </div>

      {/* Inquiry Form Modal / Card */}
      {showForm && (
        <div className="card" style={{ border: `1.5px solid ${editingInquiry ? "#e2e8f0" : "var(--green)"}`, animation: "slideDown 0.3s ease", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div className="card-title" style={{ color: editingInquiry ? "var(--text)" : "var(--green)", display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
              <Edit2 size={16} />
              {editingInquiry ? "Edit Inquiry Details" : "New Inquiry Registration"}
            </div>
            <button onClick={resetForm} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", display: "flex", padding: 4 }}>
              <X size={18} />
            </button>
          </div>
          
          <form onSubmit={handleSave} className="form-grid">
            <div className="field">
              <label>Customer Name *</label>
              <input 
                placeholder="Ramesh Bhai Patel" 
                value={form.name} 
                onChange={e => setForm({ ...form, name: e.target.value })} 
                required
              />
            </div>
            <div className="field">
              <label>Location / Site Address *</label>
              <input 
                placeholder="Sector 21, Gandhinagar, Gujarat" 
                value={form.location} 
                onChange={e => setForm({ ...form, location: e.target.value })} 
                required
              />
            </div>
            <div className="field span-full" style={{ marginBottom: 0 }}>
              <label>Remarks / Initial Inquiry Notes</label>
              <input 
                placeholder="Interested in a 5kW hybrid solar rooftop package..." 
                value={form.remark} 
                onChange={e => setForm({ ...form, remark: e.target.value })} 
              />
            </div>
            {editingInquiry && (
              <div className="field">
                <label>Status</label>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                  {["New", "Followed Up", "Quoted", "Closed"].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            )}
            
            <div className="span-full" style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <button 
                type="submit" 
                className="btn-primary" 
                style={{ width: "auto", padding: "10px 24px" }}
                disabled={saving}
              >
                {saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : (editingInquiry ? "Update Inquiry" : "Register Inquiry")}
              </button>
              <button 
                type="button" 
                className="btn-sm" 
                style={{ background: "#f3f4f6", border: "1px solid var(--border)", padding: "10px 20px", color: "var(--text)" }}
                onClick={resetForm}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 160, position: "relative", display: "flex", gap: 8 }}>
          <input
            placeholder="Search inquiries by name, location, or remark..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleSearch}
            style={{ 
              flex: 1, 
              padding: "10px 14px 10px 36px", 
              borderRadius: 12, 
              border: "1.5px solid var(--border)", 
              background: "var(--card)", 
              color: "var(--text)", 
              fontSize: 13 
            }}
          />
          <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
          <button className="btn-sm" onClick={fetchInquiries} style={{ padding: "10px 18px", display: "flex", alignItems: "center", gap: 4 }}>
            Search
          </button>
        </div>

        {/* Status Pills */}
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
          {[{ id: "", label: "All Status" }, { id: "New", label: "New" }, { id: "Followed Up", label: "Followed Up" }, { id: "Quoted", label: "Quoted" }, { id: "Closed", label: "Closed" }].map(s => (
            <button
              key={s.id}
              className={`btn-sm ${statusFilter === s.id ? "primary" : ""}`}
              onClick={() => setStatusFilter(s.id)}
              style={{ 
                padding: "6px 14px", 
                borderRadius: 10, 
                fontSize: 12,
                whiteSpace: "nowrap",
                background: statusFilter === s.id ? "var(--green)" : "white",
                color: statusFilter === s.id ? "white" : "var(--text)",
                border: statusFilter === s.id ? "1.5px solid var(--green)" : "1.5px solid var(--border)"
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid View */}
      {loading ? (
        <div style={{ padding: "80px 0", textAlign: "center", color: "var(--muted)" }}>
          <Loader2 size={40} className="animate-spin" style={{ margin: "0 auto 12px auto", color: "var(--green)" }} />
          <div>Retrieving inquiries...</div>
        </div>
      ) : list.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "4rem 2rem", color: "var(--muted)", borderRadius: 16, background: "rgba(255,255,255,0.7)", border: "1.5px dashed var(--border)" }}>
          <div style={{ display: "inline-flex", padding: 16, borderRadius: "50%", background: "rgba(46,125,82,0.06)", color: "var(--green)", marginBottom: 16 }}>
            <MessageSquare size={36} strokeWidth={1.5} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>No Inquiries Tracked</div>
          <div style={{ fontSize: 13, marginTop: 6, maxWidth: 360, margin: "6px auto 0 auto", lineHeight: 1.5 }}>
            You haven't logged any solar inquiry yet. Register an inquiry to start organizing follow-ups and converting sales!
          </div>
          <button 
            className="btn-primary" 
            style={{ width: "auto", padding: "8px 20px", margin: "20px auto 0 auto", background: "var(--green)" }}
            onClick={() => setShowForm(true)}
          >
            Add First Inquiry
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))", gap: 20 }}>
          {list.map(inq => {
            const statusStyle = getStatusStyle(inq.status);
            return (
              <div 
                key={inq.id}
                style={{
                  background: "white",
                  border: "1.5px solid var(--border)",
                  borderRadius: 16,
                  padding: 20,
                  boxShadow: "0 4px 20px rgba(0,0,0,0.02)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  transition: "transform 0.2s, box-shadow 0.2s",
                  cursor: "pointer",
                  position: "relative",
                  overflow: "hidden"
                }}
                className="hover-scale-card"
                onClick={() => handleOpenDetails(inq)}
              >
                {/* Status Indicator Bar */}
                <div style={{ 
                  position: "absolute", 
                  left: 0, 
                  top: 0, 
                  bottom: 0, 
                  width: 4, 
                  background: statusStyle.color 
                }} />

                <div>
                  {/* Top line Name + Status */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", paddingLeft: 4 }}>
                      {inq.name}
                    </div>
                    <span style={{ 
                      fontSize: 10, 
                      fontWeight: 700, 
                      padding: "2px 8px", 
                      borderRadius: 12, 
                      background: statusStyle.bg, 
                      color: statusStyle.color,
                      border: `1px solid ${statusStyle.border}`,
                      textTransform: "uppercase"
                    }}>
                      {inq.status}
                    </span>
                  </div>

                  {/* Location Pin */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: "var(--muted)", marginBottom: 12, paddingLeft: 4 }}>
                    <MapPin size={14} style={{ flexShrink: 0, marginTop: 1, color: "var(--green)" }} />
                    <span style={{ lineHeight: 1.4 }}>{inq.location}</span>
                  </div>

                  {/* Initial Remark/Note */}
                  {inq.remark && (
                    <div style={{ 
                      fontSize: 12, 
                      background: "#f9f9fb", 
                      border: "1px solid var(--border)", 
                      borderRadius: 10, 
                      padding: "10px 12px", 
                      marginBottom: 16,
                      color: "#4b5563",
                      lineHeight: 1.4,
                      fontStyle: "italic"
                    }}>
                      "{inq.remark}"
                    </div>
                  )}

                  {/* Last Follow-up Box */}
                  <div style={{ 
                    borderTop: "1px solid #f3f4f6", 
                    paddingTop: 12, 
                    marginBottom: 16,
                    paddingLeft: 4
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                      <Clock size={12} />
                      Last Follow-up
                    </div>
                    {inq.last_followup_date ? (
                      <div>
                        <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                          {inq.last_followup_notes}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
                          {new Date(inq.last_followup_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                        <AlertTriangle size={12} /> No follow-up logged yet
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Actions */}
                <div style={{ 
                  display: "flex", 
                  gap: 8,
                  flexWrap: "wrap",
                  borderTop: "1px solid #f3f4f6", 
                  paddingTop: 12,
                  marginTop: "auto"
                }}
                onClick={e => e.stopPropagation()} // Prevent card details open
                >
                  <button 
                    className="btn-primary"
                    style={{ 
                      flex: 1, 
                      fontSize: 12, 
                      padding: "8px 12px", 
                      borderRadius: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      background: inq.status === "Quoted" ? "rgba(16, 185, 129, 0.1)" : "var(--green)",
                      color: inq.status === "Quoted" ? "#10b981" : "white",
                      border: inq.status === "Quoted" ? "1px solid rgba(16, 185, 129, 0.2)" : "none",
                      cursor: inq.status === "Quoted" ? "default" : "pointer"
                    }}
                    onClick={() => inq.status !== "Quoted" && handleConvert(inq)}
                    disabled={inq.status === "Quoted"}
                  >
                    {inq.status === "Quoted" ? (
                      <>Quoted <CheckCircle2 size={13} /></>
                    ) : (
                      <>Go for Quotation <ArrowRight size={13} /></>
                    )}
                  </button>
                  <button 
                    className="btn-sm" 
                    style={{ padding: "8px 10px", borderRadius: 10, background: "#f3f4f6", border: "1px solid var(--border)", color: "var(--text)" }}
                    onClick={() => handleEdit(inq)}
                    title="Edit Inquiry"
                  >
                    <Edit2 size={13} />
                  </button>
                  <button 
                    className="btn-sm" 
                    style={{ padding: "8px 10px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fee2e2", color: "#ef4444" }}
                    onClick={() => handleDeleteClick(inq.id)}
                    title="Delete Inquiry"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Inquiry Detail Drawer Overlay & Element */}
      {selectedInquiry && (
        <div style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background: "rgba(15, 23, 42, 0.3)",
          backdropFilter: "blur(4px)",
          zIndex: 9999,
          display: "flex",
          justifyContent: "flex-end",
          animation: "fadeIn 0.25s ease"
        }}
        onClick={() => setSelectedInquiry(null)}
        >
          {/* Drawer Body */}
          <div style={{
            background: "white",
            width: "100%",
            maxWidth: 500,
            height: "100%",
            boxShadow: "-10px 0 40px rgba(0, 0, 0, 0.1)",
            display: "flex",
            flexDirection: "column",
            animation: "slideLeft 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
            overflowY: "auto"
          }}
          onClick={e => e.stopPropagation()} // Stop propagation to not close drawer
          >
            {/* Header */}
            <div style={{ padding: "env(safe-area-inset-top, 24px) 24px 24px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ 
                  fontSize: 10, 
                  fontWeight: 700, 
                  padding: "2px 8px", 
                  borderRadius: 10, 
                  background: getStatusStyle(selectedInquiry.status).bg, 
                  color: getStatusStyle(selectedInquiry.status).color,
                  border: `1px solid ${getStatusStyle(selectedInquiry.status).border}`,
                  textTransform: "uppercase",
                  display: "inline-block",
                  marginBottom: 6
                }}>
                  {selectedInquiry.status}
                </span>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{selectedInquiry.name}</div>
              </div>
              <button 
                onClick={() => setSelectedInquiry(null)} 
                style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", display: "flex", padding: 6, borderRadius: "50%", border: "1px solid var(--border)" }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Details Content */}
            <div style={{ padding: "24px 24px calc(env(safe-area-inset-bottom, 0px) + 24px) 24px", flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Location Pin */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--text)" }}>
                <MapPin size={16} style={{ color: "var(--green)", marginTop: 2, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>Location</div>
                  <div style={{ lineHeight: 1.4 }}>{selectedInquiry.location}</div>
                </div>
              </div>

              {/* Initial Remarks */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--text)" }}>
                <FileText size={16} style={{ color: "var(--green)", marginTop: 2, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>Initial Details / Remarks</div>
                  <div style={{ lineHeight: 1.4, color: "#475569" }}>{selectedInquiry.remark || "No initial details provided."}</div>
                </div>
              </div>

              <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 16 }}>
                {/* Convert Button */}
                {selectedInquiry.status !== "Quoted" && (
                  <button 
                    className="btn-primary" 
                    style={{ width: "100%", padding: "12px", background: "var(--green)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, fontWeight: 700 }}
                    onClick={() => handleConvert(selectedInquiry)}
                  >
                    Go for Quotation <ArrowRight size={15} />
                  </button>
                )}
              </div>

              {/* Follow-up Timeline */}
              <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 20, flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                    <Clock size={14} style={{ color: "var(--green)" }} />
                    Follow-up Logs ({followupHistory.length})
                  </div>
                  {!showFollowupForm && (
                    <button 
                      className="btn-sm" 
                      style={{ fontSize: 11, padding: "4px 10px", borderRadius: 8, display: "flex", alignItems: "center", gap: 4, background: "rgba(46,125,82,0.06)", color: "var(--green)", border: "1px solid rgba(46,125,82,0.15)" }}
                      onClick={() => setShowFollowupForm(true)}
                    >
                      <Plus size={12} /> Log Follow-up
                    </button>
                  )}
                </div>

                {/* Log new follow-up form */}
                {showFollowupForm && (
                  <form onSubmit={handleSaveFollowup} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>Record Follow-up Call/Meeting</div>
                    <textarea 
                      placeholder="Discussed pricing options. Client requested quotation summary. Advised on standard vs hybrid system specs."
                      value={followupNotes}
                      onChange={e => setFollowupNotes(e.target.value)}
                      required
                      style={{ 
                        width: "100%", 
                        height: 80, 
                        padding: "8px 12px", 
                        borderRadius: 8, 
                        border: followupNotes.trim() === "" && saving ? "1.5px solid #ef4444" : "1.5px solid var(--border)",
                        fontSize: 12, 
                        color: "var(--text)",
                        fontFamily: "inherit",
                        resize: "none",
                        marginBottom: followupNotes.length > 0 ? 10 : 4
                      }}
                    />
                    {followupNotes.trim() === "" && (
                      <div style={{ fontSize: 11, color: "#e05c0a", marginBottom: 10, display: "flex", alignItems: "center", gap: 4 }}>
                        <AlertTriangle size={11} /> Notes cannot be empty — describe what was discussed.
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button 
                        type="submit" 
                        className="btn-primary" 
                        style={{ width: "auto", padding: "6px 14px", fontSize: 12, borderRadius: 8, opacity: followupNotes.trim() === "" || saving ? 0.55 : 1 }}
                        disabled={saving || followupNotes.trim() === ""}
                      >
                        {saving ? "Saving..." : "Save Log"}
                      </button>
                      <button 
                        type="button" 
                        className="btn-sm" 
                        style={{ padding: "6px 12px", fontSize: 12, borderRadius: 8 }}
                        onClick={() => { setShowFollowupForm(false); setFollowupNotes(""); }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {/* Timeline display */}
                {loadingFollowups ? (
                  <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
                    <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px auto" }} />
                    Loading logs...
                  </div>
                ) : followupError ? (
                  <div style={{
                    textAlign: "center", padding: "24px 10px",
                    border: "1px dashed #fca5a5", borderRadius: 12,
                    background: "#fef2f2",
                  }}>
                    <div style={{ fontSize: 12, color: "#991b1b", fontWeight: 600, marginBottom: 8 }}>
                      Could not load follow-up history.
                    </div>
                    <button
                      className="btn-sm"
                      style={{ fontSize: 11, padding: "4px 12px", border: "1.5px solid #ef4444", color: "#ef4444", background: "none" }}
                      onClick={() => fetchFollowups(selectedInquiry.id)}
                    >
                      Retry
                    </button>
                  </div>
                ) : followupHistory.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "30px 10px", color: "var(--muted)", fontSize: 12, border: "1px dashed var(--border)", borderRadius: 12 }}>
                    No follow-ups recorded for this inquiry.
                    <div style={{ marginTop: 6 }}>
                      <button 
                        className="btn-sm" 
                        style={{ padding: "4px 10px", fontSize: 11, background: "none", border: "1.5px solid var(--green)", color: "var(--green)" }}
                        onClick={() => setShowFollowupForm(true)}
                      >
                        Create First Log
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ 
                    display: "flex", 
                    flexDirection: "column", 
                    gap: 16, 
                    borderLeft: "2px solid #e2e8f0", 
                    marginLeft: 6, 
                    paddingLeft: 16,
                    paddingTop: 4,
                    maxHeight: 300,
                    overflowY: "auto"
                  }}>
                    {followupHistory.map((item, idx) => (
                      <div key={item.id} style={{ position: "relative" }}>
                        {/* Timeline dot */}
                        <div style={{ 
                          position: "absolute", 
                          left: -23, 
                          top: 4, 
                          width: 12, 
                          height: 12, 
                          borderRadius: "50%", 
                          background: "var(--green)", 
                          border: "2px solid white",
                          boxShadow: "0 0 0 2px #e2e8f0"
                        }} />
                        
                        <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.4, wordBreak: "break-word" }}>
                          {item.notes}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
                          {new Date(item.followup_date).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation & Alert Modal */}
      <ConfirmDialog
        open={dialogState.open}
        title={dialogState.title}
        message={dialogState.message}
        variant={dialogState.variant}
        confirmText="Confirm"
        cancelText="Close"
        hideCancel={!dialogState.callback}
        onConfirm={() => {
          if (dialogState.callback) dialogState.callback();
          setDialogState(prev => ({ ...prev, open: false }));
        }}
        onCancel={() => setDialogState(prev => ({ ...prev, open: false }))}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={confirmDelete.open}
        title="Confirm Deletion"
        message="Are you sure you want to delete this inquiry? This action will permanently remove the inquiry and all of its follow-up log history."
        variant="danger"
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDelete({ open: false, id: null })}
      />
    </div>
  );
}
