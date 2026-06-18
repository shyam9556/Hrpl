import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { quotations as quotationsApi, uploads as uploadsApi } from "../utils/api";
import { fmt, generatePdfQuotation } from "../utils/helpers";
import { Loader2, ClipboardList, MessageCircle, Mail, Copy, Check, Camera, MapPin, Upload, X, Eye, Download, Info, FileText, Truck, Package, Clock, ChevronLeft, ChevronRight, Plus, AlertCircle, RefreshCw, AlertTriangle, Phone, Zap, Cpu, Home, CreditCard, Search } from "lucide-react";

import { t } from "../utils/i18n";
import ConfirmDialog from "./ConfirmDialog";
import ErrorState from "./ErrorState";

export default function DealerRequests() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  // Tab filter: "" = All | "Pending" | "Approved" | "Rejected" | "ReuploadRequested"
  const [filter, setFilter] = useState("");
  // Client-side search string (filtered from current page's list)
  const [search, setSearch] = useState("");
  // Filter-independent: ALL dealer quotations — feeds stats + action banners.
  // Fetched once (and on any mutation) at a high limit to cover all practical dealer sizes.
  const [globalList, setGlobalList] = useState([]);
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
  // Tracks whether the geo-tag submit action is in progress
  const [geotagSubmitting, setGeotagSubmitting] = useState(false);

  // Portal document re-upload state
  const [portalReuploadModal, setPortalReuploadModal] = useState(null); // quotation object
  const [portalReuploadFiles, setPortalReuploadFiles] = useState({}); // { docType: File }
  const [portalAadhaarMode, setPortalAadhaarMode] = useState("photos"); // "photos" | "pdf"
  const [portalReuploadLoading, setPortalReuploadLoading] = useState(false);
  const [portalReuploadSuccess, setPortalReuploadSuccess] = useState(false);
  const [portalReuploadError, setPortalReuploadError] = useState("");
  // Per-file upload progress tracking
  const [portalUploadProgress, setPortalUploadProgress] = useState({ current: 0, total: 0, currentDocType: "" });
  const [portalUploadedDocs, setPortalUploadedDocs] = useState(new Set()); // doc types already uploaded
  const [portalUploadStartTime, setPortalUploadStartTime] = useState(null);
  const [portalElapsed, setPortalElapsed] = useState(0);

  // Detail modal — opened when dealer clicks a row in the My Requests table
  const [selectedQuotation, setSelectedQuotation] = useState(null);
  const [detailPdfDownloading, setDetailPdfDownloading] = useState(false);
  // Per-row PDF download state (in the Actions column)
  const [pdfDownloadingId, setPdfDownloadingId] = useState(null);

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
    light_bill:    "Latest Light Bill",
    vera_bill:     "Vera Bill",
    house_photo_1: "House Photo 1",
    house_photo_2: "House Photo 2",
    house_photo_3: "House Photo 3",
  };

  const DOC_ACCEPT = {
    aadhaar:        "image/jpeg,image/png,image/webp,application/pdf",
    aadhaar_front:  "image/jpeg,image/png,image/webp,application/pdf",
    aadhaar_back:   "image/jpeg,image/png,image/webp,application/pdf",
    pan:            "image/jpeg,image/png,image/webp,application/pdf",
    passport_photo: "image/jpeg,image/png,image/webp,application/pdf",
    other:          "image/jpeg,image/png,image/webp,application/pdf",
    passbook:       "image/jpeg,image/png,image/webp,application/pdf",
    light_bill:     "image/jpeg,image/png,image/webp,application/pdf",
    vera_bill:      "image/jpeg,image/png,image/webp,application/pdf",
    house_photo_1:  "image/jpeg,image/png,image/webp,application/pdf",
    house_photo_2:  "image/jpeg,image/png,image/webp,application/pdf",
    house_photo_3:  "image/jpeg,image/png,image/webp,application/pdf",
  };

  const openPortalReuploadModal = (q) => {
    setPortalReuploadModal(q);
    setPortalReuploadFiles({});
    setPortalAadhaarMode("photos");
    setPortalReuploadSuccess(false);
    setPortalReuploadError("");
    setPortalUploadProgress({ current: 0, total: 0, currentDocType: "" });
    setPortalUploadedDocs(new Set());
    setPortalUploadStartTime(null);
    setPortalElapsed(0);
  };

  const ALL_DOC_TYPES = Object.keys(DOC_LABELS);

  // Elapsed time ticker — updates every second while upload is in progress
  useEffect(() => {
    if (!portalUploadStartTime) return;
    const interval = setInterval(() => {
      setPortalElapsed(Math.floor((Date.now() - portalUploadStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [portalUploadStartTime]);

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
    const aadhaarPdfOk    = aadhaarNeeded && portalAadhaarMode === "pdf"    && (!!portalReuploadFiles.aadhaar || portalUploadedDocs.has("aadhaar"));
    const aadhaarPhotosOk = aadhaarNeeded && portalAadhaarMode === "photos" && (!!portalReuploadFiles.aadhaar_front || portalUploadedDocs.has("aadhaar_front")) && (!!portalReuploadFiles.aadhaar_back || portalUploadedDocs.has("aadhaar_back"));
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
    const missing = otherDocs.filter(d => !portalReuploadFiles[d] && !portalUploadedDocs.has(d));
    if (missing.length > 0) {
      setPortalReuploadError(`Please upload all required documents: ${missing.map(d => DOC_LABELS[d] || d).join(", ")}`);
      return;
    }

    setPortalReuploadLoading(true);
    setPortalReuploadError("");
    setPortalUploadStartTime(Date.now());
    setPortalElapsed(0);

    try {
      // Build list of [docType, file] pairs to upload, skipping already-uploaded ones
      const filesToUpload = [];
      for (const docType of otherDocs) {
        if (!portalUploadedDocs.has(docType) && portalReuploadFiles[docType]) {
          filesToUpload.push([docType, portalReuploadFiles[docType]]);
        }
      }
      if (aadhaarNeeded) {
        if (portalAadhaarMode === "photos") {
          if (!portalUploadedDocs.has("aadhaar_front") && portalReuploadFiles.aadhaar_front)
            filesToUpload.push(["aadhaar_front", portalReuploadFiles.aadhaar_front]);
          if (!portalUploadedDocs.has("aadhaar_back") && portalReuploadFiles.aadhaar_back)
            filesToUpload.push(["aadhaar_back", portalReuploadFiles.aadhaar_back]);
        } else {
          if (!portalUploadedDocs.has("aadhaar") && portalReuploadFiles.aadhaar)
            filesToUpload.push(["aadhaar", portalReuploadFiles.aadhaar]);
        }
      }

      const totalFiles = filesToUpload.length;
      setPortalUploadProgress({ current: 0, total: totalFiles, currentDocType: "" });

      // Upload files one-by-one via FormData (fast, no base64 overhead)
      const newlyUploaded = new Set(portalUploadedDocs);
      for (let i = 0; i < filesToUpload.length; i++) {
        const [docType, file] = filesToUpload[i];
        setPortalUploadProgress({ current: i + 1, total: totalFiles, currentDocType: DOC_LABELS[docType] || docType });

        await uploadsApi.single(file, "quotation", portalReuploadModal.id, docType);
        newlyUploaded.add(docType);
        setPortalUploadedDocs(new Set(newlyUploaded));
      }

      // All files uploaded — finalize by calling complete endpoint
      setPortalUploadProgress(prev => ({ ...prev, currentDocType: "Finalizing..." }));
      await quotationsApi.completePortalReupload(portalReuploadModal.id);

      setPortalReuploadSuccess(true);
      setList(prev => prev.map(q =>
        q.id === portalReuploadModal.id
          ? { ...q, status: "Pending", reupload_required_docs: null, reupload_reason: null }
          : q
      ));
      // Refresh global stats + banners — the Re-upload banner must disappear immediately
      fetchGlobalData();
    } catch (err) {
      const failedDoc = portalUploadProgress.currentDocType;
      setPortalReuploadError(
        portalUploadedDocs.size > 0
          ? `Failed while uploading ${failedDoc}. ${portalUploadedDocs.size} file(s) uploaded successfully — tap Submit again to retry the remaining files.`
          : (err.message || "Failed to submit documents. Please try again.")
      );
    } finally {
      setPortalReuploadLoading(false);
      setPortalUploadStartTime(null);
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
      // Note: clearing geotag_reupload flags is now done in handleSubmitGeotag,
      // not automatically on upload. Dealer must explicitly click Submit.

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

  // Open the geo-tag modal for a given quotation
  const openGeotagModal = (q) => {
    setGeotagModalQuotation(q);
  };

  // Submit geo-tag photos — locks them and auto-closes the modal.
  // For first-time: all 3 slots must be uploaded.
  // For re-upload: all admin-requested slots must be uploaded.
  const handleSubmitGeotag = async (qId) => {
    setGeotagSubmitting(true);
    try {
      const res = await quotationsApi.submitGeotag(qId);
      const isReupload = res?.isReupload;
      // Update local state: mark submitted and clear reupload flags if applicable
      setList(prev => prev.map(item =>
        item.id === qId
          ? {
              ...item,
              geotag_submitted: 1,
              ...(isReupload ? { geotag_reupload_requested: 0, geotag_reupload_reason: null, geotag_reupload_slots: null } : {})
            }
          : item
      ));
      // Refresh global stats + banners — the Geo-Tag banner must disappear immediately
      fetchGlobalData();
      // Close modal automatically after successful submit
      setGeotagModalQuotation(null);
    } catch (err) {
      setDialogState({
        open: true,
        title: "Submit Failed",
        message: err.message || "Failed to submit geo-tag photos. Please try again.",
        variant: "danger"
      });
    } finally {
      setGeotagSubmitting(false);
    }
  };

  // fetchQuotations — server-side status filter + pagination
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

  // fetchGlobalData — filter-independent fetch of ALL dealer quotations.
  // Used to compute stats (Total/Approved/Pending/Rejected) and action-required banners.
  // limit:500 covers all practical dealer sizes without backend changes.
  const fetchGlobalData = useCallback(async () => {
    try {
      const res = await quotationsApi.list({ limit: 500 });
      setGlobalList(res.quotations || []);
    } catch { /* non-critical — stats and banners are UX enhancements */ }
  }, []);

  // Reset to page 1 whenever filter or search changes
  useEffect(() => { setPage(1); }, [filter]);
  useEffect(() => { setPage(1); }, [search]);
  // fetchQuotations re-runs on filter or page change (paginated, filter-sensitive)
  useEffect(() => { fetchQuotations(); }, [filter, page]);
  // fetchGlobalData runs once on mount and then every 30s to catch
  // status changes pushed by admin (reupload requests, approvals, etc.)
  // without needing a WebSocket connection. Also refreshes when the
  // dealer switches back to this browser tab.
  useEffect(() => { fetchGlobalData(); }, []);

  // 30-second polling — keeps Action Required banners up to date
  useEffect(() => {
    const id = setInterval(() => { fetchGlobalData(); }, 30_000);
    return () => clearInterval(id);
  }, [fetchGlobalData]);

  // Refresh immediately when dealer returns to this tab (visibility change)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") fetchGlobalData(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchGlobalData]);

  useEffect(() => {
    if (geotagModalQuotation) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [geotagModalQuotation]);

  // Body scroll lock for portal reupload modal — mirrors the geotag modal behaviour.
  // Without this the page scrolls behind the modal on mobile/touch devices.
  useEffect(() => {
    if (portalReuploadModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [portalReuploadModal]);

  // Body scroll lock for detail modal
  useEffect(() => {
    if (selectedQuotation) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [selectedQuotation]);

  // Keep selectedQuotation in sync when list changes (e.g. after geo-tag submit or reupload)
  useEffect(() => {
    if (!selectedQuotation) return;
    const updated = list.find(q => q.id === selectedQuotation.id);
    if (updated) setSelectedQuotation(updated);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  // ── SSE: Real-time updates from admin actions and own mutations ───────────
  // quotation:new: dealer submitted a new quotation (e.g. from another tab)
  // quotation:deleted: dealer or admin deleted a quotation
  // status_changed: admin approved/rejected/dispatched
  // delivery_changed: admin updated delivery milestone
  // reupload_requested: admin sent a document re-upload request to this dealer
  // geotag_reupload_requested: admin sent a geo-tag re-upload request
  // document:deleted: admin deleted one of the dealer's uploaded documents
  // document:uploaded: dealer uploaded a doc in another tab (e.g. geotag modal)
  // document:coordinates_updated: admin edited GPS on a geotag photo
  useEffect(() => {
    const handler = () => {
      fetchQuotations(false);
      fetchGlobalData();
    };
    const events = [
      "hp:sse:quotation:new",
      "hp:sse:quotation:deleted",
      "hp:sse:quotation:status_changed",
      "hp:sse:quotation:delivery_changed",
      "hp:sse:quotation:reupload_requested",
      "hp:sse:quotation:geotag_reupload_requested",
      // Dealer submitted geotag from another tab — banner must disappear immediately
      "hp:sse:quotation:geotag_submitted",
      "hp:sse:document:deleted",
      "hp:sse:document:uploaded",
      "hp:sse:document:coordinates_updated",
    ];
    events.forEach(e => window.addEventListener(e, handler));
    return () => events.forEach(e => window.removeEventListener(e, handler));
  }, [fetchQuotations, fetchGlobalData]);

  // ── Fallback polling: silent refresh every 60 seconds ────────────────────
  // Catches status changes in case the SSE connection is unavailable.
  // Both fetchQuotations (paginated list) and fetchGlobalData (stats banners) are refreshed.
  useEffect(() => {
    const id = setInterval(() => {
      fetchQuotations(false);
      fetchGlobalData();
    }, 60_000);
    return () => clearInterval(id);
  }, [fetchQuotations, fetchGlobalData]);


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

  // Download PDF directly from the table row — same logic as modal footer download
  const handleDownloadPdfRow = async (q) => {
    if (pdfDownloadingId === q.id) return; // prevent double-click
    setPdfDownloadingId(q.id);
    try {
      const customerData = {
        id: q.quotation_number,
        date: new Date(q.created_at).toLocaleDateString("en-IN"),
        customerName: q.customer_name,
        customerAddress: q.customer_address || q.customer_city || "",
        customerCity: q.customer_city,
        customerPhone: q.customer_phone,
        structureHeight: q.structure_height,
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
      const panelData    = { brand: q.panel_brand, watt: q.panel_watt, type: q.panel_type };
      const inverterData = { brand: q.inverter_brand, kw: q.inverter_kw, type: q.inverter_type };
      await generatePdfQuotation(customerData, quoteData, panelData, inverterData, { download: true });
    } catch (err) {
      console.error("Row PDF download failed:", err);
      setDialogState({ open: true, title: "Download Failed", message: "Could not generate the PDF. Please try again.", variant: "danger" });
    } finally {
      setPdfDownloadingId(null);
    }
  };

  // Download PDF from the detail modal footer — uses same generatePdfQuotation helper
  const handleDownloadPdfDetail = async (q) => {
    if (detailPdfDownloading) return;
    setDetailPdfDownloading(true);
    try {
      const customerData = {
        id: q.quotation_number,
        date: new Date(q.created_at).toLocaleDateString("en-IN"),
        customerName: q.customer_name,
        customerAddress: q.customer_address || q.customer_city || "",
        customerCity: q.customer_city,
        customerPhone: q.customer_phone,
        structureHeight: q.structure_height,
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
      const panelData    = { brand: q.panel_brand, watt: q.panel_watt, type: q.panel_type };
      const inverterData = { brand: q.inverter_brand, kw: q.inverter_kw, type: q.inverter_type };
      await generatePdfQuotation(customerData, quoteData, panelData, inverterData, { download: true });
    } catch (err) {
      console.error("PDF download failed:", err);
      setDialogState({ open: true, title: "Download Failed", message: "Could not generate the PDF. Please try again.", variant: "danger" });
    } finally {
      setDetailPdfDownloading(false);
    }
  };

  // ── Client-side search filter (applied to current page's list) ──────────
  const filteredList = useMemo(() => {
    if (!search.trim()) return list;
    const s = search.toLowerCase();
    return list.filter(q =>
      q.quotation_number?.toLowerCase().includes(s) ||
      q.customer_name?.toLowerCase().includes(s) ||
      q.customer_city?.toLowerCase().includes(s)
    );
  }, [list, search]);

  // ── Column visibility per active tab (mirrors admin logic) ───────────────
  const showStatus   = filter === "" || filter === "ReuploadRequested"; // Show on All tab and Re-upload tab
  const showDelivery = filter === "" || filter === "Approved";    // only meaningful post-approval
  const showGeoTags  = filter === "" || filter === "Approved";    // only meaningful post-approval
  const showActions  = filter !== "Rejected";                     // share buttons hidden for Rejected
  const showDownload = true;                                       // Download always available on all tabs

  // ── Derived from globalList (all dealer quotations, filter-independent) ──
  // Action-required items for the alert banners (shown on every tab)
  const reviewItems   = globalList.filter(q =>
    q.status === "ReuploadRequested" || (q.status === "Approved" && !!q.geotag_reupload_requested)
  );
  // Tab badge counts ("Admin needs action FROM me")
  const reuploadBadge = globalList.filter(q => q.status === "ReuploadRequested").length;
  const geotagBadge   = globalList.filter(q => q.status === "Approved" && !!q.geotag_reupload_requested).length;
  // Stats — accurate global counts across all pages and tabs
  const statsTotal    = globalList.length;
  const statsApproved = globalList.filter(q => q.status === "Approved").length;
  const statsPending  = globalList.filter(q => q.status === "Pending").length;
  const statsRejected = globalList.filter(q => q.status === "Rejected").length;
  const statsReupload = globalList.filter(q => q.status === "ReuploadRequested").length;

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

      {/* ————— Stats strip — ALL tabs, accurate global counts, 5 boxes matching 5 tabs ——————— */}
      {statsTotal > 0 && (
        <div className="dealer-stats-strip">
          {[
            { label: "Total",     value: statsTotal,    color: "#6366f1" },
            { label: "Approved",  value: statsApproved, color: "#2E7D52" },
            { label: "Pending",   value: statsPending,  color: "#d97706" },
            { label: "Rejected",  value: statsRejected, color: "#dc2626" },
            { label: "Re-upload", value: statsReupload, color: "#ea580c" },
          ].map(s => (
            <div key={s.label} className="dss-box">
              <div className="dss-val" style={{ color: s.color }}>{s.value}</div>
              <div className="dss-label">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ————— Filter Bar: Tabs + Search ——————————————————————————————————————————————— */}
      <div className="admin-filter-bar">
        {/* Scrollable Tab buttons */}
        <div className="hide-scrollbar" style={{ display: "flex", overflowX: "auto", gap: 8, WebkitOverflowScrolling: "touch", paddingBottom: 4, flex: 1, minWidth: 0 }}>
          {["", "Pending", "Approved", "Rejected", "ReuploadRequested"].map(s => {
            const badge =
              s === "ReuploadRequested" ? reuploadBadge :
              s === "Approved"          ? geotagBadge   : 0;
            return (
              <button
                key={s}
                className={`btn-sm ${filter === s ? "primary" : ""}`}
                onClick={() => setFilter(s)}
                style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                {s === "ReuploadRequested" ? "Re-upload" : (s || "All")}
                {badge > 0 && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    minWidth: 16, height: 16, borderRadius: 9999, padding: "0 4px",
                    background: filter === s ? "rgba(255,255,255,0.3)" : "#ea580c",
                    color: "white", fontSize: 10, fontWeight: 800,
                  }}>{badge}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: "var(--border, #e2e8f0)", margin: "0 4px", flexShrink: 0 }} className="desktop-only" aria-hidden="true" />

        {/* Search */}
        <div className="filter-search-box">
          <Search size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search quotation # or customer…"
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
            {filteredList.length} result{filteredList.length !== 1 ? "s" : ""}
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
          message="Something went wrong while fetching your requests. Please try again."
          onRetry={() => { setFetchError(false); fetchQuotations(true); }}
        />
      ) : list.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
          <div style={{ marginBottom: 12 }}><ClipboardList size={40} strokeWidth={1} /></div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {filter === "ReuploadRequested" ? "No re-upload requests"
              : filter ? `No ${filter} quotations`
              : t("No quotations submitted yet")}
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {filter
              ? <button className="btn-sm" style={{ marginTop: 8 }} onClick={() => setFilter("")}>View all quotations</button>
              : t("Create your first quotation from the New Quotation page.")}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "clip" }}>
          {/* ————— Action-required alert banners — filter-independent, using reviewItems ————— */}
          {reviewItems.some(q => q.status === "ReuploadRequested") && (
            <div style={{
              borderLeft: "4px solid #dc2626",
              background: "linear-gradient(90deg, rgba(220,38,38,0.06) 0%, rgba(220,38,38,0.02) 100%)",
              padding: "16px 20px",
              display: "flex",
              gap: 14,
              alignItems: "flex-start",
              flexWrap: "wrap",
              borderBottom: "1px solid rgba(220,38,38,0.12)",
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(220,38,38,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <AlertTriangle size={17} style={{ color: "#dc2626" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b", marginBottom: 6 }}>Action Required — Document Re-upload</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {reviewItems.filter(q => q.status === "ReuploadRequested").map(q => (
                    <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 200px", fontSize: 12.5, color: "#7f1d1d", lineHeight: 1.5 }}>
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
          {reviewItems.some(q => q.status === "Approved" && q.geotag_reupload_requested) && (() => {
            const SLOT_LABELS = { geotag_1: "Site / Inverter Photo", geotag_2: "Solar Panels Photo", geotag_3: "ACDB / Net Meter Photo" };
            return (
              <div style={{
                borderLeft: "4px solid #ea580c",
                background: "linear-gradient(90deg, rgba(234,88,12,0.06) 0%, rgba(234,88,12,0.02) 100%)",
                padding: "16px 20px", display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap",
                borderBottom: "1px solid rgba(234,88,12,0.12)",
              }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(234,88,12,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Camera size={17} style={{ color: "#ea580c" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#7c2d12", marginBottom: 6 }}>Action Required - Geo-Tag Photo Re-upload</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {reviewItems.filter(q => q.status === "Approved" && q.geotag_reupload_requested).map(q => {
                      return (
                        <div key={q.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ flex: "1 1 200px", fontSize: 12.5, color: "#7c2d12", lineHeight: 1.5 }}>
                            <span style={{ fontWeight: 700, fontFamily: "var(--mono)" }}>{q.quotation_number}</span>
                            {q.customer_name && <span style={{ opacity: 0.8 }}> - {q.customer_name}</span>}
                            {q.geotag_reupload_reason && <span style={{ fontStyle: "italic", opacity: 0.7 }}> — "{q.geotag_reupload_reason}"</span>}
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
          <div className="q-table-wrap">
          <div className="table-scroll-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: filter === "" ? "900px" : filter === "Approved" ? "820px" : "640px" }}>
            <thead>
              <tr>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>{t("Quotation #")}</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>{t("Date")}</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>{t("Customer")}</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>{t("Capacity")}</th>
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>{t("Effective Price")}</th>
                {showStatus   && <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "left" }}>{t("Status")}</th>}
                {showDelivery && <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "center" }}>{t("Delivery")}</th>}
                {showGeoTags  && <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "center" }}>{t("Geo-Tags")}</th>}
                <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", borderBottom: "1px solid var(--border)", textAlign: "center" }}>{t("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.map(q => (
                <tr
                  key={q.id}
                  style={{ borderBottom: "1px solid rgba(0,0,0,0.04)", transition: "background 0.2s", cursor: "pointer" }}
                  className="table-row-hover"
                  onClick={() => setSelectedQuotation(q)}
                >
                  <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
                    <div style={{ fontWeight: 600, fontFamily: "var(--mono)", color: "var(--text)", fontSize: "13px" }}>{q.quotation_number}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, flexWrap: "wrap" }}>

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
                  {showStatus && (
                  <td style={{ padding: "14px 16px", verticalAlign: "middle" }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span className={`badge ${q.status === "Approved" ? "badge-green" : q.status === "Rejected" ? "badge-red" : q.status === "ReuploadRequested" ? "" : "badge-sun"}`}
                        style={q.status === "ReuploadRequested" ? { fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: "#b45309", color: "#fff", fontWeight: 700, alignSelf: "flex-start" } : { fontSize: "11px", padding: "3px 8px", borderRadius: "6px", alignSelf: "flex-start" }}>
                        {q.status === "ReuploadRequested" ? "Re-upload Requested" : q.status}
                      </span>
                      {q.status === "ReuploadRequested" && (
                        <button
                          onClick={() => openPortalReuploadModal(q)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.2)", cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                          <RefreshCw size={9} /> Re-upload Documents
                        </button>
                      )}
                      {q.status === "Approved" && q.geotag_reupload_requested ? (
                        <button
                          onClick={() => openGeotagModal(q)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: "rgba(234,88,12,0.08)", color: "#ea580c", border: "1px solid rgba(234,88,12,0.2)", cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                          <Camera size={9} /> Re-upload Geo-Tags
                        </button>
                      ) : null}
                    </div>
                  </td>
                  )}
                  {showDelivery && (
                  <td style={{ padding: "14px 16px", verticalAlign: "middle", textAlign: "center" }} onClick={e => e.stopPropagation()}>
                    {q.status === "Approved" ? (
                      (() => {
                        let bg = "rgba(107, 114, 128, 0.06)";
                        let color = "#374151";
                        let border = "1px solid rgba(107, 114, 128, 0.15)";
                        let text = "Material Pending";
                        let icon = <Clock size={11} strokeWidth={2.5} />;
                        if (q.delivery_status === "Dispatched") {
                          bg = "rgba(217, 119, 6, 0.06)"; color = "#b45309"; border = "1px solid rgba(217, 119, 6, 0.18)"; text = "Dispatched"; icon = <Truck size={11} strokeWidth={2.5} />;
                        } else if (q.delivery_status === "Delivered") {
                          bg = "rgba(16, 185, 129, 0.08)"; color = "#047857"; border = "1px solid rgba(16, 185, 129, 0.18)"; text = "Delivered"; icon = <Check size={11} strokeWidth={3} />;
                        }
                        return (
                          <span style={{ fontSize: "11px", fontWeight: 600, padding: "4px 12px", borderRadius: "9999px", background: bg, color, border, display: "inline-flex", alignItems: "center", gap: 6 }}>
                            {icon} {text}
                          </span>
                        );
                      })()
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: "12px" }}> - </span>
                    )}
                  </td>
                  )}
                  {showGeoTags && (
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
                            style={{ padding: "4px 8px", fontSize: "10px", display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 600, borderRadius: "6px", background: needsReupload ? "rgba(234,88,12,0.1)" : count === 3 ? "rgba(46, 125, 82, 0.08)" : "rgba(249, 115, 22, 0.08)", color: needsReupload ? "#ea580c" : count === 3 ? "var(--green)" : "#f97316", border: `1px solid ${needsReupload ? "rgba(234,88,12,0.25)" : count === 3 ? "var(--green)" : "rgba(249, 115, 22, 0.2)"}`, cursor: "pointer", transition: "all 0.2s" }}
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
                  )}
                  {/* Actions column: Download always shown; share buttons only when showActions */}
                  <td style={{ padding: "14px 16px", verticalAlign: "middle" }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
                      {/* ── Download PDF ── */}
                      <button
                        onClick={() => handleDownloadPdfRow(q)}
                        disabled={pdfDownloadingId === q.id}
                        title="Download PDF Quotation"
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "6px", borderRadius: 8, background: "rgba(99, 102, 241, 0.08)", color: "#6366f1", border: "1px solid rgba(99, 102, 241, 0.18)", cursor: pdfDownloadingId === q.id ? "not-allowed" : "pointer", opacity: pdfDownloadingId === q.id ? 0.6 : 1, transition: "all 0.2s" }}
                        onMouseOver={e => { if (pdfDownloadingId !== q.id) { e.currentTarget.style.background = "#6366f1"; e.currentTarget.style.color = "white"; } }}
                        onMouseOut={e => { if (pdfDownloadingId !== q.id) { e.currentTarget.style.background = "rgba(99, 102, 241, 0.08)"; e.currentTarget.style.color = "#6366f1"; } }}
                      >
                        {pdfDownloadingId === q.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                      </button>
                      {/* ── Share buttons: hidden for Rejected tab ── */}
                      {showActions && (<>
                      {/* ── WhatsApp ── */}
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
                      {/* ── Email ── */}
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
                      {/* ── Copy ── */}
                      <button
                        onClick={() => copyToClipboard(q)}
                        disabled={sharingCopyId === q.id}
                        title="Copy to Clipboard"
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "6px", borderRadius: 8, background: copiedId === q.id ? "rgba(46, 125, 82, 0.1)" : "rgba(107, 101, 96, 0.06)", color: copiedId === q.id ? "var(--green)" : "var(--muted)", border: copiedId === q.id ? "1px solid var(--green)" : "1px solid rgba(107, 101, 96, 0.12)", cursor: sharingCopyId === q.id ? "not-allowed" : "pointer", opacity: sharingCopyId === q.id ? 0.6 : 1, transition: "all 0.2s" }}
                      >
                        {sharingCopyId === q.id ? <Loader2 size={13} className="animate-spin" /> : copiedId === q.id ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                      </>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>{/* end table-scroll-wrap */}
          </div>{/* end q-table-wrap */}

          {/* ── Mobile Card List (< 768px) ─────────────────────────────────── */}
          <div className="q-card-list">
            {filteredList.map(q => {
              const statusLabel = q.status === "ReuploadRequested" ? "Re-upload Requested" : q.status;
              const statusClass = q.status === "Approved" ? "badge-green" : q.status === "Rejected" ? "badge-red" : q.status === "ReuploadRequested" ? "" : "badge-sun";
              const statusStyle = q.status === "ReuploadRequested" ? { background: "#b45309", color: "#fff", fontWeight: 700 } : {};
              const needsDocReupload  = q.status === "ReuploadRequested";
              const needsGeoReupload  = q.status === "Approved" && !!q.geotag_reupload_requested;
              const geoCount = ["geotag_1","geotag_2","geotag_3"].filter(t => q.documents?.some(d => d.doc_type === t)).length;
              return (
                <div key={q.id} className="q-card"
                  style={needsDocReupload || needsGeoReupload ? { borderLeft: "3px solid #ea580c" } : {}}
                  onClick={() => setSelectedQuotation(q)}
                >
                  {/* Header: quotation # + status badge */}
                  <div className="q-card-header">
                    <div>
                      <div className="q-card-number">{q.quotation_number}</div>
                      <div className="q-card-badges">

                        {needsDocReupload && (
                          <span style={{ display: "inline-block", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "rgba(220,38,38,0.1)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.2)" }}>Re-upload Required</span>
                        )}
                        {needsGeoReupload && (
                          <span style={{ display: "inline-block", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "rgba(234,88,12,0.1)", color: "#ea580c", border: "1px solid rgba(234,88,12,0.2)" }}>Geo-Tag Re-upload</span>
                        )}
                      </div>
                    </div>
                    <span className={`badge ${statusClass}`} style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", flexShrink: 0, ...statusStyle }}>
                      {statusLabel}
                    </span>
                  </div>

                  {/* Body: 2-col grid of key fields */}
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
                      <span className="q-card-field-label">Eff. Price</span>
                      <span className="q-card-field-value mono">{fmt(q.effective_price)}</span>
                    </div>
                    <div className="q-card-field">
                      <span className="q-card-field-label">Customer</span>
                      <span className="q-card-field-value">{q.customer_name || "—"}</span>
                    </div>
                    {q.status === "Approved" && (
                      <div className="q-card-field">
                        <span className="q-card-field-label">Delivery</span>
                        <span className="q-card-field-value muted">{q.delivery_status || "Material Pending"}</span>
                      </div>
                    )}
                    {q.status === "Approved" && (
                      <div className="q-card-field">
                        <span className="q-card-field-label">Geo-Tags</span>
                        <span className="q-card-field-value muted">{needsGeoReupload ? "Re-upload" : `${geoCount}/3 Uploaded`}</span>
                      </div>
                    )}
                  </div>

                  {/* Footer: Tap hint + action buttons */}
                  <div className="q-card-footer" onClick={e => e.stopPropagation()}>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>Tap to view details</span>
                    <div className="q-card-actions">
                      {needsDocReupload && (
                        <button
                          onClick={e => { e.stopPropagation(); openPortalReuploadModal(q); }}
                          style={{ padding: "7px 12px", borderRadius: 8, background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.2)", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                        >
                          <RefreshCw size={12} /> Re-upload
                        </button>
                      )}
                      {needsGeoReupload && (
                        <button
                          onClick={e => { e.stopPropagation(); openGeotagModal(q); }}
                          style={{ padding: "7px 12px", borderRadius: 8, background: "rgba(234,88,12,0.08)", color: "#ea580c", border: "1px solid rgba(234,88,12,0.2)", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                        >
                          <Camera size={12} /> Re-upload Geo
                        </button>
                      )}
                      {/* ── Download PDF (mobile card) ── */}
                      <button
                        onClick={e => { e.stopPropagation(); handleDownloadPdfRow(q); }}
                        disabled={pdfDownloadingId === q.id}
                        title="Download PDF"
                        style={{ padding: "7px", borderRadius: 8, background: "rgba(99,102,241,0.08)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.18)", cursor: pdfDownloadingId === q.id ? "not-allowed" : "pointer", display: "flex", alignItems: "center", opacity: pdfDownloadingId === q.id ? 0.6 : 1 }}
                      >
                        {pdfDownloadingId === q.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      </button>
                      <button onClick={e => { e.stopPropagation(); shareWhatsApp(q); }} disabled={sharingWaId === q.id} title="Share via WhatsApp"
                        style={{ padding: "7px", borderRadius: 8, background: "rgba(37,211,102,0.08)", color: "#25D366", border: "1px solid rgba(37,211,102,0.15)", cursor: "pointer", display: "flex", alignItems: "center" }}>
                        {sharingWaId === q.id ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
                      </button>
                      <button onClick={e => { e.stopPropagation(); shareEmail(q); }} disabled={sharingEmailId === q.id} title="Share via Email"
                        style={{ padding: "7px", borderRadius: 8, background: "rgba(46,125,82,0.08)", color: "var(--green)", border: "1px solid rgba(46,125,82,0.15)", cursor: "pointer", display: "flex", alignItems: "center" }}>
                        {sharingEmailId === q.id ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                      </button>
                      <button onClick={e => { e.stopPropagation(); copyToClipboard(q); }} title="Copy"
                        style={{ padding: "7px", borderRadius: 8, background: copiedId === q.id ? "rgba(46,125,82,0.1)" : "rgba(107,101,96,0.06)", color: copiedId === q.id ? "var(--green)" : "var(--muted)", border: copiedId === q.id ? "1px solid var(--green)" : "1px solid rgba(107,101,96,0.12)", cursor: "pointer", display: "flex", alignItems: "center" }}>
                        {sharingCopyId === q.id ? <Loader2 size={14} className="animate-spin" /> : copiedId === q.id ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>{/* end q-card-list */}

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
            padding: "env(safe-area-inset-top, 12px) 12px env(safe-area-inset-bottom, 12px) 12px",
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
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
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
                padding: "16px 20px",
                paddingRight: 56,
                borderBottom: "1px solid rgba(0,0,0,0.06)",
                position: "sticky",
                top: 0,
                background: "var(--card-bg, #ffffff)",
                zIndex: 10
              }}
            >
              {/* Close button — absolutely positioned top-right */}
              <button
                onClick={() => setGeotagModalQuotation(null)}
                style={{
                  position: "absolute",
                  top: 14,
                  right: 16,
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
                  transition: "all 0.2s",
                  flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>

              {/* Title + badge */}
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", lineHeight: 1.3 }}>
                  Geo-Tag Project Photos
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12,
                  background: "rgba(46,125,82,0.1)", color: "var(--green)",
                  border: "1px solid rgba(46,125,82,0.2)",
                  whiteSpace: "nowrap"
                }}>
                  {geotagModalQuotation.quotation_number}
                </span>
              </div>

              {/* Subtitle */}
              {geotagModalQuotation.geotag_reupload_requested ? (
                <div style={{
                  fontSize: 12, color: "#ea580c", display: "flex",
                  alignItems: "flex-start", gap: 5, fontWeight: 600,
                  lineHeight: 1.4
                }}>
                  <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    Admin has requested geo-tag re-upload
                    {geotagModalQuotation.geotag_reupload_reason && (
                      <span style={{ fontWeight: 400, color: "#9a3412" }}>
                        {" "}— {geotagModalQuotation.geotag_reupload_reason}
                      </span>
                    )}
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
                  Upload on-site images with GPS tagging enabled to complete the installation file.
                </div>
              )}
            </div>

            {/* Modal Content — scrollable body */}
            <div style={{ padding: "clamp(14px, 4vw, 24px)", overflowY: "auto", flex: 1 }}>
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
                const isSubmitted = !!geotagModalQuotation.geotag_submitted;
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
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
                    {slots.map(slot => {
                      const doc = geotagModalQuotation.documents?.find(d => d.doc_type === slot.key);
                      const fileUrl = doc ? (blobUrls.get(doc.id) ?? null) : null;

                      // isLocked = submitted AND this slot is NOT in admin re-upload list
                      const isLocked = isSubmitted && !requestedSlots.includes(slot.key) && !!doc;
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
                                {isLocked ? (
                                  /* Submitted slot: show checkmark placeholder, no image preview */
                                  <div style={{ width: "100%", height: 110, borderRadius: 8, marginBottom: 10, background: "rgba(46,125,82,0.05)", border: "1px solid rgba(46,125,82,0.15)", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 6 }}>
                                    <Check size={28} style={{ color: "#2E7D52", opacity: 0.7 }} />
                                    <span style={{ fontSize: 10, color: "#2E7D52", fontWeight: 600, opacity: 0.8 }}>Photo submitted</span>
                                  </div>
                                ) : doc.mime_type.startsWith("image/") ? (
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

                          {/* Upload / Submitted Buttons */}
                          <div style={{ marginTop: 14, display: "flex", gap: 6 }}>
                            {isLocked ? (
                              // Slot is submitted — show non-clickable Submitted label only (no View button)
                              <div style={{ flex: 1, padding: "8px 0", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, background: "rgba(46,125,82,0.07)", color: "#2E7D52", border: "1.5px solid rgba(46,125,82,0.2)", borderRadius: 8, fontWeight: 700 }}>
                                <Check size={13} /> Submitted
                              </div>
                            ) : doc ? (
                              // Slot has a doc and is unlocked (editing before submit, or re-upload slot)
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
                                    background: needsReupload ? "rgba(234,88,12,0.08)" : "rgba(59,130,246,0.08)",
                                    color: needsReupload ? "#c2410c" : "#2563eb",
                                    border: needsReupload ? "1.5px dashed rgba(234,88,12,0.4)" : "1.5px dashed rgba(59,130,246,0.4)",
                                    borderRadius: 8, cursor: uploadingSlot === slot.key ? "not-allowed" : "pointer",
                                    fontWeight: 600
                                  }}
                                >
                                  {uploadingSlot === slot.key ? (
                                    <><Loader2 size={12} className="animate-spin" />{uploadPhase === "gps" ? "Getting GPS..." : "Uploading..."}</>
                                  ) : (
                                    <><Upload size={12} /> {needsReupload ? "Re-upload" : "Replace"}</>
                                  )}
                                  <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }}
                                    disabled={uploadingSlot !== null}
                                    onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) handleUploadGeotag(geotagModalQuotation.id, slot.key, f); }}
                                  />
                                </label>
                              </>
                            ) : (
                              // Slot has no doc — upload for first time
                              <label
                                style={{
                                  width: "100%", padding: "8px 0", fontSize: 12,
                                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                                  background: "linear-gradient(135deg, #2563eb, #1d4ed8)", color: "white",
                                  borderRadius: 8, cursor: uploadingSlot === slot.key ? "not-allowed" : "pointer",
                                  fontWeight: 600, boxShadow: "0 2px 8px rgba(37,99,235,0.25)"
                                }}
                              >
                                {uploadingSlot === slot.key ? (
                                  <><Loader2 size={13} className="animate-spin" />{uploadPhase === "gps" ? "Getting GPS..." : "Uploading..."}</>
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

            {/* Modal Footer — Single Submit Button */}
            {(() => {
              const SLOTS = ["geotag_1", "geotag_2", "geotag_3"];
              const hasDoc = (key) => geotagModalQuotation.documents?.some(d => d.doc_type === key);
              const isSubmittedQ = !!geotagModalQuotation.geotag_submitted;
              const reuploadQ = !!geotagModalQuotation.geotag_reupload_requested;
              const reqSlotsQ = reuploadQ && geotagModalQuotation.geotag_reupload_slots
                ? geotagModalQuotation.geotag_reupload_slots.split(",").filter(Boolean)
                : reuploadQ ? SLOTS : [];

              const allSlotsUploaded = SLOTS.every(hasDoc);
              const allReuploadDone = reqSlotsQ.length > 0 && reqSlotsQ.every(hasDoc);

              // Show Submit footer when dealer has not yet submitted, OR re-upload pending.
              // Always visible (even with 0 photos) so dealer sees it and knows to upload all 3.
              const showSubmit = !isSubmittedQ || reuploadQ;
              if (!showSubmit) return null;

              const isReuploadSubmit = !!reuploadQ;
              const submitEnabled = isReuploadSubmit ? allReuploadDone : allSlotsUploaded;
              const submitText = isReuploadSubmit ? "Submit Updated Photos" : "Submit Geo-Tag Photos";
              const enabledBg = isReuploadSubmit
                ? "linear-gradient(135deg, #ea580c, #c2410c)"
                : "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)";
              const enabledShadow = isReuploadSubmit
                ? "0 4px 14px rgba(234,88,12,0.35)"
                : "0 4px 14px rgba(46,125,82,0.35)";
              const uploadedCount = SLOTS.filter(hasDoc).length;

              return (
                <div style={{ padding: "16px 24px", borderTop: "1px solid rgba(0,0,0,0.06)", background: "var(--light, #f8fafc)", borderBottomLeftRadius: 20, borderBottomRightRadius: 20 }}>
                  <button
                    onClick={() => handleSubmitGeotag(geotagModalQuotation.id)}
                    disabled={!submitEnabled || geotagSubmitting}
                    style={{
                      width: "100%",
                      padding: "12px 24px",
                      borderRadius: 12,
                      fontSize: 14,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      border: "none",
                      cursor: submitEnabled && !geotagSubmitting ? "pointer" : "not-allowed",
                      background: !submitEnabled || geotagSubmitting ? "rgba(0,0,0,0.08)" : enabledBg,
                      color: !submitEnabled || geotagSubmitting ? "var(--muted)" : "white",
                      opacity: !submitEnabled && !geotagSubmitting ? 0.65 : 1,
                      transition: "all 0.2s",
                      boxShadow: submitEnabled && !geotagSubmitting ? enabledShadow : "none"
                    }}
                  >
                    {geotagSubmitting ? (
                      <><Loader2 size={16} className="animate-spin" /> Submitting...</>
                    ) : (
                      <><Upload size={16} /> {submitText}</>
                    )}
                  </button>
                  {!submitEnabled && !isReuploadSubmit && (
                    <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", marginTop: 8 }}>
                      {uploadedCount}/3 photos uploaded — upload all 3 to enable Submit
                    </div>
                  )}
                  {!submitEnabled && isReuploadSubmit && (
                    <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", marginTop: 8 }}>
                      Upload all requested photos to submit
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Portal Document Re-upload Modal */}
      {portalReuploadModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(15,23,42,0.45)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1100, padding: "env(safe-area-inset-top, 12px) 12px env(safe-area-inset-bottom, 12px) 12px"
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
                <div style={{
                fontSize: 12, color: "#b45309", marginTop: 2, fontWeight: 500,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "calc(100vw - 120px)"
              }}>
                Quotation: {portalReuploadModal.quotation_number}
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
            <div style={{ padding: "clamp(14px, 4vw, 24px)", overflowY: "auto", flex: 1 }}>
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
                                  const isUploaded = portalUploadedDocs.has(key);
                                  const isLocked = portalReuploadLoading || isUploaded;
                                  return (
                                    <div key={key} style={{ border: `1.5px dashed ${isUploaded ? "#16a34a" : file ? "#2E7D52" : "rgba(0,0,0,0.18)"}`, borderRadius: 12, padding: "12px", background: isUploaded ? "rgba(22,163,74,0.06)" : file ? "rgba(46,125,82,0.03)" : "#fafafa", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, pointerEvents: isLocked ? "none" : "auto", opacity: isLocked ? 0.7 : 1 }}>
                                      <div style={{ fontSize: 11, fontWeight: 700, color: isUploaded ? "#16a34a" : file ? "#1a5c38" : "#374151", textAlign: "center" }}>{label}</div>
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
                                          {isUploaded && <div style={{ fontSize: 9, fontWeight: 700, color: "#16a34a", background: "rgba(22,163,74,0.12)", borderRadius: 20, padding: "2px 8px" }}>Uploaded ✓</div>}
                                        </>
                                      ) : (
                                        <div style={{ width: 60, height: 60, background: "#f3f4f6", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                          <Upload size={20} style={{ color: "#9ca3af" }} />
                                        </div>
                                      )}
                                      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "6px 0", borderRadius: 8, width: "100%", cursor: isLocked ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 600, background: isUploaded ? "rgba(22,163,74,0.1)" : file ? "rgba(46,125,82,0.1)" : "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)", color: isUploaded ? "#16a34a" : file ? "#2E7D52" : "white", opacity: isLocked ? 0.6 : 1, marginTop: "auto", pointerEvents: isLocked ? "none" : "auto" }}>
                                        <Upload size={10} /> {isUploaded ? "Uploaded" : file ? "Change" : "Choose"}
                                        <input type="file" accept={DOC_ACCEPT.aadhaar_front} style={{ display: "none" }} disabled={isLocked} onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) setPortalReuploadFiles(prev => ({ ...prev, [key]: f })); }} />
                                      </label>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              /* PDF mode — single zone */
                              (() => {
                                const file = portalReuploadFiles.aadhaar;
                                const isUploaded = portalUploadedDocs.has("aadhaar");
                                const isLocked = portalReuploadLoading || isUploaded;
                                return (
                                  <div style={{ border: `1.5px dashed ${isUploaded ? "#16a34a" : file ? "#2E7D52" : "rgba(0,0,0,0.18)"}`, borderRadius: 12, padding: "12px 14px", background: isUploaded ? "rgba(22,163,74,0.06)" : file ? "rgba(46,125,82,0.03)" : "#fafafa", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, pointerEvents: isLocked ? "none" : "auto", opacity: isLocked ? 0.7 : 1 }}>
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
                                        {isUploaded && <div style={{ fontSize: 9, fontWeight: 700, color: "#16a34a", background: "rgba(22,163,74,0.12)", borderRadius: 20, padding: "2px 8px" }}>Uploaded ✓</div>}
                                      </>
                                    ) : (
                                      <>
                                        <div style={{ width: 70, height: 70, background: "#f3f4f6", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                          <Upload size={24} style={{ color: "#9ca3af" }} />
                                        </div>
                                        <div style={{ fontSize: 11, color: "#9ca3af" }}>No file selected</div>
                                      </>
                                    )}
                                    <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 0", borderRadius: 8, width: "100%", cursor: isLocked ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600, background: isUploaded ? "rgba(22,163,74,0.1)" : file ? "rgba(46,125,82,0.08)" : "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)", color: isUploaded ? "#16a34a" : file ? "#2E7D52" : "white", opacity: isLocked ? 0.6 : 1, marginTop: "auto", pointerEvents: isLocked ? "none" : "auto" }}>
                                      <Upload size={11} /> {isUploaded ? "Uploaded" : file ? "Change File" : "Choose File"}
                                      <input type="file" accept={DOC_ACCEPT.aadhaar} style={{ display: "none" }} disabled={isLocked} onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) setPortalReuploadFiles(prev => ({ ...prev, aadhaar: f })); }} />
                                    </label>
                                  </div>
                                );
                              })()
                            )}
                          </div>
                        )}

                        {/* ── Other documents ── */}
                        {otherDocs.length > 0 && (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
                            {otherDocs.map(docType => {
                              const file = portalReuploadFiles[docType];
                              const isUploaded = portalUploadedDocs.has(docType);
                              const isLocked = portalReuploadLoading || isUploaded;
                              return (
                                <div key={docType} style={{
                                  border: `1.5px dashed ${isUploaded ? "#16a34a" : file ? "#2E7D52" : "rgba(0,0,0,0.18)"}`,
                                  borderRadius: 14, padding: "14px 14px 12px",
                                  background: isUploaded ? "rgba(22,163,74,0.06)" : file ? "rgba(46,125,82,0.03)" : "#fafafa",
                                  display: "flex", flexDirection: "column", alignItems: "center",
                                  gap: 10, transition: "all 0.2s",
                                  pointerEvents: isLocked ? "none" : "auto",
                                  opacity: isLocked ? 0.7 : 1,
                                  position: "relative",
                                }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: isUploaded ? "#16a34a" : file ? "#1a5c38" : "#374151", textAlign: "center" }}>
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
                                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: isUploaded ? "#16a34a" : "#2E7D52", background: isUploaded ? "rgba(22,163,74,0.12)" : "rgba(46,125,82,0.1)", border: `1px dashed ${isUploaded ? "rgba(22,163,74,0.4)" : "rgba(46,125,82,0.3)"}`, borderRadius: 20, padding: "3px 10px" }}>
                                        <Check size={9} /> {isUploaded ? "Uploaded ✓" : "File Selected"}
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
                                    cursor: isLocked ? "not-allowed" : "pointer",
                                    fontSize: 12, fontWeight: 600,
                                    background: isUploaded ? "rgba(22,163,74,0.1)" : file ? "rgba(46,125,82,0.08)" : "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)",
                                    color: isUploaded ? "#16a34a" : file ? "#2E7D52" : "white",
                                    border: file || isUploaded ? "1.5px dashed rgba(46,125,82,0.3)" : "none",
                                    opacity: isLocked ? 0.6 : 1,
                                    marginTop: "auto", transition: "all 0.2s",
                                    pointerEvents: isLocked ? "none" : "auto",
                                  }}>
                                    <Upload size={11} /> {isUploaded ? "Uploaded" : file ? "Change File" : "Choose File"}
                                    <input type="file"
                                      accept={DOC_ACCEPT[docType] || "image/jpeg,image/png,image/webp,application/pdf"}
                                      style={{ display: "none" }}
                                      disabled={isLocked}
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
                padding: "14px 20px",
                borderTop: "1px solid rgba(0,0,0,0.06)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}>
                {/* Progress bar — visible during upload */}
                {portalReuploadLoading && portalUploadProgress.total > 0 && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#2E7D52" }}>
                        Uploading {portalUploadProgress.current} of {portalUploadProgress.total} — {portalUploadProgress.currentDocType}
                      </span>
                      {portalElapsed > 2 && (
                        <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)" }}>
                          {portalElapsed}s
                        </span>
                      )}
                    </div>
                    <div style={{ height: 6, background: "rgba(0,0,0,0.06)", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{
                        height: "100%",
                        width: `${Math.round((portalUploadProgress.current / portalUploadProgress.total) * 100)}%`,
                        background: "linear-gradient(90deg, #2E7D52, #16a34a)",
                        borderRadius: 4,
                        transition: "width 0.4s ease",
                      }} />
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
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
                      padding: "8px 20px", borderRadius: 8, border: "none",
                      cursor: portalReuploadLoading ? "not-allowed" : "pointer",
                      background: portalReuploadLoading
                        ? "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)"
                        : "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)",
                      color: "white", fontWeight: 700, fontSize: 13,
                      boxShadow: "0 4px 12px rgba(46,125,82,0.25)",
                      opacity: portalReuploadLoading ? 0.85 : 1,
                    }}
                  >
                    {portalReuploadLoading ? (
                      <><Loader2 size={14} className="animate-spin" /> Uploading...</>
                    ) : portalUploadedDocs.size > 0 ? (
                      <><RefreshCw size={14} /> Retry Upload ({portalUploadedDocs.size} done)</>
                    ) : (
                      <><Check size={14} /> Submit Documents</>
                    )}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4, textAlign: "center" }}>
                  {portalUploadedDocs.size > 0 && !portalReuploadLoading
                    ? `${portalUploadedDocs.size} file(s) uploaded. Tap to upload remaining files.`
                    : "After submission, your quotation will be reviewed by the admin team."
                  }
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ————— Quotation Detail Modal ——————————————————————————————————————————————————— */}
      {selectedQuotation && (() => {
        const q = selectedQuotation;
        const SLOT_LABELS = { geotag_1: "Site / Inverter Photo", geotag_2: "Solar Panels Photo", geotag_3: "ACDB / Net Meter Photo" };
        const geoCount = [1,2,3].filter(i => q.documents?.some(d => d.doc_type === `geotag_${i}`)).length;
        const statusColor = q.status === "Approved" ? "#2E7D52"
          : q.status === "Rejected" ? "#dc2626"
          : q.status === "ReuploadRequested" ? "#b45309"
          : "#d97706";
        const statusBg = q.status === "Approved" ? "rgba(46,125,82,0.1)"
          : q.status === "Rejected" ? "rgba(220,38,38,0.1)"
          : q.status === "ReuploadRequested" ? "rgba(180,83,9,0.1)"
          : "rgba(217,119,6,0.1)";
        const statusLabel = q.status === "ReuploadRequested" ? "Re-upload Requested" : q.status;

        const PriceLine = ({ label, value, highlight, muted, negative }) => (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: highlight ? "10px 0" : "5px 0", borderTop: highlight ? "1px solid rgba(0,0,0,0.08)" : "none", marginTop: highlight ? 6 : 0 }}>
            <span style={{ fontSize: highlight ? 14 : 13, fontWeight: highlight ? 700 : 500, color: muted ? "var(--muted)" : "var(--text)" }}>{label}</span>
            <span style={{ fontSize: highlight ? 17 : 13, fontWeight: highlight ? 800 : 600, fontFamily: "var(--mono)", color: highlight ? "var(--green)" : muted ? "var(--muted)" : negative ? "#2E7D52" : "var(--text)" }}>{value}</span>
          </div>
        );

        return (
          <div
            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15,23,42,0.45)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 950, padding: "env(safe-area-inset-top, 12px) 12px env(safe-area-inset-bottom, 12px) 12px" }}
            onClick={() => setSelectedQuotation(null)}
          >
            <div
              style={{ background: "var(--card-bg, #fff)", borderRadius: 20, width: "100%", maxWidth: 800, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 25px 60px -12px rgba(0,0,0,0.3)", border: "1px solid rgba(0,0,0,0.06)", animation: "modalFadeIn 0.2s ease-out" }}
              onClick={e => e.stopPropagation()}
            >
              {/* ── Modal Header ──────────────────────────────────────────────────────── */}
              <div style={{ padding: "20px 24px", paddingRight: 64, borderBottom: "1px solid var(--border)", background: "linear-gradient(135deg, rgba(28,58,42,0.03) 0%, rgba(46,125,82,0.02) 100%)", borderRadius: "20px 20px 0 0", position: "relative" }}>
                {/* Close button */}
                <button
                  onClick={() => setSelectedQuotation(null)}
                  style={{ position: "absolute", top: 16, right: 16, width: 34, height: 34, borderRadius: "50%", background: "var(--light, #f1f5f9)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text)", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.08)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "var(--light, #f1f5f9)"; }}
                >
                  <X size={17} />
                </button>

                {/* Title row */}
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "var(--mono)", color: "var(--text)", letterSpacing: "-0.3px" }}>{q.quotation_number}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: statusBg, color: statusColor, border: `1px solid ${statusColor}22` }}>{statusLabel}</span>

                  {q.is_expired && q.status === "Pending" && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 20, background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.18)", display: "flex", alignItems: "center", gap: 3 }}>
                      <AlertCircle size={10} /> Expired
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Submitted on {new Date(q.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                  {q.reupload_count > 0 && <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 12, background: "rgba(99,102,241,0.08)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.18)" }}>Re-uploaded ×{q.reupload_count}</span>}
                </div>
              </div>

              {/* ── Modal Body (scrollable) ────────────────────────────────────────────── */}
              <div style={{ overflowY: "auto", flex: 1, padding: "clamp(16px, 4vw, 24px)" }}>

                {/* Alert Banners */}
                {q.status === "Rejected" && q.rejection_reason && (
                  <div style={{ background: "rgba(220,38,38,0.05)", border: "1px solid rgba(220,38,38,0.2)", borderLeft: "4px solid #dc2626", borderRadius: 12, padding: "12px 16px", marginBottom: 18, display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <AlertTriangle size={15} style={{ color: "#dc2626", flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>Rejection Reason</div>
                      <div style={{ fontSize: 13, color: "#7f1d1d", lineHeight: 1.5 }}>{q.rejection_reason}</div>
                    </div>
                  </div>
                )}
                {q.status === "ReuploadRequested" && (
                  <div style={{ background: "rgba(180,83,9,0.05)", border: "1px solid rgba(245,158,11,0.25)", borderLeft: "4px solid #f59e0b", borderRadius: 12, padding: "12px 16px", marginBottom: 18, display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <RefreshCw size={15} style={{ color: "#b45309", flexShrink: 0, marginTop: 1 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>Document Re-upload Requested</div>
                      {q.reupload_reason && <div style={{ fontSize: 13, color: "#78350f", lineHeight: 1.5, marginBottom: 6 }}>{q.reupload_reason}</div>}
                      {q.reupload_required_docs && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                          {q.reupload_required_docs.split(",").filter(Boolean).map(d => (
                            <span key={d} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "rgba(180,83,9,0.1)", color: "#92400e", border: "1px solid rgba(180,83,9,0.2)" }}>{DOC_LABELS[d] || d}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {q.status === "Approved" && !!q.geotag_reupload_requested && (
                  <div style={{ background: "rgba(234,88,12,0.05)", border: "1px solid rgba(234,88,12,0.2)", borderLeft: "4px solid #ea580c", borderRadius: 12, padding: "12px 16px", marginBottom: 18, display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <Camera size={15} style={{ color: "#ea580c", flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#7c2d12", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>Geo-tag Re-upload Requested</div>
                      {q.geotag_reupload_reason && <div style={{ fontSize: 13, color: "#9a3412", lineHeight: 1.5, marginBottom: 6 }}>{q.geotag_reupload_reason}</div>}
                      {q.geotag_reupload_slots && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                          {q.geotag_reupload_slots.split(",").filter(Boolean).map(s => (
                            <span key={s} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "rgba(234,88,12,0.1)", color: "#c2410c", border: "1px solid rgba(234,88,12,0.2)" }}>{SLOT_LABELS[s] || s}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Two-column grid: left = Customer + System, right = Pricing + Status */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>

                  {/* LEFT COLUMN */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                    {/* Customer Section */}
                    <div style={{ background: "var(--light, #f8fafc)", borderRadius: 14, padding: "14px 16px", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 10, display: "flex", alignItems: "center", gap: 5 }}>
                        <FileText size={10} /> Customer
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>{q.customer_name || "—"}</div>
                      {q.customer_phone && (
                        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ width: 22, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Phone size={12} style={{ color: "var(--muted)" }} />
                          </span>
                          <span style={{ fontSize: 13, color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 500 }}>{q.customer_phone}</span>
                        </div>
                      )}
                      {q.customer_email && (
                        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ width: 22, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Mail size={12} style={{ color: "var(--muted)" }} />
                          </span>
                          <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, wordBreak: "break-all" }}>{q.customer_email}</span>
                        </div>
                      )}
                      {(q.customer_city || q.customer_address) && (
                        <div style={{ display: "flex", alignItems: "flex-start" }}>
                          <span style={{ width: 22, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 2 }}>
                            <MapPin size={12} style={{ color: "var(--muted)" }} />
                          </span>
                          <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, lineHeight: 1.5 }}>
                            {[q.customer_address, q.customer_city].filter(Boolean).join(", ")}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* System Specifications */}
                    <div style={{ background: "var(--light, #f8fafc)", borderRadius: 14, padding: "14px 16px", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 10, display: "flex", alignItems: "center", gap: 5 }}>
                        <Package size={10} /> System Specifications
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 12 }}>
                        <span style={{ fontSize: 22, fontWeight: 800, color: "var(--green)", fontFamily: "var(--mono)" }}>{Number(q.system_kw).toFixed(2)}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>kW System</span>
                      </div>
                      {[
                        { icon: <Zap size={12} />,       label: "Panels",    value: `${q.panel_brand} ${q.panel_watt}W × ${q.panel_count} — ${q.panel_type || ""}` },
                        { icon: <Cpu size={12} />,        label: "Inverter",  value: `${q.inverter_brand} ${Number(q.inverter_kw)}kW — ${q.inverter_type || ""}` },
                        { icon: <Home size={12} />,       label: "Structure", value: q.structure_height || "—" },
                        { icon: <CreditCard size={12} />, label: "Payment",   value: q.payment_mode || "—" },
                      ].map(({ icon, label, value }) => (
                        <div key={label} style={{ display: "flex", alignItems: "flex-start", marginBottom: 7 }}>
                          <span style={{ width: 22, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 2, color: "var(--muted)" }}>{icon}</span>
                          <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, lineHeight: 1.5 }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* RIGHT COLUMN */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                    {/* Pricing Breakdown */}
                    <div style={{ background: "var(--light, #f8fafc)", borderRadius: 14, padding: "14px 16px", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 10, display: "flex", alignItems: "center", gap: 5 }}>
                        <Info size={10} /> Pricing Breakdown
                      </div>
                      <PriceLine label="Subtotal"    value={fmt(q.subtotal)} />
                      <PriceLine label={`GST (${q.gst_rate}%)`} value={fmt(q.gst_amount)} />
                      <PriceLine label="Total"       value={fmt(q.total)} />
                      {Number(q.subsidy_amount) > 0 && (
                        <PriceLine label="Govt Subsidy" value={`−${fmt(q.subsidy_amount)}`} negative muted />
                      )}
                      <PriceLine label="Effective Price" value={fmt(q.effective_price)} highlight />
                      <PriceLine label="Price / kW"  value={`${fmt(q.price_per_kw)}/kW`} muted />
                    </div>

                    {/* Status & Delivery */}
                    <div style={{ background: "var(--light, #f8fafc)", borderRadius: 14, padding: "14px 16px", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 10, display: "flex", alignItems: "center", gap: 5 }}>
                        <Clock size={10} /> Status & Delivery
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 20, background: statusBg, color: statusColor, border: `1px solid ${statusColor}22` }}>{statusLabel}</span>
                        {q.status === "Approved" && q.delivery_status && (
                          <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 20, background: q.delivery_status === "Delivered" ? "rgba(16,185,129,0.08)" : q.delivery_status === "Dispatched" ? "rgba(217,119,6,0.08)" : "rgba(107,114,128,0.06)", color: q.delivery_status === "Delivered" ? "#047857" : q.delivery_status === "Dispatched" ? "#b45309" : "#374151", border: "1px solid rgba(0,0,0,0.08)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                            {q.delivery_status === "Delivered" ? <Check size={11} /> : q.delivery_status === "Dispatched" ? <Truck size={11} /> : <Clock size={11} />}
                            {q.delivery_status || "Material Pending"}
                          </span>
                        )}
                      </div>
                      {q.status === "Approved" && (
                        <div style={{ display: "flex", gap: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", minWidth: 58, paddingTop: 1 }}>Geo-tags</span>
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: geoCount === 3 && !!q.geotag_submitted ? "var(--green)" : !!q.geotag_reupload_requested ? "#ea580c" : "var(--text)" }}>
                            {q.geotag_submitted ? `${geoCount}/3 Submitted ✓` : `${geoCount}/3 Uploaded${geoCount < 3 ? " — pending" : ""}`}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Modal Footer — Actions ─────────────────────────────────────────────── */}
              <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", background: "var(--light, #f8fafc)", borderRadius: "0 0 20px 20px" }}>

                {/* Row 1 — Share buttons, equally filling the full width */}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => shareWhatsApp(q)}
                    disabled={sharingWaId === q.id}
                    title="Share via WhatsApp"
                    style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", borderRadius: 9, fontSize: 12, fontWeight: 700, background: "rgba(37,211,102,0.08)", color: "#25D366", border: "1px solid rgba(37,211,102,0.2)", cursor: sharingWaId === q.id ? "not-allowed" : "pointer", opacity: sharingWaId === q.id ? 0.6 : 1, transition: "all 0.15s" }}
                    onMouseEnter={e => { if (sharingWaId !== q.id) { e.currentTarget.style.background = "#25D366"; e.currentTarget.style.color = "white"; } }}
                    onMouseLeave={e => { if (sharingWaId !== q.id) { e.currentTarget.style.background = "rgba(37,211,102,0.08)"; e.currentTarget.style.color = "#25D366"; } }}
                  >
                    {sharingWaId === q.id ? <Loader2 size={13} className="animate-spin" /> : <MessageCircle size={13} />} WhatsApp
                  </button>
                  <button
                    onClick={() => shareEmail(q)}
                    disabled={sharingEmailId === q.id}
                    title="Share via Email"
                    style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", borderRadius: 9, fontSize: 12, fontWeight: 700, background: "rgba(46,125,82,0.08)", color: "var(--green)", border: "1px solid rgba(46,125,82,0.2)", cursor: sharingEmailId === q.id ? "not-allowed" : "pointer", opacity: sharingEmailId === q.id ? 0.6 : 1, transition: "all 0.15s" }}
                    onMouseEnter={e => { if (sharingEmailId !== q.id) { e.currentTarget.style.background = "var(--green)"; e.currentTarget.style.color = "white"; } }}
                    onMouseLeave={e => { if (sharingEmailId !== q.id) { e.currentTarget.style.background = "rgba(46,125,82,0.08)"; e.currentTarget.style.color = "var(--green)"; } }}
                  >
                    {sharingEmailId === q.id ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Email
                  </button>
                  <button
                    onClick={() => copyToClipboard(q)}
                    disabled={sharingCopyId === q.id}
                    title="Copy to Clipboard"
                    style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", borderRadius: 9, fontSize: 12, fontWeight: 700, background: copiedId === q.id ? "rgba(46,125,82,0.1)" : "rgba(107,101,96,0.06)", color: copiedId === q.id ? "var(--green)" : "var(--muted)", border: copiedId === q.id ? "1px solid var(--green)" : "1px solid rgba(107,101,96,0.12)", cursor: sharingCopyId === q.id ? "not-allowed" : "pointer", opacity: sharingCopyId === q.id ? 0.6 : 1, transition: "all 0.15s" }}
                  >
                    {sharingCopyId === q.id ? <Loader2 size={13} className="animate-spin" /> : copiedId === q.id ? <Check size={13} /> : <Copy size={13} />} {copiedId === q.id ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={() => handleDownloadPdfDetail(q)}
                    disabled={detailPdfDownloading}
                    title="Download PDF Proposal"
                    style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", borderRadius: 9, fontSize: 12, fontWeight: 700, background: "rgba(99,102,241,0.07)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.18)", cursor: detailPdfDownloading ? "not-allowed" : "pointer", opacity: detailPdfDownloading ? 0.6 : 1, transition: "all 0.15s" }}
                    onMouseEnter={e => { if (!detailPdfDownloading) { e.currentTarget.style.background = "#6366f1"; e.currentTarget.style.color = "white"; } }}
                    onMouseLeave={e => { if (!detailPdfDownloading) { e.currentTarget.style.background = "rgba(99,102,241,0.07)"; e.currentTarget.style.color = "#6366f1"; } }}
                  >
                    {detailPdfDownloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PDF
                  </button>
                </div>

                {/* Row 2 — Action CTA (only when applicable), full width */}
                {q.status === "ReuploadRequested" && (
                  <button
                    onClick={() => { setSelectedQuotation(null); openPortalReuploadModal(q); }}
                    style={{ marginTop: 8, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, background: "linear-gradient(135deg, #b45309, #d97706)", color: "white", border: "none", cursor: "pointer", boxShadow: "0 3px 10px rgba(180,83,9,0.25)", transition: "opacity 0.15s" }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = "0.9"; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
                  >
                    <RefreshCw size={14} /> Re-upload Documents
                  </button>
                )}
                {q.status === "Approved" && (!q.geotag_submitted || !!q.geotag_reupload_requested) && (
                  <button
                    onClick={() => { setSelectedQuotation(null); openGeotagModal(q); }}
                    style={{ marginTop: 8, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, background: q.geotag_reupload_requested ? "linear-gradient(135deg, #c2410c, #ea580c)" : "linear-gradient(135deg, #1C3A2A 0%, #2E7D52 100%)", color: "white", border: "none", cursor: "pointer", boxShadow: q.geotag_reupload_requested ? "0 3px 10px rgba(234,88,12,0.25)" : "0 3px 10px rgba(46,125,82,0.25)", transition: "opacity 0.15s" }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = "0.9"; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
                  >
                    <Camera size={14} /> {q.geotag_reupload_requested ? "Re-upload Geo-tags" : "Upload Geo-tags"}
                  </button>
                )}

              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
