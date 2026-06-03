import { useState, useEffect, useMemo, useRef } from "react";
import { fmt, calcQuotation, calculateSubsidy, generatePdfQuotation, getHighestWatt } from "../utils/helpers";
import { prices as pricesApi, quotations as quotationsApi, customers as customersApi, uploads as uploadsApi, settings as settingsApi } from "../utils/api";
import { Loader2, PartyPopper, Download, Check, Sun, Zap, Hash, BarChart3, IdCard, CreditCard, Landmark, Home, ArrowLeft, ArrowRight, Send, MessageCircle, Mail, Copy, Coins, Package, RefreshCw, FileText, Leaf, Info, AlertTriangle } from "lucide-react";
import ErrorState from "./ErrorState";
import UploadZone from "./UploadZone";
import ConfirmDialog from "./ConfirmDialog";

// Kits are loaded dynamically from the database

export default function DealerQuotation({ user, initialForm, onClearInitialForm }) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState(() => {
    // ISSUE-14 fix: use sessionStorage (cleared on tab close) instead of
    // localStorage so stale mode doesn't persist across browser sessions.
    return sessionStorage.getItem("hp_dealer_mode") || null;
  });

  // Effect to handle pre-filled customer details from Inquiries conversion
  useEffect(() => {
    if (initialForm) {
      setForm(f => ({
        ...f,
        customerName: initialForm.customerName || "",
        customerAddress: initialForm.customerAddress || "",
        customerPhone: initialForm.customerPhone || "",
        customerEmail: initialForm.customerEmail || "",
        customerCity: initialForm.customerCity || "",
      }));
      if (onClearInitialForm) {
        onClearInitialForm();
      }
    }
  }, [initialForm, onClearInitialForm]);
  const [prices, setPrices] = useState({ panels: [], inverters: [], accessories: [], kits: [] });
  const [pricingSettings, setPricingSettings] = useState({
    bom_price_per_kw: 3900,
    labour_price_per_kw: 2000,
    commission_price_per_kw: 3000,
    profit_percentage: 10,
    transport_percentage: 1.2,
    gst_rate: 8.9,
  });
  const [gstRate, setGstRate] = useState(0.089);
  const [loadingPrices, setLoadingPrices] = useState(true);
  const [priceError, setPriceError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const creatingRef = useRef(false);
  // Mirror of submittedQuotation in a ref so async closures always read the
  // latest value without stale-closure issues (fixes concurrent share bug).
  const submittedQuotationRef = useRef(null);
  const [customPrice, setCustomPrice] = useState("");
  const [selectedPanelBrand, setSelectedPanelBrand] = useState("");
  const [selectedInverterBrand, setSelectedInverterBrand] = useState("");
  const [selectedKitId, setSelectedKitId] = useState("");

  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    customerCity: "",
    customerAddress: "",
    panelCount: "",
    panelId: "",
    inverterId: "",
    structureHeight: "Ground Level (Flat)",
    paymentMode: "Cash",
    subsidy: "yes",
    aadhaarMode: "photos",
    aadhaarFront: null,
    aadhaarBack: null,
    aadhaar: null,
    pan: null,
    passbook: null,
    sitePhoto: null,
    veraBill: null,
    housePhoto1: null,
    housePhoto2: null,
    housePhoto3: null,
  });
  const [submitted, setSubmitted] = useState(false);
  const [submittedQuotation, setSubmittedQuotation] = useState(null);

  // Keep the ref in sync with state so ensureQuotationCreated always has
  // the latest value regardless of closure capture order.
  const setSubmittedQuotationWithRef = (valOrFn) => {
    setSubmittedQuotation(prev => {
      const next = typeof valOrFn === "function" ? valOrFn(prev) : valOrFn;
      submittedQuotationRef.current = next;
      return next;
    });
  };
  const [copied, setCopied] = useState(false);
  // MINOR-02 fix: separate sharing flags per action so each button shows its
  // own loading state without incorrectly disabling the others.
  const [sharingWhatsApp, setSharingWhatsApp] = useState(false);
  const [sharingEmail, setSharingEmail] = useState(false);
  const [sharingCopy, setSharingCopy] = useState(false);
  // Derived: any share action is in progress (used for combined disabled states)
  const sharing = sharingWhatsApp || sharingEmail || sharingCopy;
  const [dialogState, setDialogState] = useState({ open: false, title: "", message: "", variant: "info" });
  const [showModeSwitch, setShowModeSwitch] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [pdfRetrying, setPdfRetrying] = useState(false);

  // Shared price-fetching logic — used by initial load AND retry button (GAP 14)
  const fetchPrices = () => {
    setPriceError(false);
    setLoadingPrices(true);
    pricesApi.getAll()
      .then(res => {
        const mappedPrices = {
          panels: (res.panels || []).map(p => ({
            id: String(p.id),
            brand: p.brand,
            watt: p.watt,
            type: p.type,
            pricePerPanel: Number(p.price_per_panel),
          })),
          inverters: (res.inverters || []).map(i => ({
            id: String(i.id),
            brand: i.brand,
            kw: Number(i.kw),
            type: i.type,
            pricePerUnit: Number(i.price_per_unit),
          })),
          accessories: buildAccessoriesMap(res.accessories || []),
          kits: (res.kits || []).map(k => ({
            id: String(k.id),
            brand: k.brand,
            type: k.type,
            watt: k.watt,
            panels: Number(k.panels),
            kw: Number(k.kw),
            price: Number(k.price),
            invBrand: k.inv_brand,
            invKw: Number(k.inv_kw),
          })),
        };
        setPrices(mappedPrices);
      })
      .catch(err => { setPriceError(true); console.error("Fetch prices error:", err); })
      .finally(() => setLoadingPrices(false));
  };

  // Fetch prices on mount
  useEffect(() => { fetchPrices(); }, []);

  // Fetch pricing settings from settings
  useEffect(() => {
    settingsApi.getPublic()
      .then(res => {
        const s = res.settings || {};
        const parsed = {
          bom_price_per_kw: parseFloat(s.bom_price_per_kw) || 3900,
          labour_price_per_kw: parseFloat(s.labour_price_per_kw) || 2000,
          commission_price_per_kw: parseFloat(s.commission_price_per_kw) || 3000,
          profit_percentage: parseFloat(s.profit_percentage) || 10,
          transport_percentage: parseFloat(s.transport_percentage) || 1.2,
          gst_rate: parseFloat(s.gst_rate) || 8.9,
        };
        setPricingSettings(parsed);
        setGstRate(parsed.gst_rate / 100);
      })
      .catch(err => console.error("Fetch pricing settings error:", err));
  }, []);

  // Map DB accessories array to the flat object calcQuotation expects.
  // Uses Map.get() instead of plain-object bracket access to avoid prototype-pollution warnings.
  function buildAccessoriesMap(accArray) {
    const acc = new Map();
    for (const a of accArray) acc.set(a.key_name, Number(a.price));
    const g = (key, def) => (acc.has(key) ? acc.get(key) : def);
    return {
      dcWirePerMeter:        g("polycab_dc_cable_red",    58.50),
      acWirePerMeter:        g("addison_ac_cable_red",    31.35),
      earthingKit:           g("earthing_la_electrode",  500.00) + g("earthing_chemical", 85.00),
      mcb:                   g("wire_tap",                15.00),
      acdb:                  g("acdb",                   800.00),
      dcdb:                  g("dcdb",                   800.00),
      mountingStructurePerKw: g("gi_hot_dip_pipe_60_40", 1475.00),
      lightningArrester:     g("addison_la_cable",        22.77),
      monitoring:            g("mc4_connector",           25.00),
      installation:          g("zinc_spray",             170.00),
    };
  }

  // Synchronize Panel Brand select when panelId changes
  useEffect(() => {
    if (form.panelId && prices.panels.length > 0) {
      const p = prices.panels.find(x => x.id === form.panelId);
      if (p && p.brand !== selectedPanelBrand) {
        setSelectedPanelBrand(p.brand);
      }
    }
  }, [form.panelId, prices.panels]);

  // Synchronize Inverter Brand select when inverterId changes
  useEffect(() => {
    if (form.inverterId && prices.inverters.length > 0) {
      const inv = prices.inverters.find(x => x.id === form.inverterId);
      if (inv && inv.brand !== selectedInverterBrand) {
        setSelectedInverterBrand(inv.brand);
      }
    }
  }, [form.inverterId, prices.inverters]);

  // Handle Kit Selection
  const handleKitSelect = (kitId) => {
    setSelectedKitId(kitId);
    if (!kitId) {
      setForm(f => ({ ...f, panelId: "", inverterId: "", panelCount: "" }));
      setSelectedPanelBrand("");
      setSelectedInverterBrand("");
      return;
    }

    const kit = (prices.kits || []).find(k => k.id === kitId);
    if (!kit) return;

    // 1. Auto-select Panel Brand and Model
    const matchingPanel = prices.panels.find(p => 
      p.brand.toLowerCase() === kit.brand.toLowerCase() && 
      p.type.toLowerCase() === kit.type.toLowerCase() &&
      (String(p.watt) === String(kit.watt) || 
       (String(p.watt).includes("-") && 
        parseInt(kit.watt) >= parseInt(String(p.watt).split("-")[0]) && 
        parseInt(kit.watt) <= parseInt(String(p.watt).split("-")[1])))
    );
    if (matchingPanel) {
      setSelectedPanelBrand(matchingPanel.brand);
      setForm(f => ({ ...f, panelId: matchingPanel.id, panelCount: kit.panels }));
    } else {
      setForm(f => ({ ...f, panelCount: kit.panels }));
    }

    // 2. Auto-select Inverter Brand and Model
    const matchingInv = prices.inverters.find(i => i.brand.toLowerCase().includes(kit.invBrand.toLowerCase().split('/')[0]) && Math.abs(Number(i.kw) - Number(kit.invKw)) < 0.5);
    if (matchingInv) {
      setSelectedInverterBrand(matchingInv.brand);
      setForm(f => ({ ...f, inverterId: matchingInv.id }));
    }
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Live quotation calculation — memoized for performance
  const { quote, stdEffectivePrice, stdTotal } = useMemo(() => {
    let q = null;
    let sep = 0;
    let st = 0;
    if (!form.panelId || !form.inverterId || !form.panelCount) return { quote: q, stdEffectivePrice: sep, stdTotal: st };

    // Get parameters from settings state
    const s = pricingSettings;
    const bomPricePerKw = Number(s.bom_price_per_kw) || 3900;
    const labourPricePerKw = Number(s.labour_price_per_kw) || 2000;
    const commissionPricePerKw = Number(s.commission_price_per_kw) || 3000;
    const profitPercentage = Number(s.profit_percentage) || 10;
    const transportPercentage = Number(s.transport_percentage) || 1.2;

    if (mode === "kit") {
      const panel = prices.panels.find(p => p.id === form.panelId);
      const inverter = prices.inverters.find(i => i.id === form.inverterId);
      if (panel && inverter) {
        const kit = (prices.kits || []).find(k => k.id === selectedKitId);
        
        let stdQuote = null;
        if (kit) {
          const systemKw = kit.kw;
          const targetTotal = kit.price;

          const calcPanelCost = parseInt(form.panelCount) * panel.pricePerPanel;
          const calcInverterCost = inverter.pricePerUnit;
          
          const calcBaseCost = calcPanelCost + calcInverterCost + 
                               (systemKw * bomPricePerKw) + 
                               (systemKw * labourPricePerKw) + 
                               (systemKw * commissionPricePerKw);
                               
          const calcProfitCost = calcBaseCost * (profitPercentage / 100);
          const calcTransportCost = calcBaseCost * (transportPercentage / 100);
          
          const calcSubtotal = calcBaseCost + calcProfitCost + calcTransportCost;
          const calcGst = Math.round(calcSubtotal * (Number(s.gst_rate) / 100));
          const calcTotal = calcSubtotal + calcGst;

          if (calcTotal > 0) {
            const ratio = targetTotal / calcTotal;

            const panelCost = Math.round(calcPanelCost * ratio);
            const inverterCost = Math.round(calcInverterCost * ratio);
            const dcWire = Math.round((systemKw * bomPricePerKw) * ratio);
            const acWire = Math.round((systemKw * labourPricePerKw) * ratio);
            const structure = Math.round((systemKw * commissionPricePerKw) * ratio);
            const elec = Math.round(calcProfitCost * ratio);
            const earthing = Math.round(calcTransportCost * ratio);
            const misc = 0;

            const subtotal = panelCost + inverterCost + dcWire + acWire + structure + elec + earthing + misc;
            const gst = Math.round(subtotal * (Number(s.gst_rate) / 100));
            const total = subtotal + gst;

            stdQuote = {
              systemKw,
              panelCount: parseInt(form.panelCount), panelCost, inverterCost, dcWire, acWire,
              structure, elec, earthing, misc, subtotal, gst, total,
              subsidy: 0,
              effectivePrice: total,
              pricePerKw: Math.round(total / systemKw),
            };
          }
        } else {
          // BUG-01 FIX: This else (no kit selected — custom component config) was
          // previously nested INSIDE if(kit) due to a brace misalignment, making
          // it unreachable. It is now correctly at the same level as if(kit).
          // ISSUE-08: Use computed systemKw from panel watt × count (not kit.kw)
          // so the price per kW is calculated correctly for custom configurations.
          const systemKw = (parseInt(form.panelCount) * getHighestWatt(panel.watt)) / 1000;
          const panelCost = parseInt(form.panelCount) * panel.pricePerPanel;
          const inverterCost = inverter.pricePerUnit;
          
          const baseCost = panelCost + inverterCost + 
                           (systemKw * bomPricePerKw) + 
                           (systemKw * labourPricePerKw) + 
                           (systemKw * commissionPricePerKw);
                            
          const profitCost = baseCost * (profitPercentage / 100);
          const transportCost = baseCost * (transportPercentage / 100);
          
          const dcWire = Math.round(systemKw * bomPricePerKw);
          const acWire = Math.round(systemKw * labourPricePerKw);
          const structure = Math.round(systemKw * commissionPricePerKw);
          const elec = Math.round(profitCost);
          const earthing = Math.round(transportCost);
          const misc = 0;

          const subtotal = panelCost + inverterCost + dcWire + acWire + structure + elec + earthing + misc;
          const gst = Math.round(subtotal * (Number(s.gst_rate) / 100));
          const total = subtotal + gst;

          stdQuote = {
            systemKw,
            panelCount: parseInt(form.panelCount), 
            panelCost, 
            inverterCost, 
            dcWire, 
            acWire,
            structure, 
            elec, 
            earthing, 
            misc, 
            subtotal, 
            gst, 
            total,
            subsidy: 0,
            effectivePrice: total,
            pricePerKw: Math.round(total / systemKw),
          };
        }

        if (stdQuote) {
          st = stdQuote.total;
          if (customPrice && parseFloat(customPrice) > 0 && st > 0) {
            const targetTotal = parseFloat(customPrice);
            const ratio = targetTotal / st;

            const panelCost = Math.round(stdQuote.panelCost * ratio);
            const inverterCost = Math.round(stdQuote.inverterCost * ratio);
            const dcWire = Math.round(stdQuote.dcWire * ratio);
            const acWire = Math.round(stdQuote.acWire * ratio);
            const structure = Math.round(stdQuote.structure * ratio);
            const elec = Math.round(stdQuote.elec * ratio);
            const earthing = Math.round(stdQuote.earthing * ratio);
            const misc = Math.round(stdQuote.misc * ratio);

            const subtotal = panelCost + inverterCost + dcWire + acWire + structure + elec + earthing + misc;

            // Absorb rounding drift into panelCost to ensure total matches target
            const targetSubtotal = Math.round(targetTotal / (1 + gstRate));
            const drift = targetSubtotal - subtotal;
            const adjPanelCost = Math.abs(drift) < 10 ? panelCost + drift : panelCost;
            const adjSubtotal = adjPanelCost + inverterCost + dcWire + acWire + structure + elec + earthing + misc;

            const gst = Math.round(adjSubtotal * gstRate);
            const total = adjSubtotal + gst;

            q = {
              systemKw: stdQuote.systemKw,
              panelCount: stdQuote.panelCount, panelCost: adjPanelCost, inverterCost, dcWire, acWire,
              structure, elec, earthing, misc, subtotal: adjSubtotal, gst, total,
              subsidy: 0,
              effectivePrice: total,
              pricePerKw: Math.round(total / stdQuote.systemKw),
              isCustomPrice: true
            };
          } else {
            q = stdQuote;
          }
        }
      }
    } else {
      const stdQuote = calcQuotation(form.panelId, form.inverterId, parseInt(form.panelCount), prices, form.subsidy, gstRate, pricingSettings);
      if (stdQuote) {
        sep = stdQuote.effectivePrice;
        st = stdQuote.total;
        if (customPrice && parseFloat(customPrice) > 0 && st > 0) {
          const targetTotal = parseFloat(customPrice);
          const subsidy = stdQuote.subsidy;
          const stdTotalVal = stdQuote.total;

          if (stdTotalVal > 0) {
            const ratio = targetTotal / stdTotalVal;
            
            const panelCost = Math.round(stdQuote.panelCost * ratio);
            const inverterCost = Math.round(stdQuote.inverterCost * ratio);
            const dcWire = Math.round(stdQuote.dcWire * ratio);
            const acWire = Math.round(stdQuote.acWire * ratio);
            const structure = Math.round(stdQuote.structure * ratio);
            const elec = Math.round(stdQuote.elec * ratio);
            const earthing = Math.round(stdQuote.earthing * ratio);
            const misc = Math.round(stdQuote.misc * ratio);

            const subtotal = panelCost + inverterCost + dcWire + acWire + structure + elec + earthing + misc;

            // Absorb rounding drift into panelCost to ensure total matches target
            const targetSubtotal = Math.round(targetTotal / (1 + gstRate));
            const drift = targetSubtotal - subtotal;
            const adjPanelCost = Math.abs(drift) < 10 ? panelCost + drift : panelCost;
            const adjSubtotal = adjPanelCost + inverterCost + dcWire + acWire + structure + elec + earthing + misc;

            const gst = Math.round(adjSubtotal * gstRate);
            const total = adjSubtotal + gst;
            const effectivePrice = Math.max(0, total - subsidy);

            q = {
              systemKw: stdQuote.systemKw,
              panelCount: stdQuote.panelCount,
              panelCost: adjPanelCost, inverterCost, dcWire, acWire,
              structure, elec, earthing, misc, subtotal: adjSubtotal, gst, total,
              subsidy, effectivePrice,
              pricePerKw: Math.round(total / stdQuote.systemKw),
              isCustomPrice: true
            };
          } else {
            q = stdQuote;
          }
        } else {
          q = stdQuote;
        }
      }
    }
    return { quote: q, stdEffectivePrice: sep, stdTotal: st };
  }, [form.panelId, form.inverterId, form.panelCount, form.subsidy, mode, prices, gstRate, selectedKitId, customPrice, pricingSettings]);

  const panel = prices.panels.find(p => p.id === form.panelId);
  const inverter = prices.inverters.find(i => i.id === form.inverterId);

  const panelBrands = [...new Set(prices.panels.map(p => p.brand))];
  const inverterBrands = [...new Set(prices.inverters.map(i => i.brand))];
  const filteredPanels = prices.panels.filter(p => p.brand === selectedPanelBrand);
  const filteredInverters = prices.inverters.filter(i => i.brand === selectedInverterBrand);

  const kitObj = (prices.kits || []).find(k => k.id === selectedKitId);
  const selectedKitName = kitObj 
    ? `${kitObj.brand} ${kitObj.type} ${kitObj.kw.toFixed(2)} kW (${kitObj.panels} Panels)` 
    : "Custom Configuration";

  const numericCustomPrice = parseFloat(customPrice) || 0;
  // Enforce minimum floor in both Kit mode and Commission mode (custom price must be >= standard/kit total).
  const isCustomPriceValid = !customPrice || (numericCustomPrice >= stdTotal);
  // MINOR-03 fix: customerAddress is now required in canStep2 since it
  // appears in the PDF and WhatsApp message. Empty address produces a
  // blank address field in the customer-facing proposal.
  const canStep2 = form.customerName.trim() && form.panelCount && form.panelId 
    && form.inverterId && isCustomPriceValid && form.customerPhone 
    && form.customerPhone.length === 10 && form.customerAddress.trim();
  // ISSUE-15 fix: Kit mode canSubmit also requires quote to exist (not null).
  // Without this, submitting with no quote crashes ensureQuotationCreated()
  // because it tries to read quote.systemKw, quote.panelCost, etc.
  const aadhaarReady = form.aadhaarMode === "photos"
    ? (form.aadhaarFront && form.aadhaarBack)
    : !!form.aadhaar;
  const canSubmit = (mode === "kit" ? (quote !== null) : (
    aadhaarReady && form.pan && form.passbook && form.sitePhoto &&
    (form.paymentMode !== "Bank Loan" || (form.veraBill && form.housePhoto1 && form.housePhoto2 && form.housePhoto3))
  ));

  // Shared helper: ensures quotation is created in DB and PDF is uploaded
  // Returns { quotationId, quotationNumber, proposalDocId } or throws
  const ensureQuotationCreated = async () => {
    if (creatingRef.current) {
      // FIX BUG 2: Use the REF (not state) to check for existing quotation.
      // React state captured in a closure is stale; the ref always has the latest value.
      const existing = submittedQuotationRef.current;
      if (existing?.id) {
        return { quotationId: existing.id, quotationNumber: existing.quotation_number, proposalDocId: existing.proposalDocId };
      }
      // FIX BUG 9: Wait longer (5s) for slow network PDF uploads.
      await new Promise(r => setTimeout(r, 5000));
      const afterWait = submittedQuotationRef.current;
      if (afterWait?.id) {
        return { quotationId: afterWait.id, quotationNumber: afterWait.quotation_number, proposalDocId: afterWait.proposalDocId };
      }
      throw new Error("Quotation creation is still in progress. Please wait a moment and try again.");
    }
    if (submittedQuotationRef.current?.id) {
      // Already created, just ensure PDF exists
      const cached = submittedQuotationRef.current;
      let docId = cached.proposalDocId;
      if (!docId) {
        try {
          const customerData = {
            id: cached.quotation_number,
            date: new Date().toLocaleDateString("en-IN"),
            ...form,
            structureHeight: mode === "kit" ? ("Kit: " + selectedKitName) : form.structureHeight,
          };
          const pdfResult = await generatePdfQuotation(customerData, quote, panel, inverter, { download: false });
          if (pdfResult && pdfResult.file) {
            const uploadRes = await uploadsApi.single(pdfResult.file, "quotation", cached.id, "other");
            docId = uploadRes.document.public_token;
            setSubmittedQuotationWithRef(prev => ({ ...prev, proposalDocId: docId }));
          }
        } catch (err) {
          console.error("Failed to generate and upload PDF:", err);
        }
      }
      return {
        quotationId: cached.id,
        quotationNumber: cached.quotation_number,
        proposalDocId: docId,
      };
    }

    // Guard against double-submission
    creatingRef.current = true;
    try {
    // 1. Dedup: check if customer with this phone already exists
    let customerId;
    if (form.customerPhone) {
      try {
        const existing = await customersApi.list({ search: form.customerPhone });
        if (existing.customers && existing.customers.length > 0) {
          const match = existing.customers.find(c => c.phone === form.customerPhone);
          if (match) customerId = match.id;
        }
      } catch (e) {
        // If search fails, proceed with creating new customer
      }
    }

    if (!customerId) {
      const custRes = await customersApi.create({
        name: form.customerName,
        phone: form.customerPhone || null,
        email: form.customerEmail || null,
        city: form.customerCity || null,
        address: form.customerAddress || null,
        status: "Lead",
      });
      customerId = custRes.customer.id;
    }

    // 2. Submit quotation to the API
    const data = await quotationsApi.create({
      customerId,
      panelId: parseInt(form.panelId),
      inverterId: parseInt(form.inverterId),
      panelCount: parseInt(form.panelCount),
      systemKw: quote.systemKw,
      structureHeight: mode === "kit" ? ("Kit: " + selectedKitName) : form.structureHeight,
      paymentMode: mode === "kit" ? "Kit Purchase" : form.paymentMode,
      subsidyApplicable: mode === "commission",
      panelCost: quote.panelCost,
      inverterCost: quote.inverterCost,
      dcWireCost: quote.dcWire,
      acWireCost: quote.acWire,
      structureCost: quote.structure,
      electricalCost: quote.elec,
      earthingCost: quote.earthing,
      miscCost: quote.misc,
      subtotal: quote.subtotal,
      gstRate: Number(pricingSettings.gst_rate),
      gstAmount: quote.gst,
      total: quote.total,
      subsidyAmount: mode === "kit" ? 0 : quote.subsidy,
      effectivePrice: quote.effectivePrice,
      pricePerKw: quote.pricePerKw,
    });

    const quotationId = data.quotation.id;
    const quotationNumber = data.quotation.quotation_number;

    // 3. Generate and upload PDF
    let proposalDocId = null;
    try {
      const customerData = {
        id: quotationNumber,
        date: new Date().toLocaleDateString("en-IN"),
        ...form,
        structureHeight: mode === "kit" ? ("Kit: " + selectedKitName) : form.structureHeight,
      };
      const pdfResult = await generatePdfQuotation(customerData, quote, panel, inverter, { download: false });
      if (pdfResult && pdfResult.file) {
        const uploadRes = await uploadsApi.single(pdfResult.file, "quotation", quotationId, "other");
        proposalDocId = uploadRes.document.public_token;
      }
    } catch (pdfErr) {
      console.error("Failed to upload proposal PDF:", pdfErr);
    }

    // FIX BUG 8: Reset creatingRef on success so future calls aren't blocked.
    creatingRef.current = false;

    // Cache in both state and ref (ref ensures async closures see the latest value).
    setSubmittedQuotationWithRef({
      id: quotationId,
      quotation_number: quotationNumber,
      proposalDocId,
    });

    return { quotationId, quotationNumber, proposalDocId };
    } catch (err) {
      creatingRef.current = false;
      throw err;
    }
  };

  const downloadPdf = async () => {
    if (!quote || downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const customerData = {
        id: submittedQuotation?.quotation_number || ("Q-" + Date.now()),
        date: new Date().toLocaleDateString("en-IN"),
        ...form,
        structureHeight: mode === "kit" ? ("Kit: " + selectedKitName) : form.structureHeight,
      };
      await generatePdfQuotation(customerData, quote, panel, inverter);
    } catch (err) {
      console.error("PDF generation failed:", err);
      setDialogState({ open: true, title: "PDF Generation Failed", message: err.message || "Could not generate PDF. Please try again.", variant: "danger" });
    } finally {
      setDownloadingPdf(false);
    }
  };

  const base64ToFile = (fileObj) => {
    if (!fileObj || !fileObj.data) return null;
    try {
      const byteString = atob(fileObj.data.split(',')[1]);
      const mimeString = fileObj.data.split(',')[0].split(':')[1].split(';')[0];
      // Uint8Array.from avoids manual indexed writes — no bracket notation needed.
      const ia = Uint8Array.from(byteString, (c) => c.charCodeAt(0));
      const ab = ia.buffer;
      const blob = new Blob([ab], { type: mimeString });
      return new File([blob], fileObj.name, { type: mimeString });
    } catch (err) {
      console.error("base64ToFile: malformed data URL", err);
      return null;
    }
  };

  const handleSubmit = async () => {
    if (!quote) return;
    setSubmitting(true);

    try {
      const { quotationId } = await ensureQuotationCreated();

      // Check which doc types already exist for this quotation (prevents duplicates on retry)
      let uploadedTypes = new Set();
      try {
        const existingDocs = await uploadsApi.listForEntity("quotation", quotationId);
        uploadedTypes = new Set((existingDocs.documents || []).map(d => d.doc_type));
      } catch (e) {
        // If check fails, proceed — worst case is server-side duplicates
      }

      // Explicit per-field list — no dynamic form[key] bracket access.
      const filesToUpload = [
        // Aadhaar: two-photo mode sends front + back; PDF mode sends single file
        ...(form.aadhaarMode === "photos"
          ? [
              { file: form.aadhaarFront, type: "aadhaar_front" },
              { file: form.aadhaarBack,  type: "aadhaar_back" },
            ]
          : [{ file: form.aadhaar, type: "aadhaar" }]
        ),
        { file: form.pan,         type: "pan" },
        { file: form.passbook,    type: "passbook" },
        { file: form.sitePhoto,   type: "site_photo" },
        { file: form.veraBill,    type: "vera_bill" },
        { file: form.housePhoto1, type: "house_photo_1" },
        { file: form.housePhoto2, type: "house_photo_2" },
        { file: form.housePhoto3, type: "house_photo_3" },
      ];
      for (const { file, type } of filesToUpload) {
        if (file && !uploadedTypes.has(type)) {
          const f = base64ToFile(file);
          if (f) await uploadsApi.single(f, "quotation", quotationId, type);
        }
      }

      setSubmitted(true);
    } catch (err) {
      setDialogState({ open: true, title: "Submission Failed", message: err.message || "Failed to submit quotation. You can safely retry — already uploaded documents will not be duplicated.", variant: "danger" });
    } finally {
      setSubmitting(false);
    }
  };

  const getGreetingMessage = (isDraft = false, pdfLink = "") => {
    if (!quote) return "";
    const customerName = form.customerName.toUpperCase();
    const systemSize = quote.systemKw.toFixed(2);
    const panelBrand = panel?.brand || "";
    const panelWatt = panel?.watt || "";
    const inverterBrand = inverter?.brand || "";
    const inverterKw = inverter?.kw || "";
    const effectivePrice = fmt(quote.effectivePrice);

    const pdfLine = pdfLink
      ? `View/Download your Official PDF Proposal:\n${pdfLink}`
      : `A detailed PDF proposal will be shared with you separately.`;

    if (mode === "kit") {
      return `Hello ${customerName},

Thank you for choosing Highlight Pro. We are pleased to present the official dealer pricing proposal for your ${systemSize} kW Solar Rooftop Kit:

- System Size: ${systemSize} kW
- Panels: ${quote.panelCount} pcs (${panelBrand} ${panelWatt}W)
- Inverter: ${inverterBrand} ${Number(inverterKw)}kW
- Kit Price: ${fmt(quote.total)}

Let us help power your home with clean, renewable energy.

${pdfLine}`;
    }

    const subsidyStatus = quote.subsidy > 0 ? "Applicable" : "Not Applicable";
    return `Hello ${customerName},

Thank you for choosing Highlight Pro. We are pleased to present the proposal for your ${systemSize} kW Solar Rooftop System:

- System Size: ${systemSize} kW
- Panels: ${quote.panelCount} pcs (${panelBrand} ${panelWatt}W)
- Inverter: ${inverterBrand} ${Number(inverterKw)}kW
- Govt Subsidy: ${subsidyStatus}
- Effective Price: ${effectivePrice}

Let us help power your home with clean, renewable energy.

${pdfLine}`;
  };

  const shareWhatsApp = async (isDraft = false) => {
    if (!quote || sharingWhatsApp) return;
    setSharingWhatsApp(true);

    const waWindow = window.open("", "_blank");
    if (!waWindow) {
      setSharingWhatsApp(false);
      setDialogState({ open: true, title: "Popup Blocked", message: "Please allow popups for this site to open WhatsApp.", variant: "danger" });
      return;
    }

    try {
      if (isDraft) {
        // SEC-3 FIX: Guard against blank phone number — WhatsApp requires a valid number.
        const cleanPhone = (form.customerPhone || "").replace(/\D/g, "");
        if (!cleanPhone) {
          waWindow.close();
          setSharingWhatsApp(false);
          setDialogState({ open: true, title: "Phone Number Required", message: "Please enter the customer's phone number before sharing via WhatsApp.", variant: "danger" });
          return;
        }
        const message = getGreetingMessage(true, "");
        const phoneWithCountry = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
        const waUrl = `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`;
        await generatePdfQuotation(
          { id: "Draft", date: new Date().toLocaleDateString("en-IN"), ...form, structureHeight: mode === "kit" ? ("Kit: " + selectedKitName) : form.structureHeight },
          quote, panel, inverter, { download: true }
        );
        waWindow.location.href = waUrl;
        setDialogState({ open: true, title: "PDF Downloaded", message: "PDF proposal downloaded! Customer's WhatsApp chat has been opened. Please attach the downloaded PDF file to this chat.", variant: "info" });
        return;
      }

      const { proposalDocId } = await ensureQuotationCreated();
      const docId = proposalDocId;

      // SEC-3: Also guard for non-draft path (phone should never be empty here
      // because canStep2 requires it, but defensive check costs nothing).
      const cleanPhoneNonDraft = (form.customerPhone || "").replace(/\D/g, "");
      if (!cleanPhoneNonDraft) {
        waWindow.close();
        setDialogState({ open: true, title: "Phone Number Required", message: "Customer phone number is missing.", variant: "danger" });
        return;
      }

      // SEC-3: Guard is above — cleanPhoneNonDraft is confirmed non-empty.
      const pdfLink = docId ? `${window.location.origin}/api/uploads/public/${docId}` : "";
      const message = getGreetingMessage(false, pdfLink);
      const phoneWithCountry = cleanPhoneNonDraft.length === 10 ? `91${cleanPhoneNonDraft}` : cleanPhoneNonDraft;
      const waUrl = `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`;

      if (!docId) {
        await generatePdfQuotation({ id: submittedQuotation?.quotation_number || "Draft", date: new Date().toLocaleDateString("en-IN"), ...form, structureHeight: mode === "kit" ? ("Kit: " + selectedKitName) : form.structureHeight }, quote, panel, inverter, { download: true });
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
      setSharingWhatsApp(false);
    }
  };

  // shareEmail: create/ensure quotation exists and compose an email with PDF link.
  // Uses ensureQuotationCreated() to get the server-hosted PDF URL when available,
  // falling back to a local download + mailto if the upload failed.
  const shareEmail = async (isDraft = false) => {
    if (!quote || sharingEmail) return;
    setSharingEmail(true);
    try {
      if (isDraft) {
        // Draft mode: just download the PDF and open a generic mailto
        await downloadPdf();
        const message = getGreetingMessage(isDraft);
        const proposalNo = "Draft";
        const subject = `Solar System Proposal - Highlight Renewable Energy (${proposalNo})`;
        const url = `mailto:${form.customerEmail || ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
        window.open(url, "_blank");
        return;
      }

      // Non-draft: ensure quotation and PDF exist on server
      const { quotationNumber, proposalDocId } = await ensureQuotationCreated();
      const pdfLink = proposalDocId ? `${window.location.origin}/api/uploads/public/${proposalDocId}` : "";

      if (!proposalDocId) {
        // Fallback: download PDF locally since server upload failed
        await downloadPdf();
      }

      const message = getGreetingMessage(false, pdfLink);
      const subject = `Solar System Proposal - Highlight Renewable Energy (${quotationNumber})`;
      const url = `mailto:${form.customerEmail || ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
      window.open(url, "_blank");
    } catch (err) {
      console.error("Error sharing via email:", err);
      setDialogState({ open: true, title: "Email Failed", message: err.message || "Failed to open email client.", variant: "danger" });
    } finally {
      setSharingEmail(false);
    }
  };

  // FIX BUG 3: Guard against double-clicks; show loading state.
  // Uses server-hosted PDF link when available (matches WhatsApp/Email flow).
  const copyToClipboard = async (isDraft = false) => {
    if (!quote || sharingCopy) return;
    setSharingCopy(true);
    try {
      if (isDraft) {
        // Draft mode: download PDF locally and copy message without link
        await downloadPdf();
        const message = getGreetingMessage(true, "");
        try {
          await navigator.clipboard.writeText(message);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (err) {
          console.error("Clipboard copy failed", err);
          setDialogState({ open: true, title: "Copy Failed", message: "Could not copy to clipboard. Please copy the message manually.", variant: "danger" });
        }
        return;
      }

      // Non-draft: ensure quotation and PDF exist on server
      const { proposalDocId } = await ensureQuotationCreated();
      const pdfLink = proposalDocId ? `${window.location.origin}/api/uploads/public/${proposalDocId}` : "";

      if (!proposalDocId) {
        // No server copy — download locally as fallback
        await downloadPdf();
      }

      const message = getGreetingMessage(false, pdfLink);
      try {
        await navigator.clipboard.writeText(message);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Clipboard copy failed", err);
        setDialogState({ open: true, title: "Copy Failed", message: "Could not copy to clipboard. Please copy the message manually.", variant: "danger" });
      }
    } catch (err) {
      console.error("Error copying to clipboard:", err);
      setDialogState({ open: true, title: "Copy Failed", message: err.message || "Failed to copy message.", variant: "danger" });
    } finally {
      setSharingCopy(false);
    }
  };

  if (loadingPrices) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
        <div style={{ marginBottom: 8 }}><Loader2 size={32} className="animate-spin" /></div>
        Loading prices...
      </div>
    );
  }

  if (priceError) {
    return (
      <ErrorState
        title="Failed to load prices."
        message="Could not connect to the server. Please check your connection and try again."
        onRetry={fetchPrices}
      />
    );
  }

  if (!mode) {
    return (
      <div style={{ maxWidth: 800, margin: "40px auto", padding: "0 20px" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", marginBottom: 8 }}>
            Choose Your Work Mode
          </div>
          <div style={{ fontSize: 15, color: "var(--muted)" }}>
            Select how you want to partner with Highlight Renewable Energy for this session
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 24 }}>
          {/* Card 1: Commission */}
          <div
            onClick={() => {
              setMode("commission");
              sessionStorage.setItem("hp_dealer_mode", "commission");
            }}
            style={{
              background: "white",
              border: "1.5px solid var(--border)",
              borderRadius: 20,
              padding: 32,
              cursor: "pointer",
              transition: "all 0.25s",
              boxShadow: "0 10px 30px rgba(0,0,0,0.02)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
            className="hover-scale-card"
          >
            <div style={{ background: "rgba(46,125,82,0.1)", color: "var(--green)", width: 64, height: 64, borderRadius: 16, display: "flex", justifyContent: "center", alignItems: "center", marginBottom: 20 }}>
              <Coins size={32} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>
              Work with Commission
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, flex: 1 }}>
              Configure premium solar rooftop systems for residential or commercial clients. We handle the entire installation process, and the client receives the PM Surya Ghar government subsidy. You earn a high commission per kW!
            </div>
            <button
              className="btn-primary"
              style={{ marginTop: 24, padding: "10px 24px", width: "100%", background: "var(--green)" }}
            >
              Proceed with Commission
            </button>
          </div>

          {/* Card 2: Kit */}
          <div
            onClick={() => {
              setMode("kit");
              sessionStorage.setItem("hp_dealer_mode", "kit");
            }}
            style={{
              background: "white",
              border: "1.5px solid var(--border)",
              borderRadius: 20,
              padding: 32,
              cursor: "pointer",
              transition: "all 0.25s",
              boxShadow: "0 10px 30px rgba(0,0,0,0.02)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
            className="hover-scale-card"
          >
            <div style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6", width: 64, height: 64, borderRadius: 16, display: "flex", justifyContent: "center", alignItems: "center", marginBottom: 20 }}>
              <Package size={32} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>
              Work with Kit
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, flex: 1 }}>
              Purchase complete solar system materials (premium panels, high-end inverters, structure, cabling, ACDB/DCDB, earthing kits) as a bundle at wholesale dealer prices. Handle the installation and customer billings yourself!
            </div>
            <button
              className="btn-primary"
              style={{ marginTop: 24, padding: "10px 24px", width: "100%", background: "#3b82f6" }}
            >
              Proceed with Kit
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="success-screen">
        <div className="success-icon" style={{ color: "var(--green)" }}><PartyPopper size={56} strokeWidth={1.5} /></div>
        <div className="success-title">{mode === "kit" ? "Kit Order Submitted!" : "Request Submitted!"}</div>
        <div className="success-sub" style={{ marginBottom: 8 }}>
          Quotation <strong style={{ fontFamily: "var(--mono)" }}>{submittedQuotation?.quotation_number}</strong> has been created successfully.
        </div>
        <div className="success-sub" style={{ marginBottom: 24 }}>
          {mode === "kit" ? "Admin will review and prepare your kit shipment shortly." : "Admin will review documents and generate BOM shortly."}
        </div>

        <div className="card" style={{ maxWidth: 480, margin: "0 auto 24px auto", padding: "20px", borderRadius: 16, border: "1.5px solid var(--border)", background: "rgba(255, 255, 255, 0.8)", boxShadow: "0 10px 25px rgba(0,0,0,0.03)", textAlign: "left" }}>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <MessageCircle size={16} style={{ color: "var(--green)" }} />
            Share Proposal with Customer
          </div>
          <div style={{ background: "#FAFAF8", border: "1px solid var(--border)", borderRadius: 10, padding: 12, fontSize: 12, maxHeight: 150, overflowY: "auto", fontFamily: "var(--mono)", color: "var(--text)", whiteSpace: "pre-wrap", marginBottom: 16, borderLeft: "4px solid var(--green)" }}>
            {getGreetingMessage(false, submittedQuotation?.proposalDocId ? `${window.location.origin}/api/uploads/public/${submittedQuotation.proposalDocId}` : "")}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={shareWhatsApp}
              disabled={sharingWhatsApp}
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 14px", borderRadius: 10, background: sharingWhatsApp ? "#a8d5b5" : "#25D366", color: "white", border: "none", fontSize: 13, fontWeight: 600, cursor: sharingWhatsApp ? "not-allowed" : "pointer", boxShadow: "0 4px 10px rgba(37,211,102,0.15)", transition: "all 0.2s" }}
              onMouseOver={e => { if (!sharingWhatsApp) e.currentTarget.style.background = "#20ba59"; }}
              onMouseOut={e => { if (!sharingWhatsApp) e.currentTarget.style.background = "#25D366"; }}
            >
              {sharingWhatsApp ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />} {sharingWhatsApp ? "Opening..." : "WhatsApp"}
            </button>
            <button
              onClick={shareEmail}
              disabled={sharingEmail}
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 14px", borderRadius: 10, background: sharingEmail ? "#a8c5b2" : "var(--green)", color: "white", border: "none", fontSize: 13, fontWeight: 600, cursor: sharingEmail ? "not-allowed" : "pointer", boxShadow: "0 4px 10px rgba(46,125,82,0.15)", transition: "all 0.2s" }}
              onMouseOver={e => { if (!sharingEmail) e.currentTarget.style.background = "#20593B"; }}
              onMouseOut={e => { if (!sharingEmail) e.currentTarget.style.background = "var(--green)"; }}
            >
              <Mail size={16} /> Email
            </button>
            <button
              onClick={copyToClipboard}
              disabled={sharingCopy}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 16px", borderRadius: 10, background: copied ? "var(--green-light)" : "white", color: copied ? "var(--green)" : "var(--text)", border: copied ? "1.5px solid var(--green)" : "1.5px solid var(--border)", fontSize: 13, fontWeight: 600, cursor: sharing ? "not-allowed" : "pointer", transition: "all 0.2s", opacity: sharing ? 0.6 : 1 }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          {/* PDF Upload Status — shown when server-side PDF upload failed */}
          {!submittedQuotation?.proposalDocId && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, background: "rgba(245, 158, 11, 0.06)", border: "1px solid rgba(245, 158, 11, 0.15)", marginTop: 12 }}>
              <span style={{ fontSize: 12, color: "#b45309", flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={13} style={{ flexShrink: 0 }} /> PDF proposal could not be uploaded to server. The link will not appear in shared messages.
              </span>
              <button
                onClick={async () => {
                  if (pdfRetrying) return;
                  setPdfRetrying(true);
                  try {
                    const result = await ensureQuotationCreated();
                    if (result.proposalDocId) {
                      setSubmittedQuotationWithRef(prev => ({ ...prev, proposalDocId: result.proposalDocId }));
                    }
                  } catch (err) {
                    setDialogState({ open: true, title: "PDF Upload Failed", message: err.message || "Could not upload PDF. Please try again.", variant: "danger" });
                  } finally {
                    setPdfRetrying(false);
                  }
                }}
                disabled={pdfRetrying}
                style={{ padding: "6px 14px", borderRadius: 8, background: "#f59e0b", color: "white", border: "none", fontSize: 11, fontWeight: 600, cursor: pdfRetrying ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
              >
                {pdfRetrying ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Retry Upload
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "center", width: "100%", maxWidth: 480, margin: "0 auto" }}>
          <button
            type="button"
            className="btn-primary sun"
            style={{ flex: 1, padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12 }}
            onClick={downloadPdf}
            disabled={downloadingPdf}
          >
            {downloadingPdf ? <><Loader2 size={16} className="animate-spin" /> Generating...</> : <><Download size={16} /> Download Quotation</>}
          </button>
          <button
            className="btn-primary"
            style={{ flex: 1, padding: "12px 24px", borderRadius: 12 }}
            onClick={() => {
              // UX-2: Reset to mode selection so dealer can pick Commission or Kit for next customer.
              // This is safer than re-using the same mode — prevents accidental Kit orders for
              // commission customers and vice versa.
              setForm({
                customerName: "",
                customerPhone: "",
                customerEmail: "",
                customerCity: "",
                customerAddress: "",
                panelCount: "",
                panelId: "",
                inverterId: "",
                structureHeight: "Ground Level (Flat)",
                paymentMode: "Cash",
                subsidy: "yes",
                aadhaarMode: "photos",
                aadhaarFront: null,
                aadhaarBack: null,
                aadhaar: null,
                pan: null,
                passbook: null,
                sitePhoto: null,
                veraBill: null,
                housePhoto1: null,
                housePhoto2: null,
                housePhoto3: null,
              });
              setStep(1);
              setSubmitted(false);
              setSubmittedQuotationWithRef(null);
              setCustomPrice("");
              setSelectedKitId("");
              setSelectedPanelBrand("");
              setSelectedInverterBrand("");
              creatingRef.current = false;
              // Reset mode to force dealer to consciously choose Commission vs Kit for next customer
              setMode(null);
              sessionStorage.removeItem("hp_dealer_mode");
            }}
          >
            New Quotation
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            New Quotation
            <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 12, background: mode === "kit" ? "rgba(59,130,246,0.1)" : "rgba(46,125,82,0.1)", color: mode === "kit" ? "#3b82f6" : "var(--green)", border: `1px solid ${mode === "kit" ? "rgba(59,130,246,0.2)" : "rgba(46,125,82,0.2)"}` }}>
              {mode === "kit" ? "Kit Mode" : "Commission Mode"}
            </span>
          </div>
          <div className="page-sub">{"Configure solar rooftop specifications and pricing"}</div>
        </div>
        <button
          onClick={() => {
            if (showModeSwitch) return;
            setShowModeSwitch(true);
          }}
          className="btn-sm"
          style={{ display: "flex", alignItems: "center", gap: 6, background: "white", color: "var(--text)", border: "1.5px solid var(--border)", borderRadius: 10, padding: "8px 14px", fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
        >
          <RefreshCw size={13} /> Switch Mode
        </button>
      </div>

      <div className="steps">
        <div
          className={`step ${step === 1 ? "active" : step > 1 ? "done" : ""}`}
          onClick={() => step > 1 && setStep(1)}
        >
          <span className="step-num">{step > 1 ? <Check size={14} /> : "1"}</span>
          <span>{"System Config & Quotation"}</span>
        </div>
        <div className={`step ${step === 2 ? "active" : step > 2 ? "done" : ""}`}>
          <span className="step-num">2</span>
          <span>{mode === "kit" ? "Optional Document" : "Customer Documents"}</span>
        </div>
      </div>

      {step === 1 && (
        <>
          <div className="card">
            <div className="card-title">{"Customer Details"}</div>
            <div className="form-grid">
              <div className="field">
                <label>{"Customer Name"}</label>
                <input
                  placeholder="Ramesh Patel"
                  value={form.customerName}
                  onChange={e => set("customerName", e.target.value)}
                />
              </div>
              <div className="field">
                <label>{"Phone Number"}</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  placeholder="9876543210"
                  maxLength={10}
                  value={form.customerPhone}
                  onChange={e => set("customerPhone", e.target.value.replace(/\D/g, "").slice(0, 10))}
                />
                {/* Live digit count — helps dealer spot incomplete numbers before proceeding */}
                {form.customerPhone.length > 0 && form.customerPhone.length < 10 && (
                  <span style={{ fontSize: 11, color: "#e05c0a", marginTop: 4, display: "block" }}>
                    {form.customerPhone.length}/10 digits — must be exactly 10
                  </span>
                )}
              </div>
              <div className="field">
                <label>{"Email Address (Optional)"}</label>
                <input
                  type="email"
                  placeholder="ramesh@example.com"
                  value={form.customerEmail}
                  onChange={e => set("customerEmail", e.target.value)}
                />
                {/* Inline email format feedback — only shown when a value is present and invalid */}
                {form.customerEmail.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail) && (
                  <span style={{ fontSize: 11, color: "#e05c0a", marginTop: 4, display: "block" }}>
                    Enter a valid email address (e.g. name@example.com)
                  </span>
                )}
              </div>
              <div className="field">
                <label>{"City / District"}</label>
                <input
                  placeholder="Ahmedabad"
                  value={form.customerCity}
                  onChange={e => set("customerCity", e.target.value)}
                />
              </div>
              <div className="field">
                <label>{"Site Address / Delivery Address"}
                  {/* Frontend character guard: 60 chars keeps address within PDF field bounds */}
                  <span style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    fontWeight: 600,
                    color: form.customerAddress.length > 55 ? "#dc2626"
                         : form.customerAddress.length > 45 ? "#f97316"
                         : "var(--muted)",
                    transition: "color 0.2s"
                  }}>
                    {form.customerAddress.length}/60
                  </span>
                </label>
                <input
                  placeholder="123, Green Society, Near Main Road"
                  value={form.customerAddress}
                  maxLength={60}
                  onChange={e => set("customerAddress", e.target.value)}
                />
                {form.customerAddress.length > 55 && (
                  <div style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>
                    Address is very long — it will wrap to a second line in the PDF.
                  </div>
                )}
              </div>
              {mode === "commission" && (
                <div className="field">
                  <label>{"PM Subsidy Applicable?"}</label>
                  <select value={form.subsidy} onChange={e => set("subsidy", e.target.value)}>
                    <option value="yes">{"Yes – Residential"}</option>
                    <option value="no">{"No – Commercial"}</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title">{"System Configuration"}</div>

            {mode === "kit" && (
              <div className="field" style={{ marginBottom: "1.5rem" }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Package size={14} /> Select Pre-Packaged Kit from Raysolar Energy PDF Price List (Optional)
                </label>
                <select 
                  value={selectedKitId} 
                  onChange={e => handleKitSelect(e.target.value)}
                  style={{ width: "100%", padding: "12px", border: "1.5px solid var(--border)", borderRadius: "10px", fontWeight: 600, color: "var(--text)" }}
                >
                  <option value="">-- Custom Component Configuration --</option>
                  {/* GAP-06 fix: group kits by brand+type for easier scanning (was a flat 44-item list) */}
                  {(() => {
                    const brands = [...new Set((prices.kits || []).map(k => k.brand))];
                    return brands.map(brand => {
                      // CODE-3 FIX: key on the outer brands.map() — previously missing,
                      // causing React to warn about keys in nested array renders.
                      const types = [...new Set((prices.kits || []).filter(k => k.brand === brand).map(k => k.type))];
                      return types.map(type => {
                        const groupKits = (prices.kits || []).filter(k => k.brand === brand && k.type === type);
                        return (
                          <optgroup key={`${brand}-${type}`} label={`${brand} — ${type}`}>
                            {groupKits.map(k => (
                              <option key={k.id} value={k.id}>
                                {k.kw.toFixed(2)} kW ({k.panels} Panels) — {fmt(k.price)}
                              </option>
                            ))}
                          </optgroup>
                        );
                      });
                    });
                  })()}
                </select>
                <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <Info size={11} /> Selecting a pre-packaged kit automatically configures panels, count, inverter, and sets the total price to match the PDF (including a +800 markup).
                </span>
              </div>
            )}

            <div className="form-grid-3">
              <div className="field">
                <label>{"Number of Panels"}</label>
                <input
                  type="number"
                  min="1"
                  placeholder="e.g. 10"
                  value={form.panelCount}
                  onChange={e => {
                    const val = e.target.value;
                    set("panelCount", val === "" ? "" : Math.max(1, parseInt(val) || 1));
                  }}
                />
              </div>

              <div className="field">
                <label>{"Panel Brand"}</label>
                <select 
                  value={selectedPanelBrand} 
                  onChange={e => {
                    setSelectedPanelBrand(e.target.value);
                    set("panelId", "");
                  }}
                >
                  <option value="">{"Select Brand"}</option>
                  {panelBrands.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>{"Panel Model"}</label>
                <select 
                  value={form.panelId} 
                  onChange={e => set("panelId", e.target.value)}
                  disabled={!selectedPanelBrand}
                >
                  <option value="">{selectedPanelBrand ? "Select Model" : "Select Brand First"}</option>
                  {filteredPanels.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.watt}W {p.type}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>{"Inverter Brand"}</label>
                <select 
                  value={selectedInverterBrand} 
                  onChange={e => {
                    setSelectedInverterBrand(e.target.value);
                    set("inverterId", "");
                  }}
                >
                  <option value="">{"Select Brand"}</option>
                  {inverterBrands.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>{"Inverter Model"}</label>
                <select 
                  value={form.inverterId} 
                  onChange={e => set("inverterId", e.target.value)}
                  disabled={!selectedInverterBrand}
                >
                  <option value="">{selectedInverterBrand ? "Select Model" : "Select Brand First"}</option>
                  {filteredInverters.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.brand} {i.kw}kW {i.type}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {mode === "commission" && (
              <div className="form-grid" style={{ marginTop: "1rem" }}>
                <div className="field">
                  <label>{"Structure Height"}</label>
                  <select value={form.structureHeight} onChange={e => set("structureHeight", e.target.value)}>
                    <option value="Ground Level (Flat)">{"Ground Level (Flat)"}</option>
                    <option value="Roof Mount (Standard)">{"Roof Mount (Standard)"}</option>
                    <option value="Elevated (5 ft)">{"Elevated (5 ft)"}</option>
                    <option value="Elevated (10 ft)">{"Elevated (10 ft)"}</option>
                    <option value="Elevated (12 ft)">{"Elevated (12 ft)"}</option>
                  </select>
                </div>
                <div className="field">
                  <label>{"Payment Mode"}</label>
                  <select value={form.paymentMode} onChange={e => set("paymentMode", e.target.value)}>
                    <option value="Cash">{"Cash"}</option>
                    <option value="Bank Loan">{"Bank Loan"}</option>
                    <option value="Cheque / DD">{"Cheque / DD"}</option>
                    <option value="Online Transfer (UPI/NEFT)">{"Online Transfer (UPI/NEFT)"}</option>
                  </select>
                </div>
              </div>
            )}

            {panel && inverter && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                <span className="panel-chip">
                  <Sun size={13} /> {panel.brand} {panel.watt}W — {fmt(panel.pricePerPanel)}/panel
                </span>
                <span className="panel-chip">
                  <Zap size={13} /> {inverter.brand} {inverter.kw}kW — {fmt(inverter.pricePerUnit)}
                </span>
                {quote && <span className="panel-chip"><Hash size={13} /> {quote.panelCount} panels required</span>}
              </div>
            )}
          </div>

          {quote && (
            <div className="card" style={{ padding: "20px", borderRadius: 16, border: "1.5px solid var(--border)", background: "rgba(255, 255, 255, 0.8)", boxShadow: "0 10px 25px rgba(0,0,0,0.03)", marginTop: "1.5rem" }}>
              <div className="card-title" style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                <Coins size={16} style={{ color: mode === "kit" ? "#3b82f6" : "var(--green)" }} />
                {mode === "kit" ? "Adjust Kit Price (Optional)" : "Adjust Proposal Price (Optional)"}
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8, display: "block" }}>
                  {mode === "kit" 
                    ? "Enter Custom Total Kit Price (including GST)" 
                    : "Enter Custom Total System Price (including GST)"}
                </label>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontWeight: 600, color: "var(--muted)" }}>₹</span>
                    <input
                      type="number"
                      placeholder={mode === "kit" ? "Enter custom kit price..." : "Enter custom total price..."}
                      value={customPrice}
                      onChange={e => setCustomPrice(e.target.value)}
                      style={{ paddingLeft: 28, width: "100%" }}
                    />
                  </div>
                  {customPrice && (
                    <button 
                      type="button"
                      className="btn-sm" 
                      onClick={() => setCustomPrice("")}
                      style={{ background: "rgba(239, 68, 68, 0.1)", color: "#ef4444", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontWeight: 600 }}
                    >
                      Reset Standard
                    </button>
                  )}
                </div>
                <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 8, display: "block" }}>
                  {mode === "kit"
                    ? <>Leave blank to use the PDF kit price of <strong>{fmt(stdTotal)}</strong>. Custom price must be &ge; standard total.</>  
                    : <>Leave blank to use the standard system-calculated total of <strong>{fmt(stdTotal)}</strong>. Custom price must be &ge; standard total.</>}
                </span>
              </div>
            </div>
          )}

          {quote ? (
            <>
              <div className="quote-box" style={{
                background: mode === "kit" ? "linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)" : "linear-gradient(135deg, #114227 0%, #226b3f 100%)",
                borderRadius: "20px",
                padding: "28px",
                boxShadow: "0 15px 35px rgba(0,0,0,0.1)",
                color: "white"
              }}>
                <div style={{ textAlign: "center", marginBottom: "24px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.15em", color: "rgba(255,255,255,0.7)", marginBottom: "4px" }}>
                    {mode === "kit" ? "Wholesale Solar Kit Cost" : "Total System Price (including GST)"}
                  </div>
                  <div style={{ fontSize: "40px", fontWeight: 800, color: "#fff", fontFamily: "var(--mono)", textShadow: "0 2px 10px rgba(0,0,0,0.1)" }}>
                    {fmt(quote.total)}
                  </div>
                </div>

                {/* Key Metrics Grid */}
                <div
                  className="quote-metrics-grid"
                  style={{ 
                    display: "grid", 
                    gridTemplateColumns: "repeat(3, 1fr)", 
                    gap: "12px", 
                    background: "rgba(255, 255, 255, 0.08)", 
                    borderRadius: "14px", 
                    padding: "16px",
                    border: "1px solid rgba(255,255,255,0.12)",
                    marginBottom: "24px",
                    textAlign: "center"
                  }}
                >
                  <div className="quote-metric-cell" style={{ borderRight: "1px solid rgba(255,255,255,0.15)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start" }}>
                    <div className="quote-metric-val" style={{ fontWeight: 800, fontFamily: "var(--mono)" }}>
                      {quote.systemKw.toFixed(2)} kW
                    </div>
                    <div className="quote-metric-label" style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600, marginTop: "2px", whiteSpace: "nowrap" }}>
                      System Capacity
                    </div>
                  </div>
                  <div className="quote-metric-cell" style={{ borderRight: "1px solid rgba(255,255,255,0.15)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start" }}>
                    <div className="quote-metric-val" style={{ fontWeight: 800, fontFamily: "var(--mono)" }}>
                      {fmt(quote.pricePerKw)}
                    </div>
                    <div className="quote-metric-label" style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600, marginTop: "2px", whiteSpace: "nowrap" }}>
                      Per kW Price
                    </div>
                  </div>
                  <div className="quote-metric-cell" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start" }}>
                    <div className="quote-metric-val" style={{ fontWeight: 800, fontFamily: "var(--mono)" }}>
                      {quote.panelCount} Pcs
                    </div>
                    <div className="quote-metric-label" style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600, marginTop: "2px", whiteSpace: "nowrap" }}>
                      Solar Panels
                    </div>
                  </div>
                </div>

                {/* System Specifications */}
                <div style={{ 
                  background: "rgba(0, 0, 0, 0.12)", 
                  borderRadius: "14px", 
                  padding: "20px", 
                  border: "1px solid rgba(255,255,255,0.06)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px"
                }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.5)", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "6px", display: "flex", alignItems: "center" }}>
                    <Package size={13} style={{ marginRight: 6 }} /> {"System Specifications"}
                  </div>

                  <div className="quote-specs-grid">
                    <div>
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>{"Solar Panels"}</div>
                      <div style={{ fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", marginTop: "3px" }}>
                        <Sun size={13} style={{ marginRight: 6, color: "var(--sun)" }} /> {panel?.brand} {panel?.watt}W ({quote.panelCount} {"pcs"})
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>{"Inverter Model"}</div>
                      <div style={{ fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", marginTop: "3px" }}>
                        <Zap size={13} style={{ marginRight: 6, color: "var(--sun)" }} /> {inverter?.brand} {inverter?.kw}kW {inverter?.type}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>{"Mounting & BOS"}</div>
                      <div style={{ fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", marginTop: "3px" }}>
                        <Home size={13} style={{ marginRight: 6, color: "var(--sun)" }} /> {mode === "kit" ? "Kit Standard Accessories" : "GI Structure & Standard Cabling"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>{"Payment Mode"}</div>
                      <div style={{ fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", marginTop: "3px" }}>
                        <Landmark size={13} style={{ marginRight: 6, color: "var(--sun)" }} /> {mode === "kit" ? "Kit Purchase" : form.paymentMode}
                      </div>
                    </div>
                  </div>

                  {/* Environmental Stats */}
                  <div
                    className="quote-summary-grid"
                    style={{ 
                      borderTop: "1px solid rgba(255,255,255,0.1)", 
                      paddingTop: "12px", 
                      marginTop: "4px",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>{"Est. Annual Yield"}</div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--sun)", display: "flex", alignItems: "center", marginTop: "2px" }}>
                        <BarChart3 size={13} style={{ marginRight: 5 }} /> ~{Math.round(quote.systemKw * 1450).toLocaleString()} {"kWh / Year"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>{"CO₂ Carbon Offset"}</div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#4ade80", display: "flex", alignItems: "center", marginTop: "2px" }}>
                        <Leaf size={13} style={{ marginRight: 5 }} /> ~{(quote.systemKw * 1.2).toFixed(1)} {"Tons / Year"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card" style={{ padding: "20px", borderRadius: 16, border: "1.5px solid var(--border)", background: "rgba(255, 255, 255, 0.8)", boxShadow: "0 10px 25px rgba(0,0,0,0.03)", textAlign: "left", marginTop: "1.5rem" }}>
                <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <MessageCircle size={16} style={{ color: "var(--green)" }} />
                    {"Download & Share Proposal (Draft)"}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "none", fontWeight: 400, display: "flex", alignItems: "center", gap: 4 }}>
                    <Info size={11} /> {"Clicking share downloads the PDF and opens WhatsApp"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    onClick={() => shareWhatsApp(true)}
                    disabled={!canStep2}
                    style={{ flex: 1, minWidth: "120px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 14px", borderRadius: 10, background: "#25D366", color: "white", border: "none", fontSize: 13, fontWeight: 600, cursor: canStep2 ? "pointer" : "not-allowed", opacity: canStep2 ? 1 : 0.6, boxShadow: "0 4px 10px rgba(37,211,102,0.15)", transition: "all 0.2s" }}
                  >
                    <MessageCircle size={16} /> {"WhatsApp"}
                  </button>
                  <button
                    onClick={() => shareEmail(true)}
                    disabled={!canStep2}
                    style={{ flex: 1, minWidth: "120px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 14px", borderRadius: 10, background: "var(--green)", color: "white", border: "none", fontSize: 13, fontWeight: 600, cursor: canStep2 ? "pointer" : "not-allowed", opacity: canStep2 ? 1 : 0.6, boxShadow: "0 4px 10px rgba(46,125,82,0.15)", transition: "all 0.2s" }}
                  >
                    <Mail size={16} /> {"Email"}
                  </button>
                  <button
                    onClick={() => copyToClipboard(true)}
                    disabled={!canStep2}
                    style={{ flex: 1, minWidth: "120px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "12px 16px", borderRadius: 10, background: copied ? "var(--green-light)" : "white", color: copied ? "var(--green)" : "var(--text)", border: copied ? "1.5px solid var(--green)" : "1.5px solid var(--border)", fontSize: 13, fontWeight: 600, cursor: canStep2 ? "pointer" : "not-allowed", opacity: canStep2 ? 1 : 0.6, transition: "all 0.2s" }}
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? "Copied!" : "Copy & Download"}
                  </button>
                </div>
              </div>

              {!canStep2 && (
                <div className="alert alert-red" style={{ marginTop: "1rem" }}>
                  {!form.customerName.trim()
                    ? "Fill customer name to proceed"
                    : !form.customerPhone || form.customerPhone.length !== 10
                    ? "Enter a valid 10-digit customer mobile number to proceed"
                    : !form.customerAddress.trim()
                    ? "Enter a site / delivery address to proceed (shown on PDF proposal)"
                    : !isCustomPriceValid
                    ? `Custom price must be greater than or equal to standard calculated price (${fmt(stdTotal)})`
                    : "Please complete the required system configuration fields to proceed"}
                </div>
              )}
              <div style={{ display: "flex", gap: 12, marginTop: "1rem" }}>
                <button
                  type="button"
                  className="btn-primary sun"
                  style={{ flex: 1, padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, cursor: canStep2 ? "pointer" : "not-allowed", opacity: canStep2 ? 1 : 0.5 }}
                  disabled={!canStep2 || downloadingPdf}
                  onClick={downloadPdf}
                >
                  {downloadingPdf ? <><Loader2 size={16} className="animate-spin" /> {"Generating..."}</> : <><Download size={16} /> {"Download Quotation"}</>}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ flex: 1.3, opacity: canStep2 ? 1 : 0.5, borderRadius: 12 }}
                  disabled={!canStep2}
                  onClick={() => setStep(2)}
                >
                  {mode === "kit" ? "Proceed to Final Order" : "Proceed to Document Upload"} <ArrowRight size={16} />
                </button>
              </div>
            </>
          ) : (
            <div className="card" style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
              <div style={{ marginBottom: 8, color: "var(--muted)" }}><BarChart3 size={36} strokeWidth={1.5} /></div>
              <div style={{ fontSize: 15 }}>
                {"Select system capacity, panel, and inverter to see live quotation"}
              </div>
            </div>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <div className="card">
            <div className="card-title">{mode === "kit" ? "Upload Site Photo (Optional)" : "Upload Customer Documents"}</div>
            <div className="upload-grid">
              {/* ── Aadhaar Card (commission mode only) — Two Photos / PDF toggle ── */}
              {mode === "commission" && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{
                    background: "var(--light, #f8fafc)",
                    border: "1.5px solid var(--border, #e2e8f0)",
                    borderRadius: 12,
                    padding: "14px 16px",
                  }}>
                    {/* Header + toggle */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <IdCard size={16} style={{ color: "var(--green)" }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Aadhaar Card</span>
                      </div>
                      <div style={{ display: "inline-flex", background: "var(--border, #e2e8f0)", borderRadius: 999, padding: 3, gap: 2 }}>
                        <button type="button"
                          onClick={() => set("aadhaarMode", "photos")}
                          style={{ padding: "5px 13px", borderRadius: 999, border: "none", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.18s",
                            background: form.aadhaarMode === "photos" ? "var(--green, #2E7D52)" : "transparent",
                            color: form.aadhaarMode === "photos" ? "white" : "var(--muted)",
                            boxShadow: form.aadhaarMode === "photos" ? "0 2px 6px rgba(46,125,82,0.25)" : "none",
                          }}>Two Photos</button>
                        <button type="button"
                          onClick={() => set("aadhaarMode", "pdf")}
                          style={{ padding: "5px 13px", borderRadius: 999, border: "none", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.18s",
                            background: form.aadhaarMode === "pdf" ? "var(--green, #2E7D52)" : "transparent",
                            color: form.aadhaarMode === "pdf" ? "white" : "var(--muted)",
                            boxShadow: form.aadhaarMode === "pdf" ? "0 2px 6px rgba(46,125,82,0.25)" : "none",
                          }}>PDF / Scan</button>
                      </div>
                    </div>
                    {/* Upload zones */}
                    {form.aadhaarMode === "photos" ? (
                      <div className="aadhaar-photo-grid">
                        <UploadZone label="Front Side" icon={<IdCard size={22} />} file={form.aadhaarFront} onChange={f => set("aadhaarFront", f)} />
                        <UploadZone label="Back Side"  icon={<IdCard size={22} />} file={form.aadhaarBack}  onChange={f => set("aadhaarBack",  f)} />
                      </div>
                    ) : (
                      <UploadZone label="Aadhaar Card" icon={<IdCard size={22} />} file={form.aadhaar} onChange={f => set("aadhaar", f)} />
                    )}
                  </div>
                </div>
              )}

              {/* ── Other documents ── */}
              {[
                ...(mode === "commission" ? [
                  { key: "pan",       label: "PAN Card",                       icon: <CreditCard size={20} />, value: form.pan },
                  { key: "passbook",  label: "Bank Passbook",                  icon: <Landmark size={20} />,   value: form.passbook },
                  { key: "sitePhoto", label: "Site Photo / Latest Light Bill", icon: <FileText size={20} />,   value: form.sitePhoto },
                  ...(form.paymentMode === "Bank Loan" ? [
                    { key: "veraBill",    label: "Vera Bill",     icon: <FileText size={20} />, value: form.veraBill },
                    { key: "housePhoto1", label: "House Photo 1", icon: <Home size={20} />,     value: form.housePhoto1 },
                    { key: "housePhoto2", label: "House Photo 2", icon: <Home size={20} />,     value: form.housePhoto2 },
                    { key: "housePhoto3", label: "House Photo 3", icon: <Home size={20} />,     value: form.housePhoto3 },
                  ] : [])
                ] : [
                  { key: "sitePhoto", label: "Site / Roof Photo", icon: <Home size={20} />, value: form.sitePhoto },
                ]),
              ].map(({ key, label, icon, value }) => (
                <UploadZone key={key} label={label} icon={icon} file={value} onChange={f => set(key, f)} />
              ))}

            </div>
          </div>
          <div className="card">
            <div className="card-title">{mode === "kit" ? "Kit Order Summary" : "Quotation Summary"}</div>
            {quote && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{"Customer"}</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{form.customerName}</div>
                </div>
                {mode === "kit" && (
                  <div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>{"Selected Kit"}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "var(--primary, #3b82f6)" }}>
                      {selectedKitName}
                    </div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{"System"}</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{quote.systemKw.toFixed(2)} {"kW"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{"Panel"}</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>
                    {panel?.brand} {panel?.watt}W ({quote.panelCount} {"pcs"})
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{mode === "kit" ? "Total Kit Price" : "Total Payable"}</div>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: "var(--text)",
                      fontFamily: "var(--mono)",
                    }}
                  >
                    {fmt(quote.total)}
                  </div>
                </div>
                {quote.subsidy > 0 && mode === "commission" && (
                  <>
                    <div>
                      <div style={{ fontSize: 13, color: "var(--muted)" }}>{"Subsidy"}</div>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 600,
                          color: "var(--green)",
                          fontFamily: "var(--mono)",
                        }}
                      >
                        -{fmt(quote.subsidy)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: "var(--muted)" }}>{"Effective Price"}</div>
                      <div
                        style={{
                          fontSize: 20,
                          fontWeight: 700,
                          color: "var(--green)",
                          fontFamily: "var(--mono)",
                        }}
                      >
                        {fmt(quote.effectivePrice)}
                      </div>
                    </div>
                  </>
                )}
                {(quote.subsidy === 0 || mode === "kit") && (
                  <div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>{"Total Cost"}</div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: "var(--green)",
                        fontFamily: "var(--mono)",
                      }}
                    >
                      {fmt(quote.total)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          {mode === "commission" && !canSubmit && (
            <div className="alert alert-red" style={{ marginTop: "1rem", marginBottom: "1rem" }}>
              {form.paymentMode === "Bank Loan"
                ? "All 8 customer documents (Aadhaar Card, PAN Card, Bank Passbook, Latest Light Bill, Vera Bill, and House Photos 1, 2, 3) are mandatory for Bank Loans. Please upload all files to submit your request."
                : "All 4 customer documents (Aadhaar Card, PAN Card, Bank Passbook, and Latest Light Bill) are mandatory. Please upload all files to submit your request."}
            </div>
          )}
          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn-sm" style={{ padding: "12px 24px" }} onClick={() => {
              setStep(1);
              // GAP-04 fix: clear uploaded site photo when going Back in kit mode
              // so stale uploads from a previous attempt are not carried forward.
              if (mode === "kit") {
                set("sitePhoto", null);
              }
            }}>
              <ArrowLeft size={14} /> Back
            </button>
            <button className="btn-primary" onClick={() => setShowSubmitConfirm(true)} disabled={submitting || !canSubmit} style={{ opacity: (!submitting && canSubmit) ? 1 : 0.5 }}>
              {submitting ? <><Loader2 size={16} className="animate-spin" /> Submitting...</> : <><Send size={16} /> {mode === "kit" ? "Submit Kit Order" : "Submit Request"}</>}
            </button>
          </div>
        </>
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
      <ConfirmDialog
        open={showSubmitConfirm}
        title={mode === "kit" ? "Submit Kit Order?" : "Submit Quotation Request?"}
        message={mode === "kit"
          ? `You are about to submit a kit order for ${form.customerName.trim() || "this customer"} — ${quote?.systemKw?.toFixed(2) || "?"} kW system at ${fmt(quote?.total || 0)}. This action cannot be undone.`
          : `You are about to submit a quotation request for ${form.customerName.trim() || "this customer"} — ${quote?.systemKw?.toFixed(2) || "?"} kW system at ${fmt(quote?.effectivePrice || 0)}. Admin will review the uploaded documents.`
        }
        variant="warning"
        confirmText={submitting ? "Submitting..." : (mode === "kit" ? "Yes, Submit Order" : "Yes, Submit Request")}
        onConfirm={() => { setShowSubmitConfirm(false); handleSubmit(); }}
        onCancel={() => setShowSubmitConfirm(false)}
      />
      <ConfirmDialog
        open={showModeSwitch}
        title="Switch Mode?"
        message="Switching mode will reset your current configuration. All unsaved data will be lost."
        variant="danger"
        confirmText="Switch Mode"
        onConfirm={() => {
          setShowModeSwitch(false);
          setMode(null);
          sessionStorage.removeItem("hp_dealer_mode");
          setForm({
            customerName: "",
            customerPhone: "",
            customerEmail: "",
            customerCity: "",
            customerAddress: "",
            panelCount: "",
            panelId: "",
            inverterId: "",
            structureHeight: "Ground Level (Flat)",
            paymentMode: "Cash",
            subsidy: "yes",
            aadhaarMode: "photos",
            aadhaarFront: null,
            aadhaarBack: null,
            aadhaar: null,
            pan: null,
            passbook: null,
            sitePhoto: null,
            veraBill: null,
            housePhoto1: null,
            housePhoto2: null,
            housePhoto3: null,
          });
          setStep(1);
          setSubmitted(false);
          setSubmittedQuotationWithRef(null);
          setCustomPrice("");
          creatingRef.current = false;
          setSelectedKitId("");
          setSelectedPanelBrand("");
          setSelectedInverterBrand("");
        }}
        onCancel={() => setShowModeSwitch(false)}
      />
    </div>
  );
}
