import { useState, useEffect, useRef } from "react";
import { Download, Sliders, ShieldCheck, Eye, RefreshCw, FileText, CreditCard, Award } from "lucide-react";

export default function DealerDocuments({ user }) {
  const [activeTab, setActiveTab] = useState("certificate"); // "certificate" or "card"
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfBlob, setPdfBlob] = useState(null);
  
  // ─── 1. Certificate State Variables ──────────────────────────────────────
  const [nameY, setNameY] = useState(278);
  const [dateX, setDateX] = useState(448);
  const [dateY, setDateY] = useState(80);
  const [nameSize, setNameSize] = useState(32);
  const [dateSize, setDateSize] = useState(16);
  const [nameColor, setNameColor] = useState("gold");

  // ─── 2. Visiting Card State Variables ─────────────────────────────────────
  const [cardNameY, setCardNameY] = useState(142);
  const [cardNameSize, setCardNameSize] = useState(10);
  const [cardPhoneY, setCardPhoneY] = useState(95.12);
  const [cardEmailY, setCardEmailY] = useState(81.92);
  const [cardFontSize, setCardFontSize] = useState(6.5);
  const [cardNameColor, setCardNameColor] = useState("navy"); // Default to extracted exact Midnight Navy

  // Cached assets to prevent multiple heavy network fetches
  const cachedCertTemplateRef = useRef(null);
  const cachedCardTemplateRef = useRef(null);
  const cachedFontRegularRef = useRef(null);
  const cachedFontBoldRef = useRef(null);
  const cachedFontSemiBoldRef = useRef(null);

  // Formatting Issue Date for Certificate
  const approvedDateStr = user.created_at
    ? new Date(user.created_at).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : new Date().toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });

  // Dynamic document generator
  const generateDocument = async (forceRefetch = false) => {
    try {
      setLoading(true);
      const [pdfLibModule, fontkitModule] = await Promise.all([
        import("pdf-lib"),
        import("@pdf-lib/fontkit"),
      ]);
      const { PDFDocument, rgb } = pdfLibModule;
      const fontkit = fontkitModule.default;

      // Ensure fonts are loaded and cached
      if (!cachedFontRegularRef.current || forceRefetch) {
        const regRes = await fetch("/fonts/Poppins-Regular.ttf");
        if (regRes.ok) cachedFontRegularRef.current = await regRes.arrayBuffer();
      }
      if (!cachedFontBoldRef.current || forceRefetch) {
        const boldRes = await fetch("/fonts/Poppins-Bold.ttf");
        if (boldRes.ok) cachedFontBoldRef.current = await boldRes.arrayBuffer();
      }
      if (!cachedFontSemiBoldRef.current || forceRefetch) {
        const semiBoldRes = await fetch("/fonts/Poppins-SemiBold.ttf");
        if (semiBoldRes.ok) cachedFontSemiBoldRef.current = await semiBoldRes.arrayBuffer();
      }

      let pdfDoc;

      if (activeTab === "certificate") {
        // ─── GENERATE CHANNEL PARTNER CERTIFICATE ────────────────────────────
        if (!cachedCertTemplateRef.current || forceRefetch) {
          const response = await fetch("/channel-partner-certificate.pdf");
          if (!response.ok) throw new Error("Certificate template not found.");
          cachedCertTemplateRef.current = await response.arrayBuffer();
        }

        const certBytesCopy = cachedCertTemplateRef.current.slice(0);
        pdfDoc = await PDFDocument.load(certBytesCopy);
        pdfDoc.registerFontkit(fontkit);

        const fontRegular = cachedFontRegularRef.current ? await pdfDoc.embedFont(cachedFontRegularRef.current) : null;
        const fontBold = cachedFontBoldRef.current ? await pdfDoc.embedFont(cachedFontBoldRef.current) : null;

        const page = pdfDoc.getPages()[0];
        const { width } = page.getSize();

        // Fixed certificate name color
        const colorRgb = rgb(1, 0.624, 0); // Charcoal

        // Draw Name (Centered with elegant spacing between first, middle, and last names)
        const rawName = user.name || "Authorized Dealer";
        const nameParts = rawName.trim().split(/\s+/);
        const dealerName = nameParts.join("  "); // 2 spaces for a beautiful, uncongested look
        const embeddedBoldFont = fontBold || pdfDoc.embedStandardFont("Helvetica-Bold");
        const nameWidth = embeddedBoldFont.widthOfTextAtSize(dealerName, nameSize);
        const nameX = (width - nameWidth) / 2;

        page.drawText(dealerName, {
          x: nameX,
          y: nameY,
          size: nameSize,
          font: embeddedBoldFont,
          color: colorRgb,
        });

        // Draw Date (Centered on DATE line X=448)
        const embeddedRegularFont = fontRegular || pdfDoc.embedStandardFont("Helvetica");
        const dateWidth = embeddedRegularFont.widthOfTextAtSize(approvedDateStr, dateSize);
        const calculatedDateX = dateX - (dateWidth / 2);

        page.drawText(approvedDateStr, {
          x: calculatedDateX,
          y: dateY,
          size: dateSize,
          font: embeddedRegularFont,
          color: rgb(0.2, 0.27, 0.33),
        });

      } else {
        // ─── GENERATE PERSONALIZED VISITING CARD ─────────────────────────────
        if (!cachedCardTemplateRef.current || forceRefetch) {
          const response = await fetch("/visiting-card-template.pdf");
          if (!response.ok) throw new Error("Visiting card template not found.");
          cachedCardTemplateRef.current = await response.arrayBuffer();
        }

        const cardBytesCopy = cachedCardTemplateRef.current.slice(0);
        pdfDoc = await PDFDocument.load(cardBytesCopy);
        pdfDoc.registerFontkit(fontkit);

        const fontRegular = cachedFontRegularRef.current ? await pdfDoc.embedFont(cachedFontRegularRef.current) : null;
        const fontBold = cachedFontBoldRef.current ? await pdfDoc.embedFont(cachedFontBoldRef.current) : null;
        const fontSemiBold = cachedFontSemiBoldRef.current ? await pdfDoc.embedFont(cachedFontSemiBoldRef.current) : null;

        const page = pdfDoc.getPages()[0];

        // Fixed visiting card name color
        const cardColorRgb = rgb(0.0196, 0.0078, 0.1686); // Navy

        const embeddedBoldFont = fontBold || pdfDoc.embedStandardFont("Helvetica-Bold");
        const embeddedSemiBoldFont = fontSemiBold || fontRegular || pdfDoc.embedStandardFont("Helvetica-Bold");

        // 1. Draw Dealer's Name (First and Last name only for perfect fit, first/last parts extracted)
        const rawName = user.name || "Authorized Partner";
        const nameParts = rawName.trim().split(/\s+/);
        const dealerName = nameParts.length > 2 
          ? `${nameParts[0]} ${nameParts[nameParts.length - 1]}`
          : rawName;

        page.drawText(dealerName, {
          x: 320.46,
          y: cardNameY,
          size: cardNameSize,
          font: embeddedBoldFont,
          color: cardColorRgb,
        });

        // 2. Draw Dealer's Phone
        const dealerMobile = user.mobile ? `+91-${user.mobile}` : "+91-9999999999";
        page.drawText(dealerMobile, {
          x: 320.01,
          y: cardPhoneY,
          size: cardFontSize,
          font: embeddedSemiBoldFont,
          color: rgb(0.0196, 0.0078, 0.1686), // Extracted exact original deep navy
        });

        // 3. Draw Dealer's Email
        const dealerEmail = user.email || "dealer@highlightpro.in";
        page.drawText(dealerEmail, {
          x: 320.17,
          y: cardEmailY,
          size: cardFontSize,
          font: embeddedSemiBoldFont,
          color: rgb(0.0196, 0.0078, 0.1686), // Extracted exact original deep navy
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });

      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }

      const newUrl = URL.createObjectURL(blob);
      setPdfBlob(blob);
      setPdfUrl(newUrl);
      setError("");
    } catch (err) {
      console.error("Document generation failed:", err);
      setError(err.message || "Failed to generate preview.");
    } finally {
      setLoading(false);
    }
  };

  // Re-generate document on tab switch or slider updates
  useEffect(() => {
    generateDocument();
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    nameY, dateX, dateY, nameSize, dateSize, nameColor,
    cardNameY, cardNameSize, cardPhoneY, cardEmailY, cardFontSize, cardNameColor
  ]);

  const handleDownload = () => {
    if (!pdfBlob) return;
    const prefix = activeTab === "certificate" 
      ? "Highlight_Renewable_Channel_Partner_Certificate"
      : "Highlight_Renewable_Visiting_Card";
    const filename = `${prefix}_${(user.name || "Dealer").replace(/\s+/g, "_")}.pdf`;
    
    const a = document.createElement("a");
    a.href = pdfUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div style={{ padding: "1.5rem", maxWidth: 1200, margin: "0 auto", animation: "fadeIn 0.3s ease" }}>
      {/* Header Panel */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={{
            background: "linear-gradient(135deg, #102A1C, #2E7D52)",
            padding: "0.5rem",
            borderRadius: "12px",
            boxShadow: "0 4px 12px rgba(46, 125, 82, 0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white"
          }}>
            <ShieldCheck size={28} />
          </div>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--dark)", margin: 0, letterSpacing: "-0.5px" }}>
              Official Documents
            </h1>
            <p style={{ fontSize: "0.875rem", color: "var(--muted)", margin: 0 }}>
              View and download your dynamically personalized partner credentials.
            </p>
          </div>
        </div>
      </div>

      {/* Modern Glassmorphic Tab Switcher */}
      <div style={{
        display: "flex",
        background: "#f1f5f9",
        padding: "4px",
        borderRadius: "14px",
        marginBottom: "1.5rem",
        maxWidth: "420px"
      }}>
        <button
          onClick={() => { setActiveTab("certificate"); }}
          style={{
            flex: 1,
            padding: "10px 14px",
            fontSize: "0.875rem",
            fontWeight: 700,
            borderRadius: "10px",
            border: "none",
            background: activeTab === "certificate" ? "white" : "transparent",
            color: activeTab === "certificate" ? "var(--green)" : "#64748b",
            boxShadow: activeTab === "certificate" ? "0 4px 12px rgba(0,0,0,0.05)" : "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            transition: "all 0.2s"
          }}
        >
          <Award size={16} />
          Partner Certificate
        </button>
        <button
          onClick={() => { setActiveTab("card"); }}
          style={{
            flex: 1,
            padding: "10px 14px",
            fontSize: "0.875rem",
            fontWeight: 700,
            borderRadius: "10px",
            border: "none",
            background: activeTab === "card" ? "white" : "transparent",
            color: activeTab === "card" ? "var(--green)" : "#64748b",
            boxShadow: activeTab === "card" ? "0 4px 12px rgba(0,0,0,0.05)" : "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            transition: "all 0.2s"
          }}
        >
          <CreditCard size={16} />
          Visiting Card
        </button>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr",
        lgGridTemplateColumns: "350px 1fr",
        gap: "1.5rem",
      }} className="documents-grid-wrapper">
        
        {/* Left Control Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          {/* Glassmorphic Details Card */}
          <div style={{
            background: "white",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "20px",
            padding: "1.5rem",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.04)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
              <span style={{
                background: "#dcfce7",
                color: "#166534",
                fontSize: "0.75rem",
                fontWeight: 700,
                borderRadius: "20px",
                padding: "2px 8px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px"
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }}></span>
                Certified Active
              </span>
            </div>

            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--dark)", marginBottom: "0.5rem" }}>
              {activeTab === "certificate" ? "Channel Partner Certificate" : "Authorized Visiting Card"}
            </h2>
            
            <p style={{ fontSize: "0.875rem", color: "var(--muted)", lineHeight: 1.6, marginBottom: "1.25rem" }}>
              {activeTab === "certificate" 
                ? `Recognizes **${user.name || "your enterprise"}** as an official Channel Partner for **Highlight Renewable Energy**. Signed and issued upon registration approval.`
                : `Your official corporate visiting card for **Highlight Renewable Energy**, automatically personalized with your name, phone number, and dealer email.`
              }
            </p>

            <div style={{ 
              borderTop: "1px solid var(--border, #e5e7eb)", 
              borderBottom: "1px solid var(--border, #e5e7eb)", 
              padding: "1rem 0", 
              marginBottom: "1.5rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}>
                <span style={{ color: "var(--muted)" }}>Partner Name:</span>
                <span style={{ fontWeight: 600, color: "var(--dark)" }}>{user.name}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}>
                <span style={{ color: "var(--muted)" }}>Mobile Number:</span>
                <span style={{ fontWeight: 600, color: "var(--dark)" }}>{user.mobile || "Not Provided"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}>
                <span style={{ color: "var(--muted)" }}>Dealer Email:</span>
                <span style={{ fontWeight: 600, color: "var(--dark)" }}>{user.email}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                onClick={handleDownload}
                disabled={loading || !!error}
                className="btn-primary"
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                  padding: "0.75rem 1rem",
                  borderRadius: "12px",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  cursor: (loading || !!error) ? "not-allowed" : "pointer"
                }}
              >
                <Download size={18} />
                Download PDF
              </button>
            </div>
          </div>
        </div>

        {/* Live Preview Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{
            background: "white",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "20px",
            padding: "1.5rem",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.04)",
            display: "flex",
            flexDirection: "column",
            minHeight: "500px",
            position: "relative"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
              <Eye size={18} color="var(--green)" />
              <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--dark)" }}>Dynamic PDF Preview</span>
            </div>

            {loading ? (
              <div style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "1rem",
                color: "var(--muted)"
              }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  border: "3px solid #f3f3f3",
                  borderTop: "3px solid var(--green)",
                  animation: "spin 1s linear infinite"
                }} className="spinner-loader"></div>
                <span style={{ fontSize: "0.875rem" }}>Generating personalized credential...</span>
              </div>
            ) : error ? (
              <div style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.75rem",
                padding: "2rem",
                textAlign: "center"
              }}>
                <div style={{
                  background: "#fee2e2",
                  color: "#ef4444",
                  padding: "0.75rem",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}>
                  <FileText size={32} />
                </div>
                <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#991b1b", margin: 0 }}>Document Loading Error</h3>
                <p style={{ fontSize: "0.875rem", color: "var(--muted)", maxWidth: 320, margin: 0, lineHeight: 1.5 }}>
                  {error}
                </p>
                <button
                  onClick={() => {
                    setLoading(true);
                    generateDocument(true);
                  }}
                  className="btn-primary"
                  style={{ marginTop: "1rem", padding: "0.5rem 1rem", fontSize: "0.875rem" }}
                >
                  Try Again
                </button>
              </div>
            ) : (
              <iframe
                src={`${pdfUrl}#toolbar=0&navpanes=0`}
                title="Official Document Preview"
                style={{
                  width: "100%",
                  flex: 1,
                  border: "1px solid var(--border, #e5e7eb)",
                  borderRadius: "12px",
                  background: "#f1f5f9"
                }}
              />
            )}
          </div>
        </div>

      </div>

      {/* Styled JSX injection for custom responsive breakpoints and micro-animations */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (min-width: 1024px) {
          .documents-grid-wrapper {
            grid-template-columns: 350px 1fr !important;
          }
        }
      `}} />
    </div>
  );
}
