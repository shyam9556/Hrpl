import { useState, useEffect, useCallback } from "react";
import { quotations as quotationsApi, uploads as uploadsApi } from "../utils/api";
import { fmt, generatePdfQuotation } from "../utils/helpers";
import { Loader2, Inbox, CheckCircle, XCircle, Paperclip, Download, Eye, X, User, Phone, MapPin, Zap, FileText, Camera, Truck, Package, Check, FolderOpen, ChevronLeft, ChevronRight, AlertTriangle, Copy } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import ErrorState from "./ErrorState";


const escapeHtml = (str) => {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

export default function DealerRequestsAdmin() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [filter, setFilter] = useState("");
  const [selectedQuotation, setSelectedQuotation] = useState(null);
  const [errorDialog, setErrorDialog] = useState({ open: false, message: "" });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [statusConfirm, setStatusConfirm] = useState(null); // { id, status, number }
  // Map.get/has is prototype-safe (no CWE-94 risk from server-supplied doc.id keys).
  const [blobUrls, setBlobUrls] = useState(() => new Map());
  const [fetchError, setFetchError] = useState(false);
  // UX-6: tracks whether quotation number was just copied in the modal
  const [copiedQuotationNumber, setCopiedQuotationNumber] = useState(false);

  // Coordinate editing state for manual tagging
  const [editingCoordsDocId, setEditingCoordsDocId] = useState(null);
  const [tempLat, setTempLat] = useState("");
  const [tempLng, setTempLng] = useState("");
  const [coordsSubmitting, setCoordsSubmitting] = useState(false);

  const handleSaveCoordinates = async (docId) => {
    if (!tempLat || !tempLng) return;
    setCoordsSubmitting(true);
    try {
      const res = await uploadsApi.updateCoordinates(docId, tempLat, tempLng);
      
      // Update selectedQuotation local documents array
      setSelectedQuotation(prev => {
        if (!prev) return prev;
        const updatedDocs = (prev.documents || []).map(d => {
          if (d.id === docId) {
            return { ...d, latitude: res.document.latitude, longitude: res.document.longitude };
          }
          return d;
        });
        return { ...prev, documents: updatedDocs };
      });

      // Also update the document in the local list of quotations
      setList(prevList => prevList.map(q => {
        if (q.id === selectedQuotation.id) {
          const updatedDocs = (q.documents || []).map(d => {
            if (d.id === docId) {
              return { ...d, latitude: res.document.latitude, longitude: res.document.longitude };
            }
            return d;
          });
          return { ...q, documents: updatedDocs };
        }
        return q;
      }));

      setEditingCoordsDocId(null);
      setTempLat("");
      setTempLng("");
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to save coordinates manually." });
    } finally {
      setCoordsSubmitting(false);
    }
  };

  const fetchQuotations = useCallback(async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      setFetchError(false);
      const params = { page, limit: 20 };
      if (filter) params.status = filter;
      const res = await quotationsApi.list(params);
      setList(res.quotations || []);
      if (res.pagination) setPagination(res.pagination);
    } catch (err) {
      console.error("Fetch quotations error:", err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => { setPage(1); }, [filter]);
  useEffect(() => { setLoading(true); fetchQuotations(); }, [filter, page]);

  // Load secure blob URLs for documents when modal opens.
  // Uses a local Set to track created blob URLs so the cleanup closure
  // always revokes the exact URLs created by THIS effect, not a stale snapshot.
  useEffect(() => {
    if (!selectedQuotation) {
      // Delay revocation by 1500ms so any tab the user opened with a blob URL
      // still renders for a moment before we revoke it.
      const revokeTimer = setTimeout(() => {
        setBlobUrls(prev => {
          prev.forEach(url => { try { URL.revokeObjectURL(url); } catch(e) {} });
          return new Map();
        });
      }, 1500);
      return () => clearTimeout(revokeTimer);
    }

    const docs = selectedQuotation.documents || [];
    let cancelled = false;
    const createdUrls = new Set();

    docs.forEach(async (doc) => {
      try {
        const url = await uploadsApi.getSecureBlobUrl(doc.id);
        if (!cancelled) {
          createdUrls.add(url);
          // Map.set() is prototype-safe — no CWE-94 risk.
          setBlobUrls(prev => new Map(prev).set(doc.id, url));
        } else {
          // Effect already cleaned up before this resolved — revoke immediately.
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        console.error('Failed to load blob URL for doc', doc.id, ':', err.message);
      }
    });

    return () => {
      cancelled = true;
      setTimeout(() => {
        createdUrls.forEach(url => { try { URL.revokeObjectURL(url); } catch(e) {} });
      }, 1500);
      setBlobUrls(new Map());
    };
  }, [selectedQuotation?.id]); // Only re-run when the selected quotation ID changes

  // BUG A4: Lock body scroll when modal is open
  useEffect(() => {
    if (selectedQuotation) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [selectedQuotation]);

  const handleStatus = async (id, status) => {
    setActionLoading(id);
    try {
      await quotationsApi.updateStatus(id, status);
      // Background refetch — don't show spinner to avoid jarring UX
      await fetchQuotations(false);
      // If modal is open for this quotation, update its status in-place
      setSelectedQuotation(prev =>
        prev && prev.id === id ? { ...prev, status } : prev
      );
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to update status." });
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateDelivery = async (id, status) => {
    setActionLoading(id);
    try {
      await quotationsApi.updateDeliveryStatus(id, status);
      await fetchQuotations(false);
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to update delivery status." });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDownloadBOM = (q) => {
    const systemKw = Number(q.system_kw);
    const panelCount = parseInt(q.panel_count, 10);
    const dcWire = systemKw * 10;
    const acWire = systemKw * 8;

    const bom = [
      { category: "Panel", item: `${q.panel_brand} ${q.panel_watt}W ${q.panel_type} Panel`, qty: panelCount, unit: "pcs" },
      { category: "Inverter", item: `${q.inverter_brand} ${q.inverter_kw}kW ${q.inverter_type} Inverter`, qty: 1, unit: "pcs" },
      { category: "Wire", item: "DC Solar Cable (4mm²)", qty: Math.round(dcWire), unit: "meters" },
      { category: "Wire", item: "AC Cable – Polycab (6mm²)", qty: Math.round(acWire), unit: "meters" },
      { category: "Structure", item: `Mounting Structure (GI) for ${systemKw.toFixed(2)} kW`, qty: systemKw.toFixed(2), unit: "kW" },
      { category: "Electrical", item: "ACDB Box (Standard IP65)", qty: 1, unit: "pcs" },
      { category: "Electrical", item: "DCDB Box (Standard IP65)", qty: 1, unit: "pcs" },
      { category: "Electrical", item: "MCB / Isolator / SPD", qty: 2, unit: "pcs" },
      { category: "Earthing", item: "Earthing Kit (Chemical)", qty: systemKw <= 5 ? 2 : 3, unit: "pcs" },
      { category: "Safety", item: "Lightning Arrester (LA)", qty: 1, unit: "pcs" },
      { category: "Monitoring", item: "Remote Monitoring Unit (RMU)", qty: 1, unit: "pcs" },
      ...(q.payment_mode === "Kit Purchase" ? [] : [{ category: "Service", item: "Installation & Commissioning", qty: 1, unit: "lot" }]),
    ];

    const quoteDate = q.created_at ? new Date(q.created_at).toLocaleDateString("en-IN") : new Date().toLocaleDateString("en-IN");
    const downloadDate = new Date().toLocaleDateString("en-IN");

    // Generate rich HTML for Excel with styling, paddings, and column widths
    const htmlContent = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8">
<!--[if gte mso 9]>
<xml>
 <x:ExcelWorkbook>
  <x:ExcelWorksheets>
   <x:ExcelWorksheet>
    <x:Name>BOM Details</x:Name>
    <x:WorksheetOptions>
     <x:DisplayGridlines/>
    </x:WorksheetOptions>
   </x:ExcelWorksheet>
  </x:ExcelWorksheets>
 </x:ExcelWorkbook>
</xml>
<![endif]-->
<style>
  table { border-collapse: collapse; }
  tr { height: 28px; }
  td { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 12px; padding: 4px 10px; vertical-align: middle; }
  
  .title-cell { 
    font-size: 18px; 
    font-weight: bold; 
    color: #ffffff; 
    background-color: #102A1C; 
    text-align: center; 
    height: 50px; 
  }
  
  .section-header { 
    font-size: 13px; 
    font-weight: bold; 
    color: #102A1C; 
    background-color: #E8F5EE; 
    border-bottom: 2px solid #2E7D52;
    height: 32px;
    padding-left: 10px;
  }
  
  .lbl { 
    font-weight: bold; 
    color: #555555; 
    background-color: #FAF9F6; 
    border: 1px solid #E2DDD5; 
  }
  
  .val { 
    color: #1A1A1A; 
    background-color: #ffffff; 
    border: 1px solid #E2DDD5; 
  }
  
  .phone-txt {
    mso-number-format: '\\@';
    text-align: left;
  }
  
  .th-cell { 
    font-size: 12px; 
    font-weight: bold; 
    color: #ffffff; 
    background-color: #2E7D52; 
    border: 1px solid #2E7D52;
    height: 32px; 
  }
  
  .td-cat { 
    font-weight: bold; 
    color: #2E7D52; 
    background-color: #F8FAF8; 
    border: 1px solid #E2E8F0; 
  }
  
  .td-desc { 
    color: #2D3748; 
    border: 1px solid #E2E8F0; 
  }
  
  .td-qty { 
    text-align: right; 
    font-weight: bold; 
    color: #1A1A1A; 
    border: 1px solid #E2E8F0; 
    padding-right: 12px;
  }
  
  .td-unit { 
    color: #6B7280; 
    border: 1px solid #E2E8F0; 
  }
  
  .footer-cell { 
    font-size: 10px; 
    color: #888888; 
    font-style: italic; 
    height: 35px;
  }
</style>
</head>
<body>
<table>
  <colgroup>
    <col width="160" />
    <col width="360" />
    <col width="120" />
    <col width="120" />
  </colgroup>
  
  <!-- Title Header -->
  <tr>
    <td colspan="4" class="title-cell">HIGHLIGHT RENEWABLE ENERGY &mdash; BILL OF MATERIALS (BOM)</td>
  </tr>
  <tr style="height: 12px;"><td colspan="4"></td></tr>
  
  <!-- Section: Quotation Info -->
  <tr>
    <td colspan="4" class="section-header">QUOTATION & SYSTEM DETAILS</td>
  </tr>
  <tr>
    <td class="lbl">Quotation No</td>
    <td class="val" style="font-weight: bold; text-align: left;">${escapeHtml(q.quotation_number)}</td>
    <td class="lbl">Date</td>
    <td class="val" style="text-align: left;">${quoteDate}</td>
  </tr>
  <tr>
    <td class="lbl">System Capacity</td>
    <td class="val" style="color: #2E7D52; font-weight: bold; text-align: left;">${Number(q.system_kw).toFixed(2)} kW</td>
    <td class="lbl">Payment Mode</td>
    <td class="val" style="text-align: left;">${escapeHtml(q.payment_mode || "Cash")}</td>
  </tr>
  <tr style="height: 12px;"><td colspan="4"></td></tr>
  
  <!-- Section: Customer Info -->
  <tr>
    <td colspan="4" class="section-header">CUSTOMER INFORMATION</td>
  </tr>
  <tr>
    <td class="lbl">Customer Name</td>
    <td colspan="3" class="val" style="font-weight: bold; text-align: left;">${escapeHtml(q.customer_name || "—")}</td>
  </tr>
  <tr>
    <td class="lbl">City / Region</td>
    <td class="val" style="text-align: left;">${escapeHtml(q.customer_city || "—")}</td>
    <td class="lbl">Phone / Mobile</td>
    <td class="val phone-txt" style="text-align: left;">${escapeHtml(q.customer_phone || "—")}</td>
  </tr>
  <tr>
    <td class="lbl">Email Address</td>
    <td colspan="3" class="val" style="text-align: left;">${escapeHtml(q.customer_email || "—")}</td>
  </tr>
  <tr>
    <td class="lbl">Delivery Address</td>
    <td colspan="3" class="val" style="text-align: left; font-weight: 500;">${escapeHtml(q.customer_address || "—")}</td>
  </tr>
  <tr style="height: 12px;"><td colspan="4"></td></tr>
  
  <!-- Section: Dealer Info -->
  <tr>
    <td colspan="4" class="section-header">DEALER INFORMATION</td>
  </tr>
  <tr>
    <td class="lbl">Dealer Name</td>
    <td class="val" style="text-align: left; font-weight: bold;">${escapeHtml(q.dealer_name || "—")}</td>
    <td class="lbl">Mobile / Phone</td>
    <td class="val phone-txt" style="text-align: left;">${escapeHtml(q.dealer_mobile || "—")}</td>
  </tr>
  <tr>
    <td class="lbl">Dealer Email</td>
    <td colspan="3" class="val" style="text-align: left;">${escapeHtml(q.dealer_email || "—")}</td>
  </tr>
  <tr style="height: 16px;"><td colspan="4"></td></tr>
  
  <!-- BOM Table Header -->
  <tr>
    <td class="th-cell" style="padding-left: 8px;">Category</td>
    <td class="th-cell">Item Description</td>
    <td class="th-cell" style="text-align: right; padding-right: 12px;">Quantity</td>
    <td class="th-cell" style="padding-left: 8px;">Unit</td>
  </tr>
  
  <!-- BOM Items -->
  ${bom.map(row => `
  <tr>
    <td class="td-cat" style="padding-left: 8px;">${escapeHtml(row.category)}</td>
    <td class="td-desc" style="padding-left: 8px;">${escapeHtml(row.item)}</td>
    <td class="td-qty">${row.qty}</td>
    <td class="td-unit" style="padding-left: 8px;">${row.unit}</td>
  </tr>
  `).join("")}
  
  <tr style="height: 16px;"><td colspan="4"></td></tr>
  <tr>
    <td colspan="4" class="footer-cell" style="text-align: center; border-top: 1px dashed #E2DDD5;">
      Generated automatically by Highlight Pro System on ${downloadDate}
    </td>
  </tr>
</table>
</body>
</html>
    `;

    const blob = new Blob([htmlContent], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `BOM_${q.quotation_number.replace(/\//g, "_")}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = async (q) => {
    try {
      const customerData = {
        id: q.quotation_number,
        date: new Date(q.created_at).toLocaleDateString("en-IN"),
        customerName: q.customer_name,
        customerCity: q.customer_city,
        // FIX BUG 7: Include customerAddress so PDF address field is populated correctly.
        // Without this, generatePdfQuotation falls back to city for the address line.
        customerAddress: q.customer_address,
        customerPhone: q.customer_phone,
        structureHeight: q.structure_height,
        // Pass paymentMode so Kit PDFs correctly suppress the Subsidy row (GAP-3)
        paymentMode: q.payment_mode,
      };
      const quoteData = {
        panelCount: q.panel_count,
        subtotal: Number(q.subtotal),
        pricePerKw: Number(q.price_per_kw),
        gst: Number(q.gst_amount),
        total: Number(q.total),
        subsidy: Number(q.subsidy_amount),
        effectivePrice: Number(q.effective_price),
      };
      const panelData = {
        brand: q.panel_brand,
        watt: q.panel_watt,
        type: q.panel_type,
      };
      const inverterData = {
        brand: q.inverter_brand,
        kw: q.inverter_kw,
        type: q.inverter_type,
      };

      await generatePdfQuotation(customerData, quoteData, panelData, inverterData, { download: true });
    } catch (err) {
      console.error("PDF generation failed:", err);
      setErrorDialog({ open: true, message: err.message || "Could not generate PDF quotation. Please try again." });
    }
  };


  return (
    <div>
      <div className="page-header">
        <div className="page-title">Quotations</div>
        <div className="page-sub">Review and manage dealer quotation requests</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["", "Pending", "Approved", "Rejected"].map(s => (
          <button key={s} className={`btn-sm ${filter === s ? "primary" : ""}`} onClick={() => setFilter(s)} style={{ padding: "6px 14px", borderRadius: 8 }}>
            {s || "All"}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
          <div style={{ marginBottom: 8 }}><Loader2 size={32} className="animate-spin" /></div>Loading...
        </div>
      ) : fetchError ? (
        <ErrorState
          title="Failed to load quotations."
          message="Could not connect to the server. Please check your connection."
          onRetry={() => { setFetchError(false); fetchQuotations(true); }}
          compact
        />
      ) : list.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
          <div style={{ marginBottom: 12 }}><Inbox size={48} strokeWidth={1} /></div>
          {/* UX-4: Contextual empty state — tells admin WHICH filter returned nothing */}
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {filter ? `No ${filter} quotations found` : "No quotations found"}
          </div>
          {filter && (
            <div style={{ fontSize: 13, marginTop: 4 }}>
              Try switching to "All" to see all quotations.
            </div>
          )}
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1000px" }}>
            <thead>
              <tr>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>Quotation #</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>Date</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>Dealer</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>Customer</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>Capacity</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>Total Cost</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>Status</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>Delivery</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "center" }}>Geo-Tags</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map(q => (
                <tr key={q.id} style={{ borderBottom: "1px solid rgba(0,0,0,0.04)", transition: "background 0.2s" }} className="table-row-hover">
                  <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
                    <div style={{ fontWeight: 600, fontFamily: "var(--mono)", color: "var(--text)", fontSize: "13px" }}>{q.quotation_number}</div>
                    <span style={{ 
                      display: "inline-block",
                      marginTop: 4,
                      fontSize: 9, 
                      fontWeight: 700, 
                      padding: "1px 5px", 
                      borderRadius: 4,
                      background: q.payment_mode === 'Kit Purchase' ? "rgba(59,130,246,0.08)" : "rgba(46,125,82,0.08)", 
                      color: q.payment_mode === 'Kit Purchase' ? "#3b82f6" : "var(--green)", 
                      border: `1px solid ${q.payment_mode === 'Kit Purchase' ? "rgba(59,130,246,0.15)" : "rgba(46,125,82,0.15)"}` 
                    }}>
                      {q.payment_mode === 'Kit Purchase' ? "Kit" : "Commission"}
                    </span>
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", color: "var(--muted)", fontSize: "13px" }}>
                    {new Date(q.created_at).toLocaleDateString("en-IN")}
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", fontWeight: 600, color: "var(--text)", fontSize: "13px" }}>
                    {q.dealer_name || "—"}
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", fontWeight: 500, color: "var(--text)", fontSize: "13px" }}>
                    {q.customer_name || "—"}
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", color: "var(--text)", fontSize: "13px" }}>
                    {Number(q.system_kw).toFixed(2)} kW
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", fontFamily: "var(--mono)", color: "var(--green)", fontWeight: 700, fontSize: "14px" }}>
                    {fmt(q.total)}
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
                    <span className={`badge ${q.status === "Approved" ? "badge-green" : q.status === "Rejected" ? "badge-red" : "badge-sun"}`} style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px" }}>
                      {q.status}
                    </span>
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
                    {q.status === "Approved" ? (
                      <div style={{ display: "flex", alignItems: "center" }}>
                        {q.delivery_status === "Pending" && (
                          <button
                            className="btn-sm"
                            style={{ 
                              padding: "4px 12px", 
                              fontSize: "11px", 
                              fontWeight: 600, 
                              background: "rgba(217, 119, 6, 0.06)", 
                              color: "#b45309", 
                              border: "1px solid rgba(217, 119, 6, 0.18)",
                              borderRadius: "9999px",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              transition: "all 0.2s ease"
                            }}
                            onClick={() => handleUpdateDelivery(q.id, "Dispatched")}
                            disabled={actionLoading === q.id}
                          >
                            <Truck size={12} strokeWidth={2.5} /> Ship
                          </button>
                        )}
                        {q.delivery_status === "Dispatched" && (
                          <button
                            className="btn-sm"
                            style={{ 
                              padding: "4px 12px", 
                              fontSize: "11px", 
                              fontWeight: 600, 
                              background: "rgba(37, 99, 235, 0.06)", 
                              color: "#1d4ed8", 
                              border: "1px solid rgba(37, 99, 235, 0.18)",
                              borderRadius: "9999px",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              transition: "all 0.2s ease"
                            }}
                            onClick={() => handleUpdateDelivery(q.id, "Delivered")}
                            disabled={actionLoading === q.id}
                          >
                            <Package size={12} strokeWidth={2.5} /> Deliver
                          </button>
                        )}
                        {q.delivery_status === "Delivered" && (
                          <span style={{ 
                            fontSize: "11px", 
                            fontWeight: 600, 
                            padding: "4px 12px", 
                            borderRadius: "9999px", 
                            background: "rgba(16, 185, 129, 0.08)", 
                            color: "#047857", 
                            border: "1px solid rgba(16, 185, 129, 0.18)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6
                          }}>
                            <Check size={11} strokeWidth={3} /> Delivered
                          </span>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: "12px" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", textAlign: "center" }}>
                    {q.status === "Approved" ? (
                      (() => {
                        const geotags = q.documents?.filter(d => d.doc_type?.startsWith("geotag_")) || [];
                        const count = geotags.length;
                        
                        let bg = "rgba(107, 114, 128, 0.08)";
                        let color = "var(--muted)";
                        let border = "1px solid rgba(107, 114, 128, 0.15)";
                        let text = "0/3 Uploaded";

                        if (count === 3) {
                          bg = "rgba(16, 185, 129, 0.08)";
                          color = "#10b981";
                          border = "1px solid rgba(16, 185, 129, 0.2)";
                          text = "Complete (3/3)";
                        } else if (count > 0) {
                          bg = "rgba(249, 115, 22, 0.08)";
                          color = "#f97316";
                          border = "1px solid rgba(249, 115, 22, 0.2)";
                          text = `${count}/3`;
                        }

                        return (
                          <span 
                            style={{ 
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "4px 8px",
                              borderRadius: 6,
                              background: bg,
                              color: color,
                              border: border
                            }}
                          >
                            <Camera size={11} /> {text}
                          </span>
                        );
                      })()
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: "12px" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
                      <button
                        className="btn-sm"
                        style={{ 
                          padding: "6px", 
                          borderRadius: 8, 
                          background: "rgba(59, 130, 246, 0.08)", 
                          color: "var(--primary, #3b82f6)", 
                          border: "1px solid rgba(59, 130, 246, 0.15)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          transition: "all 0.2s"
                        }}
                        onClick={() => setSelectedQuotation(q)}
                        title="View Details"
                      >
                        <Eye size={13} />
                      </button>

                      {q.status === "Pending" && (
                        <>
                          <button
                            className="btn-sm"
                            style={{ 
                              padding: "6px", 
                              borderRadius: 8, 
                              background: "rgba(46, 125, 82, 0.08)", 
                              color: "var(--green)", 
                              border: "1px solid rgba(46, 125, 82, 0.15)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                              transition: "all 0.2s"
                            }}
                            disabled={actionLoading === q.id}
                            onClick={() => setStatusConfirm({ id: q.id, status: "Approved", number: q.quotation_number })}
                            title="Approve"
                          >
                            <CheckCircle size={13} />
                          </button>
                          <button
                            className="btn-sm danger"
                            style={{ 
                              padding: "6px", 
                              borderRadius: 8, 
                              display: "flex", 
                              alignItems: "center", 
                              justifyContent: "center",
                              cursor: "pointer",
                              transition: "all 0.2s"
                            }}
                            disabled={actionLoading === q.id}
                            onClick={() => setStatusConfirm({ id: q.id, status: "Rejected", number: q.quotation_number })}
                            title="Reject"
                          >
                            <XCircle size={13} />
                          </button>
                        </>
                      )}
                      {q.status === "Approved" && (
                        <>
                          {/* GAP-5: PDF download for admin — all approved quotations regardless of mode */}
                          <button
                            className="btn-sm"
                            style={{ 
                              padding: "6px", 
                              borderRadius: 8, 
                              background: "rgba(107, 114, 128, 0.06)", 
                              color: "var(--muted)", 
                              border: "1px solid rgba(107, 114, 128, 0.12)",
                              display: "flex", 
                              alignItems: "center", 
                              justifyContent: "center",
                              cursor: "pointer",
                              transition: "all 0.2s"
                            }}
                            onClick={() => handleDownloadPdf(q)}
                            title="Download PDF Quotation"
                            onMouseOver={e => { e.currentTarget.style.background = "#334155"; e.currentTarget.style.color = "white"; }}
                            onMouseOut={e => { e.currentTarget.style.background = "rgba(107, 114, 128, 0.06)"; e.currentTarget.style.color = "var(--muted)"; }}
                          >
                            <FileText size={13} />
                          </button>
                          <button
                            className="btn-sm"
                            style={{ 
                              padding: "6px", 
                              borderRadius: 8, 
                              background: "rgba(46, 125, 82, 0.08)", 
                              color: "var(--green)", 
                              border: "1px solid rgba(46, 125, 82, 0.15)",
                              display: "flex", 
                              alignItems: "center", 
                              justifyContent: "center",
                              cursor: "pointer",
                              transition: "all 0.2s"
                            }}
                            onClick={() => handleDownloadBOM(q)}
                            title="Download BOM"
                          >
                            <Download size={13} />
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

          {/* Pagination Controls */}
          {pagination.totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--border, #e2e8f0)" }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, pagination.total)} of {pagination.total}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn-sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  style={{ padding: "4px 12px", fontSize: 12, borderRadius: 8, display: "flex", alignItems: "center", gap: 4 }}
                >
                  <ChevronLeft size={14} /> Prev
                </button>
                <span style={{ display: "flex", alignItems: "center", fontSize: 12, color: "var(--text)", fontWeight: 600, padding: "0 8px" }}>
                  {page} / {pagination.totalPages}
                </span>
                <button
                  className="btn-sm"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage(p => p + 1)}
                  style={{ padding: "4px 12px", fontSize: 12, borderRadius: 8, display: "flex", alignItems: "center", gap: 4 }}
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Premium Detailed Quotation Box/Catalog Modal */}
      {selectedQuotation && (
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
          onClick={() => setSelectedQuotation(null)}
        >
          <div
            style={{
              background: "var(--card-bg, #ffffff)",
              borderRadius: 20,
              width: "100%",
              maxWidth: 700,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              border: "1px solid rgba(0,0,0,0.06)",
              animation: "modalFadeIn 0.2s ease-out",
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
                background: "var(--card-bg, #ffffff)",
                zIndex: 10
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* UX-6: Click quotation number to copy it to clipboard */}
                  <span
                    onClick={() => {
                      navigator.clipboard.writeText(selectedQuotation.quotation_number).then(() => {
                        setCopiedQuotationNumber(true);
                        setTimeout(() => setCopiedQuotationNumber(false), 2000);
                      }).catch(() => {});
                    }}
                    title="Click to copy quotation number"
                    style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--mono)", color: "var(--text)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, userSelect: "none" }}
                  >
                    {selectedQuotation.quotation_number}
                    {copiedQuotationNumber
                      ? <Check size={14} style={{ color: "var(--green)" }} />
                      : <Copy size={12} style={{ color: "var(--muted)", opacity: 0.6 }} />}
                  </span>
                  <span className={`badge ${selectedQuotation.status === "Approved" ? "badge-green" : selectedQuotation.status === "Rejected" ? "badge-red" : "badge-sun"}`}>
                    {selectedQuotation.status}
                  </span>
                  <span style={{ 
                    fontSize: 11, 
                    fontWeight: 600, 
                    padding: "2px 8px", 
                    borderRadius: 12, 
                    background: selectedQuotation.payment_mode === "Kit Purchase" ? "rgba(59,130,246,0.1)" : "rgba(46,125,82,0.1)", 
                    color: selectedQuotation.payment_mode === "Kit Purchase" ? "#3b82f6" : "var(--green)", 
                    border: `1px solid ${selectedQuotation.payment_mode === "Kit Purchase" ? "rgba(59,130,246,0.2)" : "rgba(46,125,82,0.2)"}` 
                  }}>
                    {selectedQuotation.payment_mode === "Kit Purchase" ? "Kit Purchase Mode" : "Commission Mode"}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  Submitted on {new Date(selectedQuotation.created_at).toLocaleDateString("en-IN")}
                </div>
              </div>
              <button
                onClick={() => setSelectedQuotation(null)}
                style={{
                  background: "var(--light, #f1f5f9)",
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
              {/* Row 1: Customer & Dealer Details */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginBottom: 24 }}>
                {/* Customer info */}
                <div style={{ background: "var(--light, #f8fafc)", padding: 16, borderRadius: 16, border: "1px solid rgba(0,0,0,0.03)" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Customer Details
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                      <User size={14} style={{ color: "var(--primary)" }} />
                      <strong>{selectedQuotation.customer_name || "—"}</strong>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text)" }}>
                      <Phone size={14} style={{ color: "var(--primary)" }} />
                      <span>{selectedQuotation.customer_phone || "—"}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text)" }}>
                      <MapPin size={14} style={{ color: "var(--primary)" }} />
                      <span>{selectedQuotation.customer_city || "—"}</span>
                    </div>
                  </div>
                </div>

                {/* Dealer info */}
                <div style={{ background: "var(--light, #f8fafc)", padding: 16, borderRadius: 16, border: "1px solid rgba(0,0,0,0.03)" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Dealer Information
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                      <strong>{selectedQuotation.dealer_name || "—"}</strong>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>
                      Email: {selectedQuotation.dealer_email || "—"}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>
                      Phone: {selectedQuotation.dealer_mobile || "—"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 2: Technical Configuration */}
              <div style={{ background: "var(--light, #f8fafc)", padding: 16, borderRadius: 16, border: "1px solid rgba(0,0,0,0.03)", marginBottom: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {selectedQuotation.payment_mode === "Kit Purchase" ? "BOM / Kit Specifications" : "System Specifications"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>Capacity</div>
                    <div style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                      <Zap size={14} style={{ color: "var(--sun)" }} /> {Number(selectedQuotation.system_kw).toFixed(2)} kW
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>Solar Panels</div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
                      {selectedQuotation.panel_brand} {selectedQuotation.panel_watt}W ({selectedQuotation.panel_count} pcs)
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>Inverter</div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
                      {selectedQuotation.inverter_brand} {Number(selectedQuotation.inverter_kw).toFixed(2)}kW
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {selectedQuotation.payment_mode === "Kit Purchase" ? "Selected Kit" : "Structure & Height"}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
                      {selectedQuotation.structure_height || "—"}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {selectedQuotation.payment_mode === "Kit Purchase" ? "Uploaded Site Photo" : "Uploaded Customer Documents"}
                </div>
                {(() => {
                  const customerDocs = (selectedQuotation.documents || []).filter(doc => doc.doc_type !== "other" && !doc.doc_type.startsWith("geotag_"));
                  return customerDocs.length > 0 ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                      {customerDocs.map(doc => {
                        const fileUrl = blobUrls.get(doc.id) ?? null;
                        return (
                          <div
                            key={doc.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              padding: 12,
                              borderRadius: 12,
                              background: "var(--light, #f8fafc)",
                              border: "1px solid rgba(0,0,0,0.06)",
                              transition: "all 0.2s"
                            }}
                            className="doc-modal-card"
                          >
                            {/* Left Part: Clickable to View */}
                            <div
                              onClick={() => { if (fileUrl) window.open(fileUrl, "_blank"); }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                                flex: 1,
                                cursor: "pointer",
                                minWidth: 0
                              }}
                            >
                              <div
                                style={{
                                  background: "var(--primary-light)",
                                  color: "var(--primary)",
                                  width: 36,
                                  height: 36,
                                  borderRadius: 8,
                                  display: "flex",
                                  justifyContent: "center",
                                  alignItems: "center",
                                  flexShrink: 0
                                }}
                              >
                                <FileText size={18} />
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {doc.doc_type === "aadhaar"
                                    ? "Aadhaar Card"
                                    : doc.doc_type === "pan"
                                    ? "PAN Card"
                                    : doc.doc_type === "passbook"
                                    ? "Bank Passbook"
                                    : doc.doc_type === "site_photo"
                                    ? (selectedQuotation?.payment_mode === "Kit Purchase" ? "Site / Roof Photo" : "Latest Light Bill")
                                    : doc.doc_type === "vera_bill"
                                    ? "Vera Bill"
                                    : doc.doc_type === "house_photo_1"
                                    ? "House Photo 1"
                                    : doc.doc_type === "house_photo_2"
                                    ? "House Photo 2"
                                    : doc.doc_type === "house_photo_3"
                                    ? "House Photo 3"
                                    : doc.original_name}
                                </div>
                                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                                  {(doc.file_size_bytes / (1024 * 1024)).toFixed(2)} MB · Tap to view
                                </div>
                              </div>
                            </div>

                            {/* Right Part: Download Button */}
                            <button
                              style={{
                                color: "var(--primary)",
                                background: "var(--primary-light)",
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
                              title="Download Document"
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                try {
                                  await uploadsApi.downloadSecure(doc.id, doc.original_name);
                                } catch(err) { console.error('Download failed:', err); }
                              }}
                            >
                              <Download size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ padding: "16px 20px", background: "var(--light, #f8fafc)", borderRadius: 12, border: "1px dashed rgba(0,0,0,0.08)", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                      {selectedQuotation.payment_mode === "Kit Purchase" 
                        ? "No site photo uploaded for this kit order (optional)." 
                        : "No verification documents uploaded for this quotation."}
                    </div>
                  );
                })()}
              </div>

              {selectedQuotation.status === "Approved" && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 6 }}>
                    <FolderOpen size={14} /> Complete Project File (Geo-Tagged Photos)
                  </div>
                  {(() => {
                    const geotagDocs = (selectedQuotation.documents || []).filter(doc => doc.doc_type.startsWith("geotag_"));
                    return geotagDocs.length > 0 ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                        {[
                          { key: "geotag_1", label: "1. Site / Inverter Photo" },
                          { key: "geotag_2", label: "2. Solar Panels Photo" },
                          { key: "geotag_3", label: "3. ACDB / Net Meter Photo" }
                        ].map(slot => {
                          const doc = geotagDocs.find(d => d.doc_type === slot.key);
                          const fileUrl = doc ? (blobUrls.get(doc.id) ?? null) : null;
                          
                          return (
                            <div
                              key={slot.key}
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                padding: 12,
                                borderRadius: 12,
                                background: "var(--light, #f8fafc)",
                                border: "1px solid rgba(0,0,0,0.06)",
                                position: "relative"
                              }}
                            >
                              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
                                {slot.label}
                              </div>
                              {doc ? (
                                <>
                                  {doc.mime_type.startsWith("image/") ? (
                                    fileUrl ? (
                                      <img 
                                        src={fileUrl} 
                                        alt={slot.label} 
                                        style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)", marginBottom: 8, cursor: "pointer" }}
                                        onClick={() => window.open(fileUrl, "_blank")}
                                      />
                                    ) : (
                                      // Shimmer skeleton while blob URL is being fetched — matches dealer-side UX.
                                      <div style={{
                                        width: "100%",
                                        height: 90,
                                        borderRadius: 8,
                                        marginBottom: 8,
                                        background: "linear-gradient(90deg, rgba(0,0,0,0.04) 25%, rgba(0,0,0,0.08) 50%, rgba(0,0,0,0.04) 75%)",
                                        backgroundSize: "200% 100%",
                                        animation: "shimmer 1.4s infinite",
                                        display: "flex",
                                        justifyContent: "center",
                                        alignItems: "center"
                                      }}>
                                        <Loader2 size={18} className="animate-spin" style={{ color: "var(--muted)" }} />
                                      </div>
                                    )
                                  ) : (
                                    <div style={{ width: "100%", height: 90, background: "rgba(0,0,0,0.03)", borderRadius: 8, display: "flex", justifyContent: "center", alignItems: "center", marginBottom: 8 }}>
                                      <FileText size={28} style={{ color: "var(--muted)" }} />
                                    </div>
                                  )}
                                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                    <span style={{ fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                                      {doc.original_name}
                                    </span>
                                    <button
                                      style={{
                                        color: "var(--primary)",
                                        background: "var(--primary-light)",
                                        width: 24,
                                        height: 24,
                                        borderRadius: 6,
                                        display: "flex",
                                        justifyContent: "center",
                                        alignItems: "center",
                                        cursor: "pointer",
                                        flexShrink: 0,
                                        border: "none"
                                      }}
                                      title="Download"
                                      onClick={async (e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        try {
                                          await uploadsApi.downloadSecure(doc.id, doc.original_name);
                                        } catch(err) { console.error('Download failed:', err); }
                                      }}
                                    >
                                      <Download size={12} />
                                    </button>
                                  </div>

                                  {doc.latitude && doc.longitude ? (
                                    <>
                                      {editingCoordsDocId === doc.id ? (
                                        <div style={{
                                          marginTop: 10,
                                          padding: 10,
                                          borderRadius: 10,
                                          background: "rgba(0,0,0,0.02)",
                                          border: "1px solid rgba(0,0,0,0.08)",
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: 6
                                        }}>
                                          <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--text)" }}>
                                            Edit Coordinates Manually
                                          </div>
                                          <div style={{ display: "flex", gap: 6 }}>
                                            <input
                                              type="number"
                                              placeholder="Latitude"
                                              value={tempLat}
                                              onChange={e => setTempLat(e.target.value)}
                                              step="any"
                                              style={{
                                                flex: 1,
                                                fontSize: "10px",
                                                padding: "4px 6px",
                                                borderRadius: 6,
                                                border: "1px solid var(--border)",
                                                background: "white",
                                                minWidth: 0
                                              }}
                                            />
                                            <input
                                              type="number"
                                              placeholder="Longitude"
                                              value={tempLng}
                                              onChange={e => setTempLng(e.target.value)}
                                              step="any"
                                              style={{
                                                flex: 1,
                                                fontSize: "10px",
                                                padding: "4px 6px",
                                                borderRadius: 6,
                                                border: "1px solid var(--border)",
                                                background: "white",
                                                minWidth: 0
                                              }}
                                            />
                                          </div>
                                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 2 }}>
                                            <button
                                              onClick={() => setEditingCoordsDocId(null)}
                                              className="btn-sm"
                                              style={{
                                                padding: "3px 6px",
                                                fontSize: "9px",
                                                background: "white",
                                                border: "1.5px solid var(--border)",
                                                borderRadius: 6,
                                                cursor: "pointer"
                                              }}
                                            >
                                              Cancel
                                            </button>
                                            <button
                                              onClick={() => handleSaveCoordinates(doc.id)}
                                              disabled={coordsSubmitting || !tempLat || !tempLng}
                                              className="btn-sm"
                                              style={{
                                                padding: "3px 8px",
                                                fontSize: "9px",
                                                background: "var(--green)",
                                                color: "white",
                                                border: "none",
                                                borderRadius: 6,
                                                cursor: "pointer",
                                                fontWeight: 700,
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 2
                                              }}
                                            >
                                              {coordsSubmitting ? (
                                                <Loader2 size={8} className="animate-spin" />
                                              ) : (
                                                <Check size={8} strokeWidth={3} />
                                              )}
                                              Save
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div style={{ marginTop: 10, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(0,0,0,0.06)" }}>
                                          <iframe
                                            title={`${slot.label} GPS Map`}
                                            src={`https://maps.google.com/maps?q=${doc.latitude},${doc.longitude}&t=k&z=18&output=embed`}
                                            width="100%"
                                            height="110"
                                            style={{ border: 0, display: "block" }}
                                            allowFullScreen=""
                                            loading="lazy"
                                          ></iframe>
                                          <div style={{ padding: "4px 8px", background: "white", fontSize: "9px", color: "var(--muted)", borderTop: "1px solid rgba(0,0,0,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "var(--mono)" }}>
                                            <span>Lat: {Number(doc.latitude).toFixed(6)}</span>
                                            <span>Lng: {Number(doc.longitude).toFixed(6)}</span>
                                          </div>
                                          <button
                                            onClick={() => {
                                              setEditingCoordsDocId(doc.id);
                                              setTempLat(doc.latitude || "");
                                              setTempLng(doc.longitude || "");
                                            }}
                                            style={{
                                              width: "100%",
                                              background: "#f8fafc",
                                              border: "none",
                                              borderTop: "1px solid rgba(0,0,0,0.04)",
                                              color: "var(--primary)",
                                              fontSize: "9px",
                                              fontWeight: 700,
                                              cursor: "pointer",
                                              padding: "5px 0",
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              gap: 3,
                                              transition: "background 0.2s"
                                            }}
                                            onMouseOver={e => { e.currentTarget.style.background = "#eff6ff"; }}
                                            onMouseOut={e => { e.currentTarget.style.background = "#f8fafc"; }}
                                          >
                                            <MapPin size={9} /> Edit Coordinates Manually
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      {editingCoordsDocId === doc.id ? (
                                        <div style={{
                                          marginTop: 10,
                                          padding: 10,
                                          borderRadius: 10,
                                          background: "rgba(0,0,0,0.02)",
                                          border: "1px solid rgba(0,0,0,0.08)",
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: 6
                                        }}>
                                          <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--text)" }}>
                                            Manual Coordinates Entry
                                          </div>
                                          <div style={{ display: "flex", gap: 6 }}>
                                            <input
                                              type="number"
                                              placeholder="Latitude"
                                              value={tempLat}
                                              onChange={e => setTempLat(e.target.value)}
                                              step="any"
                                              style={{
                                                flex: 1,
                                                fontSize: "10px",
                                                padding: "4px 6px",
                                                borderRadius: 6,
                                                border: "1px solid var(--border)",
                                                background: "white",
                                                minWidth: 0
                                              }}
                                            />
                                            <input
                                              type="number"
                                              placeholder="Longitude"
                                              value={tempLng}
                                              onChange={e => setTempLng(e.target.value)}
                                              step="any"
                                              style={{
                                                flex: 1,
                                                fontSize: "10px",
                                                padding: "4px 6px",
                                                borderRadius: 6,
                                                border: "1px solid var(--border)",
                                                background: "white",
                                                minWidth: 0
                                              }}
                                            />
                                          </div>
                                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 2 }}>
                                            <button
                                              onClick={() => setEditingCoordsDocId(null)}
                                              className="btn-sm"
                                              style={{
                                                padding: "3px 6px",
                                                fontSize: "9px",
                                                background: "white",
                                                border: "1.5px solid var(--border)",
                                                borderRadius: 6,
                                                cursor: "pointer"
                                              }}
                                            >
                                              Cancel
                                            </button>
                                            <button
                                              onClick={() => handleSaveCoordinates(doc.id)}
                                              disabled={coordsSubmitting || !tempLat || !tempLng}
                                              className="btn-sm"
                                              style={{
                                                padding: "3px 8px",
                                                fontSize: "9px",
                                                background: "var(--green)",
                                                color: "white",
                                                border: "none",
                                                borderRadius: 6,
                                                cursor: "pointer",
                                                fontWeight: 700,
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 2
                                              }}
                                            >
                                              {coordsSubmitting ? (
                                                <Loader2 size={8} className="animate-spin" />
                                              ) : (
                                                <Check size={8} strokeWidth={3} />
                                              )}
                                              Save
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div style={{
                                          marginTop: 10,
                                          padding: "10px 8px",
                                          borderRadius: 10,
                                          background: "rgba(249, 115, 22, 0.03)",
                                          border: "1.5px dashed rgba(249, 115, 22, 0.18)",
                                          textAlign: "center"
                                        }}>
                                          <div style={{ fontSize: "10px", fontWeight: 700, color: "#e06c1b", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: 2 }}>
                                            <MapPin size={10} /> No GPS Tag Embedded
                                          </div>
                                          <div style={{ fontSize: "8px", color: "var(--muted)", lineHeight: 1.3, marginBottom: 8 }}>
                                            This photo lacks location data.
                                          </div>
                                          <button
                                            onClick={() => {
                                              setEditingCoordsDocId(doc.id);
                                              setTempLat("");
                                              setTempLng("");
                                            }}
                                            style={{
                                              background: "white",
                                              border: "1px solid rgba(249, 115, 22, 0.25)",
                                              color: "#e06c1b",
                                              padding: "3px 6px",
                                              borderRadius: 6,
                                              fontSize: "9px",
                                              fontWeight: 700,
                                              cursor: "pointer",
                                              transition: "all 0.2s"
                                            }}
                                            onMouseOver={e => { e.currentTarget.style.background = "#fff8f5"; }}
                                            onMouseOut={e => { e.currentTarget.style.background = "white"; }}
                                          >
                                            Set Coordinates Manually
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </>
                              ) : (
                                <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", height: 90, border: "1px dashed rgba(0,0,0,0.06)", borderRadius: 8, background: "rgba(0,0,0,0.01)" }}>
                                  <span style={{ fontSize: 11, color: "var(--muted)" }}>Pending Upload</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ padding: "16px 20px", background: "var(--light, #f8fafc)", borderRadius: 12, border: "1px dashed rgba(0,0,0,0.08)", textAlign: "center", color: "var(--muted)", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        <AlertTriangle size={14} style={{ color: "#d97706" }} /> Geo-tagged project files have not been uploaded by the dealer yet.
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Row 4: Pricing details */}
              <div style={{ background: "var(--light, #f8fafc)", padding: 18, borderRadius: 16, border: "1px solid rgba(0,0,0,0.03)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Cost Breakdown
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "var(--muted)" }}>
                      {selectedQuotation.payment_mode === "Kit Purchase" ? "Kit Subtotal (Panels + Inverter + Acc)" : "System Subtotal (Panels + Inverters + Acc)"}
                    </span>
                    <span style={{ fontWeight: 500, fontFamily: "var(--mono)" }}>{fmt(selectedQuotation.subtotal)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "var(--muted)" }}>GST @ {selectedQuotation.gst_rate || 12}%</span>
                    <span style={{ fontWeight: 500, fontFamily: "var(--mono)" }}>{fmt(selectedQuotation.gst_amount)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: 8, marginTop: 4 }}>
                    <strong>{selectedQuotation.payment_mode === "Kit Purchase" ? "Total Kit Price" : "Total System Price"}</strong>
                    <strong style={{ fontFamily: "var(--mono)" }}>{fmt(selectedQuotation.total)}</strong>
                  </div>
                  {Number(selectedQuotation.subsidy_amount) > 0 && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--green)" }}>
                        <span>Surya Ghar Subsidy (Govt)</span>
                        <span style={{ fontFamily: "var(--mono)" }}>-{fmt(selectedQuotation.subsidy_amount)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, borderTop: "1px dashed rgba(0,0,0,0.08)", paddingTop: 8, marginTop: 4, color: "var(--green)" }}>
                        <strong>Effective Price for Customer</strong>
                        <strong style={{ fontFamily: "var(--mono)", fontSize: 18 }}>{fmt(selectedQuotation.effective_price)}</strong>
                      </div>
                    </>
                  )}
                </div>
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
                background: "var(--light, #f8fafc)",
                position: "sticky",
                bottom: 0,
                zIndex: 10,
                borderBottomLeftRadius: 20,
                borderBottomRightRadius: 20
              }}
            >
              <button
                className="btn-sm"
                style={{
                  background: "var(--primary-light, #eff6ff)",
                  color: "var(--primary, #3b82f6)",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                  marginRight: "auto"
                }}
                onClick={() => handleDownloadPdf(selectedQuotation)}
              >
                <FileText size={14} /> Download PDF Quotation
              </button>

              <button
                className="btn-sm"
                style={{ background: "white", color: "var(--text)", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, padding: "8px 16px", cursor: "pointer" }}
                onClick={() => setSelectedQuotation(null)}
              >
                Close
              </button>

              {selectedQuotation.status === "Pending" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn-sm"
                    style={{ background: "var(--green)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                    disabled={actionLoading === selectedQuotation.id}
                    onClick={async () => {
                      setStatusConfirm({ id: selectedQuotation.id, status: "Approved", number: selectedQuotation.quotation_number });
                      setSelectedQuotation(null);
                    }}
                  >
                    <CheckCircle size={14} /> Approve Request
                  </button>
                  <button
                    className="btn-sm danger"
                    style={{ borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                    disabled={actionLoading === selectedQuotation.id}
                    onClick={async () => {
                      setStatusConfirm({ id: selectedQuotation.id, status: "Rejected", number: selectedQuotation.quotation_number });
                      setSelectedQuotation(null);
                    }}
                  >
                    <XCircle size={14} /> Reject Request
                  </button>
                </div>
              )}

              {selectedQuotation.status === "Approved" && (
                <button
                  className="btn-sm"
                  style={{ background: "var(--green)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                  onClick={() => handleDownloadBOM(selectedQuotation)}
                >
                  <Download size={14} /> Download Excel BOM
                </button>
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
      {statusConfirm && (
        <ConfirmDialog
          open={true}
          title={statusConfirm.status === "Approved" ? "Approve Quotation?" : "Reject Quotation?"}
          message={`Are you sure you want to ${statusConfirm.status === "Approved" ? "approve" : "reject"} quotation ${statusConfirm.number || ""}? This action will notify the dealer.`}
          variant={statusConfirm.status === "Approved" ? "info" : "danger"}
          confirmText={statusConfirm.status === "Approved" ? "Approve" : "Reject"}
          onConfirm={() => {
            const { id, status } = statusConfirm;
            setStatusConfirm(null);
            handleStatus(id, status);
          }}
          onCancel={() => setStatusConfirm(null)}
        />
      )}
    </div>
  );
}
