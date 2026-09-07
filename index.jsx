import { useState, useEffect, useCallback, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
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
      <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
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
      {/* Header */}
      <div style={s.header}>
        <span style={s.title}>🏛 SASE Berza</span>
        <span style={s.badge}>Sarajevo Stock Exchange</span>
      </div>

      {/* Search */}
      <input
        style={s.input}
        aria-label="Search stocks by symbol or company"
        placeholder={symbolsLoaded ? `Search ${allSymbols.length} symbols…` : 'Loading symbols…'}
        value={search}
        onChange={e => setSearch(e.target.value)}
        spellCheck={false}
      />

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
      <div style={s.row}>
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
      <div style={s.summary}>
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
                  {positive ? '▲' : '▼'} {Math.abs(pctChg).toFixed(2)}% ({loadedPeriod?.label || period.label})
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                last: {last.date}
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
        <div style={{ position: 'relative' }}>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData.length > 0 ? chartData : []} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
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
                tickFormatter={v => (typeof v === 'number' && isFinite(v)) ? v.toFixed(v < 10 ? 2 : 0) : ''}
                width={54}
              />
              <Tooltip content={<PriceTooltip />} />
              {chartData.length > 0 && (
                <Line
                  type="monotone"
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
        <div style={s.tableHeader}>Recent sessions</div>
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
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = {
  root: {
    padding: 16,
    height: '100%',
    overflow: 'auto',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'var(--font)',
    fontSize: 14,
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 14,
  },
  title: { fontSize: 20, fontWeight: 700 },
  badge: {
    background: 'var(--surface)', color: 'var(--muted)',
    fontSize: 11, padding: '2px 9px', borderRadius: 12,
  },
  input: {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
    color: 'var(--text)', padding: '8px 12px', fontSize: 14,
    marginBottom: 10,
  },
  row: { display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 },

  // Unified pill button — base style for chips and period toggles.
  pill: {
    background: 'var(--accent)', color: '#fff',
    border: '1px solid transparent', borderRadius: 6,
    padding: '4px 12px', minHeight: 44, cursor: 'pointer', fontSize: 12,
  },
  pillActive: {
    background: 'var(--accent)', color: '#fff',
    borderColor: 'var(--accent)',
  },

  // Summary card — flex row with space-between.
  summary: {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '12px 16px', marginBottom: 12,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  // Generic card — block layout, used for chart and table.
  card: {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '12px 4px', marginBottom: 12,
  },

  chartOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'color-mix(in srgb, var(--surface) 80%, transparent)',
    borderRadius: 8,
  },
  stockName:   { fontSize: 15, fontWeight: 600, marginBottom: 2 },
  stockTicker: { fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' },
  priceVal:    { fontSize: 26, fontWeight: 700, letterSpacing: '-0.5px' },

  tableHeader: {
    padding: '10px 14px', fontSize: 13, fontWeight: 600,
    color: 'var(--muted)', borderBottom: '1px solid var(--border)',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    textAlign: 'left', color: 'var(--muted)',
    padding: '7px 10px', borderBottom: '1px solid var(--border)',
    fontWeight: 500, whiteSpace: 'nowrap',
  },
  td: {
    padding: '6px 10px', borderBottom: '1px solid var(--bg)',
    color: 'var(--text)', whiteSpace: 'nowrap',
  },
  footer: {
    color: 'var(--muted)', fontSize: 11, textAlign: 'center', padding: '8px 0 16px',
  },
}

const CSS = `
  @keyframes saseSpin { to { transform: rotate(360deg) } }
  .sase-root :is(button, input):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sase-root button:hover { filter: brightness(1.12); }
  .sase-root input { min-height: 44px; }
  .sase-root table { font-variant-numeric: tabular-nums; }
  @media (prefers-reduced-motion: reduce) {
    .sase-root * { animation: none !important; }
  }
`
