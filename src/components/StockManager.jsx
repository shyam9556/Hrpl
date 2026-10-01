import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Loader2, Save, X, Sun, Zap, Package, Layers, Info,
  AlertCircle, FileSpreadsheet, LockKeyhole, Trash2, ArrowRight,
  Plus, Minus, RefreshCw, BarChart2, Link2,
  Delete, Coins, TrendingUp
} from 'lucide-react';
import { stock, settings } from '../utils/api';
import ConfirmDialog from './ConfirmDialog';
import StockLedger from './StockLedger';
import DailyStockLogs from './DailyStockLogs';

// ── Reason presets ───────────────────────────────────────────
const ADD_REASONS = ['Received from supplier', 'Returned from installation site', 'Manual stock correction', 'Other'];
const DEDUCT_REASONS = ['Installed at customer site', 'Damaged / Write-off', 'Returned to supplier', 'Manual stock correction', 'Other'];

// ── Category config (keyed by DB value) ──────────────────────
const categoryConfig = {
  Panel:                 { bg: 'rgba(245,166,35,0.06)',   color: '#f5a623', icon: Sun,    label: 'Solar Panels' },
  Inverter:              { bg: 'rgba(37,99,235,0.06)',    color: '#2563eb', icon: Zap,    label: 'Inverters' },
  'Structure Material':  { bg: 'rgba(120,113,108,0.06)', color: '#78716c', icon: Layers, label: 'Structure Material' },
  'Electrical Material': { bg: 'rgba(234,179,8,0.06)',   color: '#ca8a04', icon: Zap,    label: 'Electrical Material' },
};

// ── Display groups — controls what sections appear on screen ──
// Panel and Inverter share one section even though they are
// stored as separate categories in the database.
const DISPLAY_GROUPS = [
  {
    key: 'panel-inverter',
    label: 'PANEL AND INVERTER',
    icon: Sun,
    color: '#f5a623',
    bg: 'rgba(245,166,35,0.06)',
    categories: ['Panel', 'Inverter'],
  },
  {
    key: 'structure',
    label: 'STRUCTURE MATERIAL',
    icon: Layers,
    color: '#78716c',
    bg: 'rgba(120,113,108,0.06)',
    categories: ['Structure Material'],
  },
  {
    key: 'electrical',
    label: 'ELECTRICAL MATERIAL',
    icon: Zap,
    color: '#ca8a04',
    bg: 'rgba(234,179,8,0.06)',
    categories: ['Electrical Material'],
  },
];

// ── Currency helper ──────────────────────────────────────────
const fmtCurrency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

export default function StockManager() {
  // ── State ────────────────────────────────────────────────
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [staged, setStaged] = useState({}); // { [itemId]: { addQty, deductQty, unitPrice } }
  const [stagedReasons, setStagedReasons] = useState({}); // { [itemId]: { reasonCategory, reasonNote } }
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [errorDialog, setErrorDialog] = useState({ open: false, message: null });
  const [infoDialog, setInfoDialog] = useState({ open: false, title: '', message: null });
  const [thresholds, setThresholds] = useState({ high: 20, low: 5 });
  const [pin, setPin] = useState('1234');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [enteredPin, setEnteredPin] = useState('');
  const [shake, setShake] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [activeTab, setActiveTab] = useState('live');
  const [qtyModal, setQtyModal] = useState({ open: false, itemId: null, action: null, qty: '' });
  const [tabSwitchDialog, setTabSwitchDialog] = useState({ open: false, targetTab: null });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, itemId: null, itemName: '', category: '' });
  const [addItemModal, setAddItemModal] = useState({ open: false, category: 'Structure Material', itemName: '', quantity: 0, unit: 'pcs', saving: false });

  // ── fetchStock ───────────────────────────────────────────
  const fetchStock = useCallback(async () => {
    try {
      setFetchError(false);
      const res = await stock.getAll();
      setItems(res.stock || []);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStock(); }, [fetchStock]);

  // ── Load thresholds & PIN from settings ──────────────────
  useEffect(() => {
    settings.getAll().then(s => {
      if (s?.settings) {
        const sMap = {};
        s.settings.forEach(row => { sMap[row.key] = row.value; });
        if (sMap.stock_threshold_high) setThresholds(prev => ({ ...prev, high: parseInt(sMap.stock_threshold_high) }));
        if (sMap.stock_threshold_low)  setThresholds(prev => ({ ...prev, low:  parseInt(sMap.stock_threshold_low) }));
        if (sMap.stock_pin) setPin(sMap.stock_pin);
      }
    }).catch(() => {});
  }, []);

  // ── SSE listener ─────────────────────────────────────────
  useEffect(() => {
    const handler = () => fetchStock();
    window.addEventListener('hp:sse:stock:changed', handler);
    return () => window.removeEventListener('hp:sse:stock:changed', handler);
  }, [fetchStock]);

  // ── Drawer scroll lock ────────────────────────────────────
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  // ── PIN handlers ──────────────────────────────────────────
  const handlePinDigit = (digit) => {
    const newPin = enteredPin + digit;
    setEnteredPin(newPin);
    if (newPin.length === pin.length) {
      if (newPin === pin) {
        setIsUnlocked(true);
        setPinError(false);
      } else {
        setShake(true);
        setPinError(true);
        setTimeout(() => { setShake(false); setEnteredPin(''); setPinError(false); }, 600);
      }
    }
  };
  const handlePinBackspace = () => setEnteredPin(p => p.slice(0, -1));
  const handlePinClear = () => setEnteredPin('');

  // Keyboard support for PIN
  useEffect(() => {
    if (isUnlocked) return;
    const handleKeyDown = (e) => {
      if (e.key >= '0' && e.key <= '9') handlePinDigit(e.key);
      else if (e.key === 'Backspace') handlePinBackspace();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enteredPin, isUnlocked, pin]);

  // ── Helper computations ───────────────────────────────────
  const hasPriceChange = useCallback((item) => {
    const s = staged[item.id];
    if (s?.unitPrice === undefined || s?.unitPrice === '') return false;
    return parseFloat(s.unitPrice) !== parseFloat(item.unit_price);
  }, [staged]);

  const getStagedPrice = (item) => {
    const s = staged[item.id];
    return (s?.unitPrice !== undefined && s?.unitPrice !== '') ? s.unitPrice : item.unit_price;
  };

  const getStagedQtyAction = (itemId) => {
    const s = staged[itemId];
    if (!s) return null;
    if (s.addQty > 0) return { action: 'add', qty: s.addQty };
    if (s.deductQty > 0) return { action: 'deduct', qty: s.deductQty };
    return null;
  };

  const hasStagedChanges = useMemo(() => {
    return Object.keys(staged).some(id => {
      const item = items.find(i => i.id === parseInt(id, 10));
      if (!item) return false;
      const s = staged[id];
      return (s?.addQty > 0) || (s?.deductQty > 0) || hasPriceChange(item);
    });
  }, [staged, items, hasPriceChange]);

  // ── Global nav guard — syncs hasStagedChanges to a window flag ────
  // App.jsx reads this flag before any sidebar navigation, logout, or
  // hp:navigate event, and shows a confirmation dialog if it is true.
  // The cleanup ensures the flag is cleared when StockManager unmounts.
  useEffect(() => {
    window.__stockHasStagedChanges = hasStagedChanges;
    return () => { window.__stockHasStagedChanges = false; };
  }, [hasStagedChanges]);

  // ── Browser close / reload guard ─────────────────────────────────
  // Shows the browser's native "Leave site?" prompt when there are
  // staged changes and the user tries to close the tab or reload.
  useEffect(() => {
    if (!hasStagedChanges) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = ''; // Required for Chrome to show the dialog
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasStagedChanges]);

  const getModifiedItems = () => {
    return items.filter(item => {
      const s = staged[item.id];
      return (s?.addQty > 0) || (s?.deductQty > 0) || hasPriceChange(item);
    }).map(item => {
      const s = staged[item.id] || {};
      const qtyAction = getStagedQtyAction(item.id);
      return {
        ...item,
        hasQtyChange: qtyAction !== null,
        qtyAction: qtyAction?.action,
        qtyDelta: qtyAction?.qty,
        newQty: qtyAction ? (qtyAction.action === 'add' ? item.quantity + qtyAction.qty : item.quantity - qtyAction.qty) : item.quantity,
        hasPriceChanged: hasPriceChange(item),
        oldPrice: item.unit_price,
        newPrice: hasPriceChange(item) ? parseFloat(s.unitPrice) : item.unit_price,
      };
    });
  };

  // ── Valuation metrics (uses item.quantity directly, NOT staged) ──
  const valuationMetrics = useMemo(() => {
    let totalValue = 0;
    const categories = {};

    items.forEach(i => {
      const v = (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price) || 0);
      totalValue += v;
      if (!categories[i.category]) categories[i.category] = { value: 0, count: 0 };
      categories[i.category].value += v;
      categories[i.category].count += 1;
    });

    const criticalCount = items.filter(i => i.quantity <= thresholds.low).length;
    const lowCount = items.filter(i => i.quantity > thresholds.low && i.quantity <= thresholds.high).length;
    return { totalValue, categories, criticalCount, lowCount, totalItems: items.length };
  }, [items, thresholds]);

  // ── Modal handlers ────────────────────────────────────────
  const handleOpenModal = (itemId, action) => {
    const s = staged[itemId];
    let preQty = '';
    if (action === 'add' && s?.addQty > 0) preQty = String(s.addQty);
    if (action === 'deduct' && s?.deductQty > 0) preQty = String(s.deductQty);
    setQtyModal({ open: true, itemId, action, qty: preQty });
  };

  const handleStageQty = () => {
    const { itemId, action, qty } = qtyModal;
    const parsedQty = parseInt(qty, 10);
    if (isNaN(parsedQty) || parsedQty < 1) return;
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    if (action === 'deduct' && parsedQty > item.quantity) return;
    setStaged(prev => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {}),
        addQty: action === 'add' ? parsedQty : null,
        deductQty: action === 'deduct' ? parsedQty : null,
      }
    }));
    // Clear previous reason when qty changes
    setStagedReasons(prev => ({ ...prev, [itemId]: { reasonCategory: '', reasonNote: '' } }));
    setQtyModal({ open: false, itemId: null, action: null, qty: '' });
  };

  const handleClearStagedQty = (itemId) => {
    setStaged(prev => {
      const next = { ...prev };
      if (next[itemId]) {
        const { unitPrice } = next[itemId];
        if (unitPrice !== undefined) {
          next[itemId] = { unitPrice };
        } else {
          delete next[itemId];
        }
      }
      return next;
    });
  };

  // ── Price change handler ──────────────────────────────────
  const handlePriceChange = (id, value) => {
    setStaged(prev => ({
      ...prev,
      [id]: { ...(prev[id] || {}), unitPrice: value }
    }));
  };

  // ── Tab change with warning ───────────────────────────────
  const handleTabChange = (tab) => {
    if (tab === activeTab) return;
    if (hasStagedChanges) {
      setTabSwitchDialog({ open: true, targetTab: tab });
    } else {
      setActiveTab(tab);
    }
  };

  // ── handleSave ────────────────────────────────────────────
  const handleSave = async () => {
    const toSave = getModifiedItems();
    if (toSave.length === 0) return;
    setSaving(true);
    try {
      const results = await Promise.allSettled(toSave.map(async (item) => {
        const reasons = stagedReasons[item.id] || {};
        if (item.hasQtyChange) {
          if (item.qtyAction === 'add') {
            await stock.addStock(item.id, item.qtyDelta, reasons.reasonCategory || null, reasons.reasonNote || null);
          } else {
            await stock.deductStock(item.id, item.qtyDelta, reasons.reasonCategory || null, reasons.reasonNote || null);
          }
        }
        if (item.hasPriceChanged) {
          await stock.updatePrice(item.id, item.newPrice);
        }
      }));
      const failed = results.filter(r => r.status === 'rejected');
      setStaged({});
      setStagedReasons({});
      setDrawerOpen(false);
      await fetchStock();
      if (failed.length > 0) {
        setErrorDialog({ open: true, message: (
          <span>
            <strong style={{ color: 'var(--text)' }}>{failed.length} item(s)</strong> could not be saved.
            <br />
            The page has been refreshed to show the current state.
          </span>
        ) });
      } else {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3500);
      }
    } catch (err) {
      setErrorDialog({ open: true, message: (
        <span>
          Failed to save changes.
          <br />
          <span style={{ color: '#ef4444' }}>{err?.message || 'Please try again.'}</span>
        </span>
      ) });
    } finally {
      setSaving(false);
    }
  };

  // ── handleDelete ──────────────────────────────────────────
  const handleDelete = async (itemId, itemName) => {
    setDeleteDialog({ open: false, itemId: null, itemName: '', category: '' });
    try {
      const res = await stock.remove(itemId);
      await fetchStock();
      if (res.willReappear) {
        // Succeeded but item is still in catalog — show info (blue), NOT error (red)
        setInfoDialog({
          open: true,
          title: 'Item Will Reappear',
          message: (
            <span>
              <strong style={{ color: 'var(--text)' }}>'{itemName}'</strong> has been removed from stock.
              <br /><br />
              This product is still <strong>active in Price Manager</strong>, so it will automatically reappear here on the next page load.
              <br /><br />
              <span style={{ display: 'block', fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>To stop it from reappearing:</span>
              <span style={{ display: 'block', paddingLeft: 4 }}>1. Go to <strong>Price Manager</strong></span>
              <span style={{ display: 'block', paddingLeft: 4 }}>2. Find this product and click <strong>Delete</strong></span>
              <span style={{ display: 'block', paddingLeft: 4 }}>3. Come back and remove it from stock</span>
            </span>
          ),
        });
      }
    } catch (err) {
      await fetchStock();
      const isNotFound = err?.message?.includes('not found') || err?.status === 404;
      setErrorDialog({
        open: true,
        message: isNotFound ? (
          <span>
            <strong style={{ color: 'var(--text)' }}>'{itemName}'</strong> was not found — it may have already been removed in another session.
            <br /><br />
            The stock list has been refreshed.
          </span>
        ) : (
          <span>
            Could not remove <strong style={{ color: 'var(--text)' }}>'{itemName}'</strong>.
            <br />
            <span style={{ color: '#ef4444' }}>{err?.message || 'Please try again.'}</span>
          </span>
        ),
      });
    }
  };


  // ── handleAddItem ─────────────────────────────────────────
  const handleAddItem = async () => {
    const { category, itemName, quantity, unit } = addItemModal;
    if (!category || !itemName.trim() || !unit.trim()) return;
    setAddItemModal(prev => ({ ...prev, saving: true }));
    try {
      await stock.add({ category, itemName: itemName.trim(), quantity: parseInt(quantity, 10) || 0, unit: unit.trim() });
      setAddItemModal({ open: false, category: 'Structure Material', itemName: '', quantity: 0, unit: 'pcs', saving: false });
      await fetchStock();
    } catch (err) {
      setAddItemModal(prev => ({ ...prev, saving: false }));
      setErrorDialog({ open: true, message: (
        <span>
          Could not add <strong style={{ color: 'var(--text)' }}>'{itemName}'</strong> to stock.
          <br />
          <span style={{ color: '#ef4444' }}>{err?.message || 'Please try again.'}</span>
        </span>
      ) });
    }
  };

  // Filter DISPLAY_GROUPS to only those with at least one matching stock item
  const activeGroups = DISPLAY_GROUPS.filter(g =>
    g.categories.some(cat => items.some(i => i.category === cat))
  );

  // ── Loading ───────────────────────────────────────────────
  if (loading) return (
    <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--green)' }} />
    </div>
  );

  // ── Fetch error ───────────────────────────────────────────
  if (fetchError) return (
    <div className="page-content">
      <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
        <AlertCircle size={40} style={{ marginBottom: 12, color: 'var(--red)', opacity: 0.7 }} />
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Failed to load stock data</div>
        <div style={{ fontSize: 13, marginBottom: 16 }}>Please check your connection and try again.</div>
        <button className="btn-sm primary" onClick={() => { setLoading(true); fetchStock(); }}>
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    </div>
  );

  // ── PIN lock screen ───────────────────────────────────────
  if (!isUnlocked) {
    return (
      <div className="stock-lock-screen">
        <div className={`pin-glass-container ${shake ? 'error-shake' : ''}`}>
          <div className={`pin-lock-icon-container ${pinError && !shake ? 'error' : ''}`}>
            <LockKeyhole size={30} className={shake ? 'animate-bounce' : ''} />
          </div>
          <h2 className="pin-lock-title">Security Verification</h2>
          <p className="pin-lock-sub">
            {pinError
              ? 'Access denied. Please check your credentials and try again.'
              : 'This dashboard contains sensitive financial asset metrics and inventory logs. Please enter your PIN to verify your identity.'}
          </p>

          <div className="pin-dots-row">
            {Array.from({ length: pin.length }).map((_, idx) => (
              <div
                key={idx}
                className={`pin-dot ${
                  pinError
                    ? 'error'
                    : idx < enteredPin.length
                      ? 'active'
                      : ''
                }`}
              />
            ))}
          </div>

          <div className="pin-keypad-grid">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
              <button
                key={num}
                className="pin-key-btn"
                onClick={() => handlePinDigit(num.toString())}
              >
                {num}
              </button>
            ))}
            <button
              className="pin-key-btn special-key"
              onClick={handlePinClear}
            >
              Clear
            </button>
            <button
              className="pin-key-btn"
              onClick={() => handlePinDigit('0')}
            >
              0
            </button>
            <button
              className="pin-key-btn special-key"
              onClick={handlePinBackspace}
              aria-label="Backspace"
            >
              <Delete size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main content ──────────────────────────────────────────
  return (
    <div className="page-content">
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <div className="page-title">Stock &amp; Inventory</div>
          <div className="page-subtitle">Manage live stock levels, track movements, and view transaction history.</div>
        </div>
        {/* Header action buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {activeTab === 'live' && (
            <button
              className="btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => setAddItemModal({ open: true, category: 'Structure Material', itemName: '', quantity: 0, unit: 'pcs', saving: false })}
            >
              <Plus size={13} /> Add Item
            </button>
          )}
          {activeTab === 'live' && hasStagedChanges && (
            <button className="btn-sm" style={{ background: 'var(--green)', color: 'white', borderColor: 'var(--green)', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setDrawerOpen(true)}>
              <Save size={14} /> Review &amp; Save
            </button>
          )}
        </div>
      </div>

      {/* Save success banner */}
      {saveSuccess && (
        <div style={{ background: 'var(--green-light)', border: '1px solid rgba(46,125,82,0.3)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--green)', fontWeight: 600, fontSize: 13 }}>
          <Save size={14} /> Stock changes saved successfully!
        </div>
      )}

      {/* Valuation summary cards — only on live tab */}
      {activeTab === 'live' && (
        <div className="card" style={{ padding: '24px', marginBottom: 20 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div style={{ background: 'rgba(46,125,82,0.1)', padding: 10, borderRadius: 10, color: 'var(--green)' }}>
              <Coins size={22} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Stock Asset Valuation Summary</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                Live financial assets valuation aggregated across categories
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {/* Category Cards — one per display group */}
            {DISPLAY_GROUPS.map(group => {
              const groupValue = group.categories.reduce((sum, cat) => {
                return sum + (valuationMetrics.categories[cat]?.value || 0);
              }, 0);
              const groupCount = group.categories.reduce((sum, cat) => {
                return sum + (valuationMetrics.categories[cat]?.count || 0);
              }, 0);
              const Icon = group.icon;
              return (
                <div key={group.key} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', background: 'white', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16 }}>
                    <Icon size={16} style={{ color: group.color, marginTop: 1 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', lineHeight: 1.4 }}>{group.label}<br/>Valuation</span>
                  </div>
                  <div style={{ marginTop: 'auto' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{fmtCurrency(groupValue)}</div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#f1f5f9', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, color: '#475569' }}>
                      <Package size={12} /> {groupCount} Units
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Grand Total Card */}
            <div style={{ background: 'var(--green)', borderRadius: 12, padding: '16px 20px', color: 'white', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16 }}>
                <TrendingUp size={16} style={{ opacity: 0.9, marginTop: 1 }} />
                <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.9, textTransform: 'uppercase', lineHeight: 1.4 }}>Grand Total<br/>Asset Valuation</span>
              </div>
              <div style={{ marginTop: 'auto' }}>
                <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>{fmtCurrency(valuationMetrics.totalValue)}</div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.2)', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                  <Layers size={12} /> {valuationMetrics.totalItems} Total Units
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs — always visible */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          {[
            { key: 'live',   label: 'Live Inventory',  icon: Package },
            { key: 'ledger', label: 'Stock Ledger',     icon: BarChart2 },
            { key: 'daily',  label: 'Daily Report',     icon: FileSpreadsheet },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={`btn-sm ${activeTab === key ? 'primary' : ''}`}
              onClick={() => handleTabChange(key)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Icon size={13} />{label}
            </button>
          ))}
        </div>

      {/* ── LIVE INVENTORY TAB ─────────────────────────────────── */}
      {activeTab === 'live' && (
        <>
          {items.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
              <Package size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>No stock items yet</div>
              <div style={{ fontSize: 13 }}>Panels and inverters sync automatically. Add structure or electrical items manually.</div>
            </div>
          ) : (
            activeGroups.map(group => {
              const GroupIcon = group.icon;
              const groupItems = items.filter(i => group.categories.includes(i.category));
              return (
                <div key={group.key} className="card" style={{ marginBottom: 16 }}>
                  {/* Group header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px 12px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: group.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <GroupIcon size={16} style={{ color: group.color }} />
                    </div>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{group.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>({groupItems.length} items)</span>
                  </div>

                  {/* Table */}
                  <div className="table-scroll-wrap">
                    <table style={{ minWidth: 580 }}>
                      <thead>
                        <tr>
                          <th style={{ width: '32%' }}>Item Specifications</th>
                          <th style={{ width: '27%' }}>Quantity</th>
                          <th style={{ width: '7%' }}>Unit</th>
                          <th style={{ width: '15%' }}>Unit Price (₹)</th>
                          <th style={{ width: '12%' }}>Total Value</th>
                          <th style={{ width: '7%' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupItems.map(item => {
                          const currentQty = item.quantity;
                          const stagedAction = getStagedQtyAction(item.id);
                          const previewQty = stagedAction ? (stagedAction.action === 'add' ? currentQty + stagedAction.qty : currentQty - stagedAction.qty) : null;
                          const price = getStagedPrice(item);
                          const isPriceChanged = hasPriceChange(item);
                          const badge = currentQty > thresholds.high ? { label: 'In Stock', cls: 'badge-green' }
                                      : currentQty > thresholds.low  ? { label: 'Low',      cls: 'badge-sun' }
                                      : { label: 'Critical', cls: 'badge-red' };
                          return (
                            <tr key={item.id} style={stagedAction ? { borderLeft: `3px solid ${stagedAction.action === 'add' ? 'var(--green)' : 'var(--sun)'}` } : {}}>
                              <td style={{ fontWeight: 600 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                  <span>{item.item_name}</span>
                                  {(item.category === 'Panel' || item.category === 'Inverter') && (
                                    <span
                                      title="This item is automatically synced from Price Manager. If the product is still active there, it will reappear here on every page load."
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: '#6366f1', letterSpacing: '0.02em', width: 'fit-content' }}
                                    >
                                      <Link2 size={9} />
                                      Price Manager
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                                  {/* Current qty display + badge */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                    {stagedAction ? (
                                      <>
                                        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--muted)', textDecoration: 'line-through', minWidth: 55, display: 'inline-block' }}>{currentQty}</span>
                                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>→</span>
                                        <span style={{ fontWeight: 700, fontSize: 14, color: stagedAction.action === 'add' ? 'var(--green)' : 'var(--sun-dark)' }}>{previewQty}</span>
                                        <span className={`stock-pending-chip ${stagedAction.action}`}>
                                          {stagedAction.action === 'add' ? '+' : '−'}{stagedAction.qty}
                                        </span>
                                        <button
                                          onClick={() => handleClearStagedQty(item.id)}
                                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--muted)', display: 'flex' }}
                                          title="Clear staged change"
                                        ><X size={12} /></button>
                                      </>
                                    ) : (
                                      <>
                                        <span style={{ fontWeight: 700, fontSize: 14, minWidth: 55, display: 'inline-block' }}>{currentQty}</span>
                                        <span className={`badge ${badge.cls}`} style={{ fontSize: 9, padding: '2px 6px' }}>{badge.label}</span>
                                      </>
                                    )}
                                  </div>
                                  {/* Action buttons */}
                                  {!stagedAction && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                      <button className="stock-action-btn add" onClick={() => handleOpenModal(item.id, 'add')} title="Add stock">
                                        <Plus size={12} />
                                      </button>
                                      <button className="stock-action-btn deduct" onClick={() => handleOpenModal(item.id, 'deduct')} title="Use stock" disabled={item.quantity === 0}>
                                        <Minus size={12} />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td style={{ color: 'var(--muted)', fontSize: 13 }}>{item.unit}</td>
                              <td>
                                <input
                                  className="input-inline"
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={price}
                                  style={isPriceChanged ? { borderColor: 'var(--green)', backgroundColor: 'rgba(46,125,82,0.05)', fontWeight: 'bold', width: 110 } : { width: 110 }}
                                  onChange={e => handlePriceChange(item.id, e.target.value)}
                                />
                              </td>
                              <td style={{ fontWeight: 700, color: isPriceChanged ? 'var(--green)' : 'var(--text)' }}>
                                {fmtCurrency((parseFloat(currentQty) || 0) * (parseFloat(price) || 0))}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <button
                                  title={`Remove ${item.item_name}`}
                                  onClick={() => setDeleteDialog({ open: true, itemId: item.id, itemName: item.item_name, category: item.category })}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: 'var(--muted)', display: 'inline-flex', borderRadius: 6, transition: 'color 0.15s' }}
                                  onMouseOver={e => e.currentTarget.style.color = 'var(--red)'}
                                  onMouseOut={e => e.currentTarget.style.color = 'var(--muted)'}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}

          {/* Unsaved changes bar */}
          {hasStagedChanges && (
            <div style={{ position: 'sticky', bottom: 0, background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(8px)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, zIndex: 10, marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--sun-dark)', fontWeight: 600 }}>
                <AlertCircle size={14} /> You have unsaved changes.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-sm" onClick={() => { setStaged({}); setStagedReasons({}); }}>Discard</button>
                <button className="btn-sm primary" onClick={() => setDrawerOpen(true)}><Save size={13} /> Review &amp; Save</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── STOCK LEDGER TAB ───────────────────────────────────── */}
      {activeTab === 'ledger' && (
        <StockLedger />
      )}

      {/* ── DAILY REPORT TAB ──────────────────────────────────── */}
      {activeTab === 'daily' && (
        <DailyStockLogs />
      )}

      {/* ── QUANTITY ACTION MODAL ──────────────────────────────── */}
      {qtyModal.open && (() => {
        const modalItem = items.find(i => i.id === qtyModal.itemId);
        if (!modalItem) return null;
        const currentQty = modalItem.quantity;
        const parsedQty = parseInt(qtyModal.qty, 10);
        const validQty = !isNaN(parsedQty) && parsedQty >= 1;
        const isOverDeduct = qtyModal.action === 'deduct' && validQty && parsedQty > currentQty;
        const previewQty = validQty && !isOverDeduct ? (qtyModal.action === 'add' ? currentQty + parsedQty : currentQty - parsedQty) : null;
        return (
          <div className="stock-qty-modal-backdrop" onClick={() => setQtyModal({ open: false, itemId: null, action: null, qty: '' })}>
            <div className="stock-qty-modal" onClick={e => e.stopPropagation()}>
              <div className="stock-qty-modal-title" style={{ color: qtyModal.action === 'add' ? 'var(--green)' : 'var(--sun-dark)' }}>
                {qtyModal.action === 'add' ? '＋ Add Stock' : '－ Use Stock'}
              </div>
              <div className="stock-qty-modal-subtitle">{modalItem.item_name}</div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                  Current Stock: <strong style={{ fontFamily: 'var(--mono)' }}>{currentQty} {modalItem.unit}</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: qtyModal.action === 'add' ? 'var(--green)' : 'var(--sun-dark)', width: 16, textAlign: 'center' }}>
                    {qtyModal.action === 'add' ? '+' : '−'}
                  </span>
                  <input
                    className="input-inline"
                    type="number"
                    min="1"
                    placeholder="Enter quantity..."
                    value={qtyModal.qty}
                    autoFocus
                    style={{ width: 140, borderColor: isOverDeduct ? 'var(--red)' : undefined }}
                    onChange={e => setQtyModal(prev => ({ ...prev, qty: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter' && validQty && !isOverDeduct) handleStageQty(); }}
                  />
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>{modalItem.unit}</span>
                </div>

                {previewQty !== null && (
                  <div className={`stock-qty-preview ${qtyModal.action}`}>
                    <ArrowRight size={12} />
                    New balance: <strong style={{ fontFamily: 'var(--mono)' }}>{previewQty} {modalItem.unit}</strong>
                    {qtyModal.action === 'add' ? ' ↑' : ' ↓'}
                  </div>
                )}
                {isOverDeduct && (
                  <div className="stock-qty-preview error">
                    <AlertCircle size={12} /> Cannot exceed {currentQty} {modalItem.unit} available
                  </div>
                )}
                {!qtyModal.qty && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                    {qtyModal.action === 'add' ? 'Reason can be added in Review & Save' : 'Enter how many you used'}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn-sm" onClick={() => setQtyModal({ open: false, itemId: null, action: null, qty: '' })}>
                  Cancel
                </button>
                <button
                  className="btn-sm"
                  style={qtyModal.action === 'add'
                    ? { background: 'var(--green)', color: 'white', borderColor: 'var(--green)' }
                    : { background: 'var(--sun)', color: 'white', borderColor: 'var(--sun)' }}
                  onClick={handleStageQty}
                  disabled={!validQty || isOverDeduct}
                >
                  Stage this change
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── ADD ITEM MODAL ─────────────────────────────────────── */}
      {addItemModal.open && (
        <div className="stock-qty-modal-backdrop" onClick={() => !addItemModal.saving && setAddItemModal(prev => ({ ...prev, open: false }))}>
          <div className="stock-qty-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="stock-qty-modal-title" style={{ color: 'var(--green)' }}>
              + Add New Stock Item
            </div>
            <div className="stock-qty-modal-subtitle">
              Add a new item to your live inventory.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Category</label>
                <select
                  className="input-inline"
                  style={{ width: '100%' }}
                  value={addItemModal.category}
                  onChange={e => setAddItemModal(prev => ({ ...prev, category: e.target.value }))}
                >
                  <option value="Structure Material">Structure Material</option>
                  <option value="Electrical Material">Electrical Material</option>
                </select>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 6, padding: '7px 10px', background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.12)', borderRadius: 6, fontSize: 11, color: '#2563eb' }}>
                  <Info size={11} style={{ marginTop: 1, flexShrink: 0 }} />
                  <span>Panels &amp; Inverters auto-sync from Price Manager — no need to add them here.</span>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Item Name</label>
                <input
                  className="input-inline"
                  type="text"
                  placeholder={addItemModal.category === 'Structure Material'
                    ? 'e.g. GI Pipe, MS L Angle, J Bolt, Zinc Spray...'
                    : 'e.g. ACDB Box, DC Cable, MC4 Connector, DCDB...'}
                  style={{ width: '100%' }}
                  value={addItemModal.itemName}
                  autoFocus
                  onChange={e => setAddItemModal(prev => ({ ...prev, itemName: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && addItemModal.itemName.trim()) handleAddItem(); }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Opening Qty</label>
                  <input
                    className="input-inline"
                    type="number"
                    min="0"
                    placeholder="0"
                    style={{ width: '100%' }}
                    value={addItemModal.quantity}
                    onChange={e => setAddItemModal(prev => ({ ...prev, quantity: e.target.value }))}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Unit</label>
                  <input
                    className="input-inline"
                    type="text"
                    placeholder="pcs, meters, rolls..."
                    style={{ width: '100%' }}
                    value={addItemModal.unit}
                    onChange={e => setAddItemModal(prev => ({ ...prev, unit: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-sm" disabled={addItemModal.saving} onClick={() => setAddItemModal(prev => ({ ...prev, open: false }))}>
                Cancel
              </button>
              <button
                className="btn-sm"
                style={{ background: 'var(--green)', color: 'white', borderColor: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                disabled={!addItemModal.itemName.trim() || addItemModal.saving}
                onClick={handleAddItem}
              >
                {addItemModal.saving
                  ? <><Loader2 size={12} className="animate-spin" /> Adding...</>
                  : <><Plus size={12} /> Add Item</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REVIEW & SAVE DRAWER ───────────────────────────────── */}
      {drawerOpen && (
        <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} style={{ zIndex: 999 }}>
          <div className="drawer-container" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="drawer-title-area">
                <span className="drawer-title">Review Stock Adjustments</span>
                <span className="drawer-subtitle">Quantity changes are permanently recorded in the stock ledger</span>
              </div>
              <button className="close-btn" style={{ padding: 4, display: 'flex' }} onClick={() => setDrawerOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="drawer-content" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Info size={14} style={{ color: 'var(--green)' }} />
                The following changes will be recorded in the stock ledger.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '55vh', overflowY: 'auto', paddingRight: 4 }}>
                {getModifiedItems().map(item => {
                  const reasons = stagedReasons[item.id] || {};
                  const reasonPresets = item.qtyAction === 'add' ? ADD_REASONS : DEDUCT_REASONS;
                  return (
                    <div key={item.id} style={{ padding: 14, border: '1px solid #f1f5f9', borderRadius: 10 }}>
                      {/* Item header */}
                      <div style={{ marginBottom: 8 }}>
                        <span style={{ background: '#f8fafc', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{item.category}</span>
                        <span style={{ fontWeight: 700, marginLeft: 8, fontSize: 13 }}>{item.item_name}</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 4 }}>
                        {/* Quantity change */}
                        {item.hasQtyChange && (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, flexWrap: 'wrap', gap: 4 }}>
                              <span style={{ color: 'var(--muted)' }}>
                                {item.qtyAction === 'add' ? '↑ Adding' : '↓ Using'} {item.qtyDelta} {item.unit}:
                              </span>
                              <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--mono)' }}>
                                <span style={{ color: '#ef4444', textDecoration: 'line-through' }}>{item.quantity}</span>
                                <ArrowRight size={11} style={{ color: 'var(--muted)' }} />
                                <span style={{ color: item.qtyAction === 'add' ? 'var(--green)' : 'var(--sun-dark)', fontWeight: 700 }}>{item.newQty}</span>
                                <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{item.unit}</span>
                              </span>
                            </div>

                            {/* Reason fields */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <select
                                className="input-inline"
                                style={{ width: '100%', fontSize: 12 }}
                                value={reasons.reasonCategory || ''}
                                onChange={e => setStagedReasons(prev => ({ ...prev, [item.id]: { ...(prev[item.id] || {}), reasonCategory: e.target.value } }))}
                              >
                                <option value="">Reason (optional) — select...</option>
                                {reasonPresets.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                              <input
                                className="input-inline"
                                type="text"
                                placeholder="Add a note... (optional)"
                                style={{ width: '100%', fontSize: 12 }}
                                value={reasons.reasonNote || ''}
                                onChange={e => setStagedReasons(prev => ({ ...prev, [item.id]: { ...(prev[item.id] || {}), reasonNote: e.target.value } }))}
                              />
                            </div>
                          </>
                        )}

                        {/* Price change */}
                        {item.hasPriceChanged && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, flexWrap: 'wrap', gap: 4 }}>
                            <span style={{ color: 'var(--muted)' }}>Unit Price:</span>
                            <span style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ textDecoration: 'line-through', color: '#ef4444' }}>{fmtCurrency(item.oldPrice)}</span>
                              <ArrowRight size={11} style={{ color: 'var(--muted)' }} />
                              <span style={{ color: 'var(--green)', fontWeight: 700 }}>{fmtCurrency(item.newPrice)}</span>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="drawer-footer">
              <button className="btn-sm" style={{ padding: '12px', border: '1.5px solid var(--border)', background: 'transparent', fontWeight: 600 }} onClick={() => setDrawerOpen(false)}>Cancel</button>
              <button className="btn-primary" disabled={saving} onClick={handleSave} style={{ background: 'var(--green)' }}>
                {saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : <><Save size={16} /> Confirm &amp; Save Changes</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB SWITCH WARNING ─────────────────────────────────── */}
      <ConfirmDialog
        open={tabSwitchDialog.open}
        title="Unsaved Changes"
        message="You have unsaved stock changes. If you switch tabs, your staged changes will be lost."
        confirmText="Leave Anyway"
        cancelText="Stay Here"
        onConfirm={() => {
          setStaged({});
          setStagedReasons({});
          setActiveTab(tabSwitchDialog.targetTab);
          setTabSwitchDialog({ open: false, targetTab: null });
        }}
        onCancel={() => setTabSwitchDialog({ open: false, targetTab: null })}
      />

      {/* ── ERROR DIALOG — genuine failures (red AlertTriangle) ── */}
      <ConfirmDialog
        open={errorDialog.open}
        title="Something Went Wrong"
        message={errorDialog.message}
        variant="danger"
        confirmText="OK"
        hideCancel
        onConfirm={() => setErrorDialog({ open: false, message: null })}
        onCancel={() => setErrorDialog({ open: false, message: null })}
      />

      {/* ── INFO DIALOG — success with a note (blue Info icon) ─── */}
      <ConfirmDialog
        open={infoDialog.open}
        title={infoDialog.title}
        message={infoDialog.message}
        variant="info"
        confirmText="Got it"
        hideCancel
        onConfirm={() => setInfoDialog({ open: false, title: '', message: null })}
        onCancel={() => setInfoDialog({ open: false, title: '', message: null })}
      />

      {/* ── DELETE CONFIRM (red AlertTriangle) ───────────────── */}
      <ConfirmDialog
        open={deleteDialog.open}
        title="Remove from Stock"
        message={
          (deleteDialog.category === 'Panel' || deleteDialog.category === 'Inverter')
            ? (
              <span>
                Are you sure you want to remove <strong style={{ color: 'var(--text)' }}>'{deleteDialog.itemName}'</strong> from stock?
                <br /><br />
                <strong>This item is synced from Price Manager.</strong> If it is still active there, it will automatically reappear here on the next page load.
                <br /><br />
                <span style={{ color: '#ef4444' }}>Transaction history will be permanently deleted.</span>
              </span>
            )
            : (
              <span>
                Are you sure you want to remove <strong style={{ color: 'var(--text)' }}>'{deleteDialog.itemName}'</strong> from stock?
                <br /><br />
                <span style={{ color: '#ef4444' }}>Transaction history will be permanently deleted. This cannot be undone.</span>
              </span>
            )
        }
        confirmText="Remove from Stock"
        cancelText="Cancel"
        variant="danger"
        onConfirm={() => handleDelete(deleteDialog.itemId, deleteDialog.itemName)}
        onCancel={() => setDeleteDialog({ open: false, itemId: null, itemName: '', category: '' })}
      />
    </div>
  );
}
