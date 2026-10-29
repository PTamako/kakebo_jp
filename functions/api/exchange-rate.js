// Public, read-only reference rate proxy. Does not access auth, D1 or ledger data.
// Frankfurter v2 publishes daily reference rates, not card settlement rates.
const BASES = new Set(['CNY', 'USD', 'EUR', 'KRW', 'JPY'])
const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': status === 200 ? 'public, max-age=21600' : 'no-store' }
})
export async function onRequestGet({ request }) {
  const from = new URL(request.url).searchParams.get('from')?.toUpperCase()
  if (!BASES.has(from)) return json({ error: '通貨を確認してください。' }, 400)
  if (from === 'JPY') return json({ from, to: 'JPY', rate: 1, date: new Date().toISOString().slice(0, 10), source: 'identity' })
  try {
    const response = await fetch(`https://api.frankfurter.dev/v2/rate/${from}/JPY`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
      cf: { cacheEverything: true, cacheTtl: 21600 }
    })
    if (!response.ok) return json({ error: '為替レートを取得できませんでした。' }, 502)
    const data = await response.json()
    const rate = Number(data.rate)
    if (data.base?.toUpperCase() !== from || data.quote?.toUpperCase() !== 'JPY' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.date || '') || !Number.isFinite(rate) || rate <= 0) {
      return json({ error: '為替レートを確認できませんでした。' }, 502)
    }
    return json({ from, to: 'JPY', rate, date: data.date, source: 'Frankfurter' })
  } catch {
    return json({ error: '為替レートを取得できませんでした。' }, 502)
  }
}
