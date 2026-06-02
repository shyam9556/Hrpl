import { useState, useEffect, useRef, useMemo } from "react";
import { quotations as quotationsApi, uploads as uploadsApi } from "../utils/api";
import { fmt, generatePdfQuotation } from "../utils/helpers";
import { Loader2, ClipboardList, MessageCircle, Mail, Copy, Check, Camera, MapPin, Upload, X, Eye, Download, Info, FileText, Truck, Package, Clock, ChevronLeft, ChevronRight, Plus, AlertCircle, RefreshCw, AlertTriangle, Lock } from "lucide-react";

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
  // Per-action loading state  -  prevents double-clicks and shows correct spinner per button.
  const [sharingWaId, setSharingWaId] = useState(null);
  const [sharingEmailId, setSharingEmailId] = useState(null);
  const [sharingCopyId, setSharingCopyId] = useState(null);
  const [dialogState, setDialogState] = useState({ open: false, title: "", message: "", variant: "info" });

  // GAP-4: Cache proposalDocIds within the page session so ensureProposalDocId
  // never uploads a second PDF for the same quotation (prevents duplicates on
  // concurrent WhatsApp + Email + Copy clicks).
  // Key: quotation.id (number)  ->  Value: public_token string
  const proposalDocIdCache = useRef(new Map());
  
  const [geotagModalQuotation, setGeotagModalQuotation] = useState(null);
  const [uploadingSlot, setUploadingSlot] = useState(null);
  // Tracks which upload phase the slot is in: null | 'gps' | 'upload'
  const [uploadPhase, setUploadPhase] = useState(null);
  // Tracks which slots were freshly re-uploaded IN THIS MODAL SESSION
  // (used to avoid false-clearing the flag based on old pre-existing docs)
  const [sessionReuploadedSlots, setSessionReuploadedSlots] = useState(new Set());

  // Portal document re-upload state
  const [portalReuploadModal, setPortalReuploadModal] = useState(null); // quotation object
  const [portalReuploadFiles, setPortalReuploadFiles] = useState({}); // { docType: File }
  const [portalAadhaarMode, setPortalAadhaarMode] = useState("photos"); // "photos" | "pdf"
  const [portalReuploadLoading, setPortalReuploadLoading] = useState(false);
  const [portalReuploadSuccess, setPortalReuploadSuccess] = useState(false);
  const [portalReuploadError, setPortalReuploadError] = useState("");

  // Compute stable blob URLs for portal reupload image previews.
  // useMemo ensures we create a URL exactly once per file reference, not on every render.
  // The useEffect below revokes stale URLs whenever portalReuploadFiles changes or the
  // modal closes, preventing memory leaks from uncollected blob object references.
  const portalPreviewUrls = useMemo(() => {
    const urls = {};
    for (const [docType, file] of Object.entries(portalReuploadFiles)) {
      if (file && file.type && file.type.startsWith("image/")) {
        urls[docType] = URL.createObjectURL(file);
      }
    }
    return urls;
  }, [portalReuploadFiles]);

  useEffect(() => {
    // Revoke the URLs computed in the PREVIOUS render cycle.
    // React runs the cleanup before re-running the effect, so this always
    // revokes the old set just before a new set is created.
    return () => {
      Object.values(portalPreviewUrls).forEach(url => {
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
      });
    };
  }, [portalPreviewUrls]);

  const GEOTAG_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const GEOTAG_MAX_SIZE_MB = 10;

  const DOC_LABELS = {
    aadhaar:       "Aadhaar Card",
    aadhaar_front: "Aadhaar Card — Front Side",
    aadhaar_back:  "Aadhaar Card — Back Side (QR Code)",
    pan:           "PAN Card",
    passport_photo: "Passport Photo",
    other:         "Dealership Agreement",
    passbook:      "Bank Passbook",
    site_photo:    "Latest Light Bill / Site Photo",
    vera_bill:     "Vera Bill",
    house_photo_1: "House Photo 1",
    house_photo_2: "House Photo 2",
    house_photo_3: "House Photo 3",
  };

  const DOC_ACCEPT = {
    aadhaar:       "image/jpeg,image/png,image/webp,application/pdf",
    aadhaar_front: "image/jpeg,image/png,image/webp,application/pdf",
    aadhaar_back:  "image/jpeg,image/png,image/webp,application/pdf",
    pan:           "image/jpeg,image/png,image/webp,application/pdf",
    passport_photo: "image/jpeg,image/png,image/webp,application/pdf",
    other:         "image/jpeg,image/png,image/webp,application/pdf",
    passbook:      "image/jpeg,image/png,image/webp,application/pdf",
    site_photo:    "image/jpeg,image/png,image/webp",
    vera_bill:     "image/jpeg,image/png,image/webp,application/pdf",
    house_photo_1: "image/jpeg,image/png,image/webp",
    house_photo_2: "image/jpeg,image/png,image/webp",
    house_photo_3: "image/jpeg,image/png,image/webp",
  };

  // Convert a File to a base64 payload for portal reupload submission
  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        data: reader.result,
        name: file.name,
        type: file.type,
        size: file.size,
      });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const openPortalReuploadModal = (q) => {
    setPortalReuploadModal(q);
    setPortalReuploadFiles({});
    setPortalAadhaarMode("photos");
    setPortalReuploadSuccess(false);
    setPortalReuploadError("");
  };

  const ALL_DOC_TYPES = Object.keys(DOC_LABELS);

  const handlePortalReuploadSubmit = async () => {
    const requiredDocs = portalReuploadModal.reupload_required_docs
      ? portalReuploadModal.reupload_required_docs.split(",").filter(Boolean)
      : [];

    if (requiredDocs.length === 0) {
      setPortalReuploadError("No specific documents were flagged. Please contact admin.");
      return;
    }

    // Validate — Aadhaar is special: PDF mode or two-photo mode
    const aadhaarNeeded = requiredDocs.includes("aadhaar");
    const aadhaarPdfOk    = aadhaarNeeded && portalAadhaarMode === "pdf"    && !!portalReuploadFiles.aadhaar;
    const aadhaarPhotosOk = aadhaarNeeded && portalAadhaarMode === "photos" && !!portalReuploadFiles.aadhaar_front && !!portalReuploadFiles.aadhaar_back;
    const aadhaarOk = !aadhaarNeeded || aadhaarPdfOk || aadhaarPhotosOk;

    if (!aadhaarOk) {
      if (portalAadhaarMode === "photos") {
        const frontMissing = !portalReuploadFiles.aadhaar_front;
        const backMissing  = !portalReuploadFiles.aadhaar_back;
        setPortalReuploadError(
          frontMissing && backMissing
            ? "Please upload both Aadhaar Front and Back photos."
            : frontMissing ? "Please upload the Aadhaar Front photo."
            : "Please upload the Aadhaar Back photo."
        );
      } else {
        setPortalReuploadError("Please upload the Aadhaar Card PDF or scan.");
      }
      return;
    }

    // Validate other required docs
    const otherDocs = requiredDocs.filter(d => d !== "aadhaar");
    const missing = otherDocs.filter(d => !portalReuploadFiles[d]);
    if (missing.length > 0) {
      setPortalReuploadError(`Please upload all required documents: ${missing.map(d => DOC_LABELS[d] || d).join(", ")}`);
      return;
    }

    setPortalReuploadLoading(true);
    setPortalReuploadError("");
    try {
      // Build payload — Aadhaar expands based on mode chosen by dealer
      const payload = {};
      for (const docType of otherDocs) {
        payload[docType] = await fileToBase64(portalReuploadFiles[docType]);
      }
      if (aadhaarNeeded) {
        if (portalAadhaarMode === "photos") {
          payload.aadhaar_front = await fileToBase64(portalReuploadFiles.aadhaar_front);
          payload.aadhaar_back  = await fileToBase64(portalReuploadFiles.aadhaar_back);
        } else {
          payload.aadhaar = await fileToBase64(portalReuploadFiles.aadhaar);
        }
      }
      await quotationsApi.submitPortalReupload(portalReuploadModal.id, payload);
      setPortalReuploadSuccess(true);
      setList(prev => prev.map(q =>
        q.id === portalReuploadModal.id
          ? { ...q, status: "Pending", reupload_required_docs: null, reupload_reason: null }
          : q
      ));
    } catch (err) {
      setPortalReuploadError(err.message || "Failed to submit documents. Please try again.");
    } finally {
      setPortalReuploadLoading(false);
    }
  };


  const handleUploadGeotag = async (qId, slotKey, file) => {
    // Client-side validation  -  prevents rejected upload round-trips
    if (!GEOTAG_ALLOWED_TYPES.includes(file.type)) {
      setDialogState({
        open: true,
        title: "Invalid File Type",
        message: "Only JPG, PNG, and WebP images are accepted for geo-tag photos. HEIC/HEIF is not supported  -  please convert the photo first.",
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
              timeout: 4000,  // reduced from 6s  -  avoids long freeze when GPS is unavailable
              maximumAge: 0
            });
          });
          lat = position.coords.latitude;
          lng = position.coords.longitude;
          // GPS coordinates intentionally not logged  -  location data is sensitive.
        } catch (geoErr) {
          console.warn("Could not capture GPS Coordinates automatically:", geoErr.message);
        }
      }

      setUploadPhase('upload');

      const res = await uploadsApi.single(file, "quotation", qId, slotKey, lat, lng);
      const newDoc = res.document;

      // PRIMARY FIX: Immediately fetch the blob URL for the newly uploaded document.
      // The useEffect only re-runs when geotagModalQuotation.id changes  -  since the
      // id stays the same across uploads, the new doc's blob URL would never be
      // fetched without this explicit call, leaving the View button stuck on "Loading...".
      try {
        const newBlobUrl = await uploadsApi.getSecureBlobUrl(newDoc.id);
        // Use Map.set()  -  no prototype-pollution risk (CWE-94 safe).
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

      // Mark geotag_uploaded = 1 locally (server already did this)
      setList(prev => prev.map(item =>
        item.id === qId ? { ...item, geotag_uploaded: 1 } : item
      ));
      setGeotagModalQuotation(prev =>
        prev && prev.id === qId ? { ...prev, geotag_uploaded: 1 } : prev
      );

      // Smart auto-clear: only clear flag after ALL requested slots are freshly
      // uploaded IN THIS SESSION. We use sessionReuploadedSlots (not updatedDocs)
      // because old pre-existing docs for other slots must NOT count as "done".
      const currentQ = list.find(item => item.id === qId);
      if (currentQ?.geotag_reupload_requested) {
        const requestedSlots = currentQ.geotag_reupload_slots
          ? currentQ.geotag_reupload_slots.split(",").filter(Boolean)
          : ["geotag_1", "geotag_2", "geotag_3"];

        // Add this slot to the session set
        const updatedSessionSlots = new Set(sessionReuploadedSlots);
        if (requestedSlots.includes(slotKey)) {
          updatedSessionSlots.add(slotKey);
          setSessionReuploadedSlots(updatedSessionSlots);
        }

        // Only clear when every requested slot has been uploaded in this session
        const allDone = requestedSlots.every(s => updatedSessionSlots.has(s));
        if (allDone) {
          quotationsApi.clearGeotagReupload(qId).catch(() => {});
          setList(prev => prev.map(item =>
            item.id === qId
              ? { ...item, geotag_reupload_requested: 0, geotag_reupload_reason: null, geotag_reupload_slots: null }
              : item
          ));
          setGeotagModalQuotation(prev =>
            prev && prev.id === qId
              ? { ...prev, geotag_reupload_requested: 0, geotag_reupload_reason: null, geotag_reupload_slots: null }
              : prev
          );
        }
      }

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

  // Reset session tracking every time the geo-tag modal is opened
  const openGeotagModal = (q) => {
    setSessionReuploadedSlots(new Set());
    setGeotagModalQuotation(q);
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

  // Body scroll lock for portal reupload modal \u2014 mirrors the geotag modal behaviour.
  // Without this the page scrolls behind the modal on mobile/touch devices.
  useEffect(() => {
    if (portalReuploadModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [portalReuploadModal]);

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
      {/* ————— Page Header ——————————————————————————————————————————————————————————————— */}
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 8 }}>
        <div>
          <div className="page-title" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.3px" }}>{t("My Requests")}</div>
          <div className="page-sub" style={{ fontSize: 13, marginTop: 2 }}>{t("Track and manage all your submitted quotations")}</div>
        </div>
        <a
          href="#new-quotation"
          onClick={e => { e.preventDefault(); window.dispatchEvent(new CustomEvent("hp:navigate", { detail: "new-quotation" })); }}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: "none", background: "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)", color: "white", border: "none", cursor: "pointer", boxShadow: "0 4px 14px rgba(46,125,82,0.3)", transition: "all 0.2s", whiteSpace: "nowrap" }}
        >
          <Plus size={15} /> New Quotation
        </a>
      </div>

      {/* ————— Quick stats strip ————————————————————————————————————————————————————————— */}
      {!loading && !fetchError && list.length > 0 && (() => {
        const total = list.length;
        const approved = list.filter(q => q.status === "Approved").length;
        const pending = list.filter(q => q.status === "Pending" || q.status === "ReuploadRequested").length;
        const rejected = list.filter(q => q.status === "Rejected").length;
        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginBottom: 16 }}>
            {[{label: "Total", value: total, color: "#6366f1"}, {label: "Approved", value: approved, color: "#2E7D52"}, {label: "Pending", value: pending, color: "#d97706"}, {label: "Rejected", value: rejected, color: "#dc2626"}].map(s => (
              <div key={s.label} style={{ background: "var(--card-bg, #fff)", borderRadius: 12, padding: "12px 16px", border: "1px solid rgba(0,0,0,0.05)", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.4px" }}>{s.label}</div>
              </div>
            ))}
          </div>
        );
      })()}

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
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {/* ————— Reupload alert banners —————————————————————————————————————————————————— */}
          {list.some(q => q.status === "ReuploadRequested") && (
            <div style={{
              borderLeft: "4px solid #dc2626",
              background: "linear-gradient(90deg, rgba(220,38,38,0.06) 0%, rgba(220,38,38,0.02) 100%)",
              padding: "16px 20px",
              display: "flex",
              gap: 14,
              alignItems: "flex-start",
              borderBottom: "1px solid rgba(220,38,38,0.12)",
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(220,38,38,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <AlertTriangle size={17} style={{ color: "#dc2626" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b", marginBottom: 6 }}>Action Required — Document Re-upload</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {list.filter(q => q.status === "ReuploadRequested").map(q => (
                    <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12.5, color: "#7f1d1d", lineHeight: 1.5 }}>
                        <span style={{ fontWeight: 700, fontFamily: "var(--mono)" }}>{q.quotation_number}</span>
                        {q.customer_name && <span style={{ opacity: 0.8 }}> · {q.customer_name}</span>}
                        {q.reupload_reason && <span style={{ fontStyle: "italic", opacity: 0.7 }}> — "{q.reupload_reason}"</span>}
                      </div>
                      <button
                        onClick={() => openPortalReuploadModal(q)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 7, background: "#dc2626", color: "white", border: "none", cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 2px 6px rgba(220,38,38,0.3)" }}
                      >
                        <RefreshCw size={10} /> Re-upload Now
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {list.some(q => q.status === "Approved" && q.geotag_reupload_requested) && (() => {
            const SLOT_LABELS = { geotag_1: "Site / Inverter Photo", geotag_2: "Solar Panels Photo", geotag_3: "ACDB / Net Meter Photo" };
            return (
              <div style={{
                borderLeft: "4px solid #ea580c",
                background: "linear-gradient(90deg, rgba(234,88,12,0.06) 0%, rgba(234,88,12,0.02) 100%)",
                padding: "16px 20px", display: "flex", gap: 14, alignItems: "flex-start",
                borderBottom: "1px solid rgba(234,88,12,0.12)",
              }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(234,88,12,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Camera size={17} style={{ color: "#ea580c" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#7c2d12", marginBottom: 6 }}>Action Required - Geo-Tag Photo Re-upload</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {list.filter(q => q.status === "Approved" && q.geotag_reupload_requested).map(q => {
                      const slotNames = q.geotag_reupload_slots
                        ? q.geotag_reupload_slots.split(",").filter(Boolean).map(s => SLOT_LABELS[s] || s).join(", ")
                        : "All 3 geo-tag photos";
                      return (
                        <div key={q.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ flex: 1, fontSize: 12.5, color: "#7c2d12", lineHeight: 1.5 }}>
                            <span style={{ fontWeight: 700, fontFamily: "var(--mono)" }}>{q.quotation_number}</span>
                            {q.customer_name && <span style={{ opacity: 0.8 }}> - {q.customer_name}</span>}
                            <div style={{ fontSize: 11, color: "#92400e", marginTop: 2 }}>
                              <strong>Photos needed:</strong> {slotNames}
                              {q.geotag_reupload_reason && <span style={{ fontStyle: "italic", opacity: 0.7 }}> - "{q.geotag_reupload_reason}"</span>}
                            </div>
                          </div>
                          <button
                            onClick={() => openGeotagModal(q)}
                            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 7, background: "#ea580c", color: "white", border: "none", cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 2px 6px rgba(234,88,12,0.3)" }}
                          >
                            <Camera size={10} /> Re-upload Now
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
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
                    {q.customer_name || "-"}
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", color: "var(--text)", fontSize: "13px" }}>
                    {Number(q.system_kw).toFixed(2)} kW
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", fontFamily: "var(--mono)", color: "var(--green)", fontWeight: 700, fontSize: "14px" }}>
                    {fmt(q.effective_price)}
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span className={`badge ${q.status === "Approved" ? "badge-green" : q.status === "Rejected" ? "badge-red" : "badge-sun"}`} style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", alignSelf: "flex-start" }}>
                        {q.status === "ReuploadRequested" ? "Re-upload Requested" : q.status}
                      </span>
                      {/* Document reupload button  -  show whenever status is ReuploadRequested */}
                      {q.status === "ReuploadRequested" && (
                        <button
                          onClick={() => openPortalReuploadModal(q)}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                            background: "rgba(220,38,38,0.08)", color: "#dc2626",
                            border: "1px solid rgba(220,38,38,0.2)", cursor: "pointer",
                            whiteSpace: "nowrap"
                          }}
                        >
                          <RefreshCw size={9} /> Re-upload Documents
                        </button>
                      )}
                      {/* Geo-tag reupload alert banner */}
                      {q.status === "Approved" && q.geotag_reupload_requested ? (
                        <button
                          onClick={() => openGeotagModal(q)}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                            background: "rgba(234,88,12,0.08)", color: "#ea580c",
                            border: "1px solid rgba(234,88,12,0.2)", cursor: "pointer",
                            whiteSpace: "nowrap"
                          }}
                        >
                          <Camera size={9} /> Re-upload Geo-Tags
                        </button>
                      ) : null}
                    </div>
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
                      <span style={{ color: "var(--muted)", fontSize: "12px" }}> - </span>
                    )}
                  </td>
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", textAlign: "center" }}>
                    {q.status === "Approved" ? (
                      (() => {
                        const g1 = q.documents?.some(d => d.doc_type === "geotag_1");
                        const g2 = q.documents?.some(d => d.doc_type === "geotag_2");
                        const g3 = q.documents?.some(d => d.doc_type === "geotag_3");
                        const count = [g1, g2, g3].filter(Boolean).length;
                        const needsReupload = !!q.geotag_reupload_requested;

                        return (
                          <button
                            onClick={() => openGeotagModal(q)}
                            className="btn-sm"
                            style={{
                              padding: "4px 8px",
                              fontSize: "10px",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontWeight: 600,
                              borderRadius: "6px",
                              background: needsReupload
                                ? "rgba(234,88,12,0.1)"
                                : count === 3 ? "rgba(46, 125, 82, 0.08)" : "rgba(249, 115, 22, 0.08)",
                              color: needsReupload
                                ? "#ea580c"
                                : count === 3 ? "var(--green)" : "#f97316",
                              border: `1px solid ${needsReupload
                                ? "rgba(234,88,12,0.25)"
                                : count === 3 ? "var(--green)" : "rgba(249, 115, 22, 0.2)"}`,
                              cursor: "pointer",
                              transition: "all 0.2s"
                            }}
                          >
                            <Camera size={11} />
                            <span>{needsReupload ? "Re-upload" : `${count}/3 Uploaded`}</span>
                          </button>
                        );
                      })()
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: "12px" }}> - </span>
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
                Showing {(page - 1) * 20 + 1}-{Math.min(page * 20, pagination.total)} of {pagination.total}
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
            padding: "env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px) 16px",
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
                {geotagModalQuotation.geotag_reupload_requested ? (
                  <div style={{ fontSize: 12, color: "#ea580c", marginTop: 4, display: "flex", alignItems: "center", gap: 5, fontWeight: 600 }}>
                    <AlertTriangle size={12} /> Admin has requested geo-tag re-upload
                    {geotagModalQuotation.geotag_reupload_reason && (
                      <span style={{ fontWeight: 400, color: "#9a3412" }}> - {geotagModalQuotation.geotag_reupload_reason}</span>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    Upload on-site images with GPS tagging enabled to complete the installation file.
                  </div>
                )}
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
              {(() => {
                const isFirstUpload = !geotagModalQuotation.geotag_uploaded;
                const reuploadRequested = !!geotagModalQuotation.geotag_reupload_requested;
                const requestedSlots = reuploadRequested && geotagModalQuotation.geotag_reupload_slots
                  ? geotagModalQuotation.geotag_reupload_slots.split(",").filter(Boolean)
                  : reuploadRequested ? ["geotag_1", "geotag_2", "geotag_3"] : [];

                const slots = [
                  { key: "geotag_1", label: "1. Site / Inverter Photo", desc: "Show physical mounting area & inverter." },
                  { key: "geotag_2", label: "2. Solar Panels Photo", desc: "Show full rooftop panels layout." },
                  { key: "geotag_3", label: "3. ACDB / Net Meter", desc: "Show grid utility connection board." }
                ];

                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
                    {slots.map(slot => {
                      const doc = geotagModalQuotation.documents?.find(d => d.doc_type === slot.key);
                      const fileUrl = doc ? (blobUrls.get(doc.id) ?? null) : null;

                      // Determine if this slot is editable
                      const isUnlocked = isFirstUpload || requestedSlots.includes(slot.key);
                      const isLocked = !isUnlocked && !!doc; // submitted & locked
                      const needsReupload = reuploadRequested && requestedSlots.includes(slot.key);

                      return (
                        <div
                          key={slot.key}
                          style={{
                            border: isLocked
                              ? "1.5px solid rgba(46,125,82,0.25)"
                              : needsReupload
                                ? "1.5px dashed #ea580c"
                                : "1.5px solid var(--border)",
                            borderRadius: 16,
                            padding: 16,
                            background: isLocked
                              ? "rgba(46,125,82,0.03)"
                              : needsReupload
                                ? "rgba(249,115,22,0.03)"
                                : "var(--light, #f8fafc)",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "stretch",
                            minHeight: 240,
                            transition: "all 0.2s"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: isLocked ? "#1a5c38" : needsReupload ? "#c2410c" : "var(--text)" }}>
                              {slot.label}
                            </div>
                            {isLocked && (
                              <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 700, color: "#2E7D52", background: "rgba(46,125,82,0.1)", borderRadius: 20, padding: "2px 7px", border: "1px solid rgba(46,125,82,0.2)" }}>
                                <Lock size={8} /> Locked
                              </div>
                            )}
                            {needsReupload && (
                              <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 700, color: "#ea580c", background: "rgba(249,115,22,0.1)", borderRadius: 20, padding: "2px 7px", border: "1px solid rgba(249,115,22,0.25)" }}>
                                <AlertTriangle size={8} /> Re-upload
                              </div>
                            )}
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
                                    <div style={{
                                      width: "100%", height: 110, borderRadius: 8, marginBottom: 10,
                                      background: "linear-gradient(90deg, rgba(0,0,0,0.04) 25%, rgba(0,0,0,0.08) 50%, rgba(0,0,0,0.04) 75%)",
                                      backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite",
                                      display: "flex", justifyContent: "center", alignItems: "center"
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
                                {doc.latitude && doc.longitude ? (
                                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6, padding: "2px 8px", borderRadius: 20, background: "rgba(46,125,82,0.08)", border: "1px solid rgba(46,125,82,0.2)", fontSize: 9, fontWeight: 700, color: "var(--green)" }}>
                                    <MapPin size={9} /> GPS Captured
                                  </div>
                                ) : (
                                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6, padding: "2px 8px", borderRadius: 20, background: "rgba(249,115,22,0.07)", border: "1px solid rgba(249,115,22,0.18)", fontSize: 9, fontWeight: 700, color: "#f97316" }}>
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

                          {/* Upload / Locked Buttons */}
                          <div style={{ marginTop: 14, display: "flex", gap: 6 }}>
                            {isLocked ? (
                              // Slot is submitted & admin hasn't requested re-upload  -  show locked state
                              <>
                                <button
                                  onClick={() => fileUrl && window.open(fileUrl, "_blank")}
                                  className="btn-sm"
                                  disabled={!fileUrl}
                                  style={{ flex: 1, padding: "6px 0", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, background: "white", color: fileUrl ? "var(--text)" : "var(--muted)", border: "1.5px solid var(--border)", cursor: fileUrl ? "pointer" : "default", borderRadius: 8, opacity: fileUrl ? 1 : 0.6 }}
                                >
                                  <Eye size={12} /> {fileUrl ? "View" : "Loading..."}
                                </button>
                                <div style={{ flex: 1.2, padding: "6px 0", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, background: "rgba(46,125,82,0.06)", color: "#2E7D52", border: "1.5px solid rgba(46,125,82,0.2)", borderRadius: 8, fontWeight: 600 }}>
                                  <Check size={12} /> Submitted
                                </div>
                              </>
                            ) : doc ? (
                              // Slot has a doc & is unlocked (re-upload requested for this slot)
                              <>
                                <button
                                  onClick={() => fileUrl && window.open(fileUrl, "_blank")}
                                  className="btn-sm"
                                  disabled={!fileUrl}
                                  style={{ flex: 1, padding: "6px 0", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, background: "white", color: fileUrl ? "var(--text)" : "var(--muted)", border: "1.5px solid var(--border)", cursor: fileUrl ? "pointer" : "default", borderRadius: 8, opacity: fileUrl ? 1 : 0.6 }}
                                >
                                  <Eye size={12} /> {fileUrl ? "View" : "Loading..."}
                                </button>
                                <label
                                  style={{
                                    flex: 1.2, padding: "6px 0", fontSize: 11,
                                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
                                    background: "rgba(234,88,12,0.08)", color: "#c2410c",
                                    border: "1.5px dashed rgba(234,88,12,0.4)",
                                    borderRadius: 8, cursor: uploadingSlot === slot.key ? "not-allowed" : "pointer",
                                    fontWeight: 600
                                  }}
                                >
                                  {uploadingSlot === slot.key ? (
                                    <><Loader2 size={12} className="animate-spin" />{uploadPhase === "gps" ? "Getting GPS..." : "UpLoading..."}</>
                                  ) : (
                                    <><Upload size={12} /> Re-upload</>
                                  )}
                                  <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }}
                                    disabled={uploadingSlot !== null}
                                    onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) handleUploadGeotag(geotagModalQuotation.id, slot.key, f); }}
                                  />
                                </label>
                              </>
                            ) : (
                              // Slot has no doc  -  free upload (first time)
                              <label
                                style={{
                                  width: "100%", padding: "8px 0", fontSize: 12,
                                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                                  background: "var(--primary, #3b82f6)", color: "white",
                                  borderRadius: 8, cursor: uploadingSlot === slot.key ? "not-allowed" : "pointer",
                                  fontWeight: 600
                                }}
                              >
                                {uploadingSlot === slot.key ? (
                                  <><Loader2 size={13} className="animate-spin" />{uploadPhase === "gps" ? "Getting GPS..." : "UpLoading..."}</>
                                ) : (
                                  <><Upload size={13} /> Upload Photo</>
                                )}
                                <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }}
                                  disabled={uploadingSlot !== null}
                                  onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) handleUploadGeotag(geotagModalQuotation.id, slot.key, f); }}
                                />
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

                  
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

      {/* Portal Document Re-upload Modal */}
      {portalReuploadModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(15,23,42,0.45)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1100, padding: "env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px) 16px"
        }}>
          <div style={{
            background: "var(--card-bg, #fff)", borderRadius: 20, width: "100%", maxWidth: 680,
            maxHeight: "92vh", display: "flex", flexDirection: "column",
            boxShadow: "0 25px 50px -12px rgba(0,0,0,0.3)",
            border: "1px solid rgba(0,0,0,0.06)",
            animation: "modalFadeIn 0.2s ease-out"
          }}>
            {/* Header */}
            <div style={{
              padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between",
              borderBottom: "1px solid rgba(0,0,0,0.06)",
              background: portalReuploadSuccess ? "#f0fdf4" : "#fff8f0",
              borderRadius: "20px 20px 0 0"
            }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: portalReuploadSuccess ? "#15803d" : "#92400e", display: "flex", alignItems: "center", gap: 8 }}>
                  <RefreshCw size={16} />
                  {portalReuploadSuccess ? "Documents Submitted Successfully" : "Re-upload Documents"}
                </div>
                {!portalReuploadSuccess && (
                  <div style={{ fontSize: 12, color: "#b45309", marginTop: 2, fontWeight: 500 }}>
                    Quotation: {portalReuploadModal.quotation_number}
                    {portalReuploadModal.reupload_reason && `  -  ${portalReuploadModal.reupload_reason}`}
                  </div>
                )}
              </div>
              <button
                onClick={() => { if (!portalReuploadLoading) setPortalReuploadModal(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", display: "flex", padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
              {portalReuploadSuccess ? (
                <div style={{ textAlign: "center", padding: "24px 0" }}>
                  <div style={{
                    width: 64, height: 64, borderRadius: "50%", background: "#dcfce7",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#15803d", margin: "0 auto 16px"
                  }}>
                    <Check size={32} strokeWidth={3} />
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 8 }}>Documents Submitted!</div>
                  <p style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.7, maxWidth: 380, margin: "0 auto 24px" }}>
                    Your documents have been submitted successfully. The admin team will review them and update the status of your quotation shortly.
                  </p>
                  <button
                    onClick={() => setPortalReuploadModal(null)}
                    className="btn-sm primary"
                    style={{ padding: "10px 28px", borderRadius: 10, fontSize: 14 }}
                  >
                    Done
                  </button>
                </div>
              ) : (
                <div>
                  {/* Reason banner */}
                  {portalReuploadModal.reupload_reason && (
                    <div style={{
                      background: "#fff8e6", border: "1px solid rgba(245,158,11,0.3)",
                      borderRadius: 12, padding: "10px 14px", display: "flex", gap: 10,
                      alignItems: "flex-start", marginBottom: 20
                    }}>
                      <AlertTriangle size={15} style={{ color: "#d97706", flexShrink: 0, marginTop: 1 }} />
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 3 }}>Admin's Reason for Re-upload</div>
                        <div style={{ fontSize: 13, color: "#78350f", lineHeight: 1.5 }}>{portalReuploadModal.reupload_reason}</div>
                      </div>
                    </div>
                  )}

                    {/* Upload zones  -  only the docs admin specified */}
                  {(() => {
                    const docList = portalReuploadModal.reupload_required_docs
                      ? portalReuploadModal.reupload_required_docs.split(",").filter(Boolean)
                      : [];
                    const aadhaarNeeded = docList.includes("aadhaar");
                    const otherDocs = docList.filter(d => d !== "aadhaar");
                    const count = (aadhaarNeeded ? 1 : 0) + otherDocs.length;

                    if (count === 0) return (
                      /* No specific docs flagged */
                      <div style={{ textAlign: "center", padding: "24px 16px", background: "rgba(0,0,0,0.02)", borderRadius: 12, border: "1.5px dashed rgba(0,0,0,0.1)" }}>
                        <AlertTriangle size={28} style={{ color: "#d97706", marginBottom: 8 }} />
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#92400e", marginBottom: 4 }}>No Documents Specified</div>
                        <div style={{ fontSize: 12, color: "#78350f", lineHeight: 1.6 }}>
                          Admin has not specified which documents to re-upload.<br />
                          Please contact your admin for clarification.
                        </div>
                      </div>
                    );

                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

                        {/* ── Aadhaar Card (if required) ── */}
                        {aadhaarNeeded && (
                          <div style={{
                            background: "#f8fafc",
                            border: `1.5px solid ${(portalAadhaarMode === "photos" ? (portalReuploadFiles.aadhaar_front && portalReuploadFiles.aadhaar_back) : portalReuploadFiles.aadhaar) ? "#2E7D52" : "rgba(0,0,0,0.1)"}`,
                            borderRadius: 14,
                            padding: "12px 14px",
                          }}>
                            {/* Header + toggle */}
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#1a5c38" }}>Aadhaar Card</div>
                              <div style={{ display: "inline-flex", background: "rgba(0,0,0,0.06)", borderRadius: 999, padding: 3, gap: 2 }}>
                                {[{ val: "photos", label: "Two Photos" }, { val: "pdf", label: "PDF / Scan" }].map(({ val, label }) => (
                                  <button key={val} type="button"
                                    onClick={() => { setPortalAadhaarMode(val); setPortalReuploadError(""); }}
                                    style={{
                                      padding: "4px 12px", borderRadius: 999, border: "none",
                                      fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.18s",
                                      background: portalAadhaarMode === val ? "#2E7D52" : "transparent",
                                      color: portalAadhaarMode === val ? "white" : "#6b7280",
                                    }}>{ label }</button>
                                ))}
                              </div>
                            </div>

                            {/* Upload zones based on mode */}
                            {portalAadhaarMode === "photos" ? (
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                                {[{ key: "aadhaar_front", label: "Front Side" }, { key: "aadhaar_back", label: "Back Side" }].map(({ key, label }) => {
                                  const file = portalReuploadFiles[key];
                                  return (
                                    <div key={key} style={{ border: `1.5px dashed ${file ? "#2E7D52" : "rgba(0,0,0,0.18)"}`, borderRadius: 12, padding: "12px", background: file ? "rgba(46,125,82,0.03)" : "#fafafa", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                                      <div style={{ fontSize: 11, fontWeight: 700, color: file ? "#1a5c38" : "#374151", textAlign: "center" }}>{label}</div>
                                      {file ? (
                                        <>
                                          {file.type.startsWith("image/") ? (
                                            <img src={portalPreviewUrls[key]} alt={label} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8, border: "1.5px dashed rgba(46,125,82,0.3)" }} />
                                          ) : (
                                            <div style={{ width: 60, height: 60, background: "rgba(46,125,82,0.08)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                              <FileText size={24} style={{ color: "#2E7D52" }} />
                                            </div>
                                          )}
                                          <div style={{ fontSize: 10, color: "var(--muted)", textAlign: "center", wordBreak: "break-all" }}>{file.name}</div>
                                        </>
                                      ) : (
                                        <div style={{ width: 60, height: 60, background: "#f3f4f6", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                          <Upload size={20} style={{ color: "#9ca3af" }} />
                                        </div>
                                      )}
                                      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "6px 0", borderRadius: 8, width: "100%", cursor: portalReuploadLoading ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 600, background: file ? "rgba(46,125,82,0.1)" : "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)", color: file ? "#2E7D52" : "white", opacity: portalReuploadLoading ? 0.6 : 1, marginTop: "auto" }}>
                                        <Upload size={10} /> {file ? "Change" : "Choose"}
                                        <input type="file" accept={DOC_ACCEPT.aadhaar_front} style={{ display: "none" }} disabled={portalReuploadLoading} onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) setPortalReuploadFiles(prev => ({ ...prev, [key]: f })); }} />
                                      </label>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              /* PDF mode — single zone */
                              (() => {
                                const file = portalReuploadFiles.aadhaar;
                                return (
                                  <div style={{ border: `1.5px dashed ${file ? "#2E7D52" : "rgba(0,0,0,0.18)"}`, borderRadius: 12, padding: "12px 14px", background: file ? "rgba(46,125,82,0.03)" : "#fafafa", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                                    {file ? (
                                      <>
                                        {file.type.startsWith("image/") ? (
                                          <img src={portalPreviewUrls.aadhaar} alt="Aadhaar" style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 10, border: "1.5px dashed rgba(46,125,82,0.3)" }} />
                                        ) : (
                                          <div style={{ width: 70, height: 70, background: "rgba(46,125,82,0.08)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                            <FileText size={28} style={{ color: "#2E7D52" }} />
                                          </div>
                                        )}
                                        <div style={{ fontSize: 11, color: "#374151", fontWeight: 600, wordBreak: "break-all", textAlign: "center" }}>{file.name}</div>
                                        <div style={{ fontSize: 10, color: "var(--muted)" }}>{(file.size / 1024).toFixed(0)} KB</div>
                                      </>
                                    ) : (
                                      <>
                                        <div style={{ width: 70, height: 70, background: "#f3f4f6", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                          <Upload size={24} style={{ color: "#9ca3af" }} />
                                        </div>
                                        <div style={{ fontSize: 11, color: "#9ca3af" }}>No file selected</div>
                                      </>
                                    )}
                                    <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 0", borderRadius: 8, width: "100%", cursor: portalReuploadLoading ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600, background: file ? "rgba(46,125,82,0.08)" : "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)", color: file ? "#2E7D52" : "white", opacity: portalReuploadLoading ? 0.6 : 1, marginTop: "auto" }}>
                                      <Upload size={11} /> {file ? "Change File" : "Choose File"}
                                      <input type="file" accept={DOC_ACCEPT.aadhaar} style={{ display: "none" }} disabled={portalReuploadLoading} onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) setPortalReuploadFiles(prev => ({ ...prev, aadhaar: f })); }} />
                                    </label>
                                  </div>
                                );
                              })()
                            )}
                          </div>
                        )}

                        {/* ── Other documents ── */}
                        {otherDocs.length > 0 && (
                          <div style={{ display: "grid", gridTemplateColumns: otherDocs.length === 1 ? "1fr" : "1fr 1fr", gap: 12 }}>
                            {otherDocs.map(docType => {
                              const file = portalReuploadFiles[docType];
                              return (
                                <div key={docType} style={{
                                  border: `1.5px dashed ${file ? "#2E7D52" : "rgba(0,0,0,0.18)"}`,
                                  borderRadius: 14, padding: "14px 14px 12px",
                                  background: file ? "rgba(46,125,82,0.03)" : "#fafafa",
                                  display: "flex", flexDirection: "column", alignItems: "center",
                                  gap: 10, transition: "all 0.2s",
                                }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: file ? "#1a5c38" : "#374151", textAlign: "center" }}>
                                    {DOC_LABELS[docType] || docType}
                                  </div>
                                  {file ? (
                                    <>
                                      {file.type.startsWith("image/") ? (
                                        <img src={portalPreviewUrls[docType]} alt={file.name}
                                          style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 10, border: "1.5px dashed rgba(46,125,82,0.3)" }} />
                                      ) : (
                                        <div style={{ width: 70, height: 70, background: "rgba(46,125,82,0.08)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", border: "1.5px dashed rgba(46,125,82,0.25)" }}>
                                          <FileText size={28} style={{ color: "#2E7D52" }} />
                                        </div>
                                      )}
                                      <div style={{ textAlign: "center", width: "100%" }}>
                                        <div style={{ fontSize: 11, color: "#374151", fontWeight: 600, wordBreak: "break-all", lineHeight: 1.4, marginBottom: 2 }}>{file.name}</div>
                                        <div style={{ fontSize: 10, color: "var(--muted)" }}>{(file.size / 1024).toFixed(0)} KB</div>
                                      </div>
                                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: "#2E7D52", background: "rgba(46,125,82,0.1)", border: "1px dashed rgba(46,125,82,0.3)", borderRadius: 20, padding: "3px 10px" }}>
                                        <Check size={9} /> File Selected
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <div style={{ width: 70, height: 70, background: "#f3f4f6", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", border: "1.5px dashed rgba(0,0,0,0.15)" }}>
                                        <Upload size={24} style={{ color: "#9ca3af" }} />
                                      </div>
                                      <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "center" }}>No file selected</div>
                                    </>
                                  )}
                                  <label style={{
                                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                                    padding: "7px 0", borderRadius: 8, width: "100%", boxSizing: "border-box",
                                    cursor: portalReuploadLoading ? "not-allowed" : "pointer",
                                    fontSize: 12, fontWeight: 600,
                                    background: file ? "rgba(46,125,82,0.08)" : "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)",
                                    color: file ? "#2E7D52" : "white",
                                    border: file ? "1.5px dashed rgba(46,125,82,0.3)" : "none",
                                    opacity: portalReuploadLoading ? 0.6 : 1,
                                    marginTop: "auto", transition: "all 0.2s"
                                  }}>
                                    <Upload size={11} /> {file ? "Change File" : "Choose File"}
                                    <input type="file"
                                      accept={DOC_ACCEPT[docType] || "image/jpeg,image/png,image/webp,application/pdf"}
                                      style={{ display: "none" }}
                                      disabled={portalReuploadLoading}
                                      onChange={(e) => {
                                        const f = e.target.files[0];
                                        e.target.value = "";
                                        if (f) setPortalReuploadFiles(prev => ({ ...prev, [docType]: f }));
                                      }}
                                    />
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Error message */}
                  {portalReuploadError && (
                    <div style={{
                      marginTop: 16, background: "#fef2f2", border: "1px solid rgba(220,38,38,0.2)",
                      borderRadius: 10, padding: "10px 14px", display: "flex", gap: 8, alignItems: "center"
                    }}>
                      <AlertTriangle size={14} style={{ color: "#dc2626", flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: "#dc2626" }}>{portalReuploadError}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            {!portalReuploadSuccess && (
              <div style={{
                padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center",
                borderTop: "1px solid rgba(0,0,0,0.06)", gap: 12
              }}>
                <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>
                  After submission, your quotation will be reviewed by the admin team.
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => setPortalReuploadModal(null)}
                    className="btn-sm"
                    style={{ background: "white", color: "var(--text)", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, padding: "8px 16px", cursor: portalReuploadLoading ? "not-allowed" : "pointer" }}
                    disabled={portalReuploadLoading}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePortalReuploadSubmit}
                    disabled={portalReuploadLoading}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "8px 20px", borderRadius: 8, border: "none", cursor: portalReuploadLoading ? "not-allowed" : "pointer",
                      background: portalReuploadLoading ? "#9ca3af" : "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)",
                      color: "white", fontWeight: 700, fontSize: 13,
                      boxShadow: portalReuploadLoading ? "none" : "0 4px 12px rgba(46,125,82,0.25)"
                    }}
                  >
                    {portalReuploadLoading ? (
                      <><Loader2 size={14} className="animate-spin" /> Submitting...</>
                    ) : (
                      <><Check size={14} /> Submit Documents</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
