import { useState, useEffect, useCallback } from 'react';
import { stock } from '../utils/api';
import {
  Loader2, Search, ChevronLeft, ChevronRight, ArrowLeft,
  Package, Sun, Zap, Layers, AlertCircle, TrendingUp, TrendingDown, ArrowRight, RefreshCw, BarChart2
} from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';

// ── IST date helpers ─────────────────────────────────────────
function getISTDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return getISTDateString(d);
}

// ── Category config ──────────────────────────────────────────
const categoryConfig = {
  Panel:                 { bg: 'rgba(245,166,35,0.06)',   color: '#f5a623', icon: Sun,    label: 'Solar Panels' },
  Inverter:              { bg: 'rgba(37,99,235,0.06)',    color: '#2563eb', icon: Zap,    label: 'Inverters' },
  'Structure Material':  { bg: 'rgba(120,113,108,0.06)', color: '#78716c', icon: Layers, label: 'Structure Material' },
  'Electrical Material': { bg: 'rgba(234,179,8,0.06)',   color: '#ca8a04', icon: Zap,    label: 'Electrical Material' },
  Default:               { bg: 'rgba(107,114,128,0.06)', color: '#4b5563', icon: Package, label: 'Stock Items' },
};

// ── Display groups (Panel + Inverter shown together) ─────────
const DISPLAY_GROUPS = [
  { key: 'panel-inverter', label: 'PANEL AND INVERTER',  categories: ['Panel', 'Inverter'],           icon: Sun,    color: '#f5a623', bg: 'rgba(245,166,35,0.06)' },
  { key: 'structure',      label: 'STRUCTURE MATERIAL',  categories: ['Structure Material'],           icon: Layers, color: '#78716c', bg: 'rgba(120,113,108,0.06)' },
  { key: 'electrical',     label: 'ELECTRICAL MATERIAL', categories: ['Electrical Material'],          icon: Zap,    color: '#ca8a04', bg: 'rgba(234,179,8,0.06)' },
];

// Map a DB category value to its display group key
const getGroupKey = (cat) => {
  const group = DISPLAY_GROUPS.find(g => g.categories.includes(cat));
  return group ? group.key : cat;
};


// ── Date range presets (computed at call time, not module load, to avoid stale dates) ──
function buildPresets() {
  const today = getISTDateString();
  return {
    today,
    presets: [
      { label: 'Today',         from: today,               to: today },
      { label: 'This Week',     from: addDays(today, -6),  to: today },
      { label: 'This Month',    from: addDays(today, -29), to: today },
      { label: 'Last 3 Months', from: addDays(today, -89), to: today },
      { label: 'Custom',        from: null,                to: null  },
    ],
  };
}

// ── Transaction type badge ───────────────────────────────────
function TxBadge({ type }) {
  const map = {
    add:        { label: 'Added',    bg: 'rgba(46,125,82,0.1)',   color: 'var(--green)' },
    deduct:     { label: 'Used',     bg: 'rgba(192,57,43,0.09)',  color: 'var(--red)'   },
    adjustment: { label: 'Adjusted', bg: 'rgba(37,99,235,0.09)',  color: '#2563eb'      },
    initial:    { label: 'Setup', bg: 'rgba(180,130,0,0.09)', color: '#92660a' },
  };
  const c = map[type] || { label: type || '—', bg: '#f1f5f9', color: 'var(--muted)' };
  return (
    <span style={{ background: c.bg, color: c.color, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
      {c.label}
    </span>
  );
}

// ── Net change cell ──────────────────────────────────────────
function NetCell({ value }) {
  if (value == null) return <span style={{ color: 'var(--muted)' }}>—</span>;
  const pos = value > 0;
  const zero = value === 0;
  const color = zero ? 'var(--muted)' : pos ? 'var(--green)' : 'var(--red)';
  const prefix = pos ? '+' : '';
  return <span style={{ color, fontWeight: 700, fontFamily: 'var(--mono)' }}>{prefix}{value}</span>;
}

// ── Format IST timestamp ─────────────────────────────────────
function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const PAGE_SIZE = 50;

export default function StockLedger() {
  // ── Compute today + presets fresh at mount (prevents stale dates) ────
  const { today, presets: PRESETS } = buildPresets();

  // ── View: 'summary' | 'detail' ──────────────────────────
  const [view, setView] = useState('summary');
  const [selectedItem, setSelectedItem] = useState(null); // { id, item_name, category, unit }

  // ── Date range ───────────────────────────────────────────
  const [activePreset, setActivePreset] = useState('This Week');
  const [from, setFrom] = useState(PRESETS[1].from);
  const [to, setTo]     = useState(PRESETS[1].to);

  // ── Summary state ────────────────────────────────────────
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryData, setSummaryData] = useState([]); // array of items with ledger stats
  const [search, setSearch] = useState('');
  const [summaryError, setSummaryError] = useState('');

  // ── Detail state ─────────────────────────────────────────
  const [detailLoading, setDetailLoading] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [detailError, setDetailError] = useState('');
  const [detailSummary, setDetailSummary] = useState(null);

  // ── Error dialog ─────────────────────────────────────────
  const [errorDialog, setErrorDialog] = useState({ open: false, message: '' });

  // ── Fetch summary ────────────────────────────────────────
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const res = await stock.getTransactions(from, to);
      setSummaryData(res.data || []);
    } catch (err) {
      setSummaryError(err?.message || 'Failed to load ledger data.');
      setSummaryData([]);
    } finally {
      setSummaryLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    if (view === 'summary') fetchSummary();
  }, [view, fetchSummary]);

  // ── Fetch detail ─────────────────────────────────────────
  const fetchDetail = useCallback(async (p = 1) => {
    if (!selectedItem) return;
    setDetailLoading(true);
    setDetailError('');
    try {
      const res = await stock.getItemTransactions(selectedItem.id, { from, to, page: p, limit: PAGE_SIZE });
      setTransactions(res.transactions || res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setDetailSummary(res.summary || null);
      setPage(p);
    } catch (err) {
      setDetailError(err?.message || 'Failed to load transaction history.');
      setTransactions([]);
    } finally {
      setDetailLoading(false);
    }
  }, [selectedItem, from, to]);

  useEffect(() => {
    if (view === 'detail' && selectedItem) fetchDetail(1);
  }, [view, selectedItem, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle preset selection ──────────────────────────────
  const handlePreset = (preset) => {
    setActivePreset(preset.label);
    if (preset.from && preset.to) {
      setFrom(preset.from);
      setTo(preset.to);
    }
  };

  // ── Navigate to detail ───────────────────────────────────
  const openDetail = (item) => {
    setSelectedItem(item);
    setView('detail');
  };

  // ── Navigate back to summary ─────────────────────────────
  const backToSummary = () => {
    setView('summary');
    setSelectedItem(null);
    setTransactions([]);
    setDetailSummary(null);
  };

  // ── Filter summary by search ─────────────────────────────
  const filtered = summaryData.filter(item =>
    item.item_name?.toLowerCase().includes(search.toLowerCase()) ||
    item.category?.toLowerCase().includes(search.toLowerCase())
  );

  // ── Group by display group (Panel + Inverter share one group) ─
  const grouped = {};
  for (const item of filtered) {
    const groupKey = getGroupKey(item.category);
    if (!grouped[groupKey]) grouped[groupKey] = [];
    grouped[groupKey].push(item);
  }

  // ── Date controls (shared between views) ─────────────────
  const DateControls = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Preset pills */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => handlePreset(p)}
            style={{
              padding: '4px 12px',
              borderRadius: 20,
              border: `1.5px solid ${activePreset === p.label ? 'var(--green)' : 'var(--border)'}`,
              background: activePreset === p.label ? 'rgba(46,125,82,0.08)' : 'transparent',
              color: activePreset === p.label ? 'var(--green)' : 'var(--muted)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      {/* Custom date inputs */}
      {activePreset === 'Custom' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="date"
            value={from}
            max={to}
            onChange={e => setFrom(e.target.value)}
            className="input-inline"
            style={{ fontSize: 13 }}
          />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>to</span>
          <input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={e => setTo(e.target.value)}
            className="input-inline"
            style={{ fontSize: 13 }}
          />
        </div>
      )}
    </div>
  );

  // ────────────────────────────────────────────────────────
  // LEVEL 1 — SUMMARY VIEW
  // ────────────────────────────────────────────────────────
  if (view === 'summary') {
    return (
      <div style={{ animation: 'fadeIn 0.3s ease' }}>
        {/* Header + controls */}
        <div className="card" style={{ marginBottom: 16 }}>
          {/* Row 1: Title + Search */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '18px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(46,125,82,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <BarChart2 size={18} style={{ color: 'var(--green)' }} />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Stock Ledger</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Click any item to view its full transaction history.</div>
              </div>
            </div>

            {/* Search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', minWidth: 220, maxWidth: 300 }}>
              <Search size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
              <input
                type="text"
                placeholder="Search items or categories..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: 'var(--text)', width: '100%' }}
              />
            </div>
          </div>

          {/* Row 2: Date filter toolbar */}
          <div style={{ borderTop: '1px solid var(--border)', padding: '12px 24px', background: '#fafafa', borderRadius: '0 0 16px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            {/* Preset pills */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => handlePreset(p)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 20,
                    border: `1.5px solid ${activePreset === p.label ? 'var(--green)' : 'var(--border)'}`,
                    background: activePreset === p.label ? 'rgba(46,125,82,0.08)' : 'transparent',
                    color: activePreset === p.label ? 'var(--green)' : 'var(--muted)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom date inputs — only shown when Custom is selected */}
            {activePreset === 'Custom' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>From:</span>
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={e => setFrom(e.target.value)}
                  className="input-inline"
                  style={{ fontSize: 13, fontWeight: 600, minWidth: 140 }}
                />
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>To:</span>
                <input
                  type="date"
                  value={to}
                  min={from}
                  max={today}
                  onChange={e => setTo(e.target.value)}
                  className="input-inline"
                  style={{ fontSize: 13, fontWeight: 600, minWidth: 140 }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Loading */}
        {summaryLoading && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Loader2 size={28} className="animate-spin" style={{ color: 'var(--green)' }} />
          </div>
        )}

        {/* Error */}
        {!summaryLoading && summaryError && (
          <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
            <AlertCircle size={32} style={{ marginBottom: 10, color: 'var(--red)', opacity: 0.7 }} />
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Failed to load ledger</div>
            <div style={{ fontSize: 13, marginBottom: 14 }}>{summaryError}</div>
            <button className="btn-sm primary" onClick={fetchSummary} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><RefreshCw size={12} /> Retry</button>
          </div>
        )}

        {/* Empty */}
        {!summaryLoading && !summaryError && filtered.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
            <Package size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>No ledger data</div>
            <div style={{ fontSize: 13 }}>No stock movements found for the selected period.</div>
          </div>
        )}

        {/* Grouped tables */}
        {!summaryLoading && !summaryError && DISPLAY_GROUPS.filter(g => grouped[g.key]).map(group => {
          const CatIcon = group.icon;
          return (
            <div key={group.key} className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px 12px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: group.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CatIcon size={16} style={{ color: group.color }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{group.label}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>({grouped[group.key].length} items)</span>
              </div>

              <div className="table-scroll-wrap">
                <table style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={{ width: '30%' }}>Item</th>
                      <th style={{ width: '13%' }}>Opening</th>
                      <th style={{ width: '13%' }}>+ Added</th>
                      <th style={{ width: '13%' }}>− Used</th>
                      <th style={{ width: '13%' }}>Net</th>
                      <th style={{ width: '13%' }}>Closing</th>
                      <th style={{ width: '5%' }}>Moves</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[group.key].map(item => {
                      // Backend returns: opening_balance, closing_balance, total_added, total_used, movement_count
                      const opening = item.opening_balance ?? 0;
                      const closing = item.closing_balance ?? 0;
                      const added   = item.total_added     ?? 0;
                      const used    = item.total_used      ?? 0;
                      const net     = closing - opening;
                      const moves   = item.movement_count  ?? 0;
                      return (
                        <tr
                          key={item.id || item.stock_item_id}
                          style={{ cursor: 'pointer' }}
                          onClick={() => openDetail({ id: item.id || item.stock_item_id, item_name: item.item_name, category: item.category, unit: item.unit })}
                        >
                          <td>
                            <span style={{ fontWeight: 600, color: 'var(--text)' }}>{item.item_name}</span>
                          </td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>
                            {opening} <span style={{ fontSize: 10, color: 'var(--muted)' }}>{item.unit}</span>
                          </td>
                          <td>
                            {added > 0
                              ? <span style={{ color: 'var(--green)', fontWeight: 700, fontFamily: 'var(--mono)' }}>+{added}</span>
                              : <span style={{ color: 'var(--muted)' }}>—</span>}
                          </td>
                          <td>
                            {used > 0
                              ? <span style={{ color: 'var(--red)', fontWeight: 700, fontFamily: 'var(--mono)' }}>−{used}</span>
                              : <span style={{ color: 'var(--muted)' }}>—</span>}
                          </td>
                          <td><NetCell value={net} /></td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700 }}>
                            {closing} <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{item.unit}</span>
                          </td>
                          <td>
                            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{moves}</span>
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

        <ConfirmDialog
          open={errorDialog.open}
          title="Error"
          message={errorDialog.message}
          variant="danger"
          confirmText="OK"
          hideCancel
          onConfirm={() => setErrorDialog({ open: false, message: '' })}
          onCancel={() => setErrorDialog({ open: false, message: '' })}
        />
      </div>
    );
  }

  // ────────────────────────────────────────────────────────
  // LEVEL 2 — DETAIL VIEW
  // ────────────────────────────────────────────────────────
  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      {/* Breadcrumb + back */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button
          onClick={backToSummary}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}
        >
          <ArrowLeft size={14} /> Back
        </button>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>Stock Ledger</span>
        <ChevronRight size={14} style={{ color: 'var(--muted)' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{selectedItem?.item_name}</span>
      </div>

      {/* Header + date controls */}
      <div className="card" style={{ marginBottom: 16 }}>
        {/* Row 1: Item name + category */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '18px 24px' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{selectedItem?.item_name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {(DISPLAY_GROUPS.find(g => g.categories.includes(selectedItem?.category)) || categoryConfig.Default).label} · {selectedItem?.unit}
            </div>
          </div>
        </div>

        {/* Row 2: Date filter toolbar */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 24px', background: '#fafafa', borderRadius: '0 0 16px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          {/* Preset pills */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => handlePreset(p)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 20,
                  border: `1.5px solid ${activePreset === p.label ? 'var(--green)' : 'var(--border)'}`,
                  background: activePreset === p.label ? 'rgba(46,125,82,0.08)' : 'transparent',
                  color: activePreset === p.label ? 'var(--green)' : 'var(--muted)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          {activePreset === 'Custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>From:</span>
              <input
                type="date"
                value={from}
                max={to}
                onChange={e => setFrom(e.target.value)}
                className="input-inline"
                style={{ fontSize: 13, fontWeight: 600, minWidth: 140 }}
              />
              <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>To:</span>
              <input
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={e => setTo(e.target.value)}
                className="input-inline"
                style={{ fontSize: 13, fontWeight: 600, minWidth: 140 }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Summary stats bar (separate card for visual breathing room) */}
      {detailSummary && (
        <div className="card" style={{ marginBottom: 16, padding: '16px 24px' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[
              { label: 'Opening',   value: `${detailSummary.openingBalance ?? '—'} ${selectedItem?.unit}`,  color: 'var(--text)' },
              { label: '+ Added',   value: `+${detailSummary.totalAdded    ?? 0}`,                           color: 'var(--green)' },
              { label: '− Used',    value: `−${detailSummary.totalUsed     ?? 0}`,                           color: 'var(--red)' },
              { label: 'Closing',   value: `${detailSummary.closingBalance ?? '—'} ${selectedItem?.unit}`,  color: 'var(--text)' },
              { label: 'Movements', value:  detailSummary.movementCount    ?? 0,                             color: 'var(--text)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 16px', minWidth: 100 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {detailLoading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--green)' }} />
        </div>
      )}

      {/* Error */}
      {!detailLoading && detailError && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
          <AlertCircle size={32} style={{ marginBottom: 10, color: 'var(--red)', opacity: 0.7 }} />
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Failed to load transactions</div>
          <div style={{ fontSize: 13, marginBottom: 14 }}>{detailError}</div>
          <button className="btn-sm primary" onClick={() => fetchDetail(page)}>Retry</button>
        </div>
      )}

      {/* Empty */}
      {!detailLoading && !detailError && transactions.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
          <Package size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>No transactions</div>
          <div style={{ fontSize: 13 }}>No stock movements for this item in the selected period.</div>
        </div>
      )}

      {/* Transaction table */}
      {!detailLoading && !detailError && transactions.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="table-scroll-wrap">
            <table style={{ minWidth: 680 }}>
              <thead>
                <tr>
                  <th style={{ width: '22%' }}>Date &amp; Time</th>
                  <th style={{ width: '10%' }}>Type</th>
                  <th style={{ width: '10%' }}>Change</th>
                  <th style={{ width: '12%' }}>Balance After</th>
                  <th style={{ width: '20%' }}>Reason</th>
                  <th style={{ width: '16%' }}>Note</th>
                  <th style={{ width: '10%' }}>By</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, idx) => {
                  // Backend: transaction_type ('add'|'deduct'|'adjustment'|'initial'),
                  //          quantity (always positive), balance_after, reason_category,
                  //          reason_note, created_at, performed_by_name
                  const isAdd = tx.transaction_type === 'add' || tx.transaction_type === 'initial';
                  const isAdjust = tx.transaction_type === 'adjustment';
                  const signedChange = isAdjust ? null : isAdd ? tx.quantity : -tx.quantity;
                  return (
                    <tr key={tx.id || idx}>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDateTime(tx.created_at)}</td>
                      <td><TxBadge type={tx.transaction_type} /></td>
                      <td>
                        {isAdjust
                          ? <span style={{ color: '#2563eb', fontWeight: 700, fontFamily: 'var(--mono)', fontSize: 12 }}>→ {tx.balance_after}</span>
                          : <NetCell value={signedChange} />}
                      </td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600 }}>
                        {tx.balance_after} <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{selectedItem?.unit}</span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text)' }}>{tx.reason_category || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{tx.reason_note || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{tx.performed_by_name || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Page {page} of {totalPages}</span>
              <button
                className="btn-sm"
                disabled={page <= 1 || detailLoading}
                onClick={() => fetchDetail(page - 1)}
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <button
                className="btn-sm"
                disabled={page >= totalPages || detailLoading}
                onClick={() => fetchDetail(page + 1)}
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={errorDialog.open}
        title="Error"
        message={errorDialog.message}
        variant="danger"
        confirmText="OK"
        hideCancel
        onConfirm={() => setErrorDialog({ open: false, message: '' })}
        onCancel={() => setErrorDialog({ open: false, message: '' })}
      />
    </div>
  );
}
