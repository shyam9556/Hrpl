import { useState, useEffect, useRef } from "react";
import { quotations as quotationsApi, uploads as uploadsApi } from "../utils/api";
import { fmt, generatePdfQuotation, generateBOM } from "../utils/helpers";
import { Loader2, ClipboardList, MessageCircle, Mail, Copy, Check, Camera, MapPin, Upload, X, Eye, Download, Info, FileText, Truck, Package, Clock, ChevronLeft, ChevronRight, Plus, AlertCircle } from "lucide-react";
import { t } from "../utils/i18n";
import ConfirmDialog from "./ConfirmDialog";
import ErrorState from "./ErrorState";

export default function DealerRequests() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  // Using a Map instead of a plain object so that doc.id keys never risk
  // prototype-chain access (fixes CWE-94: bracket notation with server-supplied input).
  const [blobUrls, setBlobUrls] = useState(() => new Map());

  const [copiedId, setCopiedId] = useState(null);
  // Per-action loading state — prevents double-clicks and shows correct spinner per button.
  const [sharingWaId, setSharingWaId] = useState(null);
  const [sharingEmailId, setSharingEmailId] = useState(null);
  const [sharingCopyId, setSharingCopyId] = useState(null);
  const [dialogState, setDialogState] = useState({ open: false, title: "", message: "", variant: "info" });

  // GAP-4: Cache proposalDocIds within the page session so ensureProposalDocId
  // never uploads a second PDF for the same quotation (prevents duplicates on
  // concurrent WhatsApp + Email + Copy clicks).
  // Key: quotation.id (number) → Value: public_token string
  const proposalDocIdCache = useRef(new Map());
  
  const [geotagModalQuotation, setGeotagModalQuotation] = useState(null);
  const [uploadingSlot, setUploadingSlot] = useState(null);
  // Tracks which upload phase the slot is in: null | 'gps' | 'upload'
  const [uploadPhase, setUploadPhase] = useState(null);

  const GEOTAG_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const GEOTAG_MAX_SIZE_MB = 10;

  const handleUploadGeotag = async (qId, slotKey, file) => {
    // Client-side validation — prevents rejected upload round-trips
    if (!GEOTAG_ALLOWED_TYPES.includes(file.type)) {
      setDialogState({
        open: true,
        title: "Invalid File Type",
        message: "Only JPG, PNG, and WebP images are accepted for geo-tag photos. HEIC/HEIF is not supported — please convert the photo first.",
        variant: "danger"
      });
      return;
    }
    if (file.size > GEOTAG_MAX_SIZE_MB * 1024 * 1024) {
      setDialogState({
        open: true,
        title: "File Too Large",
        message: `Photo must be under ${GEOTAG_MAX_SIZE_MB}MB. Please compress or resize it before uploading.`,
        variant: "danger"
      });
      return;
    }

    try {
      setUploadingSlot(slotKey);
      setUploadPhase('gps');

      let lat = null;
      let lng = null;

      if (navigator.geolocation) {
        try {
          const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 4000,  // reduced from 6s — avoids long freeze when GPS is unavailable
              maximumAge: 0
            });
          });
          lat = position.coords.latitude;
          lng = position.coords.longitude;
          // GPS coordinates intentionally not logged — location data is sensitive.
        } catch (geoErr) {
          console.warn("Could not capture GPS Coordinates automatically:", geoErr.message);
        }
      }

      setUploadPhase('upload');

      const res = await uploadsApi.single(file, "quotation", qId, slotKey, lat, lng);
      const newDoc = res.document;

      // PRIMARY FIX: Immediately fetch the blob URL for the newly uploaded document.
      // The useEffect only re-runs when geotagModalQuotation.id changes — since the
      // id stays the same across uploads, the new doc's blob URL would never be
      // fetched without this explicit call, leaving the View button stuck on "Loading…".
      try {
        const newBlobUrl = await uploadsApi.getSecureBlobUrl(newDoc.id);
        // Use Map.set() — no prototype-pollution risk (CWE-94 safe).
        setBlobUrls(prev => new Map(prev).set(newDoc.id, newBlobUrl));
      } catch (blobErr) {
        console.warn("Could not pre-fetch blob URL for new upload:", blobErr.message);
      }

      // Update the local list of quotations
      setList(prev => prev.map(item => {
        if (item.id === qId) {
          const existingDocs = item.documents || [];
          const cleanDocs = existingDocs.filter(d => d.doc_type !== slotKey);
          return {
            ...item,
            documents: [...cleanDocs, newDoc]
          };
        }
        return item;
      }));

      // Update the modal quotation reference too
      setGeotagModalQuotation(prev => {
        if (prev && prev.id === qId) {
          const existingDocs = prev.documents || [];
          const cleanDocs = existingDocs.filter(d => d.doc_type !== slotKey);
          return {
            ...prev,
            documents: [...cleanDocs, newDoc]
          };
        }
        return prev;
      });

    } catch (err) {
      console.error("Upload geotag error:", err);
      setDialogState({
        open: true,
        title: "Upload Failed",
        message: err.message || "Failed to upload geotag image.",
        variant: "danger"
      });
    } finally {
      setUploadingSlot(null);
      setUploadPhase(null);
    }
  };

  useEffect(() => {
    setLoading(true);
    quotationsApi.list({ page, limit: 20 })
      .then(res => {
        setList(res.quotations || []);
        if (res.pagination) setPagination(res.pagination);
      })
      .catch(err => {
        console.error("Fetch quotations error:", err);
        setFetchError(true);
      })
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => {
    if (geotagModalQuotation) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [geotagModalQuotation]);

  useEffect(() => {
    if (!geotagModalQuotation) {
      // Delay revocation by 1.5s so any tab the user opened with a blob URL
      // still renders correctly before we revoke it.
      const revokeTimer = setTimeout(() => {
        setBlobUrls(prev => {
          prev.forEach(url => { try { URL.revokeObjectURL(url); } catch(e) {} });
          return new Map();
        });
      }, 1500);
      return () => clearTimeout(revokeTimer);
    }

    const docs = geotagModalQuotation.documents || [];
    const geotagDocs = docs.filter(d => ['geotag_1', 'geotag_2', 'geotag_3'].includes(d.doc_type));
    let cancelled = false;
    const createdUrls = new Set();

    // Only fetch blob URLs for documents that aren't already loaded
    geotagDocs.forEach(async (doc) => {
      try {
        const url = await uploadsApi.getSecureBlobUrl(doc.id);
        if (!cancelled) {
          createdUrls.add(url);
          setBlobUrls(prev => {
            // If a URL was already set for this doc (e.g. from handleUploadGeotag),
            // revoke the newly fetched duplicate to avoid memory leaks.
            if (prev.has(doc.id)) {
              try { URL.revokeObjectURL(url); } catch(e) {}
              return prev;
            }
            // Return a new Map with the added entry — Map.get/has never
            // touches the prototype chain (no CWE-94 risk).
            return new Map(prev).set(doc.id, url);
          });
        } else {
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        console.error('Failed to load secure blob URL for doc', doc.id, ':', err.message);
      }
    });

    return () => {
      cancelled = true;
      // Delay revocation so open tabs still work for a moment
      setTimeout(() => {
        createdUrls.forEach(url => { try { URL.revokeObjectURL(url); } catch(e) {} });
      }, 1500);
    };
  }, [geotagModalQuotation?.id]);

  const getGreetingMessage = (q, pdfLink = "") => {
    const customerName = (q.customer_name || "Customer").toUpperCase();
    const systemSize = Number(q.system_kw || 0).toFixed(2);
    const panelBrand = q.panel_brand || "";
    const panelWatt = q.panel_watt || "";
    const inverterBrand = q.inverter_brand || "";
    const inverterKw = q.inverter_kw || "";
    const effectivePrice = fmt(Number(q.effective_price || 0));

    const pdfLine = pdfLink
      ? `View/Download your Official PDF Proposal:\n${pdfLink}`
      : `Your detailed PDF quotation proposal is attached.`;

    if (q.payment_mode === "Kit Purchase") {
      return `Hello ${customerName},

Thank you for choosing Highlight Pro. We are pleased to present the official dealer pricing proposal for your ${systemSize} kW Solar Rooftop Kit:

- System Size: ${systemSize} kW
- Panels: ${q.panel_count} pcs (${panelBrand} ${panelWatt}W)
- Inverter: ${inverterBrand} ${Number(inverterKw)}kW
- Kit Price: ${fmt(Number(q.total))}

Let us help power your home with clean, renewable energy.

${pdfLine}`;
    }

    if (Number(q.subsidy_amount || 0) > 0) {
      return `Hello ${customerName},

Thank you for choosing Highlight Pro. We are pleased to present the proposal for your ${systemSize} kW Solar Rooftop System:

- System Size: ${systemSize} kW
- Panels: ${q.panel_count} pcs (${panelBrand} ${panelWatt}W)
- Inverter: ${inverterBrand} ${Number(inverterKw)}kW
- Govt Subsidy: Applicable
- Effective Price: ${effectivePrice}

Let us help power your home with clean, renewable energy.

${pdfLine}`;
    } else {
      return `Hello ${customerName},

Thank you for choosing Highlight Pro. We are pleased to present the proposal for your ${systemSize} kW Solar Rooftop System:

- System Size: ${systemSize} kW
- Panels: ${q.panel_count} pcs (${panelBrand} ${panelWatt}W)
- Inverter: ${inverterBrand} ${Number(inverterKw)}kW
- System Price: ${fmt(Number(q.total))}

Let us help power your home with clean, renewable energy.

${pdfLine}`;
    }
  };

  const ensureProposalDocId = async (q) => {
    // GAP-4: Check the in-memory cache first — prevents duplicate PDF uploads
    // when the dealer clicks WhatsApp + Email + Copy in quick succession.
    if (proposalDocIdCache.current.has(q.id)) {
      return proposalDocIdCache.current.get(q.id);
    }

    // Match only PDF documents with mime_type check (not just filename) to avoid false positives
    let proposalDoc = q.documents?.find(
      doc => doc.doc_type === "other" &&
             (doc.mime_type === "application/pdf" || doc.original_name?.toLowerCase().endsWith(".pdf"))
    );
    if (proposalDoc?.public_token) {
      proposalDocIdCache.current.set(q.id, proposalDoc.public_token);
      return proposalDoc.public_token;
    }

    // FIX: Include customerAddress so PDF address field is populated correctly.
    // Previously missing, causing the PDF to fall back to city for the address line.
    const customerData = {
      id: q.quotation_number,
      date: new Date(q.created_at).toLocaleDateString("en-IN"),
      customerName: q.customer_name,
      customerAddress: q.customer_address || q.customer_city || "",
      customerCity: q.customer_city,
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

    try {
      const pdfResult = await generatePdfQuotation(customerData, quoteData, panelData, inverterData, { download: false });
      if (pdfResult && pdfResult.file) {
        const uploadRes = await uploadsApi.single(pdfResult.file, "quotation", q.id, "other");
        const token = uploadRes.document.public_token;
        // GAP-4: Cache immediately after first successful upload
        proposalDocIdCache.current.set(q.id, token);
        // Update the local list state so it caches
        setList(prev => prev.map(item => {
          if (item.id === q.id) {
            const docs = item.documents || [];
            return { ...item, documents: [...docs, uploadRes.document] };
          }
          return item;
        }));
        return token;
      }
    } catch (err) {
      console.error("Failed to generate and upload PDF on the fly:", err);
    }
    return null;
  };

  const shareWhatsApp = async (q) => {
    if (sharingWaId === q.id) return; // prevent double-click
    // 1. Open the new window synchronously to prevent browser from blocking the popup!
    const waWindow = window.open("", "_blank");
    if (!waWindow) {
      setDialogState({ open: true, title: "Popup Blocked", message: "Please allow popups for this site to open WhatsApp.", variant: "danger" });
      return;
    }
    setSharingWaId(q.id);
    try {
      const docId = await ensureProposalDocId(q);
      const pdfLink = docId ? `${window.location.origin}/api/uploads/public/${docId}` : "";
      const message = getGreetingMessage(q, pdfLink);
      const phone = q.customer_phone || "";
      const cleanPhone = phone.replace(/\D/g, "");
      const phoneWithCountry = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const waUrl = `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`;

      if (!docId) {
        // Fallback: download locally — include customerAddress for correct PDF address field
        const customerData = {
          id: q.quotation_number,
          date: new Date(q.created_at).toLocaleDateString("en-IN"),
          customerName: q.customer_name,
          customerAddress: q.customer_address || q.customer_city || "",
          customerCity: q.customer_city,
          customerPhone: q.customer_phone,
          structureHeight: q.structure_height,
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
        const panelData = { brand: q.panel_brand, watt: q.panel_watt, type: q.panel_type };
        const inverterData = { brand: q.inverter_brand, kw: q.inverter_kw, type: q.inverter_type };
        await generatePdfQuotation(customerData, quoteData, panelData, inverterData, { download: true });
        waWindow.location.href = waUrl;
        setDialogState({ open: true, title: "PDF Downloaded", message: "PDF proposal downloaded! Customer's WhatsApp chat has been opened. Please attach the downloaded PDF file to this chat.", variant: "info" });
      } else {
        waWindow.location.href = waUrl;
      }
    } catch (err) {
      console.error("Error sharing to WhatsApp:", err);
      waWindow.close();
      setDialogState({ open: true, title: "Share Failed", message: "Failed to share via WhatsApp.", variant: "danger" });
    } finally {
      setSharingWaId(null);
    }
  };

  const shareEmail = async (q) => {
    if (sharingEmailId === q.id) return; // prevent double-click
    setSharingEmailId(q.id);
    try {
      const docId = await ensureProposalDocId(q);
      const pdfLink = docId ? `${window.location.origin}/api/uploads/public/${docId}` : "";

      // Only generate + download the PDF locally when no server copy is available.
      // If a server copy exists, the PDF link in the email body is sufficient.
      if (!docId) {
        // FIX: Include customerAddress for correct PDF address field.
        const customerData = {
          id: q.quotation_number,
          date: new Date(q.created_at).toLocaleDateString("en-IN"),
          customerName: q.customer_name,
          customerAddress: q.customer_address || q.customer_city || "",
          customerCity: q.customer_city,
          customerPhone: q.customer_phone,
          structureHeight: q.structure_height,
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
        const panelData = { brand: q.panel_brand, watt: q.panel_watt, type: q.panel_type };
        const inverterData = { brand: q.inverter_brand, kw: q.inverter_kw, type: q.inverter_type };
        await generatePdfQuotation(customerData, quoteData, panelData, inverterData, { download: true });
      }

      const message = getGreetingMessage(q, pdfLink);
      const email = q.customer_email || "";
      const subject = `Solar System Proposal - Highlight Renewable Energy (${q.quotation_number})`;
      const url = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
      window.open(url, "_blank");
    } catch (err) {
      console.error("Error sharing to Email:", err);
      setDialogState({ open: true, title: "Email Failed", message: "Failed to share via Email.", variant: "danger" });
    } finally {
      setSharingEmailId(null);
    }
  };

  const copyToClipboard = async (q) => {
    if (sharingCopyId === q.id) return; // prevent double-click
    setSharingCopyId(q.id);
    try {
      const docId = await ensureProposalDocId(q);
      const pdfLink = docId ? `${window.location.origin}/api/uploads/public/${docId}` : "";

      // Only download the PDF locally when there is no server-hosted copy to link to.
      // The copy action's primary purpose is to put a shareable message + link on the
      // clipboard — downloading a file when a link already exists is redundant.
      if (!docId) {
        // FIX: Include customerAddress for correct PDF address field.
        const customerData = {
          id: q.quotation_number,
          date: new Date(q.created_at).toLocaleDateString("en-IN"),
          customerName: q.customer_name,
          customerAddress: q.customer_address || q.customer_city || "",
          customerCity: q.customer_city,
          customerPhone: q.customer_phone,
          structureHeight: q.structure_height,
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
        const panelData = { brand: q.panel_brand, watt: q.panel_watt, type: q.panel_type };
        const inverterData = { brand: q.inverter_brand, kw: q.inverter_kw, type: q.inverter_type };
        await generatePdfQuotation(customerData, quoteData, panelData, inverterData, { download: true });
      }

      const message = getGreetingMessage(q, pdfLink);
      try {
        await navigator.clipboard.writeText(message);
        setCopiedId(q.id);
        setTimeout(() => setCopiedId(null), 2000);
      } catch (clipErr) {
        console.error("Clipboard copy failed", clipErr);
        setDialogState({ open: true, title: "Copy Failed", message: "Clipboard access denied. Please allow clipboard permissions.", variant: "danger" });
      }
    } catch (err) {
      console.error("Error copying to clipboard:", err);
      setDialogState({ open: true, title: "Copy Failed", message: "Failed to copy message.", variant: "danger" });
    } finally {
      setSharingCopyId(null);
    }
  };

  return (
    <div>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="page-title">{t("My Requests")}</div>
          <div className="page-sub">{t("Track all your submitted quotations")}</div>
        </div>
        {/* GAP-2: Quick shortcut to create a new quotation without navigating via sidebar */}
        <a
          href="#new-quotation"
          onClick={e => { e.preventDefault(); window.dispatchEvent(new CustomEvent("hp:navigate", { detail: "new-quotation" })); }}
          className="btn-primary"
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, textDecoration: "none", background: "var(--green)", color: "white", border: "none", cursor: "pointer" }}
        >
          <Plus size={15} /> New Quotation
        </a>
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
          <div style={{ marginBottom: 8 }}><Loader2 size={32} className="animate-spin" /></div>Loading...
        </div>
      ) : fetchError ? (
        <ErrorState
          title="Failed to load quotations."
          message="Something went wrong while fetching your requests. Please try again."
          onRetry={() => { setFetchError(false); setPage(1); }}
        />
      ) : list.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
          <div style={{ marginBottom: 12 }}><ClipboardList size={40} strokeWidth={1} /></div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t("No quotations submitted yet")}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{t("Create your first quotation from the New Quotation page.")}</div>
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
            <thead>
              <tr>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>{t("Quotation #")}</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>{t("Date")}</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>{t("Customer")}</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>{t("Capacity")}</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>{t("Effective Price")}</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>{t("Status")}</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>{t("Delivery")}</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "center" }}>{t("Geo-Tags")}</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "center" }}>{t("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map(q => (
                <tr key={q.id} style={{ borderBottom: "1px solid rgba(0,0,0,0.04)", transition: "background 0.2s" }} className="table-row-hover">
                  <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
                    <div style={{ fontWeight: 600, fontFamily: "var(--mono)", color: "var(--text)", fontSize: "13px" }}>{q.quotation_number}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                      <span style={{ 
                        display: "inline-block",
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
                      {/* GAP-1: Show Expired badge for quotations past their validity date */}
                      {q.is_expired && q.status === "Pending" && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.2)" }}>
                          <AlertCircle size={9} /> Expired
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", color: "var(--muted)", fontSize: "13px" }}>
                    {new Date(q.created_at).toLocaleDateString("en-IN")}
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", fontWeight: 600, color: "var(--text)", fontSize: "13px" }}>
                    {q.customer_name || "—"}
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", color: "var(--text)", fontSize: "13px" }}>
                    {Number(q.system_kw).toFixed(2)} kW
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", fontFamily: "var(--mono)", color: "var(--green)", fontWeight: 700, fontSize: "14px" }}>
                    {fmt(q.effective_price)}
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
                    <span className={`badge ${q.status === "Approved" ? "badge-green" : q.status === "Rejected" ? "badge-red" : "badge-sun"}`} style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px" }}>
                      {q.status}
                    </span>
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
                    {q.status === "Approved" ? (
                      (() => {
                        let bg = "rgba(107, 114, 128, 0.06)";
                        let color = "#374151";
                        let border = "1px solid rgba(107, 114, 128, 0.15)";
                        let text = "Material Pending";
                        let icon = <Clock size={11} strokeWidth={2.5} />;

                        if (q.delivery_status === "Dispatched") {
                          bg = "rgba(217, 119, 6, 0.06)";
                          color = "#b45309";
                          border = "1px solid rgba(217, 119, 6, 0.18)";
                          text = "Dispatched";
                          icon = <Truck size={11} strokeWidth={2.5} />;
                        } else if (q.delivery_status === "Delivered") {
                          bg = "rgba(16, 185, 129, 0.08)";
                          color = "#047857";
                          border = "1px solid rgba(16, 185, 129, 0.18)";
                          text = "Delivered";
                          icon = <Check size={11} strokeWidth={3} />;
                        }

                        return (
                          <span style={{ 
                            fontSize: "11px", 
                            fontWeight: 600, 
                            padding: "4px 12px", 
                            borderRadius: "9999px", 
                            background: bg, 
                            color: color, 
                            border: border,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6
                          }}>
                            {icon} {text}
                          </span>
                        );
                      })()
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: "12px" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", textAlign: "center" }}>
                    {q.status === "Approved" ? (
                      (() => {
                        const g1 = q.documents?.some(d => d.doc_type === "geotag_1");
                        const g2 = q.documents?.some(d => d.doc_type === "geotag_2");
                        const g3 = q.documents?.some(d => d.doc_type === "geotag_3");
                        const count = [g1, g2, g3].filter(Boolean).length;
                        
                        return (
                          <button
                            onClick={() => setGeotagModalQuotation(q)}
                            className="btn-sm"
                            style={{
                              padding: "4px 8px",
                              fontSize: "10px",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontWeight: 600,
                              borderRadius: "6px",
                              background: count === 3 ? "rgba(46, 125, 82, 0.08)" : "rgba(249, 115, 22, 0.08)",
                              color: count === 3 ? "var(--green)" : "#f97316",
                              border: `1px solid ${count === 3 ? "var(--green)" : "rgba(249, 115, 22, 0.2)"}`,
                              cursor: "pointer",
                              transition: "all 0.2s"
                            }}
                          >
                            <Camera size={11} />
                            <span>{count}/3 Uploaded</span>
                          </button>
                        );
                      })()
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: "12px" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        onClick={() => shareWhatsApp(q)}
                        disabled={sharingWaId === q.id}
                        title="Share via WhatsApp"
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "6px", borderRadius: 8, background: "rgba(37, 211, 102, 0.08)", color: "#25D366", border: "1px solid rgba(37, 211, 102, 0.15)", cursor: sharingWaId === q.id ? "not-allowed" : "pointer", opacity: sharingWaId === q.id ? 0.6 : 1, transition: "all 0.2s" }}
                        onMouseOver={e => { if (sharingWaId !== q.id) { e.currentTarget.style.background = "#25D366"; e.currentTarget.style.color = "white"; } }}
                        onMouseOut={e => { if (sharingWaId !== q.id) { e.currentTarget.style.background = "rgba(37, 211, 102, 0.08)"; e.currentTarget.style.color = "#25D366"; } }}
                      >
                        {sharingWaId === q.id ? <Loader2 size={13} className="animate-spin" /> : <MessageCircle size={13} />}
                      </button>
                      <button
                        onClick={() => shareEmail(q)}
                        disabled={sharingEmailId === q.id}
                        title="Share via Email"
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "6px", borderRadius: 8, background: "rgba(46, 125, 82, 0.08)", color: "var(--green)", border: "1px solid rgba(46, 125, 82, 0.15)", cursor: sharingEmailId === q.id ? "not-allowed" : "pointer", opacity: sharingEmailId === q.id ? 0.6 : 1, transition: "all 0.2s" }}
                        onMouseOver={e => { if (sharingEmailId !== q.id) { e.currentTarget.style.background = "var(--green)"; e.currentTarget.style.color = "white"; } }}
                        onMouseOut={e => { if (sharingEmailId !== q.id) { e.currentTarget.style.background = "rgba(46, 125, 82, 0.08)"; e.currentTarget.style.color = "var(--green)"; } }}
                      >
                        {sharingEmailId === q.id ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                      </button>
                      <button
                        onClick={() => copyToClipboard(q)}
                        disabled={sharingCopyId === q.id}
                        title="Copy to Clipboard"
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "6px", borderRadius: 8, background: copiedId === q.id ? "rgba(46, 125, 82, 0.1)" : "rgba(107, 101, 96, 0.06)", color: copiedId === q.id ? "var(--green)" : "var(--muted)", border: copiedId === q.id ? "1px solid var(--green)" : "1px solid rgba(107, 101, 96, 0.12)", cursor: sharingCopyId === q.id ? "not-allowed" : "pointer", opacity: sharingCopyId === q.id ? 0.6 : 1, transition: "all 0.2s" }}
                      >
                        {sharingCopyId === q.id ? <Loader2 size={13} className="animate-spin" /> : copiedId === q.id ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                      {/* UX-3: BOM download for dealer on their own Approved quotations */}
                      {q.status === "Approved" && q.payment_mode !== "Kit Purchase" && (
                        <button
                          onClick={() => {
                            const bom = generateBOM({
                              systemKw: Number(q.system_kw),
                              panelCount: q.panel_count,
                              structureHeight: q.structure_height,
                            }, {});
                            const bomHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>BOM - ${q.quotation_number}</title></head><body style="font-family:sans-serif;padding:20px"><h2>Bill of Materials</h2><p>Quotation: ${q.quotation_number}</p><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th></tr></thead><tbody>${bom.map(i => `<tr><td>${i.name}</td><td>${i.qty}</td><td>${i.unit}</td></tr>`).join("")}</tbody></table></body></html>`;
                            const blob = new Blob([bomHtml], { type: "text/html" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url; a.download = `BOM_${q.quotation_number}.html`;
                            document.body.appendChild(a); a.click();
                            document.body.removeChild(a);
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                          }}
                          title="Download BOM"
                          style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "6px", borderRadius: 8, background: "rgba(107, 101, 96, 0.06)", color: "var(--muted)", border: "1px solid rgba(107, 101, 96, 0.12)", cursor: "pointer", transition: "all 0.2s" }}
                          onMouseOver={e => { e.currentTarget.style.background = "var(--text)"; e.currentTarget.style.color = "white"; }}
                          onMouseOut={e => { e.currentTarget.style.background = "rgba(107, 101, 96, 0.06)"; e.currentTarget.style.color = "var(--muted)"; }}
                        >
                          <FileText size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {pagination.totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, pagination.total)} of {pagination.total}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ padding: "4px 12px", fontSize: 12, borderRadius: 8, display: "flex", alignItems: "center", gap: 4 }}><ChevronLeft size={14} /> Prev</button>
                <span style={{ display: "flex", alignItems: "center", fontSize: 12, color: "var(--text)", fontWeight: 600, padding: "0 8px" }}>{page} / {pagination.totalPages}</span>
                <button className="btn-sm" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)} style={{ padding: "4px 12px", fontSize: 12, borderRadius: 8, display: "flex", alignItems: "center", gap: 4 }}>{t("Next")} <ChevronRight size={14} /></button>
              </div>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={dialogState.open}
        title={dialogState.title}
        message={dialogState.message}
        variant={dialogState.variant}
        confirmText="OK"
        hideCancel
        onConfirm={() => setDialogState({ ...dialogState, open: false })}
        onCancel={() => setDialogState({ ...dialogState, open: false })}
      />
      {geotagModalQuotation && (
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
          onClick={() => setGeotagModalQuotation(null)}
        >
          <div
            style={{
              background: "var(--card-bg, #ffffff)",
              borderRadius: 20,
              width: "100%",
              maxWidth: 680,
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
                  <span style={{ fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
                    Geo-Tag Project Photos
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12, background: "rgba(46,125,82,0.1)", color: "var(--green)", border: "1px solid rgba(46,125,82,0.2)" }}>
                    {geotagModalQuotation.quotation_number}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  Upload on-site images with GPS tagging enabled to complete the installation file.
                </div>
              </div>
              <button
                onClick={() => setGeotagModalQuotation(null)}
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
              {/* GPS Info Banner */}
              <div 
                style={{ 
                  background: "rgba(59, 130, 246, 0.05)", 
                  border: "1px solid rgba(59, 130, 246, 0.15)", 
                  borderRadius: 12, 
                  padding: 12, 
                  display: "flex", 
                  gap: 10, 
                  alignItems: "flex-start",
                  marginBottom: 20
                }}
              >
                <Info size={16} style={{ color: "#3b82f6", marginTop: 2, flexShrink: 0 }} />
                <div style={{ fontSize: 12, color: "#1e40af", lineHeight: 1.5 }}>
                  <strong>{t("Important Note on GPS Tagging:")}</strong>{" "}{t("Please capture these photos on your smartphone with")}{" "}<strong>{t("Location/GPS services enabled")}</strong>{" "}{t("inside your camera settings. This embeds the coordinates directly into the image.")}
                </div>
              </div>

              {/* Grid of 3 Upload Slots */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
                {[
                  { key: "geotag_1", label: "1. Site / Inverter Photo", desc: "Show physical mounting area & inverter." },
                  { key: "geotag_2", label: "2. Solar Panels Photo", desc: "Show full rooftop panels layout." },
                  { key: "geotag_3", label: "3. ACDB / Net Meter", desc: "Show grid utility connection board." }
                ].map(slot => {
                  const doc = geotagModalQuotation.documents?.find(d => d.doc_type === slot.key);
                  // Map.get() is CWE-94 safe — no prototype chain traversal.
                  const fileUrl = doc ? (blobUrls.get(doc.id) ?? null) : null;
                  
                  return (
                    <div 
                      key={slot.key}
                      style={{ 
                        border: "1.5px solid var(--border)", 
                        borderRadius: 16, 
                        padding: 16, 
                        background: "var(--light, #f8fafc)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "stretch",
                        minHeight: 240
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
                        {slot.label}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12, lineHeight: 1.3 }}>
                        {slot.desc}
                      </div>

                      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", position: "relative" }}>
                        {doc ? (
                          <div style={{ width: "100%", textAlign: "center" }}>
                            {doc.mime_type.startsWith("image/") ? (
                              fileUrl ? (
                                <img
                                  src={fileUrl}
                                  alt={slot.label}
                                  style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)", marginBottom: 10 }}
                                />
                              ) : (
                                // Skeleton placeholder while blob URL is being fetched
                                <div style={{
                                  width: "100%",
                                  height: 110,
                                  borderRadius: 8,
                                  marginBottom: 10,
                                  background: "linear-gradient(90deg, rgba(0,0,0,0.04) 25%, rgba(0,0,0,0.08) 50%, rgba(0,0,0,0.04) 75%)",
                                  backgroundSize: "200% 100%",
                                  animation: "shimmer 1.4s infinite",
                                  display: "flex",
                                  justifyContent: "center",
                                  alignItems: "center"
                                }}>
                                  <Loader2 size={20} className="animate-spin" style={{ color: "var(--muted)" }} />
                                </div>
                              )
                            ) : (
                              <div style={{ width: "100%", height: 110, background: "rgba(0,0,0,0.03)", borderRadius: 8, display: "flex", justifyContent: "center", alignItems: "center", marginBottom: 10 }}>
                                <FileText size={32} style={{ color: "var(--muted)" }} />
                              </div>
                            )}
                            <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>
                              {doc.original_name}
                            </div>
                            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                              {(doc.file_size_bytes / 1024).toFixed(0)} KB
                            </div>
                            {/* GPS status badge */}
                            {doc.latitude && doc.longitude ? (
                              <div style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                marginTop: 6,
                                padding: "2px 8px",
                                borderRadius: 20,
                                background: "rgba(46, 125, 82, 0.08)",
                                border: "1px solid rgba(46, 125, 82, 0.2)",
                                fontSize: 9,
                                fontWeight: 700,
                                color: "var(--green)"
                              }}>
                                <MapPin size={9} /> GPS Captured
                              </div>
                            ) : (
                              <div style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                marginTop: 6,
                                padding: "2px 8px",
                                borderRadius: 20,
                                background: "rgba(249, 115, 22, 0.07)",
                                border: "1px solid rgba(249, 115, 22, 0.18)",
                                fontSize: 9,
                                fontWeight: 700,
                                color: "#f97316"
                              }}>
                                <MapPin size={9} /> No GPS
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ textAlign: "center", padding: "12px 0" }}>
                            <Camera size={28} style={{ color: "var(--muted)", marginBottom: 8 }} />
                            <div style={{ fontSize: 11, color: "var(--muted)" }}>{t("No photo uploaded")}</div>
                          </div>
                        )}
                      </div>

                      {/* Upload / Manage Buttons */}
                      <div style={{ marginTop: 14, display: "flex", gap: 6 }}>
                        {doc ? (
                          <>
                            <button
                              onClick={() => fileUrl && window.open(fileUrl, "_blank")}
                              className="btn-sm"
                              disabled={!fileUrl}
                              style={{ flex: 1, padding: "6px 0", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, background: "white", color: fileUrl ? "var(--text)" : "var(--muted)", border: "1.5px solid var(--border)", cursor: fileUrl ? "pointer" : "default", borderRadius: 8, opacity: fileUrl ? 1 : 0.6 }}
                            >
                              <Eye size={12} /> {fileUrl ? "View" : "Loading…"}
                            </button>

                            <label
                              style={{ 
                                flex: 1.2, 
                                padding: "6px 0", 
                                fontSize: 11, 
                                display: "inline-flex", 
                                alignItems: "center", 
                                justifyContent: "center", 
                                gap: 4, 
                                background: "var(--green-light)", 
                                color: "var(--green)", 
                                border: "1.5px solid rgba(46,125,82,0.2)",
                                borderRadius: 8,
                                cursor: uploadingSlot === slot.key ? "not-allowed" : "pointer",
                                fontWeight: 600,
                                textAlign: "center"
                              }}
                            >
                              {uploadingSlot === slot.key ? (
                                <>
                                  <Loader2 size={12} className="animate-spin" />
                                  {uploadPhase === 'gps' ? 'Getting GPS…' : 'Uploading…'}
                                </>
                              ) : (
                                <>
                                  <Upload size={12} /> Change
                                </>
                              )}
                              <input 
                                type="file" 
                                accept="image/jpeg,image/png,image/webp" 
                                style={{ display: "none" }}
                                disabled={uploadingSlot !== null}
                                onChange={(e) => {
                                  const file = e.target.files[0];
                                  e.target.value = ""; // reset so same file can be re-selected
                                  if (file) handleUploadGeotag(geotagModalQuotation.id, slot.key, file);
                                }}
                              />
                            </label>
                          </>
                        ) : (
                          <label
                            style={{ 
                              width: "100%", 
                              padding: "8px 0", 
                              fontSize: 12, 
                              display: "inline-flex", 
                              alignItems: "center", 
                              justifyContent: "center", 
                              gap: 6, 
                              background: "var(--primary, #3b82f6)", 
                              color: "white", 
                              borderRadius: 8,
                              cursor: uploadingSlot === slot.key ? "not-allowed" : "pointer",
                              fontWeight: 600,
                              textAlign: "center"
                            }}
                          >
                            {uploadingSlot === slot.key ? (
                              <>
                                <Loader2 size={13} className="animate-spin" />
                                {uploadPhase === 'gps' ? 'Getting GPS…' : 'Uploading…'}
                              </>
                            ) : (
                              <>
                                <Upload size={13} /> Upload Photo
                              </>
                            )}
                            <input 
                              type="file" 
                              accept="image/jpeg,image/png,image/webp" 
                              style={{ display: "none" }}
                              disabled={uploadingSlot !== null}
                              onChange={(e) => {
                                const file = e.target.files[0];
                                e.target.value = ""; // reset so same file can be re-selected
                                if (file) handleUploadGeotag(geotagModalQuotation.id, slot.key, file);
                              }}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                padding: "16px 24px",
                borderTop: "1px solid rgba(0,0,0,0.06)",
                background: "var(--light, #f8fafc)",
                borderBottomLeftRadius: 20,
                borderBottomRightRadius: 20
              }}
            >
              <button
                onClick={() => setGeotagModalQuotation(null)}
                className="btn-primary"
                style={{ padding: "8px 20px", borderRadius: 10 }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
