import { useState, useEffect, useCallback, useRef } from "react";
import { dealers as dealersApi, uploads as uploadsApi } from "../utils/api";
import { Loader2, UserPlus, CheckCircle, XCircle, Paperclip, X, User, Phone, MapPin, Store, Download, Eye, FileText, Calendar } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import ErrorState from "./ErrorState";

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

export default function DealerRegistrationsAdmin() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("Pending");
  const [actionLoading, setActionLoading] = useState(null);
  const [selectedRegistration, setSelectedRegistration] = useState(null);
  const [errorDialog, setErrorDialog] = useState({ open: false, message: "" });
  const [actionConfirm, setActionConfirm] = useState(null); // { id, action, name }
  const [docViewerUrl, setDocViewerUrl] = useState(null); // blob URL for full-screen viewer
  const [fetchError, setFetchError] = useState(false);

  const fetchRegistrations = useCallback(async () => {
    setLoading(true);
    try {
      setFetchError(false);
      const res = await dealersApi.registrations(tab);
      setList(res.registrations || []);
    } catch (err) {
      console.error("Fetch registrations error:", err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { fetchRegistrations(); }, [fetchRegistrations]);

  useEffect(() => {
    if (selectedRegistration) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [selectedRegistration]);

  const handleAction = async (id, action) => {
    setActionLoading(id);
    // Close detail modal immediately to avoid showing stale data
    setSelectedRegistration(null);
    try {
      if (action === "approve") {
        await dealersApi.approve(id);
      } else {
        await dealersApi.reject(id);
      }
      fetchRegistrations();
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || `Failed to ${action} registration.` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDownloadAll = useCallback(async (documents) => {
    if (!documents || documents.length === 0) return;
    for (const doc of documents) {
      try {
        // downloadSecure triggers download with the correct filename automatically
        await uploadsApi.downloadSecure(doc.id, doc.original_name);
        // Wait 400ms between downloads to avoid browser popup blockers
        await new Promise(resolve => setTimeout(resolve, 400));
      } catch (err) {
        console.error("[Download] Failed for doc", doc.id, err.message);
      }
    }
  }, []);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Dealer Registrations</div>
        <div className="page-sub">Review and manage new dealer registration applications</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["Pending", "Approved", "Rejected"].map(s => (
          <button key={s} className={`btn-sm ${tab === s ? "primary" : ""}`} onClick={() => setTab(s)} style={{ padding: "6px 14px", borderRadius: 8 }}>
            {s}
          </button>
        ))}
      </div>

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
      ) : list.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
          <div style={{ marginBottom: 12 }}><UserPlus size={48} strokeWidth={1} /></div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>No {tab.toLowerCase()} registrations</div>
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
                <th>Submitted</th>
                <th>Documents</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map(reg => (
                <tr key={reg.id}>
                  <td style={{ fontWeight: 500 }}>{reg.name}</td>
                  <td>
                    <div>{reg.email}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{reg.mobile || "—"}</div>
                  </td>
                  <td>{reg.location || "—"}</td>
                  <td>{reg.company_name || "—"}</td>
                  <td style={{ color: "var(--muted)", fontSize: 12 }}>
                    {new Date(reg.submitted_at || reg.created_at).toLocaleDateString("en-IN")}
                  </td>
                  <td>
                    {reg.documents && reg.documents.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {reg.documents.map(doc => (
                          <button
                            key={doc.id}
                            onClick={async () => {
                              try {
                                const blobUrl = await uploadsApi.getSecureBlobUrl(doc.id);
                                const w = window.open(blobUrl, '_blank');
                                // Revoke after 90s — enough time for the browser to load the file
                                // Use a shorter window than before to reduce memory leakage
                                setTimeout(() => URL.revokeObjectURL(blobUrl), 90_000);
                                // Fallback: if window was blocked by popup blocker, revoke immediately
                                if (!w) URL.revokeObjectURL(blobUrl);
                              } catch(err) { console.error('Failed to open document:', err); }
                            }}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 11,
                              color: "var(--primary)",
                              textDecoration: "none",
                              fontWeight: 500,
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              padding: 0
                            }}
                          >
                            <Paperclip size={12} style={{ flexShrink: 0 }} />
                            <span>
                              {doc.doc_type === "aadhaar"
                                ? "Aadhaar Card"
                                : doc.doc_type === "pan"
                                ? "PAN Card"
                                : doc.doc_type === "passport_photo"
                                ? "Passport Photo"
                                : doc.original_name}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn-sm"
                        style={{ padding: "4px 10px", fontSize: 11, background: "var(--primary-light, #eff6ff)", color: "var(--primary, #3b82f6)", border: "none", display: "flex", alignItems: "center", gap: 3 }}
                        onClick={() => setSelectedRegistration(reg)}
                      >
                        <Eye size={12} /> View Details
                      </button>

                      {tab === "Pending" && (
                        <>
                          <button
                            className="btn-sm"
                            style={{ padding: "4px 10px", fontSize: 11, background: "var(--green)", color: "white", border: "none", display: "flex", alignItems: "center", gap: 3 }}
                            disabled={actionLoading === reg.id}
                            onClick={() => setActionConfirm({ id: reg.id, action: "approve", name: reg.name })}
                          >
                            {actionLoading === reg.id ? "..." : <><CheckCircle size={12} /> Approve</>}
                          </button>
                          <button
                            className="btn-sm danger"
                            style={{ padding: "4px 10px", fontSize: 11, display: "flex", alignItems: "center", gap: 3 }}
                            disabled={actionLoading === reg.id}
                            onClick={() => setActionConfirm({ id: reg.id, action: "reject", name: reg.name })}
                          >
                            <XCircle size={12} /> Reject
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
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
            padding: 16
          }}
          onClick={() => setSelectedRegistration(null)}
        >
          <div
            style={{
              background: "#ffffff",
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
                alignItems: "center",
                padding: "20px 24px",
                borderBottom: "1px solid rgba(0,0,0,0.06)",
                position: "sticky",
                top: 0,
                background: "#ffffff",
                zIndex: 10
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
                    Dealer Registration Details
                  </span>
                  <span className={`badge ${selectedRegistration.status === "Approved" ? "badge-green" : selectedRegistration.status === "Rejected" ? "badge-red" : "badge-sun"}`}>
                    {selectedRegistration.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
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

              {/* Row 2: Verification Documents Section */}
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
                      onClick={() => handleDownloadAll(selectedRegistration.documents)}
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
                                {doc.doc_type === "aadhaar"
                                  ? "Aadhaar Card"
                                  : doc.doc_type === "pan"
                                  ? "PAN Card"
                                  : doc.doc_type === "passport_photo"
                                  ? "Passport Photo"
                                  : doc.original_name}
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
                                  await uploadsApi.downloadSecure(doc.id, doc.original_name);
                                } catch (err) {
                                  console.error("Download failed:", err.message);
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
                justifyContent: "flex-end",
                gap: 12,
                padding: "16px 24px",
                borderTop: "1px solid rgba(0,0,0,0.06)",
                background: "#f8fafc",
                position: "sticky",
                bottom: 0,
                zIndex: 10,
                borderBottomLeftRadius: 20,
                borderBottomRightRadius: 20
              }}
            >
              <button
                className="btn-sm"
                style={{ background: "white", color: "var(--text)", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, padding: "8px 16px", cursor: "pointer" }}
                onClick={() => setSelectedRegistration(null)}
              >
                Close
              </button>

              {selectedRegistration.status === "Pending" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn-sm"
                    style={{ background: "var(--green)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                    disabled={actionLoading === selectedRegistration.id}
                    onClick={() => {
                      setActionConfirm({ id: selectedRegistration.id, action: "approve", name: selectedRegistration.name });
                      setSelectedRegistration(null);
                    }}
                  >
                    <CheckCircle size={14} /> Approve Request
                  </button>
                  <button
                    className="btn-sm danger"
                    style={{ borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                    disabled={actionLoading === selectedRegistration.id}
                    onClick={() => {
                      setActionConfirm({ id: selectedRegistration.id, action: "reject", name: selectedRegistration.name });
                      setSelectedRegistration(null);
                    }}
                  >
                    <XCircle size={14} /> Reject Request
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
      {actionConfirm && (
        <ConfirmDialog
          open={true}
          title={actionConfirm.action === "approve" ? "Approve Dealer?" : "Reject Dealer?"}
          message={`Are you sure you want to ${actionConfirm.action} the registration for "${actionConfirm.name}"?${actionConfirm.action === "approve" ? " A dealer account will be created and they will receive login access." : " They will be notified via email."}`}
          variant={actionConfirm.action === "approve" ? "info" : "danger"}
          confirmText={actionConfirm.action === "approve" ? "Approve" : "Reject"}
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
    </div>
  );
}
