import { useState, useEffect, useCallback, useRef } from "react";
import { quotations as quotationsApi, uploads as uploadsApi } from "../utils/api";
import { fmt, generatePdfQuotation, generateBOM } from "../utils/helpers";
import { Loader2, Inbox, CheckCircle, XCircle, Paperclip, Download, Eye, X, User, Phone, MapPin, Zap, FileText, Camera, Truck, Package, Check, FolderOpen, ChevronLeft, ChevronRight, AlertTriangle, Copy, Search, RefreshCw, Send, Clock } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import ErrorState from "./ErrorState";

// ─── Friendly doc-type labels for quotation file downloads ────────────
const QUOTATION_DOC_LABELS = {
  aadhaar:        "Aadhaar_Card",
  aadhaar_front:  "Aadhaar_Front",
  aadhaar_back:   "Aadhaar_Back",
  pan:            "PAN_Card",
  passbook:       "Bank_Passbook",
  light_bill:     "Light_Bill",
  vera_bill:      "Vera_Bill",
  passport_photo: "Passport_Photo",
  house_photo_1:  "House_Photo_1",
  house_photo_2:  "House_Photo_2",
  house_photo_3:  "House_Photo_3",
  geotag_1:       "Geotag_Site_Inverter",
  geotag_2:       "Geotag_Solar_Panels",
  geotag_3:       "Geotag_ACDB_NetMeter",
  other:          "Document",
};

// Converts a string to a safe filename segment (spaces → underscores, strips special chars).
function toSafeSegment(str) {
  return (str || "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || "unknown";
}

// Build a recognizable filename for a quotation document download.
// Format: {DocTypeLabel}_{CustomerName}_{QuotationNumber}.{ext}
// Example: Aadhaar_Card_Manoj_Patel_HP-2024-001.jpg
function getQuotationDocFilename(doc, customerName, quotationNumber) {
  const label   = QUOTATION_DOC_LABELS[doc.doc_type] || "Document";
  const ext     = doc.original_name?.includes(".")
    ? doc.original_name.slice(doc.original_name.lastIndexOf(".")).toLowerCase()
    : "";
  const safeCust = toSafeSegment(customerName);
  const safeNum  = toSafeSegment(quotationNumber);
  return `${label}_${safeCust}_${safeNum}${ext}`;
}

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
    light_bill: false,
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
        light_bill:    prevDocs.includes("light_bill"),
        vera_bill:     prevDocs.includes("vera_bill"),
        house_photo_1: prevDocs.includes("house_photo_1"),
        house_photo_2: prevDocs.includes("house_photo_2"),
        house_photo_3: prevDocs.includes("house_photo_3"),
      });
    } else {
      setReuploadDocs({
        aadhaar: false,
        pan: false, passbook: false, light_bill: false,
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
      
      // Update local state in the list & selectedQuotation optimistically
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

      // BUG FIX: Refresh stats and review banners — these were never refreshed after
      // a reupload request, so the stat boxes and banners stayed stale until next
      // navigation or manual reload.
      fetchStats();
      fetchReviewItems();
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
    } catch (err) {
      // Log so production issues (e.g. missing DB columns) are visible in DevTools
      console.error("[fetchReviewItems] Failed to load review items:", err?.message || err);
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

  // ── Coordinated filter + page effects (avoids double-fetch) ─────────────
  // Problem with naive approach: having a separate `useEffect(() => setPage(1), [filter])`
  // alongside `useEffect(() => fetch(), [filter, page])` causes TWO fetches when filter
  // changes and admin is on page > 1:
  //   1st fetch: new filter + OLD page (stale data flashes)
  //   2nd fetch: new filter + page 1  (correct)
  //
  // Fix: filterChangedRef guards the fetch effect so it skips the stale-page run
  // and only fires once page has been reset to 1.
  const filterChangedRef = useRef(false);

  // When filter changes: mark the guard and reset to page 1.
  // This effect intentionally does NOT fetch — the fetch effect below handles it.
  useEffect(() => {
    filterChangedRef.current = true;
    setPage(1);
  }, [filter]);

  // When search changes: only reset page (search is client-side, no server call needed).
  // Resetting page re-renders the pagination UI so results stay on page 1 after search.
  useEffect(() => { setPage(1); }, [search]);

  // Main fetch effect — runs on filter or page change, but skips the stale-page
  // intermediate run that occurs when filter changes and page hasn't reset yet.
  useEffect(() => {
    // If filter just changed but page is still the old value, skip this run.
    // The effect will re-fire correctly once setPage(1) propagates.
    if (filterChangedRef.current && page !== 1) return;
    filterChangedRef.current = false; // consume the guard

    setLoading(true);
    fetchQuotations();
    fetchReviewItems();
    fetchStats();
  }, [filter, page]);

  // ── SSE: Instant refresh on any quotation or document mutation ───────────
  useEffect(() => {
    const handler = () => {
      fetchQuotations(false);
      fetchStats();
      fetchReviewItems();
    };
    const events = [
      "hp:sse:quotation:new",
      "hp:sse:quotation:status_changed",
      "hp:sse:quotation:delivery_changed",
      "hp:sse:quotation:deleted",
      // BUG FIX: Admin sent a reupload request from another tab — refresh so other
      // admin tabs see the updated status, actions, and stat boxes immediately.
      "hp:sse:quotation:reupload_requested",
      // Dealer submitted geotag photos — admin needs to review
      "hp:sse:quotation:geotag_submitted",
      // Admin deleted a document — refresh the document panel in the modal
      "hp:sse:document:deleted",
      // Dealer uploaded a new document (reupload / fresh upload)
      "hp:sse:document:uploaded",
      // Admin edited GPS coordinates on a geotag in another tab
      "hp:sse:document:coordinates_updated",
    ];
    events.forEach(e => window.addEventListener(e, handler));
    return () => events.forEach(e => window.removeEventListener(e, handler));
  }, [fetchQuotations, fetchStats, fetchReviewItems]);


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
  }, [selectedQuotation?.id, (selectedQuotation?.documents || []).map(d => d.id).join(",")]); // Re-run when ID or documents list changes

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

  // Download all customer docs for a quotation as a single ZIP archive.
  // customerName and quotationNumber are passed to build recognizable file/ZIP names.
  // Falls back to sequential downloads if ZIP fails.
  const handleDownloadAllDocs = useCallback(async (documents, customerName, quotationNumber) => {
    if (!documents || documents.length === 0) return;
    const customerDocs = documents.filter(doc => doc.doc_type !== "other" && !doc.doc_type.startsWith("geotag_"));
    if (customerDocs.length === 0) return;
    try {
      const ids = customerDocs.map(d => d.id);
      const zipName = `Customer_Docs_${toSafeSegment(customerName)}_${toSafeSegment(quotationNumber)}.zip`;
      await uploadsApi.downloadZip(ids, zipName);
    } catch (zipErr) {
      console.warn("[Download] ZIP failed, falling back to sequential:", zipErr.message);
      for (const doc of customerDocs) {
        try {
          await uploadsApi.downloadSecure(doc.id, getQuotationDocFilename(doc, customerName, quotationNumber));
          await new Promise(resolve => setTimeout(resolve, 400));
        } catch (err) {
          console.error("[Download] Failed for doc", doc.id, err.message);
        }
      }
    }
  }, []);

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

  // ── Responded re-upload tracking ──────────────────────────────────────
  // respondedIds: quotation IDs where dealer already re-submitted docs and
  // admin hasn't reviewed yet (needs_review_after_reupload = 1).
  // Used to split the Re-upload tab into two visual sections.
  const respondedIds = new Set(
    reviewItems.filter(r => r.needs_review_after_reupload).map(r => r.id)
  );
  // Count for the Re-upload tab badge (shown only when dealer has responded)
  const docReviewCount = reviewItems.filter(r => r.needs_review_after_reupload).length;

  // Tab badge counts — derived from reviewItems (status-aware, always up to date)
  // pendingReviewCount: how many Pending quotations have re-uploaded docs awaiting review
  // approvedGeotagCount: how many Approved quotations have geo-tag photos awaiting review
  const pendingReviewCount  = reviewItems.filter(r => r.needs_review_after_reupload && r.status === "Pending").length;
  const approvedGeotagCount = reviewItems.filter(r => r.geotag_needs_review           && r.status === "Approved").length;

  // ── Column visibility per active tab ──────────────────────────────────────────
  const showStatus   = filter === "" || filter === "ReuploadRequested"; // Show status on All tab and Re-upload tab
  const showDelivery = filter === "" || filter === "Approved";    // Only meaningful post-approval
  const showGeoTags  = filter === "" || filter === "Approved";    // Only meaningful post-approval
  const showActions  = filter !== "Rejected";                     // No actions exist for Rejected
  // Dynamic colSpan for section header rows (matches visible column count)
  const colSpan = 5 + (showStatus ? 1 : 0) + (showDelivery ? 1 : 0) + (showGeoTags ? 1 : 0) + (showActions ? 1 : 0);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Quotations</div>
        <div className="page-sub">Review and manage dealer quotation requests</div>
      </div>

      {/* ── Stat Boxes ────────────────────────────────────────────────────────────── */}
      <div className="stat-grid-7">
        {[
          { label: "Total",              value: stats?.total,             color: "#1a1a1a", bg: "#f8f9fa",  border: "#e2e8f0", accent: "#94a3b8" },
          { label: "Pending",            value: stats?.pending,           color: "#92400e", bg: "#fffbeb",  border: "#fde68a", accent: "#f59e0b" },
          { label: "Approved",           value: stats?.approved,          color: "#166534", bg: "#f0fdf4",  border: "#bbf7d0", accent: "#22c55e" },
          { label: "Rejected",           value: stats?.rejected,          color: "#991b1b", bg: "#fef2f2",  border: "#fecaca", accent: "#ef4444" },
          { label: "Re-upload Req.",     value: stats?.reuploadRequested, color: "#7c2d12", bg: "#fff7ed",  border: "#fed7aa", accent: "#f97316" },
          { label: "Docs Awaiting",      value: stats?.docsNeedsReview,   color: "#78350f", bg: "linear-gradient(135deg,#fffbeb,#fef3c7)", border: "#fcd34d", accent: "#f59e0b", highlight: true },
          { label: "Geotag Awaiting",    value: stats?.geotagNeedsReview, color: "#1e3a5f", bg: "linear-gradient(135deg,#eff6ff,#dbeafe)", border: "#93c5fd", accent: "#3b82f6", highlightBlue: true },
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
            minWidth: 0,
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
            <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 6, wordBreak: "break-word" }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Status filter + Search bar */}
      <div className="admin-filter-bar">
        {/* Scrollable Tabs */}
        <div className="hide-scrollbar" style={{ display: "flex", overflowX: "auto", gap: 8, WebkitOverflowScrolling: "touch", paddingBottom: 4, flex: 1, minWidth: 0 }}>
          {["", "Pending", "Approved", "Rejected", "ReuploadRequested"].map(s => {
            // Badge config per tab: only show when there are items needing attention
            const badgeCount =
              s === "ReuploadRequested" ? docReviewCount :
              s === "Pending"           ? pendingReviewCount :
              s === "Approved"          ? approvedGeotagCount : 0;
            const badgeBg =
              s === "Approved" ? "#3b82f6" : "#f97316"; // blue for geo-tag, orange for docs
            return (
              <button key={s} className={`btn-sm ${filter === s ? "primary" : ""}`} onClick={() => setFilter(s)} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5 }}>
                {s === "ReuploadRequested" ? "Re-upload" : (s || "All")}
                {badgeCount > 0 && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    minWidth: 16, height: 16, borderRadius: 9999,
                    background: filter === s ? "rgba(255,255,255,0.3)" : badgeBg,
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

        {/* Divider — hidden on small mobile where everything wraps */}
        <div style={{ width: 1, height: 24, background: "var(--border, #e2e8f0)", margin: "0 4px", flexShrink: 0 }} className="desktop-only" aria-hidden="true" />

        {/* Search */}
        <div className="filter-search-box">
          <Search size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search quotation, dealer, customer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 13, color: "var(--text)", minWidth: 0 }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--muted)", display: "flex", flexShrink: 0 }} aria-label="Clear search">
              <X size={13} />
            </button>
          )}
        </div>
        {search && (
          <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>
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
              </div>
            );
          })}

          <div className="q-table-wrap">
          <div className="table-scroll-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: filter === "" ? "900px" : filter === "Approved" ? "820px" : filter === "ReuploadRequested" ? "760px" : "640px" }}>
            <thead>
              <tr>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left", width: "170px", whiteSpace: "nowrap" }}>Quotation #</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left", width: "80px" }}>Date</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left", width: "110px" }}>Dealer</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left", width: "130px" }}>Customer</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left", width: "120px" }}>Capacity / Cost</th>
                {showStatus   && <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left",  width: "100px" }}>Status</th>}
                {showDelivery && <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "center", width: "110px" }}>Delivery</th>}
                {showGeoTags  && <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "center", width: "120px" }}>Geo-Tags</th>}
                {showActions  && <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "center", width: "88px"  }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const baseList = search
                  ? list.filter(q => {
                      const s = search.toLowerCase();
                      return q.quotation_number?.toLowerCase().includes(s) ||
                             q.dealer_name?.toLowerCase().includes(s) ||
                             q.customer_name?.toLowerCase().includes(s) ||
                             q.customer_city?.toLowerCase().includes(s);
                    })
                  : list;

                // ── Sort by urgency section, then build displayList ────────
                // Re-upload tab : responded (flag=1) first, waiting second
                // Pending tab   : re-uploaded docs (flag=1) first, new quotations second
                // Approved tab  : geo-tag review (flag=1) first, normal approved second
                // For the Re-upload tab we need TWO groups:
                //   1. "Dealer Responded" — status=Pending, needs_review_after_reupload=1
                //      These are NOT in `list` (which only has ReuploadRequested rows).
                //      We pull them from reviewItems and merge them in.
                //   2. "Awaiting Dealer Response" — status=ReuploadRequested in `list`
                //      (dealer hasn't submitted yet)
                const respondedRows = filter === "ReuploadRequested"
                  ? reviewItems.filter(r => r.needs_review_after_reupload)
                  : [];
                // Avoid duplicates in case a row appears in both (shouldn't, but defensive)
                const respondedRowIds = new Set(respondedRows.map(r => r.id));

                const displayList =
                  filter === "ReuploadRequested"
                    ? [
                        ...respondedRows,
                        ...baseList.filter(q => !respondedRowIds.has(q.id)),
                      ]
                  : filter === "Pending"
                    ? [
                        ...baseList.filter(q =>  q.needs_review_after_reupload),
                        ...baseList.filter(q => !q.needs_review_after_reupload),
                      ]
                  : filter === "Approved"
                    ? [
                        ...baseList.filter(q =>  q.geotag_needs_review),
                        ...baseList.filter(q => !q.geotag_needs_review),
                      ]
                  : baseList;

                // Counts used to position section headers correctly
                const respondedCount = filter === "ReuploadRequested"
                  ? respondedRows.length : 0;
                const pendingDocsCount = filter === "Pending"
                  ? baseList.filter(q => q.needs_review_after_reupload).length : 0;
                const pendingNewCount  = filter === "Pending"
                  ? baseList.filter(q => !q.needs_review_after_reupload).length : 0;
                const geotagCount = filter === "Approved"
                  ? baseList.filter(q => q.geotag_needs_review).length : 0;
                const approvedNormalCount = filter === "Approved"
                  ? baseList.filter(q => !q.geotag_needs_review).length : 0;

                return displayList.flatMap((q, idx) => {
                  const isResponded   = respondedRowIds.has(q.id);
                  const isDocsReview  = !!q.needs_review_after_reupload;
                  const isGeotagReview = !!q.geotag_needs_review;
                  const rows = [];

                  // ── Section headers ────────────────────────────────────────

                  // Re-upload tab: "Dealer Responded" / "Awaiting Dealer Response"
                  if (filter === "ReuploadRequested") {
                    if (idx === 0 && respondedCount > 0) {
                      rows.push(
                        <tr key="hdr-responded" style={{ background: "rgba(245,158,11,0.06)", pointerEvents: "none" }}>
                          <td colSpan={colSpan} style={{ padding: "7px 18px", fontSize: 11, fontWeight: 700, color: "#b45309", borderBottom: "1px solid rgba(245,158,11,0.18)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                            <CheckCircle size={12} /> Dealer Responded — Review Required ({respondedCount})
                          </td>
                        </tr>
                      );
                    }
                    if (!isResponded && idx === respondedCount && respondedCount > 0) {
                      rows.push(
                        <tr key="hdr-waiting" style={{ background: "var(--bg, #f8fafc)", pointerEvents: "none" }}>
                          <td colSpan={colSpan} style={{ padding: "7px 18px", fontSize: 11, fontWeight: 700, color: "var(--muted)", borderBottom: "1px solid var(--border)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                            <Clock size={12} /> Awaiting Dealer Response
                          </td>
                        </tr>
                      );
                    }
                  }

                  // Pending tab: "Documents Re-uploaded" / "New Quotations"
                  if (filter === "Pending") {
                    if (idx === 0 && pendingDocsCount > 0) {
                      rows.push(
                        <tr key="hdr-docs-review" style={{ background: "rgba(245,158,11,0.06)", pointerEvents: "none" }}>
                          <td colSpan={colSpan} style={{ padding: "7px 18px", fontSize: 11, fontWeight: 700, color: "#b45309", borderBottom: "1px solid rgba(245,158,11,0.18)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                            <CheckCircle size={12} /> Documents Re-uploaded — Review Required ({pendingDocsCount})
                          </td>
                        </tr>
                      );
                    }
                    if (!isDocsReview && idx === pendingDocsCount && pendingNewCount > 0 && pendingDocsCount > 0) {
                      rows.push(
                        <tr key="hdr-new-quotations" style={{ background: "var(--bg, #f8fafc)", pointerEvents: "none" }}>
                          <td colSpan={colSpan} style={{ padding: "7px 18px", fontSize: 11, fontWeight: 700, color: "var(--muted)", borderBottom: "1px solid var(--border)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                            <FileText size={12} /> New Quotations ({pendingNewCount})
                          </td>
                        </tr>
                      );
                    }
                  }

                  // Approved tab: "Geo-tag Review Required" / "All Approved"
                  if (filter === "Approved") {
                    if (idx === 0 && geotagCount > 0) {
                      rows.push(
                        <tr key="hdr-geotag-review" style={{ background: "rgba(245,158,11,0.06)", pointerEvents: "none" }}>
                          <td colSpan={colSpan} style={{ padding: "7px 18px", fontSize: 11, fontWeight: 700, color: "#b45309", borderBottom: "1px solid rgba(245,158,11,0.18)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                            <AlertTriangle size={12} /> Geo-tag Review Required ({geotagCount})
                          </td>
                        </tr>
                      );
                    }
                    if (!isGeotagReview && idx === geotagCount && approvedNormalCount > 0 && geotagCount > 0) {
                      rows.push(
                        <tr key="hdr-all-approved" style={{ background: "var(--bg, #f8fafc)", pointerEvents: "none" }}>
                          <td colSpan={colSpan} style={{ padding: "7px 18px", fontSize: 11, fontWeight: 700, color: "var(--muted)", borderBottom: "1px solid var(--border)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                            <CheckCircle size={12} /> All Approved ({approvedNormalCount})
                          </td>
                        </tr>
                      );
                    }
                  }

                  // Row background tint: amber for urgent items (re-uploaded docs, geo-tag review, responded re-upload)
                  const rowNeedsAmberTint =
                    (filter === "Pending"           && isDocsReview) ||
                    (filter === "Approved"          && isGeotagReview) ||
                    (filter === "ReuploadRequested" && isResponded);

                  rows.push((
                <tr
                  key={q.id}
                  className="table-row-hover"
                  style={{
                    borderBottom: "1px solid rgba(0,0,0,0.04)",
                    transition: "background 0.2s",
                    cursor: "pointer",
                    ...(rowNeedsAmberTint ? { background: "rgba(245,158,11,0.025)" } : {}),
                  }}
                  onClick={() => setSelectedQuotation(q)}
                >
                  <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 600, fontFamily: "var(--mono)", color: "var(--text)", fontSize: "13px", whiteSpace: "nowrap" }}>{q.quotation_number}</div>
                      {q.reupload_count > 0 && (
                        <span style={{
                          display: "inline-block",
                          fontSize: 9,
                          fontWeight: 700,
                          padding: "1px 6px",
                          borderRadius: 4,
                          background: isResponded ? "rgba(245,158,11,0.15)" : "#E8F5EE",
                          color: isResponded ? "#b45309" : "#2E7D52",
                          border: isResponded ? "1px solid rgba(245,158,11,0.3)" : "1px solid rgba(46, 125, 82, 0.2)",
                        }}>
                          {isResponded ? `✓ Docs Submitted${q.reupload_count > 1 ? ` ×${q.reupload_count}` : ""}` : `Re-uploaded${q.reupload_count > 1 ? ` ×${q.reupload_count}` : ""}`}
                        </span>
                      )}
                    </div>

                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", color: "var(--muted)", fontSize: "13px" }}>
                    {new Date(q.created_at).toLocaleDateString("en-IN")}
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", overflow: "hidden" }}>
                    <div style={{ fontWeight: 600, color: "var(--text)", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={q.dealer_name || "—"}>
                      {q.dealer_name || "—"}
                    </div>
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", overflow: "hidden" }}>
                    <div style={{ fontWeight: 500, color: "var(--text)", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={q.customer_name || "—"}>
                      {q.customer_name || "—"}
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px", verticalAlign: "middle" }}>
                    <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, lineHeight: 1.3 }}>
                      {Number(q.system_kw).toFixed(2)} kW
                    </div>
                    <div style={{ fontFamily: "var(--mono)", color: "var(--green)", fontWeight: 700, fontSize: 13, marginTop: 2, lineHeight: 1.3 }}>
                      {fmt(q.total)}
                    </div>
                  </td>
                  {showStatus && (
                  <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
                    <span className={`badge ${q.status === "Approved" ? "badge-green" : q.status === "Rejected" ? "badge-red" : q.status === "ReuploadRequested" ? "" : "badge-sun"}`}
                      style={q.status === "ReuploadRequested" ? { fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: "#b45309", color: "#fff", fontWeight: 700 } : { fontSize: "11px", padding: "3px 8px", borderRadius: "6px" }}>
                      {q.status === "ReuploadRequested" ? "Re-upload" : q.status}
                    </span>
                  </td>
                  )}
                  {showDelivery && (<td style={{ padding: "14px 16px", verticalAlign: "middle", textAlign: "center" }}>
                    {q.status === "Approved" ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
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
                            onClick={(e) => { e.stopPropagation(); handleUpdateDelivery(q.id, "Dispatched"); }}
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
                            onClick={(e) => { e.stopPropagation(); handleUpdateDelivery(q.id, "Delivered"); }}
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
                  </td>)}
                  {showGeoTags && (<td style={{ padding: "14px 16px", verticalAlign: "middle", textAlign: "center" }}>
                    {q.status === "Approved" ? (
                      (() => {
                        // Geo-tag re-review takes priority — show urgent badge
                        if (q.geotag_needs_review === 1) {
                          return (
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontSize: 10, fontWeight: 700, padding: "4px 8px", borderRadius: 6,
                              background: "rgba(245,158,11,0.12)", color: "#b45309",
                              border: "1px solid rgba(245,158,11,0.28)",
                              animation: "pulse 2s infinite",
                            }}>
                              <AlertTriangle size={11} /> Review Photos
                            </span>
                          );
                        }

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
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            fontSize: 10, fontWeight: 700, padding: "4px 8px", borderRadius: 6,
                            background: bg, color: color, border: border
                          }}>
                            <Camera size={11} /> {text}
                          </span>
                        );
                      })()
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: "12px" }}>—</span>
                    )}
                  </td>)}
                  {showActions && (<td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>

                      {/* Pending → Approve + Reject */}
                      {q.status === "Pending" && (
                        <>
                          <button
                            className="btn-sm"
                            style={{ padding: "6px", borderRadius: 8, background: "rgba(46, 125, 82, 0.08)", color: "var(--green)", border: "1px solid rgba(46, 125, 82, 0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s" }}
                            disabled={actionLoading === q.id}
                            onClick={(e) => { e.stopPropagation(); setStatusConfirm({ id: q.id, status: "Approved", number: q.quotation_number }); }}
                            title="Approve"
                          >
                            <CheckCircle size={13} />
                          </button>
                          <button
                            className="btn-sm danger"
                            style={{ padding: "6px", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s" }}
                            disabled={actionLoading === q.id}
                            onClick={(e) => { e.stopPropagation(); setStatusConfirm({ id: q.id, status: "Rejected", number: q.quotation_number }); }}
                            title="Reject"
                          >
                            <XCircle size={13} />
                          </button>
                        </>
                      )}

                      {/* ReuploadRequested waiting for dealer */}
                      {q.status === "ReuploadRequested" && (
                        <>
                          <button
                            className="btn-sm"
                            style={{ padding: "6px", borderRadius: 8, background: "rgba(249,115,22,0.08)", color: "#f97316", border: "1px solid rgba(249,115,22,0.2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s" }}
                            onClick={(e) => { e.stopPropagation(); openReuploadModal(q); }}
                            title="Send Re-upload Link Again"
                          >
                            <Send size={13} />
                          </button>
                          <button
                            className="btn-sm danger"
                            style={{ padding: "6px", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s" }}
                            disabled={actionLoading === q.id}
                            onClick={(e) => { e.stopPropagation(); setStatusConfirm({ id: q.id, status: "Rejected", number: q.quotation_number }); }}
                            title="Reject"
                          >
                            <XCircle size={13} />
                          </button>
                        </>
                      )}

                      {/* Approved → PDF + BOM downloads */}
                      {q.status === "Approved" && (
                        <>
                          <button
                            className="btn-sm"
                            style={{ padding: "6px", borderRadius: 8, background: "rgba(107, 114, 128, 0.06)", color: "var(--muted)", border: "1px solid rgba(107, 114, 128, 0.12)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s" }}
                            onClick={(e) => { e.stopPropagation(); handleDownloadPdf(q); }}
                            title="Download PDF Quotation"
                            onMouseOver={e => { e.currentTarget.style.background = "#334155"; e.currentTarget.style.color = "white"; }}
                            onMouseOut={e => { e.currentTarget.style.background = "rgba(107, 114, 128, 0.06)"; e.currentTarget.style.color = "var(--muted)"; }}
                          >
                            <FileText size={13} />
                          </button>
                          <button
                            className="btn-sm"
                            style={{ padding: "6px", borderRadius: 8, background: "rgba(46, 125, 82, 0.08)", color: "var(--green)", border: "1px solid rgba(46, 125, 82, 0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s" }}
                            onClick={(e) => { e.stopPropagation(); handleDownloadBOM(q); }}
                            title="Download BOM"
                          >
                            <Download size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>)}
                    </tr>
                  ));

                  return rows;
                });
              })()}
            </tbody>
          </table>
          </div>
          </div>{/* end q-table-wrap */}

          {/* ── Mobile Card List (< 768px) ────────────────────────────────────── */}
          <div className="q-card-list">
            {(search
              ? list.filter(q => {
                  const s = search.toLowerCase();
                  return q.quotation_number?.toLowerCase().includes(s) ||
                         q.dealer_name?.toLowerCase().includes(s) ||
                         q.customer_name?.toLowerCase().includes(s) ||
                         q.customer_city?.toLowerCase().includes(s);
                })
              : list
            ).map(q => {
              const isResponded = respondedIds.has(q.id);
              const statusLabel = q.status === "ReuploadRequested" ? "Re-upload" : q.status;
              const statusClass = q.status === "Approved" ? "badge-green" : q.status === "Rejected" ? "badge-red" : "badge-sun";

              return (
                <div key={q.id} className="q-card" onClick={() => setSelectedQuotation(q)}
                  style={isResponded ? { borderLeft: "3px solid #f59e0b" } : {}}>

                  {/* Header row: quotation number + status badge */}
                  <div className="q-card-header">
                    <div>
                      <div className="q-card-number">{q.quotation_number}</div>
                      <div className="q-card-badges">

                        {q.reupload_count > 0 && (
                          <span style={{ display: "inline-block", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: isResponded ? "rgba(245,158,11,0.15)" : "#E8F5EE", color: isResponded ? "#b45309" : "#2E7D52", border: isResponded ? "1px solid rgba(245,158,11,0.3)" : "1px solid rgba(46,125,82,0.2)" }}>
                            {isResponded ? `✓ Docs Submitted` : `Re-uploaded ×${q.reupload_count}`}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`badge ${statusClass}`} style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", flexShrink: 0 }}>
                      {statusLabel}
                    </span>
                  </div>

                  {/* Body: 2-column grid of fields */}
                  <div className="q-card-body">
                    <div className="q-card-field">
                      <span className="q-card-field-label">Date</span>
                      <span className="q-card-field-value muted">{new Date(q.created_at).toLocaleDateString("en-IN")}</span>
                    </div>
                    <div className="q-card-field">
                      <span className="q-card-field-label">Capacity</span>
                      <span className="q-card-field-value">{Number(q.system_kw).toFixed(2)} kW</span>
                    </div>
                    <div className="q-card-field">
                      <span className="q-card-field-label">Dealer</span>
                      <span className="q-card-field-value">{q.dealer_name || "—"}</span>
                    </div>
                    <div className="q-card-field">
                      <span className="q-card-field-label">Total Cost</span>
                      <span className="q-card-field-value mono">{fmt(q.total)}</span>
                    </div>
                    <div className="q-card-field" style={{ gridColumn: "1 / -1" }}>
                      <span className="q-card-field-label">Customer</span>
                      <span className="q-card-field-value">{q.customer_name || "—"}{q.customer_city ? ` · ${q.customer_city}` : ""}</span>
                    </div>
                    {q.status === "Approved" && q.delivery_status && (
                      <div className="q-card-field">
                        <span className="q-card-field-label">Delivery</span>
                        <span className="q-card-field-value muted">{q.delivery_status}</span>
                      </div>
                    )}
                    {q.status === "Approved" && (
                      <div className="q-card-field">
                        <span className="q-card-field-label">Geo-Tags</span>
                        <span className="q-card-field-value muted">
                          {q.geotag_needs_review === 1 ? "Review Required" : `${(q.documents?.filter(d => d.doc_type?.startsWith("geotag_")) || []).length}/3 Uploaded`}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Footer: action buttons */}
                  <div className="q-card-footer">
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>Tap to view details</span>
                    <div className="q-card-actions">
                      {q.status === "Pending" && (
                        <>
                          <button className="btn-sm" style={{ padding: "7px 14px", borderRadius: 8, background: "rgba(46,125,82,0.08)", color: "var(--green)", border: "1px solid rgba(46,125,82,0.15)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                            onClick={(e) => { e.stopPropagation(); setStatusConfirm({ id: q.id, status: "Approved", number: q.quotation_number }); }}>
                            <CheckCircle size={13} /> Approve
                          </button>
                          <button className="btn-sm danger" style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                            onClick={(e) => { e.stopPropagation(); setStatusConfirm({ id: q.id, status: "Rejected", number: q.quotation_number }); }}>
                            <XCircle size={13} /> Reject
                          </button>
                        </>
                      )}
                      {q.status === "ReuploadRequested" && (
                        <>
                          <button className="btn-sm" style={{ padding: "7px 14px", borderRadius: 8, background: "rgba(249,115,22,0.08)", color: "#f97316", border: "1px solid rgba(249,115,22,0.2)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                            onClick={(e) => { e.stopPropagation(); openReuploadModal(q); }}>
                            <Send size={13} /> Resend
                          </button>
                          <button className="btn-sm danger" style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                            onClick={(e) => { e.stopPropagation(); setStatusConfirm({ id: q.id, status: "Rejected", number: q.quotation_number }); }}>
                            <XCircle size={13} /> Reject
                          </button>
                        </>
                      )}
                      {q.status === "Approved" && (
                        <>
                          <button className="btn-sm" style={{ padding: "7px", borderRadius: 8, background: "rgba(107,114,128,0.06)", color: "var(--muted)", border: "1px solid rgba(107,114,128,0.12)", cursor: "pointer", display: "flex", alignItems: "center" }}
                            onClick={(e) => { e.stopPropagation(); handleDownloadPdf(q); }} title="Download PDF">
                            <FileText size={14} />
                          </button>
                          <button className="btn-sm" style={{ padding: "7px", borderRadius: 8, background: "rgba(46,125,82,0.08)", color: "var(--green)", border: "1px solid rgba(46,125,82,0.15)", cursor: "pointer", display: "flex", alignItems: "center" }}
                            onClick={(e) => { e.stopPropagation(); handleDownloadBOM(q); }} title="Download BOM">
                            <Download size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                </div>
              );
            })}
            {/* ── Admin mobile: Re-upload tab — inject Dealer Responded cards ── */}
            {filter === "ReuploadRequested" && respondedRows.length > 0 && (
              <>
                <div style={{ padding: "7px 16px", fontSize: 11, fontWeight: 700, color: "#b45309", background: "rgba(245,158,11,0.06)", borderTop: "1px solid rgba(245,158,11,0.18)", borderBottom: "1px solid rgba(245,158,11,0.18)", textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 6 }}>
                  <CheckCircle size={11} /> Dealer Responded — Review Required ({respondedRows.length})
                </div>
                {respondedRows.map(q => {
                  const statusLabel = q.status;
                  return (
                    <div key={`mob-ar-${q.id}`} className="q-card" onClick={() => setSelectedQuotation(q)}
                      style={{ borderLeft: "3px solid #f59e0b", background: "rgba(245,158,11,0.025)" }}>
                      <div className="q-card-header">
                        <div>
                          <div className="q-card-number">{q.quotation_number}</div>
                          <div className="q-card-badges">
                            <span style={{ display: "inline-block", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "rgba(245,158,11,0.15)", color: "#b45309", border: "1px solid rgba(245,158,11,0.3)" }}>
                              ✓ Docs Submitted
                            </span>
                          </div>
                        </div>
                        <span className="badge badge-sun" style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", flexShrink: 0 }}>{statusLabel}</span>
                      </div>
                      <div className="q-card-body">
                        <div className="q-card-field"><span className="q-card-field-label">Date</span><span className="q-card-field-value muted">{new Date(q.created_at).toLocaleDateString("en-IN")}</span></div>
                        <div className="q-card-field"><span className="q-card-field-label">Dealer</span><span className="q-card-field-value">{q.dealer_name || "—"}</span></div>
                        <div className="q-card-field"><span className="q-card-field-label">Customer</span><span className="q-card-field-value">{q.customer_name || "—"}</span></div>
                        <div className="q-card-field"><span className="q-card-field-label">Capacity</span><span className="q-card-field-value">{Number(q.system_kw).toFixed(2)} kW</span></div>
                      </div>
                      <div className="q-card-footer" onClick={e => e.stopPropagation()}>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>Tap to review</span>
                        <div className="q-card-actions">
                          <button className="btn-sm" style={{ padding: "7px 14px", borderRadius: 8, background: "rgba(46,125,82,0.08)", color: "var(--green)", border: "1px solid rgba(46,125,82,0.15)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                            onClick={e => { e.stopPropagation(); setStatusConfirm({ id: q.id, status: "Approved", number: q.quotation_number }); }}>
                            <CheckCircle size={13} /> Approve
                          </button>
                          <button className="btn-sm danger" style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                            onClick={e => { e.stopPropagation(); setStatusConfirm({ id: q.id, status: "Rejected", number: q.quotation_number }); }}>
                            <XCircle size={13} /> Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>{/* end q-card-list */}

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
            padding: "env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px) 16px",
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
                alignItems: "flex-start",
                gap: 12,
                padding: "16px 20px",
                borderBottom: "1px solid rgba(0,0,0,0.06)",
                position: "sticky",
                top: 0,
                background: "var(--card-bg, #ffffff)",
                zIndex: 10
              }}
            >
              {/* Left: title + badges — flex:1 so it can shrink on mobile */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px 8px", flexWrap: "wrap", marginBottom: 6 }}>
                  {/* UX-6: Click quotation number to copy it to clipboard */}
                  <span
                    onClick={() => {
                      navigator.clipboard.writeText(selectedQuotation.quotation_number).then(() => {
                        setCopiedQuotationNumber(true);
                        setTimeout(() => setCopiedQuotationNumber(false), 2000);
                      }).catch(() => {});
                    }}
                    title="Click to copy quotation number"
                    style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--mono)", color: "var(--text)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, userSelect: "none" }}
                  >
                    {selectedQuotation.quotation_number}
                    {copiedQuotationNumber
                      ? <Check size={14} style={{ color: "var(--green)" }} />
                      : <Copy size={12} style={{ color: "var(--muted)", opacity: 0.6 }} />}
                  </span>
                  <span className={`badge ${selectedQuotation.status === "Approved" ? "badge-green" : selectedQuotation.status === "Rejected" ? "badge-red" : selectedQuotation.status === "ReuploadRequested" ? "" : "badge-sun"}`}
                    style={selectedQuotation.status === "ReuploadRequested" ? { background: "#b45309", color: "#fff", fontWeight: 700 } : {}}>
                    {selectedQuotation.status === "ReuploadRequested" ? "Re-upload Requested" : selectedQuotation.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  Submitted on {new Date(selectedQuotation.created_at).toLocaleDateString("en-IN")}
                </div>
              </div>
              {/* Close button — always right, never crowded */}
              <button
                onClick={() => setSelectedQuotation(null)}
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
                  marginTop: 2,
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
                              aadhaar_front: "Aadhaar Card (Front)",
                              aadhaar_back:  "Aadhaar Card (Back)",
                              pan:           "PAN Card",
                              passbook:      "Bank Passbook",
                              light_bill:    "Latest Light Bill",
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
                  {"System Specifications"}
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
                      {"Structure & Height"}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
                      {selectedQuotation.structure_height || "—"}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {"Uploaded Customer Documents"}
                  </div>
                  {(selectedQuotation.documents || []).filter(d => d.doc_type !== "other" && !d.doc_type.startsWith("geotag_")).length > 0 && (
                    <button
                      onClick={() => handleDownloadAllDocs(selectedQuotation.documents, selectedQuotation.customer_name, selectedQuotation.quotation_number)}
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        padding: "5px 12px", fontSize: 11, fontWeight: 600,
                        background: "var(--primary, #2E7D52)", color: "white",
                        border: "none", borderRadius: 8, cursor: "pointer",
                        transition: "opacity 0.15s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                      onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                      title="Download all customer documents as a ZIP file"
                    >
                      <Download size={12} /> Download All
                    </button>
                  )}
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
                                    : doc.doc_type === "light_bill"
                                    ? "Latest Light Bill"
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
                                  await uploadsApi.downloadSecure(doc.id, getQuotationDocFilename(doc, selectedQuotation.customer_name, selectedQuotation.quotation_number));
                                } catch(err) {
                                  console.error('Download failed:', err);
                                  setErrorDialog({ open: true, message: err.message || "Could not download the document. Please try again." });
                                }
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
                      {"No verification documents uploaded for this quotation."}
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
                                          await uploadsApi.downloadSecure(doc.id, getQuotationDocFilename(doc, selectedQuotation.customer_name, selectedQuotation.quotation_number));
                                        } catch(err) {
                                          console.error('Download failed:', err);
                                          setErrorDialog({ open: true, message: err.message || "Could not download the document. Please try again." });
                                        }
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
                      {"System Subtotal (Panels + Inverters + Acc)"}
                    </span>
                    <span style={{ fontWeight: 500, fontFamily: "var(--mono)" }}>{fmt(selectedQuotation.subtotal)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "var(--muted)" }}>GST @ {selectedQuotation.gst_rate || 12}%</span>
                    <span style={{ fontWeight: 500, fontFamily: "var(--mono)" }}>{fmt(selectedQuotation.gst_amount)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: 8, marginTop: 4 }}>
                    <strong>{"Total System Price"}</strong>
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
              className="modal-footer-responsive"
              style={{
                padding: "12px 16px",
                borderTop: "1px solid rgba(0,0,0,0.06)",
                background: "var(--light, #f8fafc)",
                position: "sticky",
                bottom: 0,
                zIndex: 10,
                borderBottomLeftRadius: 20,
                borderBottomRightRadius: 20,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {/* Top row: Download PDF */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn-sm"
                  style={{
                    background: "var(--primary-light, #eff6ff)",
                    color: "var(--primary, #3b82f6)",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: "pointer",
                    flex: "1 1 auto",
                    justifyContent: "center",
                    minWidth: 0,
                    whiteSpace: "nowrap",
                  }}
                  onClick={() => handleDownloadPdf(selectedQuotation)}
                >
                  <FileText size={14} /> Download PDF Quotation
                </button>
              </div>

              {/* Bottom row: status-specific action buttons */}
              {selectedQuotation.status === "Pending" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn-sm"
                    style={{ background: "var(--green)", color: "white", border: "none", borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flex: "1 1 auto", justifyContent: "center", minWidth: 0, whiteSpace: "nowrap" }}
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
                    style={{ borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flex: "1 1 auto", justifyContent: "center", minWidth: 0, whiteSpace: "nowrap" }}
                    disabled={actionLoading === selectedQuotation.id}
                    onClick={async () => {
                      setStatusConfirm({ id: selectedQuotation.id, status: "Rejected", number: selectedQuotation.quotation_number });
                      setSelectedQuotation(null);
                    }}
                  >
                    <XCircle size={14} /> Reject Request
                  </button>
                  <button
                      className="btn-sm"
                      style={{ background: "#fff3cd", color: "#856404", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600, flex: "1 1 auto", justifyContent: "center", minWidth: 0, whiteSpace: "nowrap" }}
                      disabled={actionLoading === selectedQuotation.id}
                      onClick={() => openReuploadModal(selectedQuotation)}
                    >
                      <RefreshCw size={14} /> Request Re-upload
                    </button>
                </div>
              )}

              {selectedQuotation.status === "Rejected" && (
                <button
                  className="btn-sm"
                  style={{ background: "#fff3cd", color: "#856404", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600, width: "100%", justifyContent: "center" }}
                  onClick={() => openReuploadModal(selectedQuotation)}
                >
                  <RefreshCw size={14} /> Request Re-upload
                </button>
              )}

              {selectedQuotation.status === "ReuploadRequested" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn-sm"
                    style={{ background: "#fff3cd", color: "#856404", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600, flex: "1 1 auto", justifyContent: "center", minWidth: 0, whiteSpace: "nowrap" }}
                    onClick={() => openReuploadModal(selectedQuotation)}
                  >
                    <RefreshCw size={14} /> Change Reupload Docs
                  </button>
                  <button
                    className="btn-sm danger"
                    style={{ borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flex: "1 1 auto", justifyContent: "center", minWidth: 0, whiteSpace: "nowrap" }}
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
                    style={{ background: "var(--green)", color: "white", border: "none", borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flex: "1 1 auto", justifyContent: "center", minWidth: 0, whiteSpace: "nowrap" }}
                    onClick={() => handleDownloadBOM(selectedQuotation)}
                  >
                    <Download size={14} /> Download Excel BOM
                  </button>
                  {/* Request Geo-Tag Reupload button — only after dealer has submitted at least once */}
                  {selectedQuotation.geotag_submitted ? (
                    <button
                      className="btn-sm"
                      style={{
                        background: selectedQuotation.geotag_reupload_requested ? "rgba(249,115,22,0.1)" : "rgba(107,114,128,0.06)",
                        color: selectedQuotation.geotag_reupload_requested ? "#ea580c" : "var(--muted)",
                        border: selectedQuotation.geotag_reupload_requested ? "1px solid rgba(249,115,22,0.3)" : "1px solid rgba(0,0,0,0.1)",
                        borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600,
                        flex: "1 1 auto", justifyContent: "center", minWidth: 0, whiteSpace: "nowrap",
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
                    <div style={{
                      fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 5,
                      padding: "8px 12px", background: "rgba(0,0,0,0.03)", borderRadius: 8,
                      border: "1px solid rgba(0,0,0,0.06)", flex: "1 1 auto", minWidth: 0,
                      lineHeight: 1.4,
                    }}>
                      <Camera size={13} style={{ flexShrink: 0 }} />
                      <span>Geo-tag re-upload available after dealer submits photos</span>
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
          zIndex: 9999, padding: "env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px) 16px"
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
                    Customer Documents
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 24 }}>
                    {[
                      { key: "aadhaar",       label: "Aadhaar Card" },
                      { key: "pan",           label: "PAN Card" },
                      { key: "passbook",      label: "Bank Passbook" },
                      { key: "light_bill",    label: "Latest Light Bill" },
                      { key: "vera_bill",     label: "Vera Bill" },
                      { key: "house_photo_1", label: "House Photo 1" },
                      { key: "house_photo_2", label: "House Photo 2" },
                      { key: "house_photo_3", label: "House Photo 3" },
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
          zIndex: 9999, padding: "env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px) 16px"
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
