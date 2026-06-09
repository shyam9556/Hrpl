import { useState, useEffect, useCallback } from "react";
import { settings as settingsApi } from "../utils/api";
import { Save, RotateCcw, Building2, FileText, Mail, Percent, Package, X, Loader2, Shield, Info, ChevronRight, Eye, EyeOff, CheckCircle } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import ErrorState from "./ErrorState";

export default function SettingsPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [edited, setEdited] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [errorDialog, setErrorDialog] = useState({ open: false, message: "" });
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showPin, setShowPin] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      setFetchError(false);
      const res = await settingsApi.getAll();
      setData(res.details || []);
    } catch (err) {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  // ── SSE: Reload if another admin session saves settings ────────────────────
  // Only fetches if the drawer (edit form) is closed — avoids overwriting
  // unsaved edits in progress.
  useEffect(() => {
    const handler = () => {
      if (!drawerOpen) fetchSettings();
    };
    window.addEventListener("hp:sse:settings:changed", handler);
    return () => window.removeEventListener("hp:sse:settings:changed", handler);
  }, [drawerOpen, fetchSettings]);


  // Auto-dismiss save success banner after 4 seconds
  useEffect(() => {
    if (!saveSuccess) return;
    const timer = setTimeout(() => setSaveSuccess(false), 4000);
    return () => clearTimeout(timer);
  }, [saveSuccess]);

  const handleChange = (key, value) => {
    setEdited(prev => ({ ...prev, [key]: value }));
  };

  const getValue = (key) => {
    if (edited[key] !== undefined) return edited[key];
    const item = data.find(s => s.key === key);
    return item ? item.value : "";
  };

  const handleSave = async () => {
    if (Object.keys(edited).length === 0) return;

    // ── Client-side validation before hitting the API ─────────────────────────
    const gst = edited["gst_rate"] !== undefined ? Number(edited["gst_rate"]) : null;
    if (gst !== null && (isNaN(gst) || gst < 0 || gst > 28)) {
      setErrorDialog({ open: true, message: "GST Rate must be between 0% and 28%." });
      return;
    }
    const profit = edited["profit_percentage"] !== undefined ? Number(edited["profit_percentage"]) : null;
    if (profit !== null && (isNaN(profit) || profit < 0 || profit > 100)) {
      setErrorDialog({ open: true, message: "Profit Margin must be between 0% and 100%." });
      return;
    }
    const transport = edited["transport_percentage"] !== undefined ? Number(edited["transport_percentage"]) : null;
    if (transport !== null && (isNaN(transport) || transport < 0 || transport > 100)) {
      setErrorDialog({ open: true, message: "Transport Charge must be between 0% and 100%." });
      return;
    }
    const getVal = (key) => edited[key] !== undefined ? Number(edited[key]) : Number(getValue(key));
    const high = getVal("stock_threshold_high");
    const low = getVal("stock_threshold_low");
    if (!isNaN(high) && !isNaN(low) && low >= high) {
      setErrorDialog({ open: true, message: "Low Stock Threshold must be less than In Stock Threshold (High)." });
      return;
    }
    const pin = edited["stock_manager_pin"];
    if (pin !== undefined && pin.length > 0 && (pin.length < 4 || pin.length > 8)) {
      setErrorDialog({ open: true, message: "Stock Manager PIN must be between 4 and 8 digits." });
      return;
    }
    const maxUpload = edited["max_upload_size_mb"] !== undefined ? Number(edited["max_upload_size_mb"]) : null;
    if (maxUpload !== null && (isNaN(maxUpload) || maxUpload < 1 || maxUpload > 100)) {
      setErrorDialog({ open: true, message: "Max Upload Size must be between 1 MB and 100 MB." });
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    setSaving(true);
    try {
      await settingsApi.update(edited);
      setEdited({});
      setDrawerOpen(false);
      setSaveSuccess(true);
      fetchSettings();
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to save settings." });
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = Object.keys(edited).length > 0;

  // Group settings by category
  const groups = [
    {
      title: "Company Information",
      icon: Building2,
      keys: ["company_name", "company_phone", "company_email", "company_address"],
    },
    {
      title: "Quotation Settings",
      icon: FileText,
      keys: ["quotation_prefix", "quotation_validity_days", "gst_rate"],
    },
    {
      title: "Quotation Pricing Manager",
      icon: Percent,
      desc: "Formula: Base = Panels + Inverter + (kW × DC Wire) + (kW × AC Wire) + (kW × Structure). Then add Profit %, Transport %, and GST.",
      keys: ["bom_price_per_kw", "labour_price_per_kw", "commission_price_per_kw", "profit_percentage", "transport_percentage", "installation_price_per_kw"],
    },
    {
      title: "Environmental Impact Estimates",
      icon: Percent,
      desc: "Used to display estimated annual yield and CO₂ offset in quotation builder. Adjust for your region's solar irradiance data.",
      keys: ["solar_yield_per_kw", "co2_per_kw"],
    },
    {
      title: "Email / SMTP Configuration",
      icon: Mail,
      keys: ["smtp_from_email", "smtp_from_name"],
    },
    {
      title: "Upload Limits",
      icon: Percent,
      keys: ["max_upload_size_mb"],
    },
    {
      title: "Stock Thresholds",
      icon: Package,
      keys: ["stock_threshold_high", "stock_threshold_low"],
    },
    {
      title: "Security Settings",
      icon: Shield,
      desc: "The Stock Manager PIN protects the stock management section. Staff must enter this PIN before making stock changes. Use a 4–8 digit number.",
      keys: ["stock_manager_pin"],
    },
  ];

  const labelMap = {
    company_name: "Company Name",
    company_phone: "Company Phone",
    company_email: "Company Email",
    company_address: "Company Address",
    quotation_prefix: "Quotation Number Prefix",
    quotation_validity_days: "Quotation Validity (Days)",
    gst_rate: "GST Rate (%)",
    bom_price_per_kw: "DC Wire Cost per kW — ₹ (used as BOM in formula)",
    labour_price_per_kw: "AC Wire Cost per kW — ₹ (used as Labour in formula)",
    commission_price_per_kw: "Mounting Structure Cost per kW — ₹ (used as Commission in formula)",
    profit_percentage: "Profit Margin (%)",
    installation_price_per_kw: "Approx Installation Price per kW — ₹",
    transport_percentage: "Transport Charge (%)",
    smtp_from_email: "Sender Email",
    smtp_from_name: "Sender Name",
    max_upload_size_mb: "Max Upload Size (MB)",
    stock_threshold_high: "In Stock Threshold (above this = In Stock)",
    stock_threshold_low: "Low Stock Threshold (above this = Low, below = Critical)",
    stock_manager_pin: "Stock Manager Security PIN",
    solar_yield_per_kw: "Solar Yield per kW per Year (kWh)",
    co2_per_kw: "CO₂ Offset per kW per Year (Tons)",
  };

  const getModifiedSettings = () => {
    return Object.keys(edited).map(key => {
      const originalItem = data.find(s => s.key === key);
      return {
        key,
        label: labelMap[key] || key,
        oldValue: originalItem ? originalItem.value : "",
        newValue: edited[key],
        isPin: key === "stock_manager_pin",
      };
    });
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
        <div style={{ marginBottom: 8 }}><Loader2 size={32} className="animate-spin" /></div>
        Loading settings...
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (fetchError) {
    return (
      <ErrorState
        title="Failed to load settings."
        message="Could not connect to the server. Please check your connection and try again."
        onRetry={fetchSettings}
      />
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="page-title">Settings</div>
          <div className="page-sub">Manage system configuration and preferences</div>
        </div>
        <button
          className="btn-primary"
          style={{ width: "auto", padding: "10px 24px", opacity: hasChanges ? 1 : 0.5 }}
          disabled={!hasChanges || saving}
          onClick={() => setDrawerOpen(true)}
        >
          <Save size={16} />
          Review &amp; Save
        </button>
      </div>

      {/* Save success banner */}
      {saveSuccess && (
        <div
          className="alert alert-green"
          style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}
        >
          <CheckCircle size={16} style={{ flexShrink: 0 }} />
          <span>Settings saved successfully.</span>
          <button
            onClick={() => setSaveSuccess(false)}
            style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--green)", display: "flex", alignItems: "center" }}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {groups.map(group => {
        const GroupIcon = group.icon;
        const groupSettings = group.keys.filter(k => data.find(s => s.key === k));
        if (groupSettings.length === 0) return null;

        return (
          <div className="card" key={group.title}>
            <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <GroupIcon size={16} />
              {group.title}
            </div>
            {group.desc && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, padding: "8px 12px", background: "rgba(46,125,82,0.05)", borderRadius: 8, borderLeft: "3px solid var(--green)", display: "flex", alignItems: "flex-start", gap: 8 }}>
                <Info size={13} style={{ color: "var(--green)", marginTop: 1, flexShrink: 0 }} />
                <span>{group.desc}</span>
              </div>
            )}
            <div className="form-grid">
              {groupSettings.map(key => {
                const setting = data.find(s => s.key === key);
                const numericKeys = [
                  "gst_rate", "quotation_validity_days", "max_upload_size_mb",
                  "stock_threshold_high", "stock_threshold_low",
                  "bom_price_per_kw", "labour_price_per_kw", "commission_price_per_kw",
                  "profit_percentage", "transport_percentage",
                  "solar_yield_per_kw", "co2_per_kw", "installation_price_per_kw"
                ];
                const isNumeric = numericKeys.includes(key);
                const isPin = key === "stock_manager_pin";

                return (
                  <div className="field" key={key}>
                    <label>{labelMap[key] || key}</label>
                    {isPin ? (
                      // PIN field with show/hide toggle
                      <div className="field-pwd-wrapper">
                        <input
                          type={showPin ? "text" : "password"}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={8}
                          value={getValue(key)}
                          onChange={e => {
                            const val = e.target.value;
                            if (/^\d*$/.test(val)) handleChange(key, val);
                          }}
                          placeholder="4–8 digit PIN"
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          className="pwd-toggle-btn"
                          onClick={() => setShowPin(v => !v)}
                          title={showPin ? "Hide PIN" : "Show PIN"}
                          aria-label={showPin ? "Hide PIN" : "Show PIN"}
                        >
                          {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    ) : (
                      <input
                        type={isNumeric ? "number" : "text"}
                        min={isNumeric ? "0" : undefined}
                        step={["gst_rate", "profit_percentage", "transport_percentage"].includes(key) ? "0.01" : "1"}
                        value={getValue(key)}
                        onChange={e => handleChange(key, e.target.value)}
                        placeholder={setting?.description || ""}
                      />
                    )}
                    {setting?.description && (
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                        {setting.description}
                      </div>
                    )}
                    {edited[key] !== undefined && (
                      <div style={{ fontSize: 11, color: "var(--sun)", marginTop: 3, fontWeight: 500 }}>
                        Modified
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Unsaved changes indicator */}
      {hasChanges && (
        <div className="alert alert-green" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span>You have unsaved changes ({Object.keys(edited).length} field{Object.keys(edited).length !== 1 ? "s" : ""} modified).</span>
          <button className="btn-sm" onClick={() => setEdited({})}>Discard</button>
        </div>
      )}

      {/* Review Changes Drawer */}
      {drawerOpen && (
        <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <div className="drawer-container" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="drawer-title-area">
                <span className="drawer-title">Review Settings Changes</span>
                <span className="drawer-subtitle">Confirm system adjustments before saving</span>
              </div>
              <button className="close-btn" style={{ padding: 4, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDrawerOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="drawer-content">
              <div style={{ marginBottom: 16, fontSize: 13, color: "var(--muted)" }}>
                The following system settings will be permanently updated:
              </div>
              {getModifiedSettings().map(item => (
                <div className="change-card" key={item.key}>
                  <div className="change-item-info">
                    <span className="change-item-cat">Setting</span>
                    <span className="change-item-name">{item.label}</span>
                  </div>
                  <div className="change-values">
                    <span className="change-val-old" style={{ maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {/* Mask PIN values in the review drawer */}
                      {item.isPin ? "●".repeat(Math.min(item.oldValue?.length || 4, 8)) : (item.oldValue || "(empty)")}
                    </span>
                    <span style={{ color: "var(--muted)" }}><ChevronRight size={14} /></span>
                    <span className="change-val-new" style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.isPin ? "●".repeat(Math.min(item.newValue?.length || 4, 8)) : (item.newValue || "(empty)")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="drawer-footer">
              <button className="btn-sm" style={{ padding: "12px", border: "1.5px solid var(--border)", background: "transparent", fontWeight: 600 }} onClick={() => setDrawerOpen(false)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? (
                  <><Loader2 size={16} className="animate-spin" /> Saving...</>
                ) : (
                  <><Save size={16} /> Confirm &amp; Save</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={errorDialog.open}
        title="Save Failed"
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
