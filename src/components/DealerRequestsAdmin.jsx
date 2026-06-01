import { useState, useEffect, useCallback } from "react";
import { quotations as quotationsApi, uploads as uploadsApi } from "../utils/api";
import { fmt, generatePdfQuotation, generateBOM } from "../utils/helpers";
import { Loader2, Inbox, CheckCircle, XCircle, Paperclip, Download, Eye, X, User, Phone, MapPin, Zap, FileText, Camera, Truck, Package, Check, FolderOpen, ChevronLeft, ChevronRight, AlertTriangle, Copy, Search, RefreshCw } from "lucide-react";
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
  const [search, setSearch] = useState("");

  // Quotation Re-upload request modal state
  const [reuploadModal, setReuploadModal] = useState(null); // { id, number, customerName }
  const [reuploadReason, setReuploadReason] = useState("");
  const [reuploadDocs, setReuploadDocs] = useState({
    aadhaar: false,
    pan: false,
    passbook: false,
    site_photo: false,
    vera_bill: false,
    house_photo_1: false,
    house_photo_2: false,
    house_photo_3: false,
  });
  const [reuploadLoading, setReuploadLoading] = useState(false);
  const [reuploadSuccess, setReuploadSuccess] = useState(false);

  // Geo-tag re-upload request modal state
  const [geotagReuploadModal, setGeotagReuploadModal] = useState(null); // { id, number }
  const [geotagReuploadReason, setGeotagReuploadReason] = useState("");
  const [geotagReuploadSlots, setGeotagReuploadSlots] = useState({ geotag_1: true, geotag_2: true, geotag_3: true });
  const [geotagReuploadLoading, setGeotagReuploadLoading] = useState(false);
  const [geotagReuploadSuccess, setGeotagReuploadSuccess] = useState(false);

  const openReuploadModal = (q) => {
    setReuploadModal({ id: q.id, number: q.quotation_number, customerName: q.customer_name || "Valued Customer", paymentMode: q.payment_mode || "" });
    setReuploadReason(q.reupload_reason || "");
    if (q.reupload_required_docs) {
      const prevDocs = q.reupload_required_docs.split(",").map(d => d.trim());
      setReuploadDocs({
        aadhaar:       prevDocs.includes("aadhaar"),
        pan:           prevDocs.includes("pan"),
        passbook:      prevDocs.includes("passbook"),
        site_photo:    prevDocs.includes("site_photo"),
        vera_bill:     prevDocs.includes("vera_bill"),
        house_photo_1: prevDocs.includes("house_photo_1"),
        house_photo_2: prevDocs.includes("house_photo_2"),
        house_photo_3: prevDocs.includes("house_photo_3"),
      });
    } else {
      setReuploadDocs({
        aadhaar: false,
        pan: false, passbook: false, site_photo: false,
        vera_bill: false, house_photo_1: false, house_photo_2: false, house_photo_3: false,
      });
    }
    setReuploadSuccess(false);
  };

  const handleRequestGeotagReupload = async () => {
    const selectedSlots = Object.entries(geotagReuploadSlots).filter(([, v]) => v).map(([k]) => k);
    if (!geotagReuploadReason.trim()) {
      setErrorDialog({ open: true, message: "Please provide a reason for requesting geo-tag re-upload." });
      return;
    }
    if (selectedSlots.length === 0) {
      setErrorDialog({ open: true, message: "Please select at least one geo-tag photo to request re-upload for." });
      return;
    }
    setGeotagReuploadLoading(true);
    try {
      await quotationsApi.requestGeotagReupload(geotagReuploadModal.id, geotagReuploadReason.trim(), selectedSlots);
      setGeotagReuploadSuccess(true);
      // Update local state
      setList(prev => prev.map(q =>
        q.id === geotagReuploadModal.id
          ? { ...q, geotag_reupload_requested: 1, geotag_reupload_reason: geotagReuploadReason.trim(), geotag_reupload_slots: selectedSlots.join(",") }
          : q
      ));
      setSelectedQuotation(prev =>
        prev && prev.id === geotagReuploadModal.id
          ? { ...prev, geotag_reupload_requested: 1, geotag_reupload_reason: geotagReuploadReason.trim(), geotag_reupload_slots: selectedSlots.join(",") }
          : prev
      );
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to send geo-tag re-upload request." });
    } finally {
      setGeotagReuploadLoading(false);
    }
  };

  const handleRequestReupload = async () => {
    const selectedDocs = Object.entries(reuploadDocs)
      .filter(([_, checked]) => checked)
      .map(([key]) => key);

    if (!reuploadReason.trim()) {
      setErrorDialog({ open: true, message: "Please provide a reason for requesting re-upload." });
      return;
    }
    if (selectedDocs.length === 0) {
      setErrorDialog({ open: true, message: "Please select at least one document or geotag to re-upload." });
      return;
    }

    setReuploadLoading(true);
    try {
      await quotationsApi.requestReupload(reuploadModal.id, reuploadReason.trim(), selectedDocs);
      setReuploadSuccess(true);
      
      // Update local state in the list & selectedQuotation
      setList(prev => prev.map(q => {
        if (q.id === reuploadModal.id) {
          return {
            ...q,
            status: "ReuploadRequested",
            reupload_reason: reuploadReason.trim(),
            reupload_required_docs: selectedDocs.join(","),
            reupload_requested_at: new Date().toISOString(),
            reupload_expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
            reupload_used: 0,
          };
        }
        return q;
      }));

      setSelectedQuotation(prev => {
        if (prev && prev.id === reuploadModal.id) {
          return {
            ...prev,
            status: "ReuploadRequested",
            reupload_reason: reuploadReason.trim(),
            reupload_required_docs: selectedDocs.join(","),
            reupload_requested_at: new Date().toISOString(),
            reupload_expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
            reupload_used: 0,
          };
        }
        return prev;
      });
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to send re-upload request." });
    } finally {
      setReuploadLoading(false);
    }
  };

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

  // ── Stats (for summary boxes) ──────────────────────────
  const [stats, setStats] = useState(null);
  const fetchStats = useCallback(async () => {
    try {
      const res = await quotationsApi.getStats();
      if (res.success) setStats(res.stats);
    } catch { /* non-critical */ }
  }, []);

  // ── Review Items (filter-independent) ─────────────────────────────────
  // Banners must show regardless of which status filter admin has applied.
  // e.g. geotag_needs_review=1 is on Approved quotations — they would be
  // invisible if admin has a "Pending" filter active.
  // This fetches ALL quotations needing review, ignoring the current filter.
  const [reviewItems, setReviewItems] = useState([]);

  const fetchReviewItems = useCallback(async () => {
    try {
      // Fetch all quotations with no status filter; client-side filter for flags.
      // limit=200 is generous — in practice very few items need review at once.
      const res = await quotationsApi.list({ limit: 200 });
      const items = (res.quotations || []).filter(
        q => q.needs_review_after_reupload || q.geotag_needs_review
      );
      setReviewItems(items);
    } catch {
      // Non-critical — silently ignore
    }
  }, []);

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
  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => { setLoading(true); fetchQuotations(); fetchReviewItems(); fetchStats(); }, [filter, page]);

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
      // Refresh list, review banners, and stat boxes
      await Promise.all([fetchQuotations(false), fetchReviewItems(), fetchStats()]);
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
      await Promise.all([fetchQuotations(false), fetchStats()]);
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to update delivery status." });
    } finally {
      setActionLoading(null);
    }
  };

  // ── Accept Geo-tag Photos ─────────────────────────────────────────────
  // Called when admin clicks "Accept Geo-tag Photos" on a quotation where
  // geotag_needs_review = 1. Clears the flag so the banner + stat box reset.
  const [geotagAcceptLoading, setGeotagAcceptLoading] = useState(false);

  const handleAcceptGeotags = async (id) => {
    setGeotagAcceptLoading(true);
    try {
      await quotationsApi.clearGeotagReupload(id);
      // Update selected quotation in-place so banner disappears immediately
      setSelectedQuotation(prev =>
        prev && prev.id === id
          ? { ...prev, geotag_needs_review: 0, geotag_reupload_requested: 0 }
          : prev
      );
      // Refresh list, banners, and stat boxes
      await Promise.all([fetchQuotations(false), fetchReviewItems(), fetchStats()]);
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to accept geo-tag photos." });
    } finally {
      setGeotagAcceptLoading(false);
    }
  };

  const handleDownloadBOM = (q) => {
    const bom = generateBOM(q);

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

      {/* ── Stat Boxes ──────────────────────────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap: 12,
        marginBottom: 20,
      }}>
        {[
          { label: "Total",              value: stats?.total,             color: "#1a1a1a", bg: "#f8f9fa",  border: "#e2e8f0", accent: "#94a3b8" },
          { label: "Pending",            value: stats?.pending,           color: "#92400e", bg: "#fffbeb",  border: "#fde68a", accent: "#f59e0b" },
          { label: "Approved",           value: stats?.approved,          color: "#166534", bg: "#f0fdf4",  border: "#bbf7d0", accent: "#22c55e" },
          { label: "Rejected",           value: stats?.rejected,          color: "#991b1b", bg: "#fef2f2",  border: "#fecaca", accent: "#ef4444" },
          { label: "Re-upload Requested",value: stats?.reuploadRequested, color: "#7c2d12", bg: "#fff7ed",  border: "#fed7aa", accent: "#f97316" },
          { label: "Docs Awaiting Review",  value: stats?.docsNeedsReview,   color: "#78350f", bg: "linear-gradient(135deg,#fffbeb,#fef3c7)", border: "#fcd34d", accent: "#f59e0b", highlight: true },
          { label: "Geotag Awaiting Review", value: stats?.geotagNeedsReview, color: "#1e3a5f", bg: "linear-gradient(135deg,#eff6ff,#dbeafe)", border: "#93c5fd", accent: "#3b82f6", highlightBlue: true },
        ].map(({ label, value, color, bg, border, accent, highlight, highlightBlue }) => (
          <div key={label} style={{
            background: bg,
            border: `1px solid ${border}`,
            borderRadius: 12,
            padding: "14px 16px",
            borderTop: `3px solid ${accent}`,
            boxShadow: highlight
              ? "0 2px 12px rgba(245,158,11,0.15)"
              : highlightBlue
                ? "0 2px 12px rgba(59,130,246,0.12)"
                : "0 1px 4px rgba(0,0,0,0.04)",
            transition: "transform 0.15s, box-shadow 0.15s",
            cursor: "default",
          }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = highlight
                ? "0 6px 18px rgba(245,158,11,0.22)"
                : highlightBlue
                  ? "0 6px 18px rgba(59,130,246,0.2)"
                  : "0 4px 12px rgba(0,0,0,0.08)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = "";
              e.currentTarget.style.boxShadow = highlight
                ? "0 2px 12px rgba(245,158,11,0.15)"
                : highlightBlue
                  ? "0 2px 12px rgba(59,130,246,0.12)"
                  : "0 1px 4px rgba(0,0,0,0.04)";
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: "var(--mono)", lineHeight: 1, letterSpacing: -1 }}>
              {value ?? <span style={{ fontSize: 18, opacity: 0.3 }}>—</span>}
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 6 }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Status filter + Search bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {["", "Pending", "Approved", "Rejected", "ReuploadRequested"].map(s => (
          <button key={s} className={`btn-sm ${filter === s ? "primary" : ""}`} onClick={() => setFilter(s)} style={{ padding: "6px 14px", borderRadius: 8 }}>
            {s === "ReuploadRequested" ? "Re-upload Requested" : s || "All"}
          </button>
        ))}

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: "var(--border, #e2e8f0)", margin: "0 4px" }} />

        {/* Search */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--card, white)", border: "1px solid var(--border, #e2e8f0)",
          borderRadius: 10, padding: "6px 12px", minWidth: 240,
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}>
          <Search size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search quotation, dealer, customer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 13, color: "var(--text)" }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--muted)", display: "flex" }}>
              <X size={13} />
            </button>
          )}
        </div>
        {search && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {(() => {
              const count = list.filter(q => {
                const s = search.toLowerCase();
                return q.quotation_number?.toLowerCase().includes(s) ||
                       q.dealer_name?.toLowerCase().includes(s) ||
                       q.customer_name?.toLowerCase().includes(s) ||
                       q.customer_city?.toLowerCase().includes(s);
              }).length;
              return `${count} result${count !== 1 ? "s" : ""}`;
            })()}
          </span>
        )}
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

          {/* ── Action Required Banners ─────────────────────────────────────────
               Shown when a dealer has re-submitted documents or geotag photos
               and the admin needs to review them.
               Each banner links directly to the quotation detail modal.
               Multiple banners stack if several quotations need review.
          ─────────────────────────────────────────────────────────────────── */}
          {reviewItems.map(q => {
            const docsNeeded   = q.needs_review_after_reupload === 1;
            const geotagNeeded = q.geotag_needs_review === 1;
            const bothNeeded   = docsNeeded && geotagNeeded;
            const title = bothNeeded
              ? "Action Required — Documents & Geo-tag Photos Re-uploaded"
              : docsNeeded
                ? "Action Required — Documents Re-uploaded"
                : "Action Required — Geo-tag Photos Re-uploaded";
            return (
              <div key={`banner-${q.id}`} style={{
                display: "flex", alignItems: "center", gap: 12,
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
                {/* Text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#92400e", letterSpacing: 0.1 }}>
                    {title}
                  </div>
                  <div style={{ fontSize: 12, color: "#b45309", marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--mono, monospace)", fontWeight: 600 }}>{q.quotation_number}</span>
                    <span style={{ color: "#d97706" }}>·</span>
                    <span>{q.dealer_name}</span>
                    <span style={{ color: "#d97706" }}>·</span>
                    <span>{q.customer_name}</span>
                    {q.reupload_count > 0 && (
                      <span style={{
                        background: "rgba(245,158,11,0.2)", color: "#92400e",
                        fontSize: 10, fontWeight: 700,
                        padding: "1px 7px", borderRadius: 20,
                        border: "1px solid rgba(245,158,11,0.35)",
                      }}>
                        Re-upload #{q.reupload_count}
                      </span>
                    )}
                  </div>
                </div>
                {/* CTA */}
                <button
                  onClick={() => setSelectedQuotation(q)}
                  style={{
                    flexShrink: 0,
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "#f59e0b", color: "white",
                    border: "none", borderRadius: 8,
                    padding: "8px 18px", fontWeight: 700, fontSize: 12,
                    cursor: "pointer", whiteSpace: "nowrap",
                    boxShadow: "0 2px 8px rgba(245,158,11,0.4)",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "#d97706"}
                  onMouseLeave={e => e.currentTarget.style.background = "#f59e0b"}
                >
                  <Eye size={13} strokeWidth={2.5} />
                  Review Now
                </button>
              </div>
            );
          })}

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
              {(search
                ? list.filter(q => {
                    const s = search.toLowerCase();
                    return q.quotation_number?.toLowerCase().includes(s) ||
                           q.dealer_name?.toLowerCase().includes(s) ||
                           q.customer_name?.toLowerCase().includes(s) ||
                           q.customer_city?.toLowerCase().includes(s);
                  })
                : list
              ).map(q => (
                <tr key={q.id} style={{ borderBottom: "1px solid rgba(0,0,0,0.04)", transition: "background 0.2s" }} className="table-row-hover">
                  <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 600, fontFamily: "var(--mono)", color: "var(--text)", fontSize: "13px" }}>{q.quotation_number}</div>
                      {q.reupload_count > 0 && (
                        <span style={{
                          display: "inline-block",
                          fontSize: 9,
                          fontWeight: 700,
                          padding: "1px 6px",
                          borderRadius: 4,
                          background: "#E8F5EE",
                          color: "#2E7D52",
                          border: "1px solid rgba(46, 125, 82, 0.2)",
                        }}>
                          Re-uploaded {q.reupload_count > 1 ? `×${q.reupload_count}` : ""}
                        </span>
                      )}
                    </div>
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
              {selectedQuotation.status === "ReuploadRequested" && (
                <div style={{
                  background: "#fffbeb",
                  border: "1.5px solid #fbbf24",
                  borderRadius: 16,
                  padding: 16,
                  marginBottom: 20,
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: "50%", background: "#fff3cd",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#d97706", flexShrink: 0
                  }}>
                    <RefreshCw size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#92400e", marginBottom: 2 }}>Re-upload Request Active</div>
                    <div style={{ fontSize: 12, color: "#b45309", marginBottom: 8 }}>
                      {selectedQuotation.reupload_requested_at && (
                        <span>Sent: <strong>{new Date(selectedQuotation.reupload_requested_at).toLocaleString("en-IN")}</strong></span>
                      )}
                      {selectedQuotation.reupload_expires_at && (
                        <span style={{ marginLeft: 12 }}>
                          Expiry:{" "}
                          <strong style={{ color: new Date(selectedQuotation.reupload_expires_at) < new Date() ? "#dc2626" : "#b45309" }}>
                            {new Date(selectedQuotation.reupload_expires_at).toLocaleString("en-IN")}
                          </strong>{" "}
                          ({new Date(selectedQuotation.reupload_expires_at) < new Date() ? "Link Expired" : "Link Active"})
                        </span>
                      )}
                    </div>
                    {selectedQuotation.reupload_required_docs && (
                      <div style={{ fontSize: 12, color: "#451a03", marginBottom: 6 }}>
                        <strong>Files flagged:</strong>{" "}
                        <span style={{ display: "inline-block", background: "#fef3c7", padding: "2px 8px", borderRadius: 6, fontWeight: 600 }}>
                          {selectedQuotation.reupload_required_docs.split(",").map(d => {
                            const labels = {
                              aadhaar:       "Aadhaar Card",
                              pan:           "PAN Card",
                              passbook:      "Bank Passbook",
                              site_photo:    "Latest Light Bill/Site Photo",
                              vera_bill:     "Vera Bill",
                              house_photo_1: "House Photo 1",
                              house_photo_2: "House Photo 2",
                              house_photo_3: "House Photo 3",
                              geotag_1:      "Site / Inverter Photo",
                              geotag_2:      "Solar Panels Photo",
                              geotag_3:      "ACDB / Net Meter Photo",
                            };
                            return labels[d] || d;
                          }).join(", ")}
                        </span>
                      </div>
                    )}
                    {selectedQuotation.reupload_reason && (
                      <div style={{ fontSize: 12, color: "#451a03", lineHeight: 1.5, background: "rgba(255,255,255,0.5)", padding: 10, borderRadius: 8, border: "1px dashed rgba(217,119,6,0.2)" }}>
                        <strong>Reason:</strong> {selectedQuotation.reupload_reason}
                      </div>
                    )}
                  </div>
                </div>
              )}
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
                                    : doc.doc_type === "aadhaar_front"
                                    ? "Aadhaar Card (Front)"
                                    : doc.doc_type === "aadhaar_back"
                                    ? "Aadhaar Card (Back)"
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

                  {/* ── Accept Geo-tag Banner ──────────────────────────────────
                     Shown only when dealer has re-uploaded geotag photos and
                     admin needs to review and accept them.
                  ───────────────────────────────────────────────── */}
                  {selectedQuotation.geotag_needs_review === 1 && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 12,
                      background: "linear-gradient(135deg, #eff6ff, #dbeafe)",
                      border: "1px solid #93c5fd",
                      borderLeft: "4px solid #3b82f6",
                      borderRadius: 10, padding: "12px 16px",
                      marginBottom: 14,
                      boxShadow: "0 2px 10px rgba(59,130,246,0.12)",
                      animation: "fadeInDown 0.2s ease",
                    }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: "rgba(59,130,246,0.15)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                      }}>
                        <Camera size={15} color="#2563eb" strokeWidth={2.5} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 12.5, color: "#1e3a5f" }}>
                          Geo-tag Photos Re-uploaded — Review &amp; Accept
                        </div>
                        <div style={{ fontSize: 11.5, color: "#2563eb", marginTop: 2 }}>
                          Dealer has submitted updated geo-tag photos. Review the photos below, then accept.
                        </div>
                      </div>
                      <button
                        onClick={() => handleAcceptGeotags(selectedQuotation.id)}
                        disabled={geotagAcceptLoading}
                        style={{
                          flexShrink: 0,
                          display: "inline-flex", alignItems: "center", gap: 6,
                          background: geotagAcceptLoading ? "#93c5fd" : "#2563eb",
                          color: "white",
                          border: "none", borderRadius: 8,
                          padding: "8px 16px", fontWeight: 700, fontSize: 12,
                          cursor: geotagAcceptLoading ? "not-allowed" : "pointer",
                          whiteSpace: "nowrap",
                          boxShadow: "0 2px 8px rgba(37,99,235,0.35)",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={e => { if (!geotagAcceptLoading) e.currentTarget.style.background = "#1d4ed8"; }}
                        onMouseLeave={e => { if (!geotagAcceptLoading) e.currentTarget.style.background = "#2563eb"; }}
                      >
                        {geotagAcceptLoading
                          ? <><Loader2 size={13} className="animate-spin" /> Accepting...</>
                          : <><Check size={13} strokeWidth={2.5} /> Accept Geo-tag Photos</>
                        }
                      </button>
                    </div>
                  )}

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
                  {/* Only show reupload request if dealer has already submitted documents */}
                  {selectedQuotation.documents && selectedQuotation.documents.length > 0 && (
                    <button
                      className="btn-sm"
                      style={{ background: "#fff3cd", color: "#856404", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600 }}
                      disabled={actionLoading === selectedQuotation.id}
                      onClick={() => openReuploadModal(selectedQuotation)}
                    >
                      <RefreshCw size={14} /> Request Re-upload
                    </button>
                  )}
                </div>
              )}

              {selectedQuotation.status === "Rejected" &&
                selectedQuotation.documents && selectedQuotation.documents.length > 0 && (
                <button
                  className="btn-sm"
                  style={{ background: "#fff3cd", color: "#856404", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600 }}
                  onClick={() => openReuploadModal(selectedQuotation)}
                >
                  <RefreshCw size={14} /> Request Re-upload
                </button>
              )}

              {selectedQuotation.status === "ReuploadRequested" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn-sm"
                    style={{ background: "#fff3cd", color: "#856404", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600 }}
                    onClick={() => openReuploadModal(selectedQuotation)}
                  >
                    <RefreshCw size={14} /> Change Reupload Docs
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
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn-sm"
                    style={{ background: "var(--green)", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                    onClick={() => handleDownloadBOM(selectedQuotation)}
                  >
                    <Download size={14} /> Download Excel BOM
                  </button>
                  {/* Request Geo-Tag Reupload button — only after dealer has uploaded at least once */}
                  {selectedQuotation.geotag_uploaded ? (
                    <button
                      className="btn-sm"
                      style={{
                        background: selectedQuotation.geotag_reupload_requested ? "rgba(249,115,22,0.1)" : "rgba(107,114,128,0.06)",
                        color: selectedQuotation.geotag_reupload_requested ? "#ea580c" : "var(--muted)",
                        border: selectedQuotation.geotag_reupload_requested ? "1px solid rgba(249,115,22,0.3)" : "1px solid rgba(0,0,0,0.1)",
                        borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600
                      }}
                      onClick={() => {
                        setGeotagReuploadModal({ id: selectedQuotation.id, number: selectedQuotation.quotation_number });
                        setGeotagReuploadReason(selectedQuotation.geotag_reupload_reason || "");
                        // Pre-fill slots from existing request, or default all 3
                        const existingSlots = selectedQuotation.geotag_reupload_slots
                          ? selectedQuotation.geotag_reupload_slots.split(",")
                          : ["geotag_1", "geotag_2", "geotag_3"];
                        setGeotagReuploadSlots({
                          geotag_1: existingSlots.includes("geotag_1"),
                          geotag_2: existingSlots.includes("geotag_2"),
                          geotag_3: existingSlots.includes("geotag_3"),
                        });
                        setGeotagReuploadSuccess(false);
                      }}
                    >
                      <Camera size={14} />
                      {selectedQuotation.geotag_reupload_requested ? "Re-send Geo-Tag Request" : "Request Geo-Tag Reupload"}
                    </button>
                  ) : (
                    <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", background: "rgba(0,0,0,0.03)", borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)" }}>
                      <Camera size={13} />
                      Geo-tag re-upload available after dealer uploads photos
                    </div>
                  )}
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

      {/* Re-upload Request Modal */}
      {reuploadModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(15,23,42,0.4)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9999, padding: 16
        }}>
          <div style={{
            background: "white", borderRadius: 20, width: "100%", maxWidth: 640,
            boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", overflow: "hidden",
            display: "flex", flexDirection: "column", maxHeight: "90vh"
          }}>
            {/* Modal Header */}
            <div style={{
              padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between",
              borderBottom: "1px solid rgba(0,0,0,0.06)",
              background: reuploadSuccess ? "#f0fdf4" : "#fffbeb",
            }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: reuploadSuccess ? "#15803d" : "#92400e", display: "flex", alignItems: "center", gap: 8 }}>
                  <RefreshCw size={16} />
                  {reuploadSuccess ? "Request Sent" : "Request Document Re-upload"}
                </div>
                {!reuploadSuccess && (
                  <div style={{ fontSize: 12, color: "#b45309", marginTop: 2, fontWeight: 600 }}>
                    Quotation: {reuploadModal.number} — Customer: {reuploadModal.customerName}
                  </div>
                )}
              </div>
              <button
                onClick={() => { if (!reuploadLoading) setReuploadModal(null); }}
                style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", display: "flex", padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
              {reuploadSuccess ? (
                <div style={{ textAlign: "center", padding: "16px 0" }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: "50%", background: "#dcfce7",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#15803d", margin: "0 auto 16px",
                  }}>
                    <Check size={28} strokeWidth={3} />
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 6 }}>Re-upload Request Sent Successfully!</div>
                  <p style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.6, margin: "0 0 20px 0" }}>
                    The dealer has been notified by email to log into the portal and re-upload the flagged documents.
                    The quotation is now marked as <strong>Re-upload Requested</strong>.
                  </p>
                  <button
                    onClick={() => setReuploadModal(null)}
                    className="btn-sm primary"
                    style={{ padding: "8px 24px", borderRadius: 8, margin: "0 auto" }}
                  >
                    Done
                  </button>
                </div>
              ) : (
                <div>
                  {/* Customer Documents */}
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
                    {reuploadModal?.paymentMode === "Kit Purchase" ? "Kit Documents" : "Customer Documents"}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 24 }}>
                    {[
                      ...(reuploadModal?.paymentMode !== "Kit Purchase" ? [
                        { key: "aadhaar",       label: "Aadhaar Card" },
                        { key: "pan",           label: "PAN Card" },
                        { key: "passbook",      label: "Bank Passbook" },
                      ] : []),
                      { key: "site_photo", label: reuploadModal?.paymentMode === "Kit Purchase" ? "Site / Roof Photo" : "Latest Light Bill / Site Photo" },
                      ...(reuploadModal?.paymentMode !== "Kit Purchase" ? [
                        { key: "vera_bill",     label: "Vera Bill" },
                        { key: "house_photo_1", label: "House Photo 1" },
                        { key: "house_photo_2", label: "House Photo 2" },
                        { key: "house_photo_3", label: "House Photo 3" },
                      ] : []),
                    ].map(({ key, label }) => (
                      <label
                        key={key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: `1.5px solid ${reuploadDocs[key] ? "#2E7D52" : "rgba(0,0,0,0.08)"}`,
                          background: reuploadDocs[key] ? "rgba(46,125,82,0.04)" : "#fafafa",
                          cursor: "pointer",
                          userSelect: "none",
                          transition: "all 0.2s",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={reuploadDocs[key]}
                          onChange={(e) => setReuploadDocs(p => ({ ...p, [key]: e.target.checked }))}
                          style={{ cursor: "pointer", accentColor: "#2E7D52" }}
                        />
                        <FileText size={14} color={reuploadDocs[key] ? "#2E7D52" : "#6b7280"} />
                        <span style={{ fontSize: 13, fontWeight: 500, color: reuploadDocs[key] ? "#1C3A2A" : "#374151" }}>{label}</span>
                      </label>
                    ))}
                  </div>

                  {/* Reason text area */}
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Reason for Re-upload Request</label>
                    <textarea
                      value={reuploadReason}
                      onChange={(e) => setReuploadReason(e.target.value)}
                      placeholder="e.g. The Aadhaar card image is blurry and unreadable. The PAN card photo is partially cut off."
                      rows={3}
                      style={{
                        width: "100%", padding: 12, border: "1.5px solid rgba(0,0,0,0.08)", borderRadius: 10,
                        fontSize: 13, color: "#111827", background: "#fafafa", resize: "none", outline: "none",
                        boxSizing: "border-box", transition: "border-color 0.2s"
                      }}
                      onFocus={(e) => e.target.style.borderColor = "#2E7D52"}
                      onBlur={(e) => e.target.style.borderColor = "rgba(0,0,0,0.08)"}
                    />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5, display: "flex", gap: 6, alignItems: "flex-start", background: "#f8fafc", padding: 10, borderRadius: 8 }}>
                    <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1, color: "#d97706" }} />
                    <span>The quotation status will change to <strong>Re-upload Requested</strong>. The dealer will be notified by email to log into the portal and re-upload the selected documents.</span>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {!reuploadSuccess && (
              <div style={{ padding: "16px 24px", display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                <button
                  onClick={() => setReuploadModal(null)}
                  className="btn-sm"
                  style={{ background: "white", color: "var(--text)", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, padding: "8px 16px", cursor: reuploadLoading ? "not-allowed" : "pointer" }}
                  disabled={reuploadLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleRequestReupload}
                  disabled={reuploadLoading || !reuploadReason.trim() || !Object.values(reuploadDocs).some(Boolean)}
                  className="btn-sm"
                  style={{
                    borderRadius: 8, padding: "8px 20px", cursor: reuploadLoading || !reuploadReason.trim() || !Object.values(reuploadDocs).some(Boolean) ? "not-allowed" : "pointer",
                    background: reuploadLoading || !reuploadReason.trim() || !Object.values(reuploadDocs).some(Boolean) ? "#9ca3af" : "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)",
                    color: "white", border: "none", fontWeight: 600, display: "flex", alignItems: "center", gap: 6,
                    boxShadow: reuploadLoading || !reuploadReason.trim() || !Object.values(reuploadDocs).some(Boolean) ? "none" : "0 4px 12px rgba(46,125,82,0.2)"
                  }}
                >
                  {reuploadLoading ? (
                    <><Loader2 size={14} className="animate-spin" /> Sending...</>
                  ) : (
                    <><RefreshCw size={14} /> Send Re-upload Request</>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Geo-Tag Re-upload Request Modal */}
      {geotagReuploadModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(15,23,42,0.4)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9999, padding: 16
        }}>
          <div style={{
            background: "white", borderRadius: 20, width: "100%", maxWidth: 500,
            boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", overflow: "hidden"
          }}>
            {/* Header */}
            <div style={{
              padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between",
              borderBottom: "1px solid rgba(0,0,0,0.06)",
              background: geotagReuploadSuccess ? "#f0fdf4" : "#fff7ed",
            }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: geotagReuploadSuccess ? "#15803d" : "#c2410c", display: "flex", alignItems: "center", gap: 8 }}>
                  <Camera size={16} />
                  {geotagReuploadSuccess ? "Request Sent" : "Request Geo-Tag Re-upload"}
                </div>
                {!geotagReuploadSuccess && (
                  <div style={{ fontSize: 12, color: "#9a3412", marginTop: 2, fontWeight: 600 }}>
                    Quotation: {geotagReuploadModal.number}
                  </div>
                )}
              </div>
              <button
                onClick={() => { if (!geotagReuploadLoading) setGeotagReuploadModal(null); }}
                style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", display: "flex", padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: 24 }}>
              {geotagReuploadSuccess ? (
                <div style={{ textAlign: "center", padding: "8px 0" }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: "50%", background: "#dcfce7",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#15803d", margin: "0 auto 16px",
                  }}>
                    <Check size={28} strokeWidth={3} />
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: "#111827", marginBottom: 6 }}>Geo-Tag Re-upload Request Sent!</div>
                  <p style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.6, margin: "0 0 20px 0" }}>
                    The dealer has been notified by email to log into the portal and re-upload the geo-tag photos for quotation <strong>{geotagReuploadModal.number}</strong>.
                  </p>
                  <button
                    onClick={() => setGeotagReuploadModal(null)}
                    className="btn-sm primary"
                    style={{ padding: "8px 24px", borderRadius: 8, margin: "0 auto" }}
                  >
                    Done
                  </button>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, margin: "0 0 16px 0" }}>
                    The dealer will be notified by email and will see a banner in their portal. Only the selected photo slots will be unlocked for re-upload.
                  </p>

                  {/* Slot checkboxes */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>Select Photos to Re-upload</div>
                    {[
                      { key: "geotag_1", label: "Site / Inverter Photo", desc: "Photo of the solar inverter at the site" },
                      { key: "geotag_2", label: "Solar Panels Photo", desc: "Overview photo of installed solar panels" },
                      { key: "geotag_3", label: "ACDB / Net Meter Photo", desc: "Photo of the net meter or ACDB unit" },
                    ].map(slot => (
                      <label key={slot.key} style={{
                        display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 10, marginBottom: 6, cursor: "pointer",
                        background: geotagReuploadSlots[slot.key] ? "rgba(234,88,12,0.05)" : "rgba(0,0,0,0.02)",
                        border: `1.5px solid ${geotagReuploadSlots[slot.key] ? "rgba(234,88,12,0.25)" : "rgba(0,0,0,0.08)"}`,
                        transition: "all 0.15s"
                      }}>
                        <input
                          type="checkbox"
                          checked={!!geotagReuploadSlots[slot.key]}
                          onChange={e => setGeotagReuploadSlots(prev => ({ ...prev, [slot.key]: e.target.checked }))}
                          style={{ marginTop: 2, accentColor: "#ea580c", width: 15, height: 15, flexShrink: 0 }}
                        />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: geotagReuploadSlots[slot.key] ? "#c2410c" : "#374151" }}>{slot.label}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{slot.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Reason for Re-upload</label>
                    <textarea
                      value={geotagReuploadReason}
                      onChange={(e) => setGeotagReuploadReason(e.target.value)}
                      placeholder="e.g. The inverter photo is too dark. Please re-upload a clear, geotagged photo."
                      rows={3}
                      style={{
                        width: "100%", padding: 12, border: "1.5px solid rgba(0,0,0,0.08)", borderRadius: 10,
                        fontSize: 13, color: "#111827", background: "#fafafa", resize: "none", outline: "none",
                        boxSizing: "border-box", transition: "border-color 0.2s"
                      }}
                      onFocus={(e) => e.target.style.borderColor = "#ea580c"}
                      onBlur={(e) => e.target.style.borderColor = "rgba(0,0,0,0.08)"}
                      autoFocus
                    />
                  </div>

                  <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5, display: "flex", gap: 6, alignItems: "flex-start", background: "#fff7ed", padding: 10, borderRadius: 8, border: "1px solid rgba(234,88,12,0.15)" }}>
                    <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1, color: "#ea580c" }} />
                    <span>Only the selected slots will be unlocked. Quotation status remains <strong>Approved</strong>. Other geo-tag slots stay locked.</span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            {!geotagReuploadSuccess && (
              <div style={{ padding: "16px 24px", display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                <button
                  onClick={() => setGeotagReuploadModal(null)}
                  className="btn-sm"
                  style={{ background: "white", color: "var(--text)", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, padding: "8px 16px", cursor: geotagReuploadLoading ? "not-allowed" : "pointer" }}
                  disabled={geotagReuploadLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleRequestGeotagReupload}
                  disabled={geotagReuploadLoading || !geotagReuploadReason.trim() || !Object.values(geotagReuploadSlots).some(Boolean)}
                  className="btn-sm"
                  style={{
                    borderRadius: 8, padding: "8px 20px",
                    cursor: (geotagReuploadLoading || !geotagReuploadReason.trim() || !Object.values(geotagReuploadSlots).some(Boolean)) ? "not-allowed" : "pointer",
                    background: (geotagReuploadLoading || !geotagReuploadReason.trim() || !Object.values(geotagReuploadSlots).some(Boolean)) ? "#9ca3af" : "linear-gradient(135deg, #9a3412 0%, #ea580c 100%)",
                    color: "white", border: "none", fontWeight: 600, display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  {geotagReuploadLoading ? (
                    <><Loader2 size={14} className="animate-spin" /> Sending...</>
                  ) : (
                    <><Camera size={14} /> Send Request</>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
