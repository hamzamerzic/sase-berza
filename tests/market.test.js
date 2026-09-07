import test from 'node:test'
import assert from 'node:assert/strict'
import { downsample, formatTick, fmt, parseSymbols, fetchSase } from '../market.js'

test('sampling preserves endpoints and chronological order', () => {
  const rows = Array.from({ length: 1000 }, (_, date) => ({ date }))
  const sample = downsample(rows, 250)
  assert.equal(sample.length, 250)
  assert.equal(sample[0], rows[0])
  assert.equal(sample.at(-1), rows.at(-1))
  assert.ok(sample.every((row, index) => index === 0 || row.date > sample[index - 1].date))
})

test('empty and short histories are not padded or invented', () => {
  assert.deepEqual(downsample([]), [])
  const rows = [{ date: '2025-01-01', avg: 10 }]
  assert.equal(downsample(rows), rows)
})

test('date labels follow the requested range', () => {
  assert.equal(fmt(new Date(2025, 0, 9)), '09.01.2025')
  assert.equal(formatTick('2025-01-09', 30), '09.01')
  assert.equal(formatTick('2025-01-09', 1825), '01/25')
  assert.equal(formatTick(null, 30), '')
})

test('company search reads the SASE SymbolDescription field', () => {
  assert.deepEqual(parseSymbols(JSON.stringify([{ Symbol: 'TEST', SymbolDescription: 'TEST - Example company' }])),
    [{ symbol: 'TEST', name: 'Example company' }])
  assert.deepEqual(parseSymbols('[{"Name":"Missing symbol"}]'), [])
  assert.deepEqual(parseSymbols('{}'), [])
  assert.throws(() => parseSymbols('not JSON'))
})

test('feed reads use GET with header authentication and cancellation', async (t) => {
  const controller = new AbortController()
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = new URL(url, 'https://example.test')
    assert.equal(target.pathname, '/api/proxy')
    const feed = new URL(target.searchParams.get('url'))
    assert.equal(feed.searchParams.get('symbol'), 'TEST&ONE')
    assert.equal(options.headers.Authorization, 'Bearer test-only')
    assert.equal(options.signal, controller.signal)
    assert.equal(options.method, undefined)
    assert.ok(!url.includes('test-only'))
    return { ok: true, text: async () => 'response' }
  })
  assert.equal(await fetchSase({ type: '1', symbol: 'TEST&ONE' }, 'test-only', controller.signal), 'response')
})

test('HTTP failures remain errors instead of empty market history', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 502 }))
  await assert.rejects(fetchSase({ type: '1' }, 'test-only'), /HTTP 502/)
})
