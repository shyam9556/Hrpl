import { useState, useEffect, useCallback } from "react";
import { prices as pricesApi } from "../utils/api";
import { Loader2, Plus, Trash2, Save, Check, AlertTriangle, Info, X } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import ErrorState from "./ErrorState";

export default function PriceManager() {
  const [panels, setPanels] = useState([]);
  const [inverters, setInverters] = useState([]);
  const [accessories, setAccessories] = useState([]);
  const [kits, setKits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorDialog, setErrorDialog] = useState({ open: false, message: "" });
  const [fetchError, setFetchError] = useState(false);
  const [accessorySaved, setAccessorySaved] = useState(false);
  const [savedRowId, setSavedRowId] = useState(null); // flashes green on recently saved row
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { type: 'panel'|'inverter'|'kit', id, name }

  // Add Product Form Toggles
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [showAddInv, setShowAddInv] = useState(false);
  const [showAddKit, setShowAddKit] = useState(false);

  // New Kit Form State
  const [newKit, setNewKit] = useState({ brand: "", type: "Bifacial", watt: "", panels: "", kw: "", inv_brand: "", inv_kw: "", price: "" });
  const [addingKit, setAddingKit] = useState(false);

  // Form State for Additions
  const [newPanel, setNewPanel] = useState({ brand: "", watt: "", type: "Mono PERC", pricePerPanel: "" });
  const [newInv, setNewInv] = useState({ brand: "", kw: "", type: "Single Phase (Single MPPT)", pricePerUnit: "" });

  // Form State for Editing
  const [editingPanelId, setEditingPanelId] = useState(null);
  const [editingPanel, setEditingPanel] = useState({ brand: "", watt: "", type: "", pricePerPanel: "" });

  const [editingInverterId, setEditingInverterId] = useState(null);
  const [editingInverter, setEditingInverter] = useState({ brand: "", kw: "", type: "", pricePerUnit: "" });

  // Kit Price Editing State
  const [editingKitId, setEditingKitId] = useState(null);
  const [editingKitPrice, setEditingKitPrice] = useState("");

  const fetchPrices = useCallback(async () => {
    setFetchError(false);
    setLoading(true);
    try {
      const res = await pricesApi.getAll();
      setPanels(res.panels || []);
      setInverters(res.inverters || []);
      setAccessories(res.accessories || []);
      setKits(res.kits || []);
    } catch (err) {
      console.error("Fetch prices error:", err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPrices(); }, [fetchPrices]);

  // ── SSE: Refresh when any price is added/updated/deleted ────────────────────
  // Ensures PriceManager always shows the latest catalog even when a second
  // admin session makes changes concurrently.
  useEffect(() => {
    const handler = () => fetchPrices();
    window.addEventListener("hp:sse:prices:changed", handler);
    return () => window.removeEventListener("hp:sse:prices:changed", handler);
  }, [fetchPrices]);


  const handleAddPanel = async () => {
    const missing = [];
    if (!newPanel.brand.trim()) missing.push("Brand");
    if (!newPanel.watt) missing.push("Watt");
    if (!newPanel.pricePerPanel) missing.push("Price");
    if (missing.length > 0) {
      setErrorDialog({ open: true, message: `Please fill in: ${missing.join(", ")}.` });
      return;
    }
    try {
      await pricesApi.addPanel({
        brand: newPanel.brand,
        watt: String(newPanel.watt),
        type: newPanel.type,
        pricePerPanel: parseFloat(newPanel.pricePerPanel),
      });
      setNewPanel({ brand: "", watt: "", type: "Mono PERC", pricePerPanel: "" });
      setShowAddPanel(false);
      fetchPrices();
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to add panel." });
    }
  };

  const handleAddInv = async () => {
    const missing = [];
    if (!newInv.brand.trim()) missing.push("Brand");
    if (!newInv.kw) missing.push("Capacity (kW)");
    if (!newInv.pricePerUnit) missing.push("Price");
    if (missing.length > 0) {
      setErrorDialog({ open: true, message: `Please fill in: ${missing.join(", ")}.` });
      return;
    }
    try {
      await pricesApi.addInverter({
        brand: newInv.brand,
        kw: parseFloat(newInv.kw),
        type: newInv.type,
        pricePerUnit: parseFloat(newInv.pricePerUnit),
      });
      setNewInv({ brand: "", kw: "", type: "Single Phase (Single MPPT)", pricePerUnit: "" });
      setShowAddInv(false);
      fetchPrices();
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to add inverter." });
    }
  };

  const handleSavePanel = async (id) => {
    const missing = [];
    if (!editingPanel.brand.trim()) missing.push("Brand");
    if (!editingPanel.watt) missing.push("Watt");
    if (!editingPanel.pricePerPanel) missing.push("Price");
    if (missing.length > 0) {
      setErrorDialog({ open: true, message: `Please fill in: ${missing.join(", ")}.` });
      return;
    }
    try {
      await pricesApi.updatePanel(id, {
        brand: editingPanel.brand,
        watt: String(editingPanel.watt),
        type: editingPanel.type,
        pricePerPanel: parseFloat(editingPanel.pricePerPanel),
      });
      setEditingPanelId(null);
      setSavedRowId(`panel-${id}`);
      setTimeout(() => setSavedRowId(null), 2000);
      fetchPrices();
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to update panel." });
    }
  };

  const handleSaveInverter = async (id) => {
    const missing = [];
    if (!editingInverter.brand.trim()) missing.push("Brand");
    if (!editingInverter.kw) missing.push("Capacity (kW)");
    if (!editingInverter.pricePerUnit) missing.push("Price");
    if (missing.length > 0) {
      setErrorDialog({ open: true, message: `Please fill in: ${missing.join(", ")}.` });
      return;
    }
    try {
      await pricesApi.updateInverter(id, {
        brand: editingInverter.brand,
        kw: parseFloat(editingInverter.kw),
        type: editingInverter.type,
        pricePerUnit: parseFloat(editingInverter.pricePerUnit),
      });
      setEditingInverterId(null);
      setSavedRowId(`inverter-${id}`);
      setTimeout(() => setSavedRowId(null), 2000);
      fetchPrices();
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to update inverter." });
    }
  };

  const handleSaveKitPrice = async (id) => {
    const parsedPrice = parseFloat(editingKitPrice);
    if (!editingKitPrice || isNaN(parsedPrice) || parsedPrice <= 0) {
      setErrorDialog({ open: true, message: "Please enter a valid kit price greater than zero." });
      return;
    }
    try {
      await pricesApi.updateKit(id, parsedPrice);
      setEditingKitId(null);
      setSavedRowId(`kit-${id}`);
      setTimeout(() => setSavedRowId(null), 2000);
      fetchPrices();
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to update kit price." });
    }
  };

  const handleAddKit = async () => {
    const { brand, type, watt, panels, kw, inv_brand, inv_kw, price } = newKit;
    if (!brand || !type || !watt || !panels || !kw || !inv_brand || !inv_kw || !price) {
      setErrorDialog({ open: true, message: "Please fill in all kit fields." });
      return;
    }
    setAddingKit(true);
    try {
      await pricesApi.createKit({
        brand: brand.trim(),
        type: type.trim(),
        watt: String(watt).trim(),
        panels: parseInt(panels, 10),
        kw: parseFloat(kw),
        inv_brand: inv_brand.trim(),
        inv_kw: parseFloat(inv_kw),
        price: parseFloat(price),
      });
      setNewKit({ brand: "", type: "Bifacial", watt: "", panels: "", kw: "", inv_brand: "", inv_kw: "", price: "" });
      setShowAddKit(false);
      fetchPrices();
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to add kit." });
    } finally {
      setAddingKit(false);
    }
  };

  const handleDeleteKit = async (id) => {
    try {
      await pricesApi.deleteKit(id);
      fetchPrices();
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to delete kit." });
    }
  };

  const handleDeletePanel = async (id) => {
    try {
      await pricesApi.deletePanel(id);
      fetchPrices();
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to delete panel." });
    }
  };

  const handleDeleteInv = async (id) => {
    try {
      await pricesApi.deleteInverter(id);
      fetchPrices();
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to delete inverter." });
    }
  };

  const saveAccessoryPrices = async () => {
    setSaving(true);
    try {
      const updates = accessories.map(a => ({ id: a.id, price: parseFloat(a.price) }));
      await pricesApi.updateAccessories(updates);
      setSaving(false);
      setAccessorySaved(true);
      setTimeout(() => setAccessorySaved(false), 2500);
    } catch (err) {
      setErrorDialog({ open: true, message: err.message || "Failed to update accessory prices." });
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
        <div style={{ marginBottom: 8 }}><Loader2 size={32} className="animate-spin" /></div>Loading prices...
      </div>
    );
  }

  if (fetchError) {
    return (
      <ErrorState
        title="Failed to load prices."
        message="Could not connect to the server. Please check your connection and try again."
        onRetry={fetchPrices}
      />
    );
  }

  return (
    <div>
      <div
        className="page-header"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
      >
        <div>
          <div className="page-title">Price Manager</div>
          <div className="page-sub">Edit prices — quotations update instantly</div>
        </div>
      </div>

      {/* ── Panels ── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: 8 }}>
          <div className="card-title" style={{ margin: 0 }}>Solar Panels</div>
          <button className="btn-sm primary" onClick={() => setShowAddPanel(!showAddPanel)}>
            {showAddPanel ? "Cancel" : "+ Add Panel"}
          </button>
        </div>

        {showAddPanel && (
          <div style={{
            background: "var(--green-light)", border: "1.5px solid var(--green)",
            borderRadius: "12px", padding: "1.25rem", marginBottom: "1.5rem"
          }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: "var(--green)" }}>
              <Plus size={14} /> Configure & Add New Solar Panel
            </div>
            <div className="form-grid-3" style={{ gap: 12 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 10 }}>Brand Name</label>
                <input placeholder="e.g. Adani, Waaree" value={newPanel.brand} onChange={e => setNewPanel({ ...newPanel, brand: e.target.value })} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 10 }}>Capacity (Watts)</label>
                <input type="text" placeholder="e.g. 540-555" value={newPanel.watt} onChange={e => setNewPanel({ ...newPanel, watt: e.target.value })} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 10 }}>Panel Type</label>
                <select value={newPanel.type} onChange={e => setNewPanel({ ...newPanel, type: e.target.value })}>
                  <option value="Mono PERC">Mono PERC</option>
                  <option value="Bifacial">Bifacial</option>
                  <option value="TOPCon">TOPCon</option>
                  <option value="Polycrystalline">Polycrystalline</option>
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 10 }}>Price per Panel (₹)</label>
                <input type="number" placeholder="e.g. 12000" value={newPanel.pricePerPanel} onChange={e => setNewPanel({ ...newPanel, pricePerPanel: e.target.value })} />
              </div>
              <div className="span-full" style={{ display: "flex", alignItems: "flex-end" }}>
                <button className="btn-primary" style={{ height: 42, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={handleAddPanel}>
                  <span><Plus size={14} /></span> Add to Product List
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="table-scroll-wrap">
        <table style={{ minWidth: "500px" }}>
          <thead>
            <tr>
              <th>Brand</th>
              <th>Watt</th>
              <th>Type</th>
              <th>Price / Panel (₹)</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {panels.map(p => {
              const isEditing = editingPanelId === p.id;
              const isSaved = savedRowId === `panel-${p.id}`;
              return (
                <tr key={p.id} style={isSaved ? { background: "rgba(34,197,94,0.07)", transition: "background 0.3s" } : {}}>
                  <td>
                    {isEditing ? (
                      <input
                        className="input-inline"
                        value={editingPanel.brand}
                        onChange={e => setEditingPanel({ ...editingPanel, brand: e.target.value })}
                        style={{ width: "100%", padding: "4px 8px" }}
                      />
                    ) : (
                      <span style={{ fontWeight: 600 }}>{p.brand}</span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        type="text"
                        className="input-inline"
                        value={editingPanel.watt}
                        onChange={e => setEditingPanel({ ...editingPanel, watt: e.target.value })}
                        style={{ width: 80, padding: "4px 8px" }}
                      />
                    ) : (
                      `${p.watt}W`
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <select
                        className="input-inline"
                        value={editingPanel.type}
                        onChange={e => setEditingPanel({ ...editingPanel, type: e.target.value })}
                        style={{ width: 130, padding: "4px 8px" }}
                      >
                        <option value="Mono PERC">Mono PERC</option>
                        <option value="Bifacial">Bifacial</option>
                        <option value="TOPCon">TOPCon</option>
                        <option value="Polycrystalline">Polycrystalline</option>
                      </select>
                    ) : (
                      <span className="badge badge-gray">{p.type}</span>
                    )}
                  </td>
                  <td style={{ fontFamily: "var(--mono)", fontWeight: 500 }}>
                    {isEditing ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span>₹</span>
                        <input
                          type="number"
                          className="input-inline"
                          value={editingPanel.pricePerPanel}
                          onChange={e => setEditingPanel({ ...editingPanel, pricePerPanel: e.target.value })}
                          style={{ width: 100, padding: "4px 8px" }}
                        />
                      </div>
                    ) : (
                      `₹${Number(p.price_per_panel).toLocaleString("en-IN")}`
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {isEditing ? (
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <button
                          className="btn-sm"
                          style={{ background: "var(--green)", color: "white", borderColor: "var(--green)", padding: "4px 10px", display: "flex", alignItems: "center", gap: 3 }}
                          onClick={() => handleSavePanel(p.id)}
                        >
                          <Save size={12} /> Save
                        </button>
                        <button
                          className="btn-sm"
                          style={{ padding: "4px 10px" }}
                          onClick={() => setEditingPanelId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <button
                          className="btn-sm"
                          style={{ padding: "4px 10px", borderColor: "var(--primary, #3b82f6)", color: "var(--primary, #3b82f6)" }}
                          onClick={() => {
                            setEditingPanelId(p.id);
                            setEditingPanel({ brand: p.brand, watt: p.watt, type: p.type, pricePerPanel: p.price_per_panel });
                          }}
                        >
                          Edit
                        </button>
                        <button className="btn-sm danger" style={{ padding: "4px 10px" }} onClick={() => setDeleteConfirm({ type: "panel", id: p.id, name: `${p.brand} ${p.watt}W` })} title="Remove from catalog">
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* ── Inverters ── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: 8 }}>
          <div className="card-title" style={{ margin: 0 }}>Inverters</div>
          <button className="btn-sm primary" onClick={() => setShowAddInv(!showAddInv)}>
            {showAddInv ? "Cancel" : "+ Add Inverter"}
          </button>
        </div>

        {showAddInv && (
          <div style={{
            background: "var(--green-light)", border: "1.5px solid var(--green)",
            borderRadius: "12px", padding: "1.25rem", marginBottom: "1.5rem"
          }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: "var(--green)" }}>
              <Plus size={14} /> Configure & Add New Inverter
            </div>
            <div className="form-grid-3" style={{ gap: 12 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 10 }}>Brand Name</label>
                <input placeholder="e.g. Growatt, Solis" value={newInv.brand} onChange={e => setNewInv({ ...newInv, brand: e.target.value })} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 10 }}>Capacity (kW)</label>
                <input type="number" placeholder="e.g. 5" value={newInv.kw} onChange={e => setNewInv({ ...newInv, kw: e.target.value })} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 10 }}>Inverter Type</label>
                <select value={newInv.type} onChange={e => setNewInv({ ...newInv, type: e.target.value })}>
                  <option value="Single Phase (Single MPPT)">Single Phase (Single MPPT)</option>
                  <option value="Single Phase (Dual MPPT)">Single Phase (Dual MPPT)</option>
                  <option value="Three Phase">Three Phase</option>
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 10 }}>Price per Unit (₹)</label>
                <input type="number" placeholder="e.g. 24000" value={newInv.pricePerUnit} onChange={e => setNewInv({ ...newInv, pricePerUnit: e.target.value })} />
              </div>
              <div className="span-full" style={{ display: "flex", alignItems: "flex-end" }}>
                <button className="btn-primary" style={{ height: 42, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={handleAddInv}>
                  <span><Plus size={14} /></span> Add to Inverter List
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="table-scroll-wrap">
        <table style={{ minWidth: "500px" }}>
          <thead>
            <tr>
              <th>Brand</th>
              <th>kW</th>
              <th>Type</th>
              <th>Price / Unit (₹)</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {inverters.map(i => {
              const isEditing = editingInverterId === i.id;
              const isSaved = savedRowId === `inverter-${i.id}`;
              return (
                <tr key={i.id} style={isSaved ? { background: "rgba(34,197,94,0.07)", transition: "background 0.3s" } : {}}>
                  <td>
                    {isEditing ? (
                      <input
                        className="input-inline"
                        value={editingInverter.brand}
                        onChange={e => setEditingInverter({ ...editingInverter, brand: e.target.value })}
                        style={{ width: "100%", padding: "4px 8px" }}
                      />
                    ) : (
                      <span style={{ fontWeight: 600 }}>{i.brand}</span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        type="number"
                        className="input-inline"
                        value={editingInverter.kw}
                        onChange={e => setEditingInverter({ ...editingInverter, kw: e.target.value })}
                        style={{ width: 80, padding: "4px 8px" }}
                      />
                    ) : (
                      `${Number(i.kw)} kW`
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <select
                        className="input-inline"
                        value={editingInverter.type}
                        onChange={e => setEditingInverter({ ...editingInverter, type: e.target.value })}
                        style={{ width: 130, padding: "4px 8px" }}
                      >
                        <option value="Single Phase (Single MPPT)">Single Phase (Single MPPT)</option>
                        <option value="Single Phase (Dual MPPT)">Single Phase (Dual MPPT)</option>
                        <option value="Three Phase">Three Phase</option>
                      </select>
                    ) : (
                      <span className="badge badge-gray">{i.type}</span>
                    )}
                  </td>
                  <td style={{ fontFamily: "var(--mono)", fontWeight: 500 }}>
                    {isEditing ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span>₹</span>
                        <input
                          type="number"
                          className="input-inline"
                          value={editingInverter.pricePerUnit}
                          onChange={e => setEditingInverter({ ...editingInverter, pricePerUnit: e.target.value })}
                          style={{ width: 100, padding: "4px 8px" }}
                        />
                      </div>
                    ) : (
                      `₹${Number(i.price_per_unit).toLocaleString("en-IN")}`
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {isEditing ? (
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <button
                          className="btn-sm"
                          style={{ background: "var(--green)", color: "white", borderColor: "var(--green)", padding: "4px 10px", display: "flex", alignItems: "center", gap: 3 }}
                          onClick={() => handleSaveInverter(i.id)}
                        >
                          <Save size={12} /> Save
                        </button>
                        <button
                          className="btn-sm"
                          style={{ padding: "4px 10px" }}
                          onClick={() => setEditingInverterId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <button
                          className="btn-sm"
                          style={{ padding: "4px 10px", borderColor: "var(--primary, #3b82f6)", color: "var(--primary, #3b82f6)" }}
                          onClick={() => {
                            setEditingInverterId(i.id);
                            setEditingInverter({ brand: i.brand, kw: i.kw, type: i.type, pricePerUnit: i.price_per_unit });
                          }}
                        >
                          Edit
                        </button>
                        <button className="btn-sm danger" style={{ padding: "4px 10px" }} onClick={() => setDeleteConfirm({ type: "inverter", id: i.id, name: `${i.brand} ${i.kw}kW` })} title="Remove from catalog">
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* ── Accessories ── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: 8 }}>
          <div className="card-title" style={{ margin: 0 }}>Accessories & Labour</div>
          <button className="btn-primary" style={{ width: "auto", padding: "8px 20px" }} onClick={saveAccessoryPrices} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : accessorySaved ? <><Check size={14} /> Saved!</> : <><Save size={14} /> Save Accessory Prices</>}
          </button>
        </div>
        {/* ISSUE-07: Accessories are used for stock tracking and BOM display only.
            They do NOT directly affect quotation pricing calculations.
            Quotation pricing is driven by the Pricing Settings (DC Wire, AC Wire, Structure costs per kW). */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.18)", borderRadius: 10, marginBottom: "1rem" }}>
          <Info size={15} style={{ color: "#3b82f6", flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 12, color: "var(--text)", lineHeight: 1.6 }}>
            <strong>Stock Tracking Only.</strong> Accessory prices here update stock valuations and material costs in the Stock Manager. They do <em>not</em> affect the quotation price shown to customers — quotation pricing is controlled by the <strong>Settings &rsaquo; Pricing</strong> parameters (DC Wire Cost, AC Wire Cost, Structure Cost per kW).
          </p>
        </div>
        <div className="table-scroll-wrap">
        <table style={{ minWidth: "360px" }}>
          <thead>
            <tr>
              <th>Item</th>
              <th>Price (₹)</th>
              <th>Unit</th>
            </tr>
          </thead>
          <tbody>
            {accessories.map(a => (
              <tr key={a.id}>
                <td style={{ fontWeight: 500 }}>{a.display_name}</td>
                <td>
                  <input
                    className="input-inline"
                    type="number"
                    value={a.price}
                    onChange={e => {
                      setAccessories(prev => prev.map(acc =>
                        acc.id === a.id ? { ...acc, price: e.target.value } : acc
                      ));
                    }}
                  />
                </td>
                <td style={{ color: "var(--muted)" }}>{a.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* ── Pre-packaged Kits ── */}
      {/* ── Pre-packaged Kits ── */}
      <div style={{ width: "100%", marginBottom: "2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div className="page-title" style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Pre-packaged Kit Prices</div>
            <div className="page-sub" style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px" }}>
              Standard kit pricing catalogs for quotation generation
            </div>
          </div>
          <button
            className="btn-sm primary"
            style={{ padding: "6px 14px", display: "flex", alignItems: "center", gap: 5, fontSize: 12, minHeight: 32 }}
            onClick={() => setShowAddKit(v => !v)}
          >
            {showAddKit ? <><X size={13} /> Cancel</> : <><Plus size={13} /> Add Kit</>}
          </button>
        </div>

        {/* Add Kit Form */}
        {showAddKit && (
          <div style={{ background: "var(--bg, #f8fafc)", border: "1.5px solid var(--green)", borderRadius: 12, padding: "16px", marginBottom: "1.5rem" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--green)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <Plus size={14} /> New Kit Configuration
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px", marginBottom: 12 }}>
              <div className="field" style={{ margin: 0 }}>
                <label style={{ fontSize: 10 }}>Panel Brand</label>
                <input placeholder="Adani" value={newKit.brand} onChange={e => setNewKit(p => ({ ...p, brand: e.target.value }))} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label style={{ fontSize: 10 }}>Panel Type</label>
                <select value={newKit.type} onChange={e => setNewKit(p => ({ ...p, type: e.target.value }))}>
                  <option>Bifacial</option>
                  <option>TOPCon</option>
                  <option>Mono PERC</option>
                  <option>Polycrystalline</option>
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label style={{ fontSize: 10 }}>Panel Watt</label>
                <input placeholder="555" value={newKit.watt} onChange={e => setNewKit(p => ({ ...p, watt: e.target.value }))} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label style={{ fontSize: 10 }}>No. of Panels</label>
                <input type="number" placeholder="4" value={newKit.panels} onChange={e => setNewKit(p => ({ ...p, panels: e.target.value }))} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label style={{ fontSize: 10 }}>System kW</label>
                <input type="number" step="0.01" placeholder="2.22" value={newKit.kw} onChange={e => setNewKit(p => ({ ...p, kw: e.target.value }))} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label style={{ fontSize: 10 }}>Inverter Brand</label>
                <input placeholder="Vsole" value={newKit.inv_brand} onChange={e => setNewKit(p => ({ ...p, inv_brand: e.target.value }))} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label style={{ fontSize: 10 }}>Inverter kW</label>
                <input type="number" step="0.1" placeholder="3" value={newKit.inv_kw} onChange={e => setNewKit(p => ({ ...p, inv_kw: e.target.value }))} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label style={{ fontSize: 10 }}>Kit Price (Rs.)</label>
                <input type="number" placeholder="95000" value={newKit.price} onChange={e => setNewKit(p => ({ ...p, price: e.target.value }))} />
              </div>
            </div>
            <button
              className="btn-primary"
              style={{ width: "auto", padding: "8px 20px", fontSize: 13 }}
              onClick={handleAddKit}
              disabled={addingKit}
            >
              {addingKit ? <><Loader2 size={13} className="animate-spin" /> Adding...</> : <><Plus size={13} /> Add Kit</>}
            </button>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%" }}>
        {/* GAP-05 fix: derive brands dynamically from DB data — any new kit brand
            added to kit_prices will appear automatically without code changes. */}
        {(() => {
          const brandOrder = ["Adani", "Waaree", "Rayzon"];
          const sortedBrands = [...new Set(kits.map(k => k.brand))].sort((a, b) => {
            const indexA = brandOrder.indexOf(a);
            const indexB = brandOrder.indexOf(b);
            const valA = indexA === -1 ? 99 : indexA;
            const valB = indexB === -1 ? 99 : indexB;
            return valA - valB;
          });
          
          return sortedBrands.map(brand => {
            const brandColor = brand === "Adani" ? "#ea580c" : brand === "Waaree" ? "#047857" : "#0284c7";
            const brandBgLight = brand === "Adani" ? "rgba(234,88,12,0.06)" : brand === "Waaree" ? "rgba(4,120,87,0.06)" : "rgba(2,132,199,0.06)";
            const brandBorderColor = brand === "Adani" ? "rgba(234,88,12,0.2)" : brand === "Waaree" ? "rgba(4,120,87,0.2)" : "rgba(2,132,199,0.2)";
            const brandKitsCount = kits.filter(k => k.brand === brand).length;

            return (
              <div 
                key={brand} 
                className="card"
                style={{ 
                  display: "flex", 
                  flexDirection: "column", 
                  gap: "20px", 
                  padding: "1.5rem", 
                  borderLeft: `6px solid ${brandColor}`,
                  boxShadow: "0 4px 20px rgba(0,0,0,0.02)",
                  margin: 0
                }}
              >
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom: "2px solid var(--border)",
                  paddingBottom: "10px",
                }}>
                  <div style={{
                    fontWeight: 800,
                    fontSize: 16,
                    color: brandColor,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    display: "flex",
                    alignItems: "center",
                    gap: 8
                  }}>
                    {brand} Solar Kits
                  </div>
                  <span style={{ 
                    fontSize: 11, 
                    fontWeight: 700, 
                    color: brandColor, 
                    background: brandBgLight, 
                    border: `1px solid ${brandBorderColor}`, 
                    padding: "3px 10px", 
                    borderRadius: "12px" 
                  }}>
                    {brandKitsCount} Configurations
                  </span>
                </div>

                {["Bifacial", "TOPCon"].map(type => {
                  const groupKits = kits.filter(k => k.brand === brand && k.type === type);
                  if (groupKits.length === 0) return null;
                  return (
                    <div key={type} style={{ background: "#FAFAF9", padding: "16px", borderRadius: "12px", border: "1px solid var(--border)" }}>
                      <div style={{ 
                        fontWeight: 700, 
                        fontSize: 13, 
                        color: "var(--text)", 
                        marginBottom: "12px", 
                        borderBottom: "1px dashed var(--border)", 
                        paddingBottom: "8px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}>
                        <span>{type} Panel Range</span>
                        <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>
                          Rating: {groupKits[0].watt}W
                        </span>
                      </div>
                      
                      <div className="table-scroll-wrap" style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                      <table style={{ margin: 0, width: "100%", fontSize: "12px" }}>
                        <thead>
                          <tr style={{ background: "#F1F5F9" }}>
                            <th style={{ padding: "10px 14px", fontWeight: 700 }}>System kW</th>
                            <th style={{ padding: "10px 14px", fontWeight: 700 }}>Panels Count</th>
                            <th style={{ padding: "10px 14px", fontWeight: 700 }}>Inverter Specs</th>
                            <th style={{ padding: "10px 14px", fontWeight: 700 }}>Kit Price (Rs.)</th>
                            <th style={{ padding: "10px 14px", fontWeight: 700, textAlign: "right" }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupKits.map(k => {
                            const isEditing = editingKitId === k.id;
                            const isSaved = savedRowId === `kit-${k.id}`;
                            return (
                              <tr 
                                key={k.id} 
                                style={{ 
                                  transition: "background 0.2s",
                                  backgroundColor: isSaved ? "rgba(34,197,94,0.07)" : "white"
                                }}
                              >
                                <td style={{ padding: "10px 14px", fontWeight: 700, color: "var(--text)" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <span style={{ fontSize: 13 }}>{Number(k.kw).toFixed(2)}</span>
                                    <span style={{ fontSize: 10, fontWeight: 500, color: "var(--muted)" }}>kW</span>
                                  </div>
                                </td>
                                <td style={{ padding: "10px 14px" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                    <span style={{ fontWeight: 600 }}>{k.panels}</span>
                                    <span style={{ fontSize: 11, color: "var(--muted)" }}>modules</span>
                                  </div>
                                </td>
                                <td style={{ padding: "10px 14px" }}>
                                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(0,0,0,0.03)", padding: "2px 8px", borderRadius: "6px" }}>
                                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--muted)", letterSpacing: "0.5px" }}>{k.inv_brand}</span>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{Number(k.inv_kw)} kW</span>
                                  </div>
                                </td>
                                <td style={{ padding: "10px 14px" }}>
                                  {isEditing ? (
                                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>₹</span>
                                      <input
                                        type="number"
                                        className="input-inline"
                                        value={editingKitPrice}
                                        onChange={e => setEditingKitPrice(e.target.value)}
                                        style={{ width: "95px", padding: "4px 8px" }}
                                        autoFocus
                                      />
                                    </div>
                                  ) : (
                                    <span style={{ fontFamily: "var(--mono)", fontWeight: 700, color: "var(--green)", fontSize: "13px" }}>
                                      ₹{Number(k.price).toLocaleString("en-IN")}
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: "10px 14px", textAlign: "right" }}>
                                  {isEditing ? (
                                    <div style={{ display: "inline-flex", gap: "6px" }}>
                                      <button
                                        className="btn-sm"
                                        style={{ background: "var(--green)", color: "white", borderColor: "var(--green)", padding: "2px 8px", fontSize: "10px", minHeight: "24px" }}
                                        onClick={() => handleSaveKitPrice(k.id)}
                                      >
                                        Save
                                      </button>
                                      <button
                                        className="btn-sm"
                                        style={{ padding: "2px 8px", fontSize: "10px", minHeight: "24px" }}
                                        onClick={() => setEditingKitId(null)}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <div style={{ display: "inline-flex", gap: 6 }}>
                                      <button
                                        className="btn-sm"
                                        style={{ padding: "2px 8px", fontSize: "10px", minHeight: "24px", borderColor: brandColor, color: brandColor }}
                                        onClick={() => {
                                          setEditingKitId(k.id);
                                          setEditingKitPrice(k.price);
                                        }}
                                      >
                                        Edit Price
                                      </button>
                                      <button
                                        className="btn-sm danger"
                                        style={{ padding: "2px 6px", fontSize: "10px", minHeight: "24px" }}
                                        onClick={() => setDeleteConfirm({ type: "kit", id: k.id, name: `${k.brand} ${k.type} ${Number(k.kw).toFixed(2)}kW` })}
                                        title="Delete Kit"
                                      >
                                        <Trash2 size={11} />
                                      </button>
                                    </div>
                                  )}
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
              </div>
            );
          });
        })()}
        </div>
      </div>
      <ConfirmDialog
        open={!!deleteConfirm}
        title={`Remove ${deleteConfirm?.type ? deleteConfirm.type.charAt(0).toUpperCase() + deleteConfirm.type.slice(1) : "Item"}?`}
        message={`Are you sure you want to remove "${deleteConfirm?.name || "this item"}" from the catalog? Quotations already created will keep their data, but it won't be available for new orders. This cannot be undone.`}
        variant="danger"
        confirmText="Yes, Remove"
        onConfirm={() => {
          const { type, id } = deleteConfirm;
          setDeleteConfirm(null);
          if (type === "panel") handleDeletePanel(id);
          else if (type === "inverter") handleDeleteInv(id);
          else if (type === "kit") handleDeleteKit(id);
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
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
