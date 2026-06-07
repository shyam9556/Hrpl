import { useState, useEffect, useMemo } from "react";
import { stock as stockApi, settings as settingsApi } from "../utils/api";
import { 
  Loader2, Save, X, Coins, TrendingUp, Sun, Zap, Package, 
  Layers, Info, AlertCircle, FileSpreadsheet, ShieldAlert, LockKeyhole, Delete, ArrowRight
} from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import ErrorState from "./ErrorState";

export default function StockManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [edited, setEdited] = useState({}); // Stores { [id]: { quantity, unitPrice } }
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [errorDialog, setErrorDialog] = useState({ open: false, message: "" });
  const [thresholds, setThresholds] = useState({ high: 20, low: 5 });
  const [pin, setPin] = useState("1234");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [enteredPin, setEnteredPin] = useState("");
  const [shake, setShake] = useState(false);
  const [pinError, setPinError] = useState(false);

  const fetchStock = () => {
    setLoading(true);
    setFetchError(false);
    Promise.all([
      stockApi.getAll().then(res => setItems(res.stock || [])),
      settingsApi.getPublic().then(res => {
        const s = res.settings || {};
        setThresholds({
          high: parseInt(s.stock_threshold_high) || 20,
          low: parseInt(s.stock_threshold_low) || 5,
        });
      }).catch(() => {}), // Silently use defaults if settings fail
      settingsApi.getAll().then(res => {
        const s = res.settings || {};
        if (s.stock_manager_pin) {
          setPin(s.stock_manager_pin);
        }
      }).catch(() => {}),
    ])
      .catch(err => {
        setFetchError(true);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchStock(); }, []);

  const handleKeyPress = (num) => {
    if (enteredPin.length < pin.length) {
      const nextPin = enteredPin + num;
      setEnteredPin(nextPin);
      setPinError(false);
      
      if (nextPin.length === pin.length) {
        verifyPin(nextPin);
      }
    }
  };

  const handleBackspace = () => {
    setEnteredPin(prev => prev.slice(0, -1));
    setPinError(false);
  };

  const verifyPin = (currentPin) => {
    if (currentPin === pin) {
      setIsUnlocked(true);
    } else {
      setShake(true);
      setPinError(true);
      setTimeout(() => {
        setShake(false);
        setEnteredPin("");
      }, 400);
    }
  };

  useEffect(() => {
    if (isUnlocked) return;
    
    const handleKeyDown = (e) => {
      if (e.key >= "0" && e.key <= "9") {
        handleKeyPress(e.key);
      } else if (e.key === "Backspace") {
        handleBackspace();
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enteredPin, isUnlocked, pin]);

  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  const handleChange = (id, field, value) => {
    setEdited(prev => {
      const current = prev[id] || {};
      return {
        ...prev,
        [id]: {
          ...current,
          [field]: value === "" ? "" : value
        }
      };
    });
  };

  const getQty = (item) => {
    return edited[item.id]?.quantity !== undefined ? edited[item.id].quantity : item.quantity;
  };

  const getPrice = (item) => {
    return edited[item.id]?.unitPrice !== undefined ? edited[item.id].unitPrice : item.unit_price;
  };

  const isModified = (item) => {
    const edit = edited[item.id];
    if (!edit) return false;
    
    const qtyChanged = edit.quantity !== undefined && edit.quantity !== "" && parseInt(edit.quantity) !== parseInt(item.quantity);
    const priceChanged = edit.unitPrice !== undefined && edit.unitPrice !== "" && parseFloat(edit.unitPrice) !== parseFloat(item.unit_price);
    
    return qtyChanged || priceChanged;
  };

  const isQtyModified = (item) => {
    const edit = edited[item.id];
    return edit?.quantity !== undefined && edit.quantity !== "" && parseInt(edit.quantity) !== parseInt(item.quantity);
  };

  const isPriceModified = (item) => {
    const edit = edited[item.id];
    return edit?.unitPrice !== undefined && edit.unitPrice !== "" && parseFloat(edit.unitPrice) !== parseFloat(item.unit_price);
  };

  const handleSave = async () => {
    const toUpdate = Object.keys(edited).filter(id => {
      const item = items.find(i => i.id === parseInt(id));
      if (!item) return false;
      const edit = edited[id];
      const qtyChanged = edit.quantity !== undefined && edit.quantity !== "" && parseInt(edit.quantity) !== parseInt(item.quantity);
      const priceChanged = edit.unitPrice !== undefined && edit.unitPrice !== "" && parseFloat(edit.unitPrice) !== parseFloat(item.unit_price);
      return qtyChanged || priceChanged;
    });

    if (toUpdate.length === 0) return;

    setSaving(true);
    try {
      await Promise.all(
        toUpdate.map(async (id) => {
          const item = items.find(i => i.id === parseInt(id));
          const edit = edited[id];
          
          let qty = edit.quantity !== undefined && edit.quantity !== "" ? parseInt(edit.quantity) : item.quantity;
          let price = edit.unitPrice !== undefined && edit.unitPrice !== "" ? parseFloat(edit.unitPrice) : item.unit_price;

          if (isNaN(qty) || qty < 0) {
            throw new Error(`Quantity for '${item.item_name}' must be a non-negative integer.`);
          }
          if (isNaN(price) || price < 0) {
            throw new Error(`Price for '${item.item_name}' must be a non-negative number.`);
          }
          await stockApi.update(parseInt(id), qty, price);
        })
      );

      // Update local state
      setItems(prev =>
        prev.map(item => {
          const edit = edited[item.id];
          if (edit) {
            return {
              ...item,
              quantity: edit.quantity !== undefined && edit.quantity !== "" ? parseInt(edit.quantity) : item.quantity,
              unit_price: edit.unitPrice !== undefined && edit.unitPrice !== "" ? parseFloat(edit.unitPrice) : item.unit_price,
            };
          }
          return item;
        })
      );
      setEdited({});
      setDrawerOpen(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3500);
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to save stock changes." });
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setEdited({});
  };

  const getModifiedItems = () => {
    return items
      .filter(item => isModified(item))
      .map(item => {
        const edit = edited[item.id];
        return {
          ...item,
          oldQty: item.quantity,
          newQty: edit.quantity !== undefined && edit.quantity !== "" ? parseInt(edit.quantity) : item.quantity,
          oldPrice: item.unit_price,
          newPrice: edit.unitPrice !== undefined && edit.unitPrice !== "" ? parseFloat(edit.unitPrice) : item.unit_price,
          qtyChanged: isQtyModified(item),
          priceChanged: isPriceModified(item),
        };
      });
  };

  // Indian Currency Formatting Helper
  const fmtCurrency = (num) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(num);
  };

  // Calculation of stock live valuations (computes live changes instantly!)
  const valuationMetrics = useMemo(() => {
    const catVal = {};
    const catQty = {};
    let grandTotal = 0;

    for (const item of items) {
      const qty = parseFloat(getQty(item)) || 0;
      const price = parseFloat(getPrice(item)) || 0;
      const val = qty * price;

      catVal[item.category] = (catVal[item.category] || 0) + val;
      catQty[item.category] = (catQty[item.category] || 0) + qty;
      grandTotal += val;
    }

    return {
      categoryValuations: catVal,
      categoryQuantities: catQty,
      grandTotalValuation: grandTotal,
    };
  }, [items, edited]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
        <div style={{ marginBottom: 8 }}><Loader2 size={32} className="animate-spin" /></div>Loading stock...
      </div>
    );
  }

  if (fetchError) {
    return (
      <ErrorState
        title="Failed to load stock data."
        message="Could not connect to the server. Please check your connection and try again."
        onRetry={fetchStock}
      />
    );
  }

  if (!isUnlocked) {
    return (
      <div className="stock-lock-screen">
        <div className={`pin-glass-container ${shake ? "error-shake" : ""}`}>
          <div className={`pin-lock-icon-container ${pinError && !shake ? "error" : ""}`}>
            <LockKeyhole size={30} className={shake ? "animate-bounce" : ""} />
          </div>
          <h2 className="pin-lock-title">Security Verification</h2>
          <p className="pin-lock-sub">
            {pinError 
              ? "Access denied. Please check your credentials and try again." 
              : "This dashboard contains sensitive financial asset metrics and inventory logs. Please enter your PIN to verify your identity."}
          </p>
          
          <div className="pin-dots-row">
            {Array.from({ length: pin.length }).map((_, idx) => (
              <div 
                key={idx} 
                className={`pin-dot ${
                  pinError 
                    ? "error" 
                    : idx < enteredPin.length 
                      ? "active" 
                      : ""
                }`} 
              />
            ))}
          </div>
          
          <div className="pin-keypad-grid">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
              <button 
                key={num} 
                className="pin-key-btn"
                onClick={() => handleKeyPress(num.toString())}
              >
                {num}
              </button>
            ))}
            <button 
              className="pin-key-btn special-key"
              onClick={() => {
                setEnteredPin("");
                setPinError(false);
              }}
            >
              Clear
            </button>
            <button 
              className="pin-key-btn"
              onClick={() => handleKeyPress("0")}
            >
              0
            </button>
            <button 
              className="pin-key-btn special-key"
              onClick={handleBackspace}
              aria-label="Backspace"
            >
              <Delete size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const categories = [...new Set(items.map(i => i.category))];
  const modifiedKeys = Object.keys(edited).filter(id => {
    const item = items.find(i => i.id === parseInt(id));
    return item && isModified(item);
  });
  const hasChanges = modifiedKeys.length > 0;

  // Category Colors and Icons Map for premium rendering
  const categoryConfig = {
    Panel: { bg: "rgba(245, 158, 11, 0.06)", color: "#d97706", icon: Sun, label: "Solar Panels" },
    Inverter: { bg: "rgba(59, 130, 246, 0.06)", color: "#2563eb", icon: Zap, label: "Inverters" },
    Accessory: { bg: "rgba(16, 185, 129, 0.06)", color: "#059669", icon: Package, label: "Accessories" },
    Wire: { bg: "rgba(139, 92, 246, 0.06)", color: "#7c3aed", icon: Layers, label: "Wires & Cables" },
    Default: { bg: "rgba(107, 114, 128, 0.06)", color: "#4b5563", icon: Package, label: "Stock Items" }
  };

  return (
    <div>
      {/* Page Header */}
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="page-title">Stock & Inventory Suite</div>
          <div className="page-sub">Update inventory quantities, adjust unit valuation prices, and track assets</div>
        </div>
        <button
          className="btn-primary"
          style={{ 
            width: "auto", 
            padding: "10px 24px", 
            opacity: hasChanges ? 1 : 0.5,
            background: hasChanges ? "var(--green)" : "var(--muted)",
            display: "flex",
            alignItems: "center",
            gap: 6
          }}
          disabled={!hasChanges || saving}
          onClick={() => setDrawerOpen(true)}
        >
          <Save size={16} />
          Review & Save
        </button>
      </div>

      {/* Save success banner */}
      {saveSuccess && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 10, background: "#f0fdf4", border: "1px solid #86efac", marginBottom: 16, fontSize: 13, color: "#166534", animation: "fadeIn 0.2s ease" }}>
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          Stock updated successfully. All changes have been saved.
        </div>
      )}

      {/* Empty state when no stock items exist */}
      {items.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem 2rem", color: "var(--muted)" }}>
          <div style={{ marginBottom: 12 }}><Package size={48} strokeWidth={1} /></div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>No Stock Items Found</div>
          <div style={{ fontSize: 13, marginTop: 6, maxWidth: 380, margin: "6px auto 0 auto", lineHeight: 1.6 }}>
            Stock items are automatically created when you add panels and inverters in the <strong>Price Manager</strong>. Go to Price Manager to add your first panel or inverter.
          </div>
        </div>
      ) : (

      <>
      {/* Stock Valuation Summary Dashboard Section */}
      <div className="card" style={{ 
        marginBottom: 32, 
        border: "1.5px solid #e2e8f0", 
        borderRadius: 20, 
        background: "linear-gradient(135deg, #ffffff 0%, #fafaf9 100%)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.03)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #f1f5f9", paddingBottom: 16, marginBottom: 20 }}>
          <span style={{ 
            background: "rgba(46,125,82,0.1)", 
            color: "var(--green)", 
            width: 38, 
            height: 38, 
            borderRadius: 10, 
            display: "flex", 
            justifyContent: "center", 
            alignItems: "center" 
          }}>
            <Coins size={22} />
          </span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>Stock Asset Valuation Summary</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Live financial assets valuation aggregated across categories</div>
          </div>
        </div>

        {/* Valuation Grid Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          {categories.map(cat => {
            const config = categoryConfig[cat] || categoryConfig.Default;
            const Icon = config.icon;
            const val = valuationMetrics.categoryValuations[cat] || 0;
            const qty = valuationMetrics.categoryQuantities[cat] || 0;

            return (
              <div 
                key={cat}
                style={{
                  background: "white",
                  border: "1px solid #f1f5f9",
                  borderRadius: 12,
                  padding: 18,
                  boxShadow: "0 4px 10px rgba(0,0,0,0.01)"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ 
                    background: config.bg, 
                    color: config.color, 
                    width: 28, 
                    height: 28, 
                    borderRadius: 6, 
                    display: "flex", 
                    justifyContent: "center", 
                    alignItems: "center" 
                  }}>
                    <Icon size={14} />
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{cat}s Valuation</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
                  {fmtCurrency(val)}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                  Asset count: {qty} units
                </div>
              </div>
            );
          })}

          {/* Grand Total Valuation Card */}
          <div 
            style={{
              background: "linear-gradient(135deg, var(--green) 0%, #15803d 100%)",
              color: "white",
              borderRadius: 12,
              padding: 18,
              boxShadow: "0 8px 20px rgba(46,125,82,0.15)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, opacity: 0.9 }}>
              <TrendingUp size={16} />
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Grand Total Asset Valuation</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>
              {fmtCurrency(valuationMetrics.grandTotalValuation)}
            </div>
            <div style={{ fontSize: 10, marginTop: 4, opacity: 0.8 }}>
              All 4 stock categories combined
            </div>
          </div>
        </div>
      </div>

      {/* Grid of Categories */}
      {categories.map(cat => {
        const config = categoryConfig[cat] || categoryConfig.Default;
        const Icon = config.icon;
        
        return (
          <div className="card" key={cat} style={{ borderLeft: `4px solid ${config.color}`, borderRadius: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
              <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                <span style={{ 
                  background: config.bg, 
                  color: config.color, 
                  width: 32, 
                  height: 32, 
                  borderRadius: 8, 
                  display: "flex", 
                  justifyContent: "center", 
                  alignItems: "center" 
                }}>
                  <Icon size={18} />
                </span>
                <span>{config.label}</span>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", background: "#f8fafc", padding: "4px 10px", borderRadius: 8 }}>
                Valuation: {fmtCurrency(valuationMetrics.categoryValuations[cat] || 0)}
              </span>
            </div>
            
            <div className="table-scroll-wrap">
              <table style={{ minWidth: "520px" }}>
                <thead>
                  <tr>
                    <th style={{ width: "35%" }}>Item Specifications</th>
                    <th style={{ width: "20%" }}>Quantity</th>
                    <th style={{ width: "10%" }}>Unit</th>
                    <th style={{ width: "20%" }}>Unit Price (₹)</th>
                    <th style={{ width: "15%" }}>Total Value</th>
                  </tr>
                </thead>
                <tbody>
                  {items
                    .filter(i => i.category === cat)
                    .map(item => {
                      const qty = getQty(item);
                      const price = getPrice(item);
                      const isQtyChanged = isQtyModified(item);
                      const isPriceChanged = isPriceModified(item);
                      const isItemModified = isModified(item);
                      
                      return (
                        <tr key={item.id}>
                          <td style={{ fontWeight: 600 }}>{item.item_name}</td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <input
                                className="input-inline"
                                type="number"
                                min="0"
                                value={qty}
                                style={
                                  isQtyChanged
                                    ? {
                                        borderColor: "var(--sun)",
                                        backgroundColor: "rgba(245, 166, 35, 0.05)",
                                        fontWeight: "bold",
                                        width: 80
                                      }
                                    : { width: 80 }
                                }
                                onChange={e => handleChange(item.id, "quantity", e.target.value)}
                              />
                              
                              {/* Stock status indicator badge */}
                              <span
                                className={`badge ${
                                  qty > thresholds.high
                                    ? "badge-green"
                                    : qty > thresholds.low
                                    ? "badge-sun"
                                    : "badge-red"
                                }`}
                                style={{ fontSize: 9, padding: "2px 6px" }}
                              >
                                {qty > thresholds.high ? "In Stock" : qty > thresholds.low ? "Low" : "Critical"}
                              </span>
                            </div>
                          </td>
                          <td style={{ color: "var(--muted)", fontSize: 13 }}>{item.unit}</td>
                          <td>
                            <input
                              className="input-inline"
                              type="number"
                              min="0"
                              step="0.01"
                              value={price}
                              style={
                                isPriceChanged
                                  ? {
                                      borderColor: "var(--green)",
                                      backgroundColor: "rgba(46, 125, 82, 0.05)",
                                      fontWeight: "bold",
                                      width: 110
                                    }
                                  : { width: 110 }
                              }
                              onChange={e => handleChange(item.id, "unitPrice", e.target.value)}
                            />
                          </td>
                          <td style={{ fontWeight: 700, color: isItemModified ? "var(--green)" : "var(--text)" }}>
                            {fmtCurrency((parseFloat(qty) || 0) * (parseFloat(price) || 0))}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* Unsaved Changes Alert bar */}
      {hasChanges && (
        <div
          className="alert alert-green"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 20,
            borderRadius: 12,
            animation: "fadeIn 0.2s ease"
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--sun)" }}></span>
            You have unsaved changes ({modifiedKeys.length} inventory item{modifiedKeys.length > 1 ? "s" : ""} modified).
          </span>
          <button className="btn-sm" style={{ background: "transparent", border: "1.5px solid var(--green)", color: "var(--green)" }} onClick={handleDiscard}>
            Discard Changes
          </button>
        </div>
      )}



      </> 
      )} 

      {/* Review Changes Drawer */}
      {drawerOpen && (
        <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} style={{ zIndex: 999 }}>
          <div className="drawer-container" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="drawer-title-area">
                <span className="drawer-title">Review Stock Adjustments</span>
                <span className="drawer-subtitle">Verify quantity and price changes before syncing</span>
              </div>
              <button className="close-btn" style={{ padding: 4, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDrawerOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="drawer-content" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
                <Info size={14} style={{ color: "var(--green)" }} />
                The following modifications will update stock logs and assets value:
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "55vh", overflowY: "auto", paddingRight: 4 }}>
                {getModifiedItems().map(item => (
                  <div className="change-card" key={item.id} style={{ padding: 14, border: "1px solid #f1f5f9", borderRadius: 10 }}>
                    <div className="change-item-info" style={{ marginBottom: 8 }}>
                      <span className="change-item-cat" style={{ background: "#f8fafc", padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, color: "var(--muted)" }}>{item.category}</span>
                      <span className="change-item-name" style={{ fontWeight: 700, marginLeft: 8, fontSize: 13 }}>{item.item_name}</span>
                    </div>
                    
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 4 }}>
                      {/* Qty Change */}
                      {item.qtyChanged && (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, flexWrap: "wrap", gap: 4 }}>
                          <span style={{ color: "var(--muted)" }}>Quantity Adjustment:</span>
                          <span style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ textDecoration: "line-through", color: "#ef4444" }}>{item.oldQty}</span>
                            <ArrowRight size={11} style={{ color: "var(--muted)" }} />
                            <span style={{ color: "var(--green)", fontWeight: 700 }}>{item.newQty}</span> {item.unit}
                          </span>
                        </div>
                      )}
                      
                      {/* Price Change */}
                      {item.priceChanged && (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, flexWrap: "wrap", gap: 4 }}>
                          <span style={{ color: "var(--muted)" }}>Unit Price Adjustment:</span>
                          <span style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ textDecoration: "line-through", color: "#ef4444" }}>{fmtCurrency(item.oldPrice)}</span>
                            <ArrowRight size={11} style={{ color: "var(--muted)" }} />
                            <span style={{ color: "var(--green)", fontWeight: 700 }}>{fmtCurrency(item.newPrice)}</span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="drawer-footer">
              <button className="btn-sm" style={{ padding: "12px", border: "1.5px solid var(--border)", background: "transparent", fontWeight: 600 }} onClick={() => setDrawerOpen(false)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={saving} onClick={handleSave} style={{ background: "var(--green)" }}>
                {saving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Saving Changes...
                  </>
                ) : (
                  <>
                    <Save size={16} /> Confirm & Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation & Alert dialog */}
      <ConfirmDialog
        open={errorDialog.open}
        title="Error"
        message={errorDialog.message}
        variant="danger"
        confirmText="OK"
        hideCancel
        onConfirm={() => setErrorDialog({ open: false, message: "" })}
        onCancel={() => setErrorDialog({ open: false, message: "" })}
      />
    </div>
  );
}
