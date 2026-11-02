// Add the actual D1 default-matching dictionary to authenticated portable snapshots.
// Middleware calls the existing authenticated API first; never expose rules on errors.
// No additional DB tables, ledger mutations or startup seeding.
export async function onRequest(context) {
  const url = new URL(context.request.url)
  if (context.request.method !== 'GET' || url.pathname !== '/api/backup-snapshot')
    return context.next()

  const response = await context.next()
  if (!response.ok) return response
  const archive = await response.clone().json().catch(() => null)
  if (archive?.format !== 'kakeibo-ledger-backup') return response

  try {
    const { results = [] } = await context.env.DB.prepare(
      "SELECT keyword,category FROM rules WHERE substr(keyword,1,2)<>'__' ORDER BY keyword"
    ).all()
    // Source-of-truth is the D1 rules table, NOT a stale JS fixture.
    if (!results.length) {
      return Response.json({ error:'デフォルト分類ルールが空です。完全なバックアップを作成できません' }, { status:503, headers:{'cache-control':'no-store'} })
    }
    return Response.json({ ...archive, defaultRules:results }, {
      headers:{ 'cache-control':'no-store', 'content-type':'application/json; charset=utf-8' }
    })
  } catch {
    return Response.json({ error:'基本分類ルールのバックアップに失敗しました' }, { status:503, headers:{'cache-control':'no-store'} })
  }
}
