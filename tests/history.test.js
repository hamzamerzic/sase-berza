import test from 'node:test'
import assert from 'node:assert/strict'
import { yearRanges, loadPriceHistory, parseXmlHistory } from '../market.js'

const day = text => new Date(`${text}T00:00:00`)
const key = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`

test('year chunks cover the full request without gaps, overlaps, or leap-day loss', () => {
  assert.deepEqual(yearRanges(day('2023-09-07'), day('2025-09-07')).map(r => [key(r.from), key(r.to)]), [
    ['2023-09-07', '2023-12-31'], ['2024-01-01', '2024-12-31'], ['2025-01-01', '2025-09-07'],
  ])
  assert.equal(yearRanges(day('2024-02-29'), day('2024-02-29')).length, 1)
  assert.throws(() => yearRanges(day('2025-01-02'), day('2025-01-01')), /valid/)
})

test('five-year history keeps older sessions rather than falling back to one year', async () => {
  let active = 0
  let peak = 0
  const progress = []
  const result = await loadPriceHistory('TEST', day('2021-09-07'), day('2026-09-07'), {
    onProgress: value => progress.push(value),
  }, async (_symbol, range) => {
    active++
    peak = Math.max(active, peak)
    await Promise.resolve()
    active--
    return [{ date: key(range.from), avg: 10 }]
  })
  assert.equal(result.rows.length, 6)
  assert.equal(result.rows[0].date, '2021-09-07')
  assert.equal(result.rows.at(-1).date, '2026-01-01')
  assert.deepEqual(result.missing, [])
  assert.ok(peak <= 2)
  assert.deepEqual(progress.at(-1), { completed: 6, total: 6 })
})

test('one failed year preserves successful rows and explicitly reports the gap', async () => {
  const result = await loadPriceHistory('TEST', day('2023-01-01'), day('2025-12-31'), {}, async (_symbol, range) => {
    if (range.from.getFullYear() === 2024) throw new Error('HTTP 502')
    return [{ date: key(range.from), avg: 10 }]
  })
  assert.equal(result.rows.length, 2)
  assert.deepEqual(result.missing, [{ from: '2024-01-01', to: '2024-12-31', message: 'HTTP 502' }])
})

test('valid empty years are not mistaken for failed requests', async () => {
  const result = await loadPriceHistory('TEST', day('2023-01-01'), day('2024-12-31'), {}, async () => [])
  assert.deepEqual(result.rows, [])
  assert.deepEqual(result.missing, [])
})

test('duplicate dates and out-of-range rows do not distort coverage', async () => {
  const result = await loadPriceHistory('TEST', day('2024-06-01'), day('2024-06-30'), {}, async () => [
    { date: '2024-06-12', avg: 10 }, { date: '2024-06-12', avg: 10 },
    { date: '2024-05-01', avg: 20 }, { date: '2024-07-01', avg: 20 },
  ])
  assert.deepEqual(result.rows, [{ date: '2024-06-12', avg: 10 }])
})

test('cancelling a stock change stops further years and never returns stale results', async () => {
  const controller = new AbortController()
  let calls = 0
  await assert.rejects(loadPriceHistory('OLD', day('2021-01-01'), day('2026-12-31'), {
    signal: controller.signal,
  }, async () => {
    calls++
    controller.abort()
    return [{ date: '2021-01-01', avg: 10 }]
  }), { name: 'AbortError' })
  assert.ok(calls <= 2)
})

test('blank feed responses are errors, not an empty trading year', () => {
  for (const response of ['', '   ', null]) assert.throws(() => parseXmlHistory(response), /empty response/)
})
