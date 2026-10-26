// Cloudflare Pages Functions：/api/*
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } })

export async function onRequest({ request, env, params }) {
  // 个人使用：设置环境变量 AUTH_TOKEN 后，所有请求都需要携带 x-token
  if (env.AUTH_TOKEN && request.headers.get('x-token') !== env.AUTH_TOKEN)
    return json({ error: 'unauthorized' }, 401)

  const db = env.DB
  const url = new URL(request.url)
  const m = request.method
  const [a, b] = params.path || []
  const month = (url.searchParams.get('month') || '').slice(0, 7)

  try {
    if (a === 'entries') {
      if (m === 'GET') {
        const { results } = await db
          .prepare('SELECT * FROM entries WHERE date LIKE ?1 ORDER BY date DESC, time DESC, id DESC LIMIT 1000')
          .bind(month + '%').all()
        return json(results)
      }
      if (m === 'POST') {
        const e = await request.json()
        const amount = Math.round(Number(e.amount))
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !Number.isFinite(amount) || amount <= 0)
          return json({ error: '日期或金额不正确' }, 400)
        await db.prepare(
          'INSERT INTO entries (date,time,amount,category,merchant,note,raw) VALUES (?1,?2,?3,?4,?5,?6,?7)'
        ).bind(e.date, e.time || '', amount, e.category || '其他', e.merchant || '', e.note || '', (e.raw || '').slice(0, 2000)).run()
        return json({ ok: true })
      }
      if (m === 'DELETE' && b) {
        await db.prepare('DELETE FROM entries WHERE id = ?1').bind(Number(b)).run()
        return json({ ok: true })
      }
    }
    if (a === 'rules') {
      if (m === 'GET') return json((await db.prepare('SELECT * FROM rules').all()).results)
      if (m === 'POST') {
        const r = await request.json()
        const kw = String(r.keyword || '').trim()
        if (kw.length < 2) return json({ error: '关键词太短' }, 400)
        await db.prepare('INSERT OR REPLACE INTO rules (keyword,category) VALUES (?1,?2)').bind(kw, r.category).run()
        return json({ ok: true })
      }
    }
    if (a === 'stats' && m === 'GET') {
      const like = month + '%'
      const total = await db.prepare('SELECT COALESCE(SUM(amount),0) t, COUNT(*) n FROM entries WHERE date LIKE ?1').bind(like).first()
      const cat = await db.prepare('SELECT category, SUM(amount) amount FROM entries WHERE date LIKE ?1 GROUP BY category ORDER BY amount DESC').bind(like).all()
      const day = await db.prepare('SELECT date, SUM(amount) amount FROM entries WHERE date LIKE ?1 GROUP BY date ORDER BY date').bind(like).all()
      return json({ total: total.t, count: total.n, byCategory: cat.results, byDay: day.results })
    }
    return json({ error: 'not found' }, 404)
  } catch (err) {
    return json({ error: String(err.message || err) }, 500)
  }
}
