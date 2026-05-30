// ─── HELPER FUNCTIONS ────────────────────────────────────────────────────────
//
// NOTE: pdf-lib and @pdf-lib/fontkit are NOT imported at the top level.
// They are loaded lazily inside generatePdfQuotation() via dynamic import().
// This means the ~1.1MB pdf-vendor chunk is only downloaded the FIRST time
// a user clicks "Generate PDF" — not on every page load.
// Admin users who never generate PDFs will never download this chunk at all.

export function getLS(key, def) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : def;
  } catch {
    return def;
  }
}

export function setLS(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (err) {
    console.error("Local storage set failed", err);
  }
}

export function fmt(n) {
  return "₹" + Number(n).toLocaleString("en-IN");
}

export function getHighestWatt(wattStr) {
  if (typeof wattStr !== "string") {
    wattStr = String(wattStr);
  }
  const parts = wattStr.split("-");
  if (parts.length > 1) {
    const last = parseInt(parts[parts.length - 1].trim(), 10);
    return isNaN(last) ? 0 : last;
  }
  const val = parseInt(wattStr.trim(), 10);
  return isNaN(val) ? 0 : val;
}

export function generateBOM(req, prices) {
  const systemKw = req.systemKw;
  const panel = prices.panels.find(p => p.id === req.panelId);
  const inverter = prices.inverters.find(i => i.id === req.inverterId);
  if (!panel || !inverter) return [];

  const panelCount = req.panelCount || Math.ceil((systemKw * 1000) / getHighestWatt(panel.watt));
  const dcWire = systemKw * 10;
  const acWire = systemKw * 8;

  return [
    { item: `${panel.brand} ${panel.watt}W ${panel.type} Panel`, qty: panelCount, unit: "pcs", category: "Panel" },
    { item: `${inverter.brand} ${inverter.kw}kW ${inverter.type} Inverter`, qty: 1, unit: "pcs", category: "Inverter" },
    { item: "DC Solar Cable (4mm²)", qty: dcWire, unit: "meters", category: "Wire" },
    { item: "AC Cable – Polycab (6mm²)", qty: acWire, unit: "meters", category: "Wire" },
    { item: "Mounting Structure (GI)", qty: systemKw, unit: "kW", category: "Structure" },
    { item: "ACDB Box", qty: 1, unit: "pcs", category: "Electrical" },
    { item: "DCDB Box", qty: 1, unit: "pcs", category: "Electrical" },
    { item: "MCB / Isolator", qty: 2, unit: "pcs", category: "Electrical" },
    { item: "Earthing Kit", qty: systemKw <= 5 ? 2 : 3, unit: "pcs", category: "Earthing" },
    { item: "Lightning Arrester", qty: 1, unit: "pcs", category: "Safety" },
    { item: "Remote Monitoring Unit", qty: 1, unit: "pcs", category: "Monitoring" },
    { item: "Installation & Commissioning", qty: 1, unit: "lot", category: "Service" },
  ];
}

export function calculateSubsidy(systemKw) {
  if (systemKw <= 0) return 0;
  if (systemKw <= 2) {
    return Math.round(systemKw * 30000);
  } else if (systemKw <= 3) {
    return Math.round(60000 + (systemKw - 2) * 18000);
  } else {
    return 78000;
  }
}

export function calcQuotation(panelId, inverterId, panelCount, prices, subsidyApplicable = "yes", gstRate = 0.089, pricingSettings = null) {
  const panel = prices.panels.find(p => p.id === panelId);
  const inverter = prices.inverters.find(i => i.id === inverterId);
  if (!panel || !inverter || !panelCount) return null;

  const systemKw = (panelCount * getHighestWatt(panel.watt)) / 1000;

  // Load pricing manager configuration parameters with safe defaults
  const s = pricingSettings || (prices.settings || {
    bom_price_per_kw: 3900,
    labour_price_per_kw: 2000,
    commission_price_per_kw: 3000,
    profit_percentage: 10,
    transport_percentage: 1.2,
    gst_rate: 8.9,
  });

  const bomPricePerKw = Number(s.bom_price_per_kw) || 3900;
  const labourPricePerKw = Number(s.labour_price_per_kw) || 2000;
  const commissionPricePerKw = Number(s.commission_price_per_kw) || 3000;
  const profitPercentage = Number(s.profit_percentage) || 10;
  const transportPercentage = Number(s.transport_percentage) || 1.2;

  const panelCost = panelCount * panel.pricePerPanel;
  const inverterCost = inverter.pricePerUnit;

  // New commercial pricing formula: cost basis
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
  // GST calculation — single source of truth:
  // pricingSettings.gst_rate is a PERCENTAGE (e.g. 8.9 for 8.9%).
  // The legacy `gstRate` parameter is a DECIMAL (e.g. 0.089).
  // When pricingSettings is provided (always in new code), use gst_rate directly.
  // Fall back to gstRate*100 only when pricingSettings is not available.
  const gstPercent = Number(s.gst_rate) > 0 ? Number(s.gst_rate) : (gstRate * 100);
  const gst = Math.round(subtotal * (gstPercent / 100));
  const total = subtotal + gst;

  const subsidy = subsidyApplicable === "yes" ? calculateSubsidy(systemKw) : 0;
  const effectivePrice = Math.max(0, total - subsidy);

  return {
    systemKw,
    panelCount, 
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
    subsidy, 
    effectivePrice,
    pricePerKw: Math.round(total / systemKw),
  };
}

// ─── PDF GENERATION (Lazy-loaded) ────────────────────────────────────────────
// pdf-lib (~1.1MB) and fontkit are loaded on-demand via dynamic import().
// The browser module system caches the import — subsequent calls are instant.

let poppinsRegularBytes = null;
let poppinsBoldBytes = null;
let cachedTemplateBytes = null; // Cache the 1.1MB template PDF in memory after first fetch

async function loadPoppinsFonts() {
  try {
    if (!poppinsRegularBytes) {
      const res = await fetch("/fonts/Poppins-Regular.ttf");
      if (res.ok) poppinsRegularBytes = await res.arrayBuffer();
      else console.warn("⚠️ Poppins-Regular.ttf not found in /public/fonts/ — PDF will use Helvetica fallback. Download from: https://fonts.google.com/specimen/Poppins");
    }
  } catch (e) {
    console.warn("Could not load Poppins-Regular font", e);
  }

  try {
    if (!poppinsBoldBytes) {
      const res = await fetch("/fonts/Poppins-Bold.ttf");
      if (res.ok) poppinsBoldBytes = await res.arrayBuffer();
      else console.warn("⚠️ Poppins-Bold.ttf not found in /public/fonts/ — PDF will use Helvetica-Bold fallback.");
    }
  } catch (e) {
    console.warn("Could not load Poppins-Bold font", e);
  }
}

export async function generatePdfQuotation(customerData, quoteData, panelData, inverterData, options = { download: true }) {
  try {
    // ── Lazy-load pdf-lib and fontkit ──────────────────────────
    // These are loaded on first call only. The browser caches the modules
    // so subsequent PDF generations pay zero import cost.
    const [pdfLibModule, fontkitModule] = await Promise.all([
      import("pdf-lib"),
      import("@pdf-lib/fontkit"),
    ]);
    const { PDFDocument, rgb, StandardFonts } = pdfLibModule;
    const fontkit = fontkitModule.default;

    // ── Load the PDF template (cached after first fetch) ─────
    if (!cachedTemplateBytes) {
      const response = await fetch("/quotation-template.pdf");
      if (!response.ok) {
        throw new Error("Failed to fetch PDF template. Make sure quotation-template.pdf exists in the public directory.");
      }
      cachedTemplateBytes = await response.arrayBuffer();
    }
    // pdf-lib detaches the ArrayBuffer, so we must pass a copy each time
    const existingPdfBytes = cachedTemplateBytes.slice(0);

    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    pdfDoc.registerFontkit(fontkit);
    
    // Load and embed premium fonts
    await loadPoppinsFonts();
    
    let fontRegular, fontBold;
    if (poppinsRegularBytes) {
      fontRegular = await pdfDoc.embedFont(poppinsRegularBytes);
    } else {
      fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }
    
    if (poppinsBoldBytes) {
      fontBold = await pdfDoc.embedFont(poppinsBoldBytes);
    } else {
      fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    }

    const pages = pdfDoc.getPages();
    if (pages.length < 3) {
      throw new Error(`PDF template is corrupted — expected at least 3 pages but found ${pages.length}. Please re-upload quotation-template.pdf to the public/ directory.`);
    }
    const page1 = pages[0];
    const page3 = pages[2];

    const drawText = (page, text, x, y, size = 10, font = fontRegular, color = rgb(0.12, 0.16, 0.22)) => {
      page.drawText(String(text), { x, y, size, font, color });
    };

    const drawBoldText = (page, text, x, y, size = 10.5, color = rgb(0.12, 0.16, 0.22)) => {
      page.drawText(String(text), { x, y, size, font: fontBold, color });
    };

    // Professional right-alignment helper for the financial amount column
    const drawRightAlignedBoldText = (page, text, x_right, y, size = 10.5, color = rgb(0.12, 0.16, 0.22)) => {
      const width = fontBold.widthOfTextAtSize(String(text), size);
      page.drawText(String(text), { x: x_right - width, y, size, font: fontBold, color });
    };

    // ── Text helpers ──────────────────────────────────────────────────────────

    // fitText: hard-truncate with "..." when text won't fit at a FIXED size.
    // Used as a last-resort safety net inside autoFitText (below).
    const fitText = (font, text, size, maxWidth) => {
      const str = String(text || "");
      if (font.widthOfTextAtSize(str, size) <= maxWidth) return str;
      const ellipsis = "...";
      const ellipsisWidth = font.widthOfTextAtSize(ellipsis, size);
      let truncated = "";
      for (const ch of str) {
        if (font.widthOfTextAtSize(truncated + ch, size) + ellipsisWidth > maxWidth) break;
        truncated += ch;
      }
      return truncated + ellipsis;
    };

    // autoFitText: shrinks the font size in 0.5pt steps (preferredSize → minSize)
    // before falling back to truncation.  This way long-but-readable text like
    // "Single Phase (Single MPPT)" is shown complete at a smaller size instead
    // of being cut to "Single Phase (Si...".
    //
    //   preferredSize = 9.5pt  (ideal — matches pre-printed label size)
    //   minSize       = 7.5pt  (smallest still legible in print)
    //   Returns { text, size } ready to pass to drawText / drawBoldText.
    const autoFitText = (font, text, preferredSize, minSize, maxWidth) => {
      const str = String(text || "");
      let size = preferredSize;
      while (size >= minSize) {
        if (font.widthOfTextAtSize(str, size) <= maxWidth) return { text: str, size };
        size = Math.round((size - 0.5) * 10) / 10; // avoid floating-point drift
      }
      // Still too wide at minSize — truncate as a last resort
      return { text: fitText(font, str, minSize, maxWidth), size: minSize };
    };

    // drawAddressWrapped: word-wraps address onto up to 2 lines.
    // Page 1 vertical layout:  Address y=141.9,  Contact No y=115.7  → gap=26.2pt
    // A second line at y=128.5 sits safely between those two fields.
    const drawAddressWrapped = (page, text, x, yTop, font, maxWidth, size) => {
      const str = String(text || "");
      if (font.widthOfTextAtSize(str, size) <= maxWidth) {
        // Fits on a single line — draw normally
        page.drawText(str, { x, y: yTop, size, font, color: rgb(0.08, 0.12, 0.22) });
        return;
      }
      // Split at word boundaries into line1 / line2
      const words = str.split(" ");
      let line1 = "";
      let splitIdx = 0;
      for (let i = 0; i < words.length; i++) {
        const candidate = line1 ? `${line1} ${words[i]}` : words[i];
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          line1 = candidate;
          splitIdx = i + 1;
        } else {
          break;
        }
      }
      const line2 = words.slice(splitIdx).join(" ");
      // Draw line 1 at original y
      page.drawText(fitText(font, line1, size, maxWidth), { x, y: yTop, size, font, color: rgb(0.08, 0.12, 0.22) });
      // Draw line 2 at y-13pt (safely above Contact No. at y=115.7)
      if (line2.trim()) {
        const line2Str = fitText(font, line2, size, maxWidth);
        page.drawText(line2Str, { x, y: yTop - 13, size, font, color: rgb(0.08, 0.12, 0.22) });
      }
    };

    // ── Page 1 field layout constants ────────────────────────────────────────
    // Each labelled field on Page 1 starts at x=360 and runs to the template
    // box right edge at approximately x=528pt → available width = 168pt.
    // We use 160pt (8pt safety margin) to prevent text touching the border.
    const PAGE1_FIELD_MAX_WIDTH = 160;

    // --- Page 1 Overlay (Customer Info) ---
    // Vertical baselines adjusted to exact bottoms (y1 of labels):
    const quoteNo = customerData.id || `Q-${Date.now()}`;
    const dateStr = customerData.date || new Date().toLocaleDateString("en-IN");
    const name    = customerData.customerName || "";
    const address = customerData.customerAddress || customerData.customerCity || "";
    const contact = customerData.customerPhone || "";

    drawBoldText(page1, fitText(fontBold, quoteNo, 10.5, PAGE1_FIELD_MAX_WIDTH), 360, 222.5, 10.5);
    drawBoldText(page1, fitText(fontBold, dateStr, 10.5, PAGE1_FIELD_MAX_WIDTH), 360, 195.2, 10.5);
    drawBoldText(page1, fitText(fontBold, name,    10.5, PAGE1_FIELD_MAX_WIDTH), 360, 168.5, 10.5);
    // Address uses 2-line word-wrap (gap to Contact No. is 26.2pt — enough for 1 extra line)
    drawAddressWrapped(page1, address, 360, 141.9, fontBold, PAGE1_FIELD_MAX_WIDTH, 10.5);
    drawBoldText(page1, fitText(fontBold, contact, 10.5, PAGE1_FIELD_MAX_WIDTH), 360, 115.7, 10.5);

    // --- Page 3 Overlay (Specifications & Pricing Table) ---
    const panelCount = customerData.panelCount || quoteData.panelCount;

    // ── Spec text layout constants ─────────────────────────────────────────────
    //  SPEC_X = 193  — clears all pre-printed sub-labels (widest "Solar Structure"
    //                   ends at ≈182pt; 193 gives a clear visual gap for the colon)
    //  SPEC_RIGHT_LIMIT = 375  — x of the pre-printed column separator
    //  SPEC_MAX_WIDTH   = 182pt
    //  autoFitText() shrinks 9.5→7.5pt before truncating, so complete spec
    //  text is always shown when possible.
    const SPEC_X         = 193;
    const SPEC_MAX_WIDTH = 375 - SPEC_X; // = 182 pt

    const panelSpec    = `: ${panelData?.brand || ""} ${panelData?.watt || ""}W ${panelData?.type || ""} (${panelCount} pcs)`;
    const inverterSpec = `: ${inverterData?.brand || ""} ${inverterData?.kw || ""}kW ${inverterData?.type || ""}`;
    const structureSpec = `: GI Structure - ${customerData.structureHeight || "Standard"}`;

    // autoFitText: shrink 9.5→7.5pt before truncating (last resort only)
    const ps = autoFitText(fontRegular, panelSpec,    9.5, 7.5, SPEC_MAX_WIDTH);
    const is = autoFitText(fontRegular, inverterSpec, 9.5, 7.5, SPEC_MAX_WIDTH);
    const ss = autoFitText(fontRegular, structureSpec,9.5, 7.5, SPEC_MAX_WIDTH);

    drawText(page3, ps.text, SPEC_X, 582.14, ps.size);
    drawText(page3, is.text, SPEC_X, 563.06, is.size);
    drawText(page3, ss.text, SPEC_X, 543.98, ss.size);

    // ── Amount values ──────────────────────────────────────────────────────────
    const fmtCurrency = (n) => "Rs. " + Number(n).toLocaleString("en-IN");
    const colRight = 495; // right-align all amount values at x=495

    // Row 1 — Solar Rooftop System Cost  (y=602.21)
    drawRightAlignedBoldText(page3, fmtCurrency(quoteData.subtotal),   colRight, 602.21, 10.5);
    // Row 2 — Solar System Cost Per kw   (y=503.70)
    drawRightAlignedBoldText(page3, fmtCurrency(quoteData.pricePerKw), colRight, 503.70, 10.5);
    // Row 3 — Meter Charges: pre-printed "AT ACTUAL" — no value to write
    // Row 4 — CGST & SGST                (y=425.63)
    drawRightAlignedBoldText(page3, fmtCurrency(quoteData.gst),        colRight, 425.63, 10.5);
    // Total Payable Amount               (y=390.61)
    drawRightAlignedBoldText(page3, fmtCurrency(quoteData.total),      colRight, 390.61, 11, rgb(0.08, 0.12, 0.18));
    // Total Subsidy                      (y=350.04)
    const subsidy = quoteData.subsidy || 0;
    drawRightAlignedBoldText(page3, fmtCurrency(subsidy),              colRight, 350.04, 11, rgb(0.05, 0.5, 0.1));
    // Effective Price For Customer       (y=314.36)
    const effectivePrice = quoteData.effectivePrice || (quoteData.total - subsidy);
    drawRightAlignedBoldText(page3, fmtCurrency(effectivePrice),       colRight, 314.36, 12, rgb(0.02, 0.55, 0.05));

    const pdfBytes = await pdfDoc.save();
    const filename = `Highlight_Solar_Quotation_${name.replace(/\s+/g, "_") || "Proposal"}.pdf`;
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const file = new File([blob], filename, { type: "application/pdf" });

    if (options && options.download) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    return { pdfBytes, blob, file, filename };
  } catch (error) {
    console.error("Error generating PDF quotation:", error);
    throw new Error("Could not generate PDF: " + error.message);
  }
}


export function compressAndConvertToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        const maxDim = 1024;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
      img.src = e.target.result;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

