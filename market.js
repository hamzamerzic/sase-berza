const SASE_URL = 'https://www.sase.ba/FeedServices/HandlerChart.ashx'

const MAIN_STOCKS = [
  { symbol: 'BHTSR',   name: 'BH Telecom d.d.' },
  { symbol: 'JPESR',   name: 'JP Elektroprivreda BiH' },
  { symbol: 'JPEMR',   name: 'JP Elektroprivreda HZHB' },
  { symbol: 'TCMKR',   name: 'HM Cement BiH' },
  { symbol: 'BSNLR',   name: 'Bosnalijek d.d.' },
  { symbol: 'SOSOR',   name: 'Sarajevo osiguranje' },
  { symbol: 'UNIBR',   name: 'Union banka d.d.' },
  { symbol: 'ZGBMR',   name: 'UniCredit Bank d.d.' },
  { symbol: 'TRZBR',   name: 'Ziraat Bank d.d.' },
  { symbol: 'GINXR',   name: 'Unis Ginex d.d.' },
  { symbol: 'SRPVRK1', name: 'Sarajevska Pivara' },
  { symbol: 'ALUMR',   name: 'Aluminij d.d. Mostar' },
  { symbol: 'ENISR',   name: 'Energoinvest d.d.' },
]

const PERIODS = [
  { label: '1M',  days: 30   },
  { label: '3M',  days: 90   },
  { label: '6M',  days: 180  },
  { label: '1Y',  days: 365  },
  { label: '3Y',  days: 1095 },
  { label: '5Y',  days: 1825 },
]


// ── Utilities ────────────────────────────────────────────────────────────────

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function fmt(d) { return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}` }

// Downsample data for long periods — keeps first, last, and evenly spaced points.
function downsample(data, maxPoints = 200) {
  if (!data || data.length === 0) return []
  if (data.length <= maxPoints) return data
  const result = [data[0]]
  const step = (data.length - 1) / (maxPoints - 1)
  for (let i = 1; i < maxPoints - 1; i++) {
    result.push(data[Math.round(i * step)])
  }
  result.push(data[data.length - 1])
  return result
}

// Format X-axis date based on period length.
function formatTick(dateStr, periodDays) {
  if (!dateStr || typeof dateStr !== 'string') return ''
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  const [y, m, d] = parts
  if (periodDays <= 90) return `${d}.${m}`       // 01.03
  return `${m}/${y.slice(2)}`                     // 03/24
}

async function fetchSase(params, token, signal) {
  // These feed operations are reads; GET also works inside an opaque app frame.
  const url = `${SASE_URL}?${new URLSearchParams(params)}`
  const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!res.ok) throw new Error(`SASE request failed: HTTP ${res.status}`)
  return res.text()
}

function parseSymbols(text) {
  const rows = JSON.parse(text)
  if (!Array.isArray(rows)) return []
  return rows.map(row => {
    const symbol = row.Symbol || row.symbol
    if (typeof symbol !== 'string' || !symbol) return null
    const description = row.SymbolDescription
    const name = row.IssuerName || row.issuerName || row.Name ||
      (typeof description === 'string' ? description.replace(`${symbol} - `, '') : symbol)
    return { symbol, name: typeof name === 'string' ? name : symbol }
  }).filter(Boolean)
}

function parseXmlHistory(xml) {
  if (!xml || typeof xml !== 'string' || xml.trim().length === 0) return []
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const parseErr = doc.querySelector('parsererror')
  if (parseErr) return []
  const rows = [...doc.querySelectorAll('NewDataSet > *')]
  if (!rows.length) return []

  return rows.map(r => {
    const g = name =>
      r.getAttribute(name) ??
      r.querySelector(name)?.textContent ??
      r.querySelector(name.toLowerCase())?.textContent ?? ''

    const day = g('TradingDay') || g('tradingday') || g('Date')
    const avg = parseFloat(g('AvgPrice') || g('avgprice') || g('Price')) || 0
    if (!day || !Number.isFinite(avg) || avg <= 0) return null

    return {
      date:   day.slice(0, 10),
      avg,
      close:  parseFloat(g('ClosePrice') || g('closeprice'))   || avg,
      high:   parseFloat(g('MaxPrice')   || g('maxprice'))     || avg,
      low:    parseFloat(g('MinPrice')   || g('minprice'))     || avg,
      volume: parseInt(g('Volume')       || g('volume'))       || 0,
      change: parseFloat(g('AvgPerChange') || g('avgperchange')) || 0,
    }
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date))
}


export { MAIN_STOCKS, PERIODS, daysAgo, fmt, downsample, formatTick, fetchSase, parseSymbols, parseXmlHistory }
