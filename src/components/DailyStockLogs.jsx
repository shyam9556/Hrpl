import { useState, useEffect, useCallback } from 'react';
import { stock } from '../utils/api';
import {
  Loader2, FileText, Info, Sun, Zap, Layers, Package,
  ChevronLeft, ChevronRight, AlertCircle, RefreshCw
} from 'lucide-react';


// ── IST date helper ──────────────────────────────────────────
// 'en-CA' locale returns YYYY-MM-DD natively — timezone-aware, no manual offset.
function getISTDateString() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

// ── Category config ──────────────────────────────────────────
const categoryConfig = {
  Panel:     { bg: 'rgba(245,166,35,0.06)',  color: '#f5a623', icon: Sun,    label: 'Solar Panels' },
  Inverter:  { bg: 'rgba(37,99,235,0.06)',   color: '#2563eb', icon: Zap,    label: 'Inverters' },
  Accessory: { bg: 'rgba(16,185,129,0.06)', color: '#10b981', icon: Layers, label: 'Accessories' },
  Wire:      { bg: 'rgba(139,92,246,0.06)', color: '#7c3aed', icon: Layers, label: 'Wires & Cables' },
  Default:   { bg: 'rgba(107,114,128,0.06)', color: '#4b5563', icon: Package, label: 'Stock Items' },
};

// ── Format a net change with color ───────────────────────────
function NetChange({ value }) {
  if (value === 0 || value == null) {
    return <span style={{ color: 'var(--muted)', fontWeight: 600 }}>—</span>;
  }
  const color = value > 0 ? 'var(--green)' : 'var(--red)';
  const prefix = value > 0 ? '+' : '';
  return <span style={{ color, fontWeight: 700 }}>{prefix}{value}</span>;
}

export default function DailyStockLogs() {
  // ── Mode: 'single' or 'range' ────────────────────────────
  const [mode, setMode] = useState('single');
  const today = getISTDateString();

  // ── Single-day state ─────────────────────────────────────
  const [date, setDate] = useState(today);

  // ── Range state ──────────────────────────────────────────
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);

  // ── Data state ───────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState([]);
  const [fetchError, setFetchError] = useState(false);

  // ── Fetch ────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      let res;
      if (mode === 'single') {
        res = await stock.getDaily({ date });
      } else {
        res = await stock.getDaily({ from: fromDate, to: toDate });
      }
      setBalances(res.data || []);
    } catch {
      setFetchError(true);
      setBalances([]);
    } finally {
      setLoading(false);
    }
  }, [mode, date, fromDate, toDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Prev / Next day navigation ───────────────────────────
  const navigateDay = (dir) => {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + dir);
    const newDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
    if (newDate <= today) setDate(newDate);
  };

  const isToday = date === today;

  // ── Group by category ────────────────────────────────────
  const grouped = {};
  for (const b of balances) {
    if (!grouped[b.category]) grouped[b.category] = [];
    grouped[b.category].push(b);
  }
  const hasData = balances.length > 0;

  // ── Single-day: compute opening, change, closing ─────────
  // Backend returns: opening_balance, closing_balance, live_quantity
  function getSingleRowValues(b) {
    const opening = b.opening_balance ?? 0;
    const closing = b.closing_balance ?? b.live_quantity ?? opening;
    const change  = closing - opening;
    return { opening, change, closing };
  }

  // ── Range: compute opening, added, used, net, closing ────
  // Backend returns: opening_balance, closing_balance, total_added, total_used
  function getRangeRowValues(b) {
    const opening = b.opening_balance ?? 0;
    const closing = b.closing_balance ?? opening;
    const added   = b.total_added  ?? 0;
    const used    = b.total_used   ?? 0;
    const net     = closing - opening;
    return { opening, added, used, net, closing };
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      {/* ── Header card ──────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        {/* Row 1: Title + Mode toggle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '18px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: 'rgba(46,125,82,0.1)', padding: 10, borderRadius: 10, color: 'var(--green)', flexShrink: 0 }}>
              <FileText size={20} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Daily Stock Report</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Opening, movement, and closing balance per item.</div>
            </div>
          </div>

          {/* Segmented mode toggle */}
          <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 8, padding: 3, gap: 2 }}>
            {[
              { key: 'single', label: 'Single Day' },
              { key: 'range',  label: 'Date Range' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                style={{
                  padding: '6px 16px',
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: mode === key ? 'white' : 'transparent',
                  color: mode === key ? 'var(--text)' : 'var(--muted)',
                  boxShadow: mode === key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Date controls */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '14px 24px', background: '#fafafa', borderRadius: '0 0 16px 16px' }}>
          {mode === 'single' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginRight: 4 }}>Date:</span>
              <button
                onClick={() => navigateDay(-1)}
                style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--muted)' }}
                title="Previous day"
              >
                <ChevronLeft size={14} />
              </button>
              <input
                type="date"
                value={date}
                max={today}
                onChange={e => setDate(e.target.value)}
                className="input-inline"
                style={{ fontWeight: 600, fontSize: 13, minWidth: 140 }}
              />
              <button
                onClick={() => navigateDay(1)}
                disabled={isToday}
                style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 10px', cursor: isToday ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', color: 'var(--muted)', opacity: isToday ? 0.4 : 1 }}
                title="Next day"
              >
                <ChevronRight size={14} />
              </button>
              {isToday && (
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', background: 'rgba(46,125,82,0.08)', padding: '3px 8px', borderRadius: 20 }}>Today</span>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>From:</span>
              <input
                type="date"
                value={fromDate}
                max={toDate}
                onChange={e => setFromDate(e.target.value)}
                className="input-inline"
                style={{ fontWeight: 600, fontSize: 13, minWidth: 140 }}
              />
              <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>To:</span>
              <input
                type="date"
                value={toDate}
                min={fromDate}
                max={today}
                onChange={e => setToDate(e.target.value)}
                className="input-inline"
                style={{ fontWeight: 600, fontSize: 13, minWidth: 140 }}
              />
              {fromDate === toDate && (
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>Same day selected</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Info banner ──────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', marginBottom: 20, fontSize: 13, color: 'var(--muted)' }}>
        <Info size={16} style={{ color: 'var(--blue, #3b82f6)', flexShrink: 0 }} />
        <div>
          <strong>Fully Automated:</strong> The system captures opening stock at day start and tracks all movements in real-time. No manual entry required.
        </div>
      </div>

      {/* ── Loading ───────────────────────────────────────────── */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--green)' }} />
        </div>
      )}

      {/* ── Fetch error ───────────────────────────────────────── */}
      {!loading && fetchError && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
          <AlertCircle size={36} style={{ marginBottom: 12, color: 'var(--red)', opacity: 0.7 }} />
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Failed to load report</div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>Please check your connection and try again.</div>
          <button className="btn-sm primary" onClick={fetchData} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────── */}
      {!loading && !fetchError && !hasData && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
          <AlertCircle size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>No data for this period</div>
          <div style={{ fontSize: 13 }}>
            {mode === 'single'
              ? `No stock records found for ${date}.`
              : `No stock records found between ${fromDate} and ${toDate}.`}
          </div>
        </div>
      )}

      {/* ── Category tables ───────────────────────────────────── */}
      {!loading && !fetchError && hasData && Object.keys(grouped).map(cat => {
        const config = categoryConfig[cat] || categoryConfig.Default;
        const CatIcon = config.icon;

        return (
          <div key={cat} className="card" style={{ marginBottom: 16 }}>
            {/* Category header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px 12px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: config.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CatIcon size={16} style={{ color: config.color }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{config.label}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>({grouped[cat].length} items)</span>
            </div>

            <div className="table-scroll-wrap">
              {mode === 'single' ? (
                /* ── SINGLE DAY TABLE ── */
                <table style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th style={{ width: '40%' }}>Item</th>
                      <th style={{ width: '20%' }}>Opening</th>
                      <th style={{ width: '20%' }}>Change</th>
                      <th style={{ width: '20%' }}>Closing {isToday ? '(Live)' : ''}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[cat].map(b => {
                      const { opening, change, closing } = getSingleRowValues(b);
                      return (
                        <tr key={b.stock_item_id}>
                          <td style={{ fontWeight: 600 }}>{b.item_name}</td>
                          <td>
                            <span style={{ fontWeight: 600 }}>{opening}</span>
                            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>{b.unit}</span>
                          </td>
                          <td>
                            <NetChange value={change} />
                            {change !== 0 && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>{b.unit}</span>}
                          </td>
                          <td>
                            <span style={{ fontWeight: 700, color: isToday ? 'var(--green)' : 'var(--text)' }}>{closing}</span>
                            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>{b.unit}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                /* ── DATE RANGE TABLE ── */
                <table style={{ minWidth: 620 }}>
                  <thead>
                    <tr>
                      <th style={{ width: '30%' }}>Item</th>
                      <th style={{ width: '14%' }}>Opening</th>
                      <th style={{ width: '14%' }}>+ Added</th>
                      <th style={{ width: '14%' }}>− Used</th>
                      <th style={{ width: '14%' }}>Net</th>
                      <th style={{ width: '14%' }}>Closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[cat].map(b => {
                      const { opening, added, used, net, closing } = getRangeRowValues(b);
                      return (
                        <tr key={b.stock_item_id}>
                          <td style={{ fontWeight: 600 }}>{b.item_name}</td>
                          <td>
                            <span style={{ fontWeight: 600 }}>{opening}</span>
                            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>{b.unit}</span>
                          </td>
                          <td>
                            {added > 0
                              ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>+{added}</span>
                              : <span style={{ color: 'var(--muted)' }}>—</span>}
                          </td>
                          <td>
                            {used > 0
                              ? <span style={{ color: 'var(--red)', fontWeight: 700 }}>−{used}</span>
                              : <span style={{ color: 'var(--muted)' }}>—</span>}
                          </td>
                          <td><NetChange value={net} /></td>
                          <td>
                            <span style={{ fontWeight: 700 }}>{closing}</span>
                            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>{b.unit}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        );
      })}

    </div>
  );
}
