import { useState, useEffect, useCallback, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
import { Chart, TriangleExclamationErrorWarning, Search } from '@openai/apps-sdk-ui/components/Icon'
import { MAIN_STOCKS, PERIODS, daysAgo, fmt, downsample, formatTick, fetchSase, parseSymbols, parseXmlHistory } from './market.js'

// ── Constants ────────────────────────────────────────────────────────────────

const GREEN = '#22c55e'
const RED = '#ef4444'

// ── Sub-components ───────────────────────────────────────────────────────────

function PriceTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '10px 14px', fontSize: 12,
    }}>
      <div style={{ color: 'var(--muted)', marginBottom: 4 }}>{d.date}</div>
      <div style={{ color: 'var(--accent)', fontWeight: 600 }}>
        Avg: {d.avg.toFixed(2)} KM
      </div>
      {d.high !== d.avg && (
        <div style={{ color: GREEN }}>High: {d.high.toFixed(2)}</div>
      )}
      {d.low !== d.avg && (
        <div style={{ color: RED }}>Low: {d.low.toFixed(2)}</div>
      )}
      {d.volume > 0 && (
        <div style={{ color: 'var(--muted)' }}>Vol: {d.volume.toLocaleString()}</div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 16px' }}>
      <div style={{
        width: 28, height: 28,
        border: '3px solid var(--border)',
        borderTop: '3px solid var(--accent)',
        borderRadius: '50%',
        animation: 'saseSpin 0.8s linear infinite',
      }} />
      <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 12 }}>
        Loading price history…
      </div>
    </div>
  )
}

function EmptyMsg({ children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 16px', color: 'var(--muted)' }}>
      {children}
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px' }}>
      <TriangleExclamationErrorWarning aria-hidden="true" style={{ width: 28, height: 28, color: 'var(--muted)', marginBottom: 12 }} />
      <div style={{ color: RED, fontWeight: 600, marginBottom: 4 }}>
        Could not load data
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 12, maxWidth: 340, textAlign: 'center', marginBottom: 12 }}>
        {message}
      </div>
      <button style={s.pill} onClick={onRetry}>Retry</button>
    </div>
  )
}

// Unified toggle button used for both stock chips and period selectors.
function Toggle({ active, onClick, children, title, mono }) {
  return (
    <button
      title={title}
      aria-pressed={active}
      onClick={onClick}
      style={{
        ...s.pill,
        ...(mono ? { fontFamily: 'var(--mono)' } : {}),
        ...(active ? s.pillActive : { background: 'var(--surface)', color: 'var(--muted)' }),
      }}
    >
      {children}
    </button>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function SaseBerza({ token }) {
  const [stock,         setStock]         = useState(MAIN_STOCKS[0])
  const [period,        setPeriod]        = useState(PERIODS[3])
  const [data,          setData]          = useState([])
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)
  const [search,        setSearch]        = useState('')
  const [allSymbols,    setAllSymbols]    = useState(MAIN_STOCKS)
  const [symbolsLoaded, setSymbolsLoaded] = useState(false)
  const reqRef = useRef(0)
  const requestController = useRef(null)
  const [loadedPeriod, setLoadedPeriod] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    setSymbolsLoaded(false)
    fetchSase({ type: '20', symbol: '', lng: '0' }, token, controller.signal)
      .then(text => {
        const symbols = parseSymbols(text)
        if (symbols.length) setAllSymbols(symbols)
      })
      .catch(error => {
        if (error.name !== 'AbortError') {
          window.mobius?.signal('error', { source: 'symbols', message: error.message })
        }
        // The built-in list keeps stock selection usable if the feed is unavailable.
      })
      .finally(() => { if (!controller.signal.aborted) setSymbolsLoaded(true) })
    return () => controller.abort()
  }, [token])

  const loadHistory = useCallback(async (sym, per) => {
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    const id = ++reqRef.current
    setLoading(true)
    setError(null)
    setData([])
    setLoadedPeriod(null)

    // Try the requested period first, then fall back to shorter periods
    // so we always show whatever data is available.
    const fallbacks = PERIODS.filter(p => p.days <= per.days).reverse()

    try {
      for (const tryPer of fallbacks) {
        if (reqRef.current !== id) return

        const xml = await fetchSase({
          id: '1', type: '1',
          dateFrom: fmt(daysAgo(tryPer.days)),
          dateTo:   fmt(new Date()),
          cssClass: 'PriceGrid',
          symbol:   sym.symbol,
          Months: '0', lng: '0', Bonds: '',
        }, token, controller.signal)

        if (reqRef.current !== id) return
        const rows = parseXmlHistory(xml)
        if (rows.length > 0) {
          setData(rows)
          setLoadedPeriod(tryPer)
          window.mobius?.signal('app_ready', { item_count: rows.length })
          return
        }
      }
      setError('No trading data available for this symbol.')
    } catch (e) {
      if (reqRef.current !== id || e.name === 'AbortError') return
      setError(e.message)
      window.mobius?.signal('error', { source: 'history', message: e.message })
    } finally {
      if (reqRef.current === id) setLoading(false)
    }
  }, [token])

  useEffect(() => {
    loadHistory(stock, period)
    return () => { ++reqRef.current; requestController.current?.abort() }
  }, [stock, period, loadHistory])

  // Derived values — guard against empty or single-element data.
  const last  = data.length > 0 ? data[data.length - 1] : null
  const first = data.length > 0 ? data[0] : null
  const pctChg = last && first && first.avg > 0 && data.length > 1
    ? ((last.avg - first.avg) / first.avg * 100) : null
  const positive = pctChg !== null ? pctChg >= 0 : null

  // Search filtering.
  const q = search.trim().toLowerCase()
  const filtered = q
    ? allSymbols
        .filter(s => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
        .slice(0, 40)
    : MAIN_STOCKS

  // Downsample for chart (avoids sluggish rendering on 3Y/5Y).
  const chartData = downsample(data, 250)

  // Compute tick interval for readable X-axis.
  const tickInterval = chartData.length > 1 ? Math.max(1, Math.floor(chartData.length / 8)) : 0

  return (
    <div className="sase-root" style={s.root}>
      <style>{CSS}</style>
      <main className="sase-content">
      {/* Header */}
      <div style={s.header}>
        <div className="sase-brand"><Chart aria-hidden="true" /><h1 style={s.title}>SASE Berza</h1></div>
        <span style={s.badge}>Sarajevo Stock Exchange</span>
      </div>

      {/* Search */}
      <div className="sase-search"><Search aria-hidden="true" />
      <input
        style={s.input}
        aria-label="Search stocks by symbol or company"
        placeholder={symbolsLoaded ? `Search ${allSymbols.length} symbols…` : 'Loading symbols…'}
        value={search}
        onChange={e => setSearch(e.target.value)}
        spellCheck={false}
      />

      </div>

      {/* Stock chips */}
      <div style={s.row}>
        {filtered.map(sym => (
          <Toggle
            key={sym.symbol}
            active={stock.symbol === sym.symbol}
            title={sym.name}
            mono
            onClick={() => { setStock(sym); setSearch('') }}
          >
            {sym.symbol}
          </Toggle>
        ))}
        {q && filtered.length === 0 && (
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>No matches</span>
        )}
      </div>

      {/* Period selector */}
      <div className="sase-periods" aria-label="Chart period">
        {PERIODS.map(p => (
          <Toggle
            key={p.label}
            active={period.label === p.label}
            onClick={() => setPeriod(p)}
          >
            {p.label}
          </Toggle>
        ))}
      </div>

      {/* Summary card */}
      <div className="sase-summary" style={s.summary}>
        <div>
          <div style={s.stockName}>{stock.name}</div>
          <div style={s.stockTicker}>{stock.symbol} · BAM (KM)</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {loading ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>loading…</div>
          ) : last ? (
            <>
              <div style={s.priceVal}>{(typeof last.avg === 'number' && isFinite(last.avg)) ? last.avg.toFixed(2) : '—'}</div>
              {pctChg !== null && (
                <div style={{ fontSize: 13, fontWeight: 500, color: positive ? GREEN : RED }}>
                  {positive ? '▲' : '▼'} {Math.abs(pctChg).toFixed(2)}% <span style={{ color: 'var(--muted)', fontWeight: 400 }}>over {loadedPeriod?.label || period.label}</span>
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                Last session · {last.date}
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--muted)' }}>—</div>
          )}
        </div>
      </div>

      {loadedPeriod && loadedPeriod.days < period.days && (
        <p role="status" style={{ color: 'var(--muted)', fontSize: 12 }}>
          The requested {period.label} range was unavailable; showing {loadedPeriod.label}.
        </p>
      )}

      {/* Chart */}
      <div style={s.card}>
        <h2 className="sase-section-heading">Average price <span>KM</span></h2>
        <div style={{ position: 'relative' }}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData.length > 0 ? chartData : []} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
                interval={tickInterval}
                tickFormatter={v => formatTick(v, period.days)}
              />
              <YAxis
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                domain={[
                  dataMin => {
                    if (typeof dataMin !== 'number' || !isFinite(dataMin)) return 0
                    const pad = Math.max(dataMin * 0.02, 0.01)
                    return dataMin - pad
                  },
                  dataMax => {
                    if (typeof dataMax !== 'number' || !isFinite(dataMax)) return 1
                    const pad = Math.max(dataMax * 0.02, 0.01)
                    return dataMax + pad
                  },
                ]}
                tickFormatter={v => (typeof v === 'number' && isFinite(v)) ? v.toFixed(2) : ''}
                width={54}
              />
              <Tooltip content={<PriceTooltip />} />
              {chartData.length > 0 && (
                <Line
                  type="linear"
                  dataKey="avg"
                  stroke={positive === false ? RED : 'var(--accent)'}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: 'var(--accent)' }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
          {/* Overlay messages on top of the chart */}
          {loading && (
            <div style={s.chartOverlay}><Spinner /></div>
          )}
          {!loading && error && (
            <div style={s.chartOverlay}>
              <ErrorState message={error} onRetry={() => loadHistory(stock, period)} />
            </div>
          )}
          {!loading && !error && data.length === 0 && (
            <div style={s.chartOverlay}>
              <EmptyMsg>No trading data for this period.</EmptyMsg>
            </div>
          )}
        </div>
      </div>

      {/* Recent sessions table */}
      <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
        <h2 style={s.tableHeader}>Recent sessions <span className="sase-session-count">{Math.min(data.length, 30)} shown</span></h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                {['Date', 'Avg (KM)', 'High', 'Low', 'Chg %', 'Volume'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...s.td, textAlign: 'center', color: 'var(--muted)', padding: '20px 10px' }}>
                    {loading ? 'Loading…' : 'No data available'}
                  </td>
                </tr>
              ) : (
                [...data].reverse().slice(0, 30).map((r, i) => (
                  <tr key={r.date} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg)' }}>
                    <td style={s.td}>{r.date}</td>
                    <td style={{ ...s.td, fontWeight: 600 }}>{r.avg.toFixed(2)}</td>
                    <td style={{ ...s.td, color: GREEN }}>{r.high.toFixed(2)}</td>
                    <td style={{ ...s.td, color: RED }}>{r.low.toFixed(2)}</td>
                    <td style={{
                      ...s.td,
                      color: r.change > 0 ? GREEN : r.change < 0 ? RED : 'var(--muted)',
                    }}>
                      {r.change > 0 ? '+' : ''}{r.change.toFixed(2)}%
                    </td>
                    <td style={{ ...s.td, color: 'var(--muted)' }}>
                      {r.volume > 0 ? r.volume.toLocaleString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={s.footer}>
        Data · Sarajevo Stock Exchange (SASE) · Prices in BAM (KM)
      </div>
      </main>
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = {
  root: {
    padding: 0,
    height: '100%',
    overflow: 'auto',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'var(--font)',
    fontSize: 14,
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 24, justifyContent: 'space-between',
  },
  title: { fontSize: 22, fontWeight: 650, margin: 0, letterSpacing: '-0.4px' },
  badge: {
    background: 'var(--surface)', color: 'var(--muted)',
    fontSize: 12,
  },
  input: {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
    color: 'var(--text)', padding: '12px 14px 12px 42px', fontSize: 14,
  },
  row: { display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 20 },

  // Unified pill button — base style for chips and period toggles.
  pill: {
    background: 'var(--accent)', color: 'var(--bg)',
    border: '1px solid var(--border)', borderRadius: 8,
    padding: '8px 13px', minHeight: 44, cursor: 'pointer', fontSize: 12,
  },
  pillActive: {
    background: 'color-mix(in srgb, var(--accent) 16%, var(--surface))', color: 'var(--text)',
    borderColor: 'var(--accent)',
  },

  // Summary card — flex row with space-between.
  summary: {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
    padding: '22px 24px', marginBottom: 16, gap: 20,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  // Generic card — block layout, used for chart and table.
  card: {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
    padding: '20px 12px 12px', marginBottom: 20,
  },

  chartOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'color-mix(in srgb, var(--surface) 80%, transparent)',
    borderRadius: 8,
  },
  stockName:   { fontSize: 18, fontWeight: 600, marginBottom: 6 },
  stockTicker: { fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' },
  priceVal:    { fontSize: 32, fontWeight: 650, letterSpacing: '-0.5px' },

  tableHeader: {
    margin: 0, padding: '18px 20px', fontSize: 14, fontWeight: 600,
    color: 'var(--muted)', borderBottom: '1px solid var(--border)',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left', color: 'var(--muted)',
    padding: '12px 16px', borderBottom: '1px solid var(--border)',
    fontWeight: 500, whiteSpace: 'nowrap',
  },
  td: {
    padding: '11px 16px', borderBottom: '1px solid var(--bg)',
    color: 'var(--text)', whiteSpace: 'nowrap',
  },
  footer: {
    color: 'var(--muted)', fontSize: 11, textAlign: 'center', padding: '8px 0 16px',
  },
}

const CSS = `
  @keyframes saseSpin { to { transform: rotate(360deg) } }
  .sase-root :is(button, input):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sase-content { max-width: 1120px; margin: 0 auto; padding: 28px 28px 12px; }
  .sase-brand { display: flex; align-items: center; gap: 10px; }
  .sase-brand > svg { width: 26px; height: 26px; color: var(--accent); }
  .sase-search { position: relative; margin-bottom: 14px; }
  .sase-search > svg { position: absolute; width: 18px; height: 18px; left: 14px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
  .sase-summary > div:first-child { min-width: 0; flex: 1; overflow-wrap: anywhere; }
  .sase-summary > div:last-child { flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .sase-periods { display: flex; gap: 6px; margin-bottom: 20px; }
  .sase-periods button { flex: 0 1 64px; }
  .sase-section-heading { margin: 0 8px 18px; font-size: 14px; font-weight: 600; }
  .sase-section-heading span { color: var(--muted); font-size: 12px; font-weight: 400; margin-left: 6px; }
  .sase-session-count { float: right; font-size: 12px; font-weight: 400; }
  .sase-root button { transition: border-color 140ms ease, background 140ms ease; }
  .sase-root button:hover { border-color: var(--accent) !important; }
  .sase-root td:not(:first-child), .sase-root th:not(:first-child) { text-align: right !important; }
  .sase-root tbody tr:hover { background: var(--surface-2) !important; }
  .sase-root ::selection { background: var(--accent); color: var(--bg); }
  .sase-root input { caret-color: var(--accent); }
  @media (max-width: 600px) {
    .sase-content { padding: 20px 14px 8px; }
    .sase-summary { padding: 18px 16px !important; gap: 12px !important; }
    .sase-periods { gap: 4px; }
    .sase-periods button { flex: 1; padding-inline: 0 !important; }
    .sase-root th, .sase-root td { padding: 10px 12px !important; }
  }
  .sase-root input { min-height: 44px; }
  .sase-root table { font-variant-numeric: tabular-nums; }
  @media (prefers-reduced-motion: reduce) {
    .sase-root * { animation: none !important; transition: none !important; }
  }
`
