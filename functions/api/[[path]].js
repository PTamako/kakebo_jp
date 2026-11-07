import { isAppliedSbiTransfer, applyDueSbiTransfers } from './investment-transfer.js'
import { handlePrepaid, validPrepaidTarget, prepaidSchemaReady } from './prepaid-assets.js'
import { handlePortfolio } from './investment-portfolio.js'
import { recognizeWithGemma } from './gemma-ocr.js'
import { resolveRecurringApproval } from './recurring-approval.js'
import { nextAutomaticStartMonth, recurringRequestId, scheduledRecurringOnDate, scheduledRecurringDate } from '../../src/recurring-posting.js'
import { recurringManualSlot } from './recurring-collision.js'
import { aiQuotaState, reserveAiAttempt } from './ai-quota.js'
import { restoreAtomic } from './restore-atomic.js'
import { comparisonWindow, calculateSpendingComparison, nextCivilDay } from '../../src/stats-period-comparison.js'
// Cloudflare Pages Functions：/api/*
const validTime = value => value == null || value === '' || (typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value

// Date ranges are indexed; LIKE prefixes otherwise scan every ledger entry.
const entryDateBounds = period => {
  if(typeof period!=='string'||!/^\d{4}(?:-(0[1-9]|1[0-2]))?$/.test(period))return null
  const year=Number(period.slice(0,4));if(year<1||year>9998)return null
  const nextYear=String(year+1).padStart(4,'0')
  if(period.length===4)return {start:period+'-01-01',end:nextYear+'-01-01'}
  const month=Number(period.slice(5))
  return {start:period+'-01',end:month===12?nextYear+'-01-01':
    period.slice(0,5)+String(month+1).padStart(2,'0')+'-01'}
}
const pointChargeId = (requestId, entryId) =>
  requestId && requestId.length <= 100 ? 'point_charge_' + requestId : 'point_charge_entry_' + entryId
const isPointCharge = e => typeof e?.client_request_id === 'string' && e.client_request_id.startsWith('point_charge_')
async function rewardDestination(db, e, existingTarget = '') {
  if (e.type !== 'income' || e.category !== 'ポイント還元') return {target:null,source:null}
  const target = String(e.rewardDestination || '').trim()
  if (!target) return {target:null,source:null}
  if (target.startsWith('prepaid:') && await validPrepaidTarget(db,target)) {
    const cardName=target.slice('prepaid:'.length)
    const eligible=target===existingTarget || await db.prepare("SELECT name FROM payment_sources WHERE name=?1 AND is_archived=0").bind(cardName).first()
    if(eligible)return {target,source:'ポイント還元'}
  }
  if (target.startsWith('credit:')) {
    const name=target.slice('credit:'.length)
    if (name && name.length<=80 && !['現金','その他','其他','ポイント還元'].includes(name)) {
      const card=await db.prepare("SELECT name FROM payment_sources WHERE name=?1 AND source_type='standard' AND (is_archived=0 OR ?2=1)").bind(name,target===existingTarget?1:0).first()
      if (card) return {target,source:name}
    }
  }
  return {error:'登録済みのプリペイドカードまたはクレジットカードを選択してください'}
}
const pointTopUpSql = `INSERT INTO entries
  (date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source)
  SELECT date,time,amount,'投資・資産移動',substr(transfer_target,9)||'チャージ','ポイント還元の自動チャージ','','transfer',
    transfer_target,0,date,?2,'ポイント還元'
  FROM entries WHERE client_request_id=?1 AND type='income' AND category='ポイント還元' AND transfer_target=?3
  ON CONFLICT(client_request_id) DO UPDATE SET
    date=excluded.date,time=excluded.time,amount=excluded.amount,category=excluded.category,
    merchant=excluded.merchant,note=excluded.note,raw=excluded.raw,type=excluded.type,
    transfer_target=excluded.transfer_target,transfer_applied=0,transfer_date=excluded.transfer_date,
    payment_source=excluded.payment_source`

const json = (d, s = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders } })
const cookieSession = request => {
  const cookie = request.headers.get('cookie') || ''
  const match = cookie.match(/(?:^|;\s*)kakeibo_session=([a-f0-9]{64})(?:;|$)/)
  return match?.[1] || ''
}
const sessionCookie = (token, remember) =>
  'kakeibo_session='+token+'; HttpOnly; Secure; SameSite=Strict; Path=/api'+(remember ? '; Max-Age=2592000' : '')
const expiredSessionCookie = 'kakeibo_session=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0'

// GET /api/rules merges D1 rules (default fallback) and merchant_rules (user overrides).
// Never delete rules as a legacy table; explicit user overrides take precedence.
// SBIの投信積立引落は資産移動として扱い、生活支出から除外する。
const isInvestmentTransfer = e => {
  const text = [e.merchant, e.note, e.raw].filter(Boolean).join(' ').toLowerCase()
  return /証券投信積立サービス|投信積立サービス|翌月買付分/.test(text) ||
    (/sbi/.test(text) && /投信積立|投資信託積立/.test(text))
}

async function sessionHash(session) {
  const bytes = new TextEncoder().encode(session)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('')
}

export async function onRequest({ request, env, params }) {
  // Device sessions are revocable and expire after 30 days. Never store the access code.
  if (!env.AUTH_TOKEN) return json({ error: 'アクセス認証が設定されていません' }, 503)
  const db = env.DB
  const url = new URL(request.url)
  const m = request.method
  const [a, b] = params.path || []
  // Cloudflare Pages preview deployments must never mutate the production ledger,
  // even if a dashboard binding accidentally points to the production DB.
  // Login/logout stay usable for read-only preview QA.
  const host = url.hostname.toLowerCase()
  // Runtime environment markers cover custom preview domains; the host rule
  // covers Pages previews even when the dashboard forgets to set a marker.
  const isPagesPreview = (host.endsWith('.kakeibo-f17.pages.dev') && host !== 'kakeibo-f17.pages.dev') ||
    env.APP_ENV === 'preview' ||
    (typeof env.CF_PAGES_BRANCH === 'string' && !!env.CF_PAGES_BRANCH && env.CF_PAGES_BRANCH !== 'main')
  // Preview bindings cannot be inspected from this repo. Fail closed on ALL preview
  // API access until a dedicated Preview D1 binding is explicitly verified.
  // A single opt-in flag is not evidence that the DB bindings are separate.
  // Both IDs must be recorded in the Preview environment, verified in the
  // dashboard, and different. This still cannot inspect the binding itself.
  const previewDbVerified = env.PREVIEW_D1_ISOLATED === 'true' &&
    typeof env.PREVIEW_D1_ID === 'string' && /^[a-f0-9-]{36}$/i.test(env.PREVIEW_D1_ID) &&
    typeof env.PRODUCTION_D1_ID === 'string' && /^[a-f0-9-]{36}$/i.test(env.PRODUCTION_D1_ID) &&
    env.PREVIEW_D1_ID.toLowerCase() !== env.PRODUCTION_D1_ID.toLowerCase()
  if (isPagesPreview && !previewDbVerified)
    return json({error:'プレビュー環境のテスト専用DBが未確認です。本番のデータを保護するためAPIを停止しています',code:'preview_db_not_verified'},503)
  // Verify the ID stored INSIDE the actual bound D1, not just variables.
  // A Preview accidentally bound to production has no matching identity and
  // fails CLOSED before session/auth or other data is accessible.
  if (isPagesPreview) {
    let actualIdentity
    try {
      actualIdentity=await db.prepare("SELECT value FROM environment_identity WHERE name='database_id'").first()
    }catch { return json({error:'テスト用DBの識別情報がありません',code:'preview_db_not_verified'},503) }
    if(actualIdentity?.value?.toLowerCase()!==env.PREVIEW_D1_ID.toLowerCase())
      return json({error:'テスト用DBの識別情報が一致しません',code:'preview_db_not_verified'},503)
  }
  if (isPagesPreview && m !== 'GET' && a !== 'auth')
    return json({error:'プレビュー画面では明細・設定を更新できません。本番サイトをご利用ください',code:'preview_read_only'},403)
  if (a === 'auth') {
    if (b === 'login' && m === 'POST') {
      let body
      try { body = await request.json() } catch { return json({ error: '入力内容を確認してください' }, 400) }
      // Rate-limit failed access-code attempts per client IP.
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
      const ipHash = await sessionHash(ip)
      try {
        const now = Date.now()
        // Reclaim expired authentication rows without touching sessions still in use.
        await db.batch([
          db.prepare('DELETE FROM login_attempts WHERE reset_at <= ?1').bind(now),
          db.prepare('DELETE FROM device_sessions WHERE expires_at <= ?1').bind(now)
        ]).catch(() => {})
        const attempt = await db.prepare('SELECT attempts, reset_at FROM login_attempts WHERE ip_hash = ?1').bind(ipHash).first()
        if (attempt && attempt.reset_at > now && attempt.attempts >= 5) return json({ error: 'しばらくしてから再度お試しください' }, 429)
        if (typeof body?.code !== 'string' || body.code !== env.AUTH_TOKEN) {
          await db.prepare('INSERT INTO login_attempts (ip_hash, attempts, reset_at) VALUES (?1, 1, ?2) ON CONFLICT(ip_hash) DO UPDATE SET attempts = CASE WHEN reset_at <= ?3 THEN 1 ELSE attempts + 1 END, reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END').bind(ipHash, now + 15 * 60 * 1000, now).run()
          return json({ error: 'アクセスコードを確認してください' }, 401)
        }
        await db.prepare('DELETE FROM login_attempts WHERE ip_hash = ?1').bind(ipHash).run()
      } catch { return json({ error: 'ログイン処理に失敗しました' }, 503) }
      const session = Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('')
      const hash = await sessionHash(session)
      const expires = Date.now() + 30 * 24 * 60 * 60 * 1000
      try {
        await db.prepare('INSERT INTO device_sessions (token_hash, expires_at) VALUES (?1, ?2)').bind(hash, expires).run()
      } catch { return json({ error: 'ログイン処理に失敗しました' }, 500) }
      // On a newly installed PWA, use the saved D1 privacy preference
      // rather than blindly replacing it with the login screen's default.
      let remember = body.remember !== false
      try {
        const savedMode = await db.prepare("SELECT value_json FROM app_client_state WHERE state_key='remember_device'").first()
        if (savedMode) remember = JSON.parse(savedMode.value_json) === true
      } catch { /* The pre-0010 login path still works. */ }
      return json({ session, expires_at: expires }, 200,
        { 'set-cookie': sessionCookie(session, remember) })
    }
    if (b === 'logout' && m === 'POST') {
      const session = request.headers.get('x-session') || cookieSession(request)
      if (/^[a-f0-9]{64}$/.test(session)) {
        try { await db.prepare('DELETE FROM device_sessions WHERE token_hash = ?1').bind(await sessionHash(session)).run() } catch {}
      }
      return json({ ok: true }, 200, { 'set-cookie': expiredSessionCookie })
    }
    if (b === 'remember' && m === 'PUT') {
      const session = request.headers.get('x-session') || cookieSession(request)
      if (!/^[a-f0-9]{64}$/.test(session))
        return json({error:'再ログインしてください'},401)
      const found = await db.prepare('SELECT token_hash FROM device_sessions WHERE token_hash = ?1 AND expires_at > ?2')
        .bind(await sessionHash(session),Date.now()).first()
      if (!found) return json({error:'再ログインしてください'},401)
      const body = await request.json().catch(() => null)
      if (typeof body?.remember !== 'boolean') return json({error:'保存方法を確認してください'},400)
      // Persist the D1 privacy preference before issuing the new cookie.
      // This single endpoint replaces two competing client-side writes.
      try {
        await db.prepare("INSERT INTO app_client_state(state_key,value_json,updated_at) VALUES('remember_device',?1,CURRENT_TIMESTAMP) ON CONFLICT(state_key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP")
          .bind(JSON.stringify(body.remember)).run()
      } catch { return json({error:'保存方法をD1に記録できませんでした。設定は変更していません'},503) }
      return json({ok:true},200,{'set-cookie':sessionCookie(session,body.remember)})
    }
    return json({ error: '対象が見つかりません' }, 404)
  }
  const session = request.headers.get('x-session') || cookieSession(request)
  if (!/^[a-f0-9]{64}$/.test(session)) return json({ error: 'アクセスコードを確認してください' }, 401)
  let validSession
  try { validSession = await db.prepare('SELECT token_hash FROM device_sessions WHERE token_hash = ?1 AND expires_at > ?2').bind(await sessionHash(session), Date.now()).first() }
  catch { return json({ error: 'アクセス認証を確認できません' }, 503) }
  if (!validSession) return json({ error: 'アクセスコードを確認してください' }, 401)
  if (a === 'ai-ocr' && b === 'quota' && m === 'GET') {
    try { return json(await aiQuotaState(db,env)) }
    catch { return json({error:'AI利用枠を確認できません'},503) }
  }
  if (a === 'ai-ocr' && m === 'POST') {
    if (!env.AI) return json({ error: 'AI接続が未設定です。Cloudflare PagesのAIバインディングを確認してください' }, 503)
    const size = Number(request.headers.get('content-length') || 0)
    if (size > 5 * 1024 * 1024) return json({ error: '画像サイズが大きすぎます' }, 413)
    let body
    try { body = await request.formData() } catch { return json({ error: '画像を読み込めませんでした' }, 400) }
    const file = body.get('image')
    const mode = ['receipt','statement','portfolio','portfolio-detail'].includes(body.get('mode')) ? body.get('mode') : 'statement'
    if (!file || typeof file.arrayBuffer !== 'function' || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024)
      return json({ error: 'JPEG・PNG・WebP画像（4MB以下）を選択してください' }, 400)
    // Reserve a daily attempt before invoking Cloudflare AI; if quota D1 fails, use local OCR.
    try {
      const quota=await reserveAiAttempt(db,env)
      if(!quota.allowed)return json({error:'本日のAI画像認識の上限に達しました。端末内OCRをご利用ください',code:'daily_limit'},429)
    }catch {return json({error:'AI使用枠を確認できないため、端末内OCRをご利用ください',code:'quota_unavailable'},503)}
    try {
      const text = await recognizeWithGemma(env.AI, await file.arrayBuffer(), file.type, mode)
      return json({ text, engine: 'gemma4' })
    } catch (error) {
      const detail = String(error?.message || '')
      const category = /429|3040|capacity|rate.limit/i.test(detail) ? 'capacity' : /quota|credit|limit.exceeded/i.test(detail) ? 'quota' : /401|403|unauthoriz|permission/i.test(detail) ? 'permission' : /timeout|timed.out|deadline/i.test(detail) ? 'timeout' : /image|format|invalid|schema|input|400/i.test(detail) ? 'input' : /文字を読み取れません|empty|response/i.test(detail) ? 'empty_response' : 'unknown'
      console.error('Gemma OCR failed', { category, name: error?.name || 'Error', message: detail.slice(0, 400) })
      const messages = { capacity: 'AIが混雑しています。時間をおいて再試行してください', quota: 'AIの利用枠を確認してください', permission: 'AIの利用権限を確認してください', timeout: 'AIの応答がタイムアウトしました', input: 'AIが画像入力を受け付けませんでした', empty_response: 'AIの応答から文字を取得できませんでした', unknown: 'AI画像認識に失敗しました' }
      return json({ error: messages[category], code: category }, 502)
    }
  }
  const month = url.searchParams.get('month') || ''
  const entriesYear = url.searchParams.get('year') || ''

  try {
    const tokyoToday = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const applyDueTransfers = () => applyDueSbiTransfers(db, tokyoToday())
    // D1 migrations have been completed. Requests never create schema,
    // import legacy records, or write default investment snapshots. User-initiated writes remain available.
    // Normalized recurring plans and bills are the sole persistent stores.
    // Obsolete finance_settings is intentionally neither created nor queried.
    // D1 stores only the authenticated remember-device preference and cloud draft backup.
    // OCR consent and FX currency are always device-local.
    // These writes cannot modify the ledger, investment holdings or scheduled expenses.
    if (a === 'app-state' && !b) {
      const allowed = new Set(['remember_device','unsaved_draft'])
      try {
        if (m === 'GET') {
          const selectedKey = url.searchParams.get('key')
          if (selectedKey && !allowed.has(selectedKey)) return json({error:'取得する設定を確認してください'},400)
          const query = selectedKey
            ? db.prepare('SELECT state_key,value_json FROM app_client_state WHERE state_key=?1').bind(selectedKey)
            : db.prepare('SELECT state_key,value_json FROM app_client_state')
          const {results} = await query.all()
          const state = {}
          for (const entry of results) {
            if (!allowed.has(entry.state_key)) continue
            try { state[entry.state_key] = JSON.parse(entry.value_json) } catch {}
          }
          return json(state)
        }
        if (m === 'PUT') {
          const body = await request.json().catch(() => null)
          if (!allowed.has(body?.key)) return json({error:'保存項目を確認してください'},400)
          const value = body.value
          if (body.key === 'remember_device' && typeof value !== 'boolean')
            return json({error:'設定値を確認してください'},400)
          if (body.key === 'unsaved_draft' &&
              (typeof value !== 'object' || !value || Array.isArray(value) ||
                !Array.isArray(value.forms) || value.forms.length > 150 ||
                typeof value.input !== 'string' || value.input.length > 100000 ||
                !['manual','scan'].includes(value.mode)))
            return json({error:'下書きデータを確認してください'},400)
          const encoded = JSON.stringify(value)
          if (encoded.length > 250000) return json({error:'下書きの保存容量を超えました'},413)
          await db.prepare('INSERT INTO app_client_state(state_key,value_json,updated_at) VALUES(?1,?2,CURRENT_TIMESTAMP) ON CONFLICT(state_key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP')
            .bind(body.key,encoded).run()
          return json({ok:true})
        }
        if (m === 'DELETE') {
          const key = url.searchParams.get('key')
          if (!allowed.has(key)) return json({error:'削除項目を確認してください'},400)
          await db.prepare('DELETE FROM app_client_state WHERE state_key=?1').bind(key).run()
          return json({ok:true})
        }
      } catch(error) {
        if (/no such table: app_client_state/i.test(String(error)))
          return json({error:'端末設定用のD1移行（0011）が必要です。既存明細は変更されていません',code:'app_state_schema_required'},503)
        throw error
      }
    }
    // Acknowledged review notices belong to D1, not PWA localStorage.
    // This endpoint never inserts or deletes financial entries or legacy data.
    if (a === 'review-notices' && !b) {
      const validNoticeKey = key => typeof key === 'string' && (
        /^c:v1:[0-9a-f]{16}$/.test(key) ||
        /^d:v1:[0-9a-f]{16}$/.test(key) ||
        /^r:[A-Za-z0-9_-]{1,80}:\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.test(key) ||
        /^t:[1-9]\d{0,14}$/.test(key))
      try {
        if (m === 'GET') {
          const {results} = await db.prepare('SELECT notice_key FROM review_notice_states ORDER BY notice_key').all()
          return json({keys:results.map(item => item.notice_key)})
        }
        if (m === 'PUT') {
          const body = await request.json().catch(() => null)
          const add = body?.add, remove = body?.remove
          if (!Array.isArray(add) || !Array.isArray(remove) || !add.length && !remove.length ||
              add.length + remove.length > 5000 || [...add,...remove].some(key => !validNoticeKey(key)))
            return json({error:'確認状態の更新内容を確認してください'},400)
          const toAdd = [...new Set(add)], toRemove = [...new Set(remove)]
          if (toAdd.some(key => toRemove.includes(key)))
            return json({error:'確認状態の更新内容が競合しています'},400)
          const operations = [
            ...toRemove.map(key => db.prepare('DELETE FROM review_notice_states WHERE notice_key=?1').bind(key)),
            ...toAdd.map(key => db.prepare('INSERT OR IGNORE INTO review_notice_states(notice_key) VALUES(?1)').bind(key))
          ]
          // Each D1 batch is transactional. Only user-confirmed notification keys change.
          for (let i = 0; i < operations.length; i += 100)
            await db.batch(operations.slice(i,i+100))
          return json({ok:true,count:operations.length})
        }
      } catch (error) {
        if (/no such table: review_notice_states/i.test(String(error)))
          return json({error:'確認履歴用のD1移行（0010）が必要です。明細は変更されていません',code:'review_schema_required'},503)
        throw error
      }
    }
    if (a === 'recurring-exclusions') {
      if (m === 'GET' && !b) {
        const [months,dates]=await Promise.all([
          db.prepare('SELECT plan_id,month FROM recurring_candidate_exclusions ORDER BY month DESC,plan_id').all(),
          db.prepare('SELECT plan_id,date FROM recurring_date_exclusions ORDER BY date DESC,plan_id').all()
        ])
        return json([...months.results.map(x=>({planId:x.plan_id,month:x.month})),
          ...dates.results.map(x=>({planId:x.plan_id,date:x.date,month:x.date.slice(0,7)}))])
      }
      if ((m === 'POST' || m === 'DELETE') && !b) {
        const body=await request.json().catch(()=>null)
        const planId=body?.planId,month=body?.month,date=body?.date
        if (typeof planId!=='string' || !/^[a-zA-Z0-9-]{8,80}$/.test(planId) ||
          typeof month!=='string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
          (date!=null && (typeof date!=='string' || !validDate(date) || !date.startsWith(month+'-'))))
          return json({error:'除外する固定費と日付を確認してください'},400)
        const plan=await db.prepare('SELECT start_month,schedule_type,weekday,day,workday_only FROM recurring_plans WHERE id=?1').bind(planId).first()
        const today=tokyoToday(), tomorrow=nextCivilDay(today)
        // A scheduled occurrence can be excluded at most one day early.
        // Monthly rules exclude the matching month, weekly rules the exact date.
        // Existing historic exclusions can still be removed; no early entry writes.
        const targetDate=date || (plan?.schedule_type==='monthly' ? scheduledRecurringDate(month,Number(plan.day)) : null)
        if(!plan || month<plan.start_month || month>tomorrow.slice(0,7) ||
          (date && (plan.schedule_type!=='weekly' || !scheduledRecurringOnDate(plan,date))) ||
          (targetDate && targetDate>tomorrow) ||
          (month>today.slice(0,7) && targetDate!==tomorrow))
          return json({error:'固定費の対象日は明日まで指定できます'},409)
        if(m==='POST'){
          if(date)await db.prepare('INSERT OR IGNORE INTO recurring_date_exclusions(plan_id,date) VALUES(?1,?2)').bind(planId,date).run()
          else await db.prepare('INSERT OR IGNORE INTO recurring_candidate_exclusions(plan_id,month) VALUES(?1,?2)').bind(planId,month).run()
        }else{
          if(date)await db.prepare('DELETE FROM recurring_date_exclusions WHERE plan_id=?1 AND date=?2').bind(planId,date).run()
          else await db.prepare('DELETE FROM recurring_candidate_exclusions WHERE plan_id=?1 AND month=?2').bind(planId,month).run()
        }
        return json({ok:true})
      }
      return json({error:'未対応の操作です'},405)
    }
    if (a === 'recurring-plans' || a === 'card-bills') {
      if (m === 'GET' && !b) {
        if (a === 'recurring-plans') {
          const trash = url.searchParams.get('trash') === '1'
          let results
          try {
            const query = trash
              ? `SELECT p.id,p.name,p.amount,p.day,p.category,p.payment_source,p.start_month,p.enabled,p.posting_mode,p.auto_from_month,p.schedule_type,p.weekday,p.workday_only,t.deleted_at AS archived_at
                 FROM recurring_plans p JOIN trash_items t ON t.item_type='recurring_plan' AND t.item_id=p.id ORDER BY t.deleted_at DESC`
              : `SELECT p.id,p.name,p.amount,p.day,p.category,p.payment_source,p.start_month,p.enabled,p.posting_mode,p.auto_from_month,p.schedule_type,p.weekday,p.workday_only
                 FROM recurring_plans p WHERE NOT EXISTS (SELECT 1 FROM trash_items t WHERE t.item_type='recurring_plan' AND t.item_id=p.id)
                 ORDER BY p.name,p.id`
            ;({results} = await db.prepare(query).all())
          } catch(e) {
            if (!/no such table: trash_items/i.test(String(e))) throw e
            // Migration 0012 is manual. Normal reads must remain available
            // before it is applied; do not silently permit archiving.
            if (trash) return json([])
            ;({results} = await db.prepare('SELECT id,name,amount,day,category,payment_source,start_month,enabled,posting_mode,auto_from_month,schedule_type,weekday,workday_only FROM recurring_plans ORDER BY name,id').all())
          }
          return json(results.map(p => ({id:p.id,name:p.name,amount:p.amount,day:p.day,category:p.category,paymentSource:p.payment_source,startMonth:p.start_month,enabled:!!p.enabled,postingMode:p.posting_mode||'manual',autoFromMonth:p.auto_from_month||'',scheduleType:p.workday_only?'workday':(p.schedule_type||'monthly'),weekday:Number(p.weekday||0), ...(trash ? {archivedAt:p.archived_at} : {})})))
        }
        const {results} = await db.prepare('SELECT payment_source,bill_month,period_start,period_end,total_amount,transaction_count FROM card_bills ORDER BY bill_month DESC,payment_source').all()
        return json(results.map(x => ({name:x.payment_source,month:x.bill_month,start:x.period_start,end:x.period_end,total:x.total_amount,count:x.transaction_count})))
      }
      if (a === 'recurring-plans') {
        if (m === 'POST' && !b) {
          const item = await request.json()
          if (typeof item?.id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(item.id) ||
              typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 ||
              !Number.isSafeInteger(item.amount) || item.amount <= 0 ||
              !Number.isInteger(item.day) || item.day < 1 || item.day > 31 ||
              typeof item.category !== 'string' || !item.category || typeof item.paymentSource !== 'string' ||
              !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.startMonth || '') || typeof item.enabled !== 'boolean' || !['auto','manual'].includes(item.postingMode ?? 'manual') || !['monthly','weekly','workday'].includes(item.scheduleType ?? 'monthly') || !Number.isInteger(item.weekday ?? 0) || (item.weekday ?? 0)<0 || (item.weekday ?? 0)>6)
            return json({error:'固定支出の入力を確認してください'},400)
          const mode=item.postingMode||'manual'
          const workdayOnly=item.scheduleType==='workday'?1:0
          const storedSchedule=workdayOnly?'weekly':(item.scheduleType||'monthly')
          const autoFrom=mode==='auto' ? nextAutomaticStartMonth(tokyoToday(),item.day,item.startMonth,item.scheduleType||'monthly',item.weekday||0) : ''
          const result = await db.prepare('INSERT OR IGNORE INTO recurring_plans(id,name,amount,day,category,payment_source,start_month,enabled,posting_mode,auto_from_month,schedule_type,weekday,workday_only) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)').bind(item.id,item.name.trim(),item.amount,item.day,item.category,item.paymentSource,item.startMonth,item.enabled ? 1 : 0,mode,autoFrom,storedSchedule,item.weekday||0,workdayOnly).run()
          return json({ok:true,created:!!result.meta?.changes})
        }
        if (m === 'PUT' && b && /^[a-zA-Z0-9-]{8,80}$/.test(b)) {
          const item = await request.json()
          if (typeof item?.name !== 'string' || !item.name.trim() || item.name.length > 120 ||
              !Number.isSafeInteger(item.amount) || item.amount <= 0 ||
              !Number.isInteger(item.day) || item.day < 1 || item.day > 31 ||
              typeof item.category !== 'string' || !item.category.trim() ||
              typeof item.paymentSource !== 'string' ||
              !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.startMonth || '') ||
              typeof item.enabled !== 'boolean' || (item.postingMode != null && !['auto','manual'].includes(item.postingMode)) || (item.scheduleType != null && !['monthly','weekly','workday'].includes(item.scheduleType)) || !Number.isInteger(item.weekday ?? 0) || (item.weekday ?? 0)<0 || (item.weekday ?? 0)>6) return json({error:'固定支出の入力を確認してください'},400)
          const prior = await db.prepare("SELECT name,amount,day,category,payment_source,start_month,enabled,posting_mode,auto_from_month,schedule_type,weekday,workday_only FROM recurring_plans WHERE id=?1 AND NOT EXISTS (SELECT 1 FROM trash_items WHERE item_type='recurring_plan' AND item_id=?1)").bind(b).first()
          if (!prior) return json({error:'固定支出が見つかりません'},404)
          const mode=item.postingMode ?? prior.posting_mode
          const workdayOnly=item.scheduleType==='workday'?1:0
          const storedSchedule=workdayOnly?'weekly':(item.scheduleType||'monthly')
          const sameSchedule=prior.name===item.name.trim() && Number(prior.amount)===item.amount && Number(prior.day)===item.day && prior.category===item.category && prior.payment_source===item.paymentSource && prior.start_month===item.startMonth && !!prior.enabled===item.enabled && prior.schedule_type===storedSchedule && Number(prior.workday_only||0)===workdayOnly && Number(prior.weekday)===Number(item.weekday||0)
          const autoFrom=mode==='auto' ? (prior.posting_mode==='auto' && sameSchedule && prior.auto_from_month ? prior.auto_from_month : nextAutomaticStartMonth(tokyoToday(),item.day,item.startMonth,item.scheduleType||'monthly',item.weekday||0)) : ''
          const updated = await db.prepare("UPDATE recurring_plans SET name=?1,amount=?2,day=?3,category=?4,payment_source=?5,start_month=?6,enabled=?7,posting_mode=?8,auto_from_month=?9,schedule_type=?10,weekday=?11,workday_only=?13 WHERE id=?12 AND NOT EXISTS (SELECT 1 FROM trash_items WHERE item_type='recurring_plan' AND item_id=?12)")
            .bind(item.name.trim(),item.amount,item.day,item.category,item.paymentSource,item.startMonth,item.enabled?1:0,mode,autoFrom,storedSchedule,item.weekday||0,b,workdayOnly).run()
          if(!updated.meta?.changes)return json({error:'固定支出が見つかりません'},404)
          // Stable plan IDs preserve the monthly idempotency key. Existing ledger entries are untouched.
          return json({ok:true})
        }
        if (b && /^[a-zA-Z0-9-]{8,80}$/.test(b) &&
            params.path?.[2] === 'restore' && m === 'POST') {
          const result=await db.prepare("DELETE FROM trash_items WHERE item_type='recurring_plan' AND item_id=?1").bind(b).run()
          if (!result.meta?.changes) return json({error:'ゴミ箱に固定費が見つかりません'},404)
          return json({ok:true})
        }
        if (b && /^[a-zA-Z0-9-]{8,80}$/.test(b) &&
            params.path?.[2] === 'purge' && m === 'DELETE') {
          // Only a second explicit confirmation may permanently remove the
          // archived schedule. Never delete previously saved ledger rows.
          if (request.headers.get('x-confirm-purge') !== b)
            return json({error:'削除対象の再確認が必要です'},428)
          const archived=await db.prepare("SELECT 1 FROM trash_items WHERE item_type='recurring_plan' AND item_id=?1").bind(b).first()
          if (!archived) return json({error:'ゴミ箱に固定費が見つかりません'},404)
          await db.batch([
            db.prepare("DELETE FROM recurring_candidate_exclusions WHERE plan_id=?1 AND EXISTS (SELECT 1 FROM trash_items WHERE item_type='recurring_plan' AND item_id=?1)").bind(b),
            db.prepare("DELETE FROM recurring_plans WHERE id=?1 AND EXISTS (SELECT 1 FROM trash_items WHERE item_type='recurring_plan' AND item_id=?1)").bind(b),
            db.prepare("DELETE FROM trash_items WHERE item_type='recurring_plan' AND item_id=?1").bind(b)
          ])
          return json({ok:true})
        }
        if (m === 'DELETE' && b && /^[a-zA-Z0-9-]{8,80}$/.test(b) && !params.path?.[2]) {
          // Soft delete: preserve IDs, schedule, exclusions and ledger data.
          const existing=await db.prepare('SELECT 1 FROM recurring_plans WHERE id=?1').bind(b).first()
          if (!existing) return json({error:'固定費が見つかりません'},404)
          await db.prepare("INSERT OR IGNORE INTO trash_items(item_type,item_id) VALUES('recurring_plan',?1)").bind(b).run()
          return json({ok:true})
        }
      } else {
        if (m === 'POST' && b === 'recalculate') {
          const item=await request.json()
          if(typeof item?.name!=='string'||!item.name.trim()||item.name.length>80||
             !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month||'')||
             !validDate(item.start)||!validDate(item.end)||item.start>item.end)
            return json({error:'カードの対象期間を確認してください'},400)
          // One SQL statement calculates and writes the bill from authoritative
          // D1 entries. A stale browser cache can never overwrite this total.
          await db.prepare(`INSERT INTO card_bills(payment_source,bill_month,period_start,period_end,total_amount,transaction_count)
            SELECT ?1,?2,?3,?4,MAX(0,COALESCE(SUM(CASE WHEN type='income' THEN -amount ELSE amount END),0)),COUNT(*)
            FROM entries WHERE date>=?3 AND date<=?4
              AND ((payment_source=?1 AND (type='expense' OR (type='transfer' AND
                (transfer_target='sbi' OR (transfer_target LIKE 'prepaid:%' AND LENGTH(transfer_target)>8)))))
                OR (type='income' AND category='ポイント還元' AND transfer_target='credit:'||?1))
            ON CONFLICT(payment_source,bill_month) DO UPDATE SET
              period_start=excluded.period_start,period_end=excluded.period_end,
              total_amount=excluded.total_amount,transaction_count=excluded.transaction_count`)
            .bind(item.name,item.month,item.start,item.end).run()
          const latest=await db.prepare('SELECT total_amount AS total,transaction_count AS count FROM card_bills WHERE payment_source=?1 AND bill_month=?2').bind(item.name,item.month).first()
          return json({ok:true,total:latest.total,count:latest.count})
        }
        if ((m === 'PUT' || m === 'POST') && !b) {
          const item = await request.json()
          if (typeof item?.name !== 'string' || !item.name || item.name.length > 80 ||
              !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month || '') ||
              !validDate(item.start) || !validDate(item.end) || item.start > item.end || !Number.isSafeInteger(item.total) || item.total < 0 ||
              !Number.isSafeInteger(item.count) || item.count < 0)
            return json({error:'カード請求額を確認してください'},400)
          // Restore uses POST (insert-only) so another device's saved bill always wins.
          const statement = m === 'POST'
            ? 'INSERT OR IGNORE INTO card_bills(payment_source,bill_month,period_start,period_end,total_amount,transaction_count) VALUES(?1,?2,?3,?4,?5,?6)'
            : 'INSERT INTO card_bills(payment_source,bill_month,period_start,period_end,total_amount,transaction_count) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(payment_source,bill_month) DO UPDATE SET period_start=excluded.period_start,period_end=excluded.period_end,total_amount=excluded.total_amount,transaction_count=excluded.transaction_count'
          await db.prepare(statement).bind(item.name,item.month,item.start,item.end,item.total,item.count).run()
          return json({ok:true})
        }
        if (m === 'DELETE' && !b) {
          const name = url.searchParams.get('name') || ''
          const month = url.searchParams.get('month') || ''
          if (!name || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({error:'削除対象の請求を確認してください'},400)
          await db.prepare('DELETE FROM card_bills WHERE payment_source=?1 AND bill_month=?2').bind(name,month).run()
          return json({ok:true})
        }
      }
      return json({error:'未対応の操作です'},405)
    }
    if (a === 'backup-snapshot' && m === 'GET') {
      // db.batch() executes all SELECTs inside one D1 transaction, preventing
      // mixed ledger/settings snapshots between requests or devices.
      const size=await db.prepare('SELECT COUNT(*) AS total FROM entries').first()
      if(Number(size.total)>10000)return json({error:'大容量のバックアップは段階的に作成してください',code:'snapshot_too_large'},413)
      // Legacy D1 continues to support v3 backups until the explicit
      // additive portfolio migration has been applied. Never auto-create tables.
      const schema=await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('investment_plans','investment_plan_history','investment_holdings','fund_prices','sbi_transfer_links')").first()
      const portfolioReady=Number(schema?.n)===5
      const archiveSchema=await db.prepare("SELECT 1 AS ready FROM sqlite_master WHERE type='table' AND name='trash_items'").first()
      const recurringArchiveReady=!!archiveSchema?.ready
      const statements=[
        'SELECT * FROM entries ORDER BY id',
        recurringArchiveReady
          ? `SELECT id,name,amount,day,category,payment_source,start_month,enabled,posting_mode,auto_from_month,schedule_type,weekday,workday_only FROM recurring_plans p WHERE NOT EXISTS (SELECT 1 FROM trash_items t WHERE t.item_type='recurring_plan' AND t.item_id=p.id) ORDER BY id`
          : 'SELECT id,name,amount,day,category,payment_source,start_month,enabled,posting_mode,auto_from_month,schedule_type,weekday,workday_only FROM recurring_plans ORDER BY id',
        'SELECT payment_source,bill_month,period_start,period_end,total_amount,transaction_count FROM card_bills ORDER BY payment_source,bill_month',
        
        "SELECT " + (await prepaidSchemaReady(db)
          ? "name,closing_day,is_default,sort_order,source_type,stat_group,opening_balance,opening_date,opening_entry_id,is_archived"
          : "name,closing_day,is_default,sort_order,'standard' AS source_type,0 AS opening_balance,'' AS opening_date,0 AS opening_entry_id")
          + " FROM payment_sources ORDER BY CASE WHEN name IN ('その他','其他') THEN 1 ELSE 0 END,sort_order,name",
        'SELECT keyword,payment_source FROM merchant_rules WHERE payment_source IS NOT NULL ORDER BY keyword',
        'SELECT keyword,category FROM merchant_rules WHERE category IS NOT NULL ORDER BY keyword',
        'SELECT category FROM category_source ORDER BY CASE WHEN category IN (\'其他\',\'その他\') THEN 1 ELSE 0 END,COALESCE(sort_order,10000),category',
        'SELECT category,sort_order,icon,display_name,entry_type,is_default FROM category_source ORDER BY category',
        'SELECT entry_id FROM dismissed_transfer_reminders ORDER BY entry_id',
        ...(portfolioReady ? [
          'SELECT fund_code,account_type,fund_name,monthly_amount,order_day,enabled,updated_at FROM investment_plans ORDER BY fund_code,account_type',
          'SELECT fund_code,account_type,effective_month,fund_name,monthly_amount,order_day,enabled,updated_at FROM investment_plan_history ORDER BY fund_code,account_type,effective_month',
          'SELECT fund_code,account_type,fund_name,units,acquisition_cost,reported_value,reported_at,updated_at FROM investment_holdings ORDER BY fund_code,account_type',
          'SELECT fund_code,nav_per_10000,price_date,source,updated_at FROM fund_prices ORDER BY fund_code',
          'SELECT entry_id,purchase_month FROM sbi_transfer_links ORDER BY entry_id'
        ] : []),
        'SELECT plan_id,month FROM recurring_candidate_exclusions ORDER BY plan_id,month',
        ...(recurringArchiveReady ? [`SELECT p.id,p.name,p.amount,p.day,p.category,p.payment_source,p.start_month,p.enabled,p.posting_mode,p.auto_from_month,p.schedule_type,p.weekday,p.workday_only
          FROM recurring_plans p JOIN trash_items t ON t.item_type='recurring_plan' AND t.item_id=p.id ORDER BY p.id`,
          "SELECT item_id,payload_json,deleted_at FROM trash_items WHERE item_type='entry' ORDER BY item_id"] : []),
        'SELECT plan_id,date FROM recurring_date_exclusions ORDER BY plan_id,date'
      ].map(sql=>db.prepare(sql))
      const results=await db.batch(statements)
      const rows=n=>results[n]?.results||[]
      return json({
        format:'kakeibo-ledger-backup',version:portfolioReady ? 4 : 3,exportedAt:new Date().toISOString(),
        entries:rows(0),
        plans:rows(1).map(x=>({id:x.id,name:x.name,amount:x.amount,day:x.day,category:x.category,paymentSource:x.payment_source,startMonth:x.start_month,enabled:!!x.enabled,postingMode:x.posting_mode||'manual',autoFromMonth:x.auto_from_month||'',scheduleType:x.workday_only?'workday':(x.schedule_type||'monthly'),weekday:Number(x.weekday||0)})),
        bills:rows(2).map(x=>({name:x.payment_source,month:x.bill_month,start:x.period_start,end:x.period_end,total:x.total_amount,count:x.transaction_count})),
        paymentSources:rows(3),merchantPaymentRules:rows(4),
        customRules:rows(5).map(rule=>({...rule,is_custom:true})),
        categories:rows(6).map(x=>x.category),
        categoryIcons:Object.fromEntries(rows(7).filter(x=>x.icon).map(x=>[x.category,x.icon])),
        categoryMetadata:rows(7),
        dismissedTransfers:rows(8).map(x=>x.entry_id),
        recurringExclusions:rows(portfolioReady ? 14 : 9).map(x=>({planId:x.plan_id,month:x.month})),
        recurringDateExclusions:rows(portfolioReady ? (recurringArchiveReady?17:15) : (recurringArchiveReady?12:10)).map(x=>({planId:x.plan_id,date:x.date})),
        archivedPlans:recurringArchiveReady ? rows(portfolioReady ? 15 : 10).map(p=>({
          id:p.id,name:p.name,amount:p.amount,day:p.day,category:p.category,paymentSource:p.payment_source,startMonth:p.start_month,enabled:!!p.enabled,postingMode:p.posting_mode||'manual',autoFromMonth:p.auto_from_month||'',scheduleType:p.workday_only?'workday':(p.schedule_type||'monthly'),weekday:Number(p.weekday||0)
        })) : [],
        trashedEntries:recurringArchiveReady ? rows(portfolioReady ? 16 : 11) : [],
        ...(portfolioReady ? {investmentPlans:rows(9),investmentPlanHistory:rows(10),
          investmentHoldings:rows(11),fundPrices:rows(12),transferLinks:rows(13)} : {})
      })
    }
    if (a === 'restore-atomic' && m === 'POST') {
      const size=Number(request.headers.get('content-length')||0)
      if(size>2*1024*1024)return json({error:'一括復元のサイズ上限を超えました'},413)
      const payload=await request.json()
      try {
        const result=await restoreAtomic(db,payload)
        return json(result)
      }catch(e){
        if(/atomic_restore_too_large/.test(String(e)))return json({error:'一括復元の安全上限を超えました。小分け復元を使用してください'},413)
        if(/atomic_restore_invalid|バックアップ|不正|形式|取引/.test(String(e)))return json({error:'復元データを確認してください'},400)
        throw e
      }
    }
    if (a === 'finance-settings')
      return json({error:'この旧設定APIは廃止されました。現在の管理画面をご利用ください',code:'deprecated_finance_settings'},410)
    if (a === 'payment-sources' || a === 'merchant-payment-rules') {
      // Use the already migrated merchant_rules table; never re-import old mappings.
    }
    if (a === 'prepaid-assets') return handlePrepaid({db,request,method:m,sub:b})
    if (a === 'payment-sources' && !b && m === 'GET') {
      // Closing days are authoritative on payment_sources.closing_day.
      // Never recreate the deprecated finance_settings table.
      // Enforce the persisted sentinel on existing databases, without touching
      // transaction/payment references or any user-created payment method.
      // The completed migration already persisted payment sorting. Read only.
      const migrated=await prepaidSchemaReady(db)
      const columns=migrated?'name,is_default,closing_day,source_type,stat_group,opening_balance,opening_date,opening_entry_id,is_archived':"name,is_default,closing_day,'standard' AS source_type,'card' AS stat_group,0 AS opening_balance,'' AS opening_date,0 AS opening_entry_id,0 AS is_archived"
      const {results}=await db.prepare("SELECT "+columns+" FROM payment_sources ORDER BY CASE WHEN name IN ('その他','其他') THEN 1 ELSE 0 END,sort_order,name").all()
      return json(results)
    }
    if (a === 'payment-sources' && b === 'restore-missing' && m === 'POST') {
      const body = await request.json()
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      const closingDay = body?.closingDay ?? null
      if (!name || name.length > 80 ||
          (closingDay !== null && (!Number.isInteger(closingDay) || closingDay < 0 || closingDay > 31)))
        return json({error:'復元するカード設定を確認してください'},400)
      // Insert name and closing day atomically; no later update may replace a
      // different device's card settings created in the meantime.
      const result = await db.prepare("INSERT OR IGNORE INTO payment_sources(name,sort_order,closing_day) VALUES(?1,CASE WHEN ?1 IN ('その他','其他') THEN 99999 ELSE (SELECT COALESCE(MAX(sort_order),-1)+1 FROM payment_sources WHERE name NOT IN ('その他','其他') AND sort_order<99999) END,?2)")
        .bind(name,closingDay).run()
      return json({ok:true,created:!!result.meta?.changes})
    }
    if (a === 'payment-sources' && b === 'restore-default' && m === 'POST') {
      const body = await request.json()
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      if (!name || name.length > 80) return json({error:'既定カードを確認してください'},400)
      // Never reset a newer default set by another device while restoring.
      const result = await db.prepare('UPDATE payment_sources SET is_default=1 WHERE name=?1 AND is_archived=0 AND NOT EXISTS (SELECT 1 FROM payment_sources WHERE is_default=1)').bind(name).run()
      return json({ok:true,restored:!!result.meta?.changes})
    }
    if (a === 'payment-sources' && b === 'closing-day' && m === 'POST') {
      const body = await request.json()
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      const day = body?.closingDay
      if (!name || !Number.isInteger(day) || day < 0 || day > 31) return json({error:'カードと締め日を確認してください'},400)
      const result = await db.prepare('UPDATE payment_sources SET closing_day=?1 WHERE name=?2').bind(day,name).run()
      if (!result.meta?.changes) return json({error:'カードが見つかりません'},404)
      return json({ok:true})
    }
    // Historic browser-card bootstrap is retired after completed D1 migration.
    // Reject even stale clients; an empty payment_sources table must remain empty.
    if (a === 'payment-sources' && b === 'initialize') {
      return json({error:'旧カード設定の自動移行は終了しました'},410)
    }
    if (a === 'payment-sources' && !b && m === 'POST') {
      const body = await request.json()
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      if (!name || name.length > 80) return json({ error: 'カード名を確認してください' }, 400)
      const kind=body.sourceType||'standard'
      const statGroup=body.statGroup||'card'
      if(!['standard','prepaid'].includes(kind)||!['card','points'].includes(statGroup)||(name==='現金' && statGroup!=='card'))return json({error:'カード種別・集計区分を確認してください'},400)
      if(kind==='prepaid'){
        if(['現金','その他','其他'].includes(name))return json({error:'現金・その他はプリペイドに設定できません'},400)
        if(!await prepaidSchemaReady(db))return json({error:'プリペイド設定の移行が必要です'},409)
        await db.prepare("INSERT OR IGNORE INTO payment_sources(name,sort_order,source_type,stat_group,opening_balance,opening_date,opening_entry_id) VALUES(?1,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM payment_sources WHERE sort_order<99999),'prepaid',?3,0,?2,(SELECT COALESCE(MAX(id),0) FROM entries))").bind(name,new Date(Date.now()+9*3600000).toISOString().slice(0,10),statGroup).run()
      } else {
        await db.prepare("INSERT OR IGNORE INTO payment_sources(name,sort_order,stat_group) VALUES(?1,CASE WHEN ?1 IN ('その他','其他') THEN 99999 ELSE (SELECT COALESCE(MAX(sort_order),-1)+1 FROM payment_sources WHERE name NOT IN ('その他','其他') AND sort_order<99999) END,?2)").bind(name,statGroup).run()
      }
      return json({ok:true})
    }
    if (a === 'payment-sources' && b === 'stat-group' && m === 'POST') {
      const body = await request.json().catch(() => null)
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      const statGroup = body?.statGroup
      if(!name || name.length>80 || name==='現金' || !['card','points'].includes(statGroup))
        return json({error:'支払方法と集計区分を確認してください'},400)
      const existing=await db.prepare('SELECT stat_group FROM payment_sources WHERE name=?1').bind(name).first()
      if(!existing)return json({error:'登録済みの支払方法が見つかりません'},404)
      if(existing.stat_group===statGroup)return json({ok:true,changed:false})
      const updated=await db.prepare('UPDATE payment_sources SET stat_group=?1 WHERE name=?2 AND stat_group=?3')
        .bind(statGroup,name,existing.stat_group).run()
      if(!updated.meta?.changes)return json({error:'支払方法の設定が変更されました。再読み込みしてください'},409)
      return json({ok:true,changed:true})
    }
    if (a === 'payment-sources' && b === 'type' && m === 'POST') {
      if(!await prepaidSchemaReady(db))return json({error:'プリペイド設定の移行が必要です'},409)
      const body=await request.json(),name=String(body?.name||'').trim(),kind=body?.sourceType
      if(!name||name.length>80||['現金','その他','其他'].includes(name)||!['standard','prepaid'].includes(kind))return json({error:'カード種別を確認してください'},400)
      const existing=await db.prepare('SELECT source_type FROM payment_sources WHERE name=?1').bind(name).first()
      if(!existing)return json({error:'カードが見つかりません'},404)
      if(existing.source_type===kind)return json({ok:true})
      if(kind==='standard'){
        const used=await db.prepare("SELECT id FROM entries WHERE type='transfer' AND transfer_target=?1 LIMIT 1").bind('prepaid:'+name).first()
        if(used)return json({error:'チャージ履歴があるため通常カードに変更できません'},409)
        await db.prepare("UPDATE payment_sources SET source_type='standard',opening_balance=0,opening_date='',opening_entry_id=0 WHERE name=?1").bind(name).run()
      } else {
        await db.prepare("UPDATE payment_sources SET source_type='prepaid',opening_balance=0,opening_date=?1,opening_entry_id=(SELECT COALESCE(MAX(id),0) FROM entries) WHERE name=?2 AND source_type='standard'").bind(new Date(Date.now()+9*3600000).toISOString().slice(0,10),name).run()
      }
      return json({ok:true})
    }
    if (a === 'payment-sources' && b === 'default' && m === 'POST') {
      const body = await request.json()
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      if (name && !(await db.prepare('SELECT name FROM payment_sources WHERE name=?1 AND is_archived=0').bind(name).first())) return json({ error: '有効なカードを選択してください' }, 400)
      // One atomic SQL statement: never leave every card without a default
      // if a second request fails or another device edits the same setting.
      // Guard the target inside the statement in case it was deleted after
      // the existence check above. An empty name explicitly clears defaults.
      const updated = await db.prepare(`UPDATE payment_sources
        SET is_default=CASE WHEN name=?1 THEN 1 ELSE 0 END
        WHERE ?1='' OR EXISTS(SELECT 1 FROM payment_sources WHERE name=?1 AND is_archived=0)`)
        .bind(name).run()
      if (name && !updated.meta?.changes) return json({error:'登録済みのカードを選択してください'},404)
      return json({ ok: true })
    }
    if (a === 'payment-sources' && b === 'archive' && m === 'POST') {
      const body=await request.json().catch(()=>null)
      const name=typeof body?.name==='string'?body.name.trim():''
      const archived=body?.archived
      if(!name||name.length>80||['現金','その他','其他'].includes(name)||typeof archived!=='boolean')
        return json({error:'アーカイブするカードと状態を確認してください'},400)
      const current=await db.prepare('SELECT is_archived FROM payment_sources WHERE name=?1').bind(name).first()
      if(!current)return json({error:'カードが見つかりません'},404)
      if(Boolean(current.is_archived)===archived)return json({ok:true,archived,changed:false})
      // Disabled/archived plans keep history; ACTIVE recurring postings must
      // be stopped or reassigned explicitly before archiving the payment card.
      const updated=await db.prepare(`UPDATE payment_sources
        SET is_archived=?1,is_default=CASE WHEN ?1=1 THEN 0 ELSE is_default END
        WHERE name=?2 AND is_archived<>?1 AND
          (?1=0 OR NOT EXISTS(SELECT 1 FROM recurring_plans
            WHERE payment_source=?2 AND enabled=1 AND NOT EXISTS(
              SELECT 1 FROM trash_items WHERE item_type='recurring_plan' AND item_id=recurring_plans.id)))`)
        .bind(archived?1:0,name).run()
      if(!updated.meta?.changes)
        return json({error:'有効な固定費で使用中のためアーカイブできません。先に固定費を停止または変更してください',code:'active_recurring_plan'},409)
      return json({ok:true,archived,changed:true})
    }
    if (a === 'payment-sources' && b === 'remove' && m === 'POST') {
      const body = await request.json()
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      if (!name || name === '現金') return json({ error: 'カード名を確認してください' }, 400)
      // Do not remove a card that is still used by an enabled automatic charge.
      const activePlan = await db.prepare('SELECT id FROM recurring_plans WHERE payment_source=?1 AND enabled=1 LIMIT 1').bind(name).first()
      if (activePlan) return json({error:'このカードを利用する固定支出が残っています。先に固定支出の設定を整理してください'},409)
      if(await prepaidSchemaReady(db)){
        const card=await db.prepare('SELECT source_type,opening_balance FROM payment_sources WHERE name=?1').bind(name).first()
        if(card?.source_type==='prepaid' && Number(card.opening_balance)>0)
          return json({error:'期首残高のあるプリペイドカードは削除できません。アーカイブをご利用ください'},409)
      }
      // Source identifiers are part of history; never orphan an old bill or reward.
      const historical=await db.prepare(`SELECT 1 AS linked FROM entries
        WHERE payment_source=?1 OR transfer_target='prepaid:'||?1 OR transfer_target='credit:'||?1
        UNION ALL SELECT 1 FROM card_bills WHERE payment_source=?1
        UNION ALL SELECT 1 FROM recurring_plans WHERE payment_source=?1 LIMIT 1`).bind(name).first()
      if(historical)return json({error:'過去の明細・保存済み請求・固定費で使用中のため削除できません。名称変更で履歴を保持してください',code:'payment_source_in_use'},409)
      await db.batch([
        db.prepare('DELETE FROM merchant_rules WHERE payment_source=?1 AND category IS NULL').bind(name),
        db.prepare('UPDATE merchant_rules SET payment_source=NULL WHERE payment_source=?1').bind(name),
        db.prepare('DELETE FROM payment_sources WHERE name=?1').bind(name)
      ])
      return json({ ok: true })
    }
    if (a === 'merchant-payment-rules' && m === 'GET') {
      const { results } = await db.prepare('SELECT keyword, payment_source FROM merchant_rules WHERE payment_source IS NOT NULL ORDER BY LENGTH(keyword) DESC').all()
      return json(results)
    }
    if (a === 'merchant-payment-rules' && (m === 'POST' || m === 'PUT')) {
      const body = await request.json()
      const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : ''
      const name = typeof body?.paymentSource === 'string' ? body.paymentSource.trim() : ''
      if (keyword.length < 2 || keyword.length > 80 || !name || name.length > 80) return json({ error: '店舗と支払方法を確認してください' }, 400)
      if (!(await db.prepare('SELECT name FROM payment_sources WHERE name=?1 AND is_archived=0').bind(name).first())) return json({ error: '有効な支払方法を選択してください' }, 400)
      // PUT is reserved for insert-if-missing during restore. Normal POST keeps edit behavior.
      const statement = m === 'PUT'
        ? 'INSERT INTO merchant_rules(keyword,payment_source) VALUES(?1,?2) ON CONFLICT(keyword) DO UPDATE SET payment_source=COALESCE(merchant_rules.payment_source,excluded.payment_source)'
        : 'INSERT INTO merchant_rules(keyword,payment_source) VALUES(?1,?2) ON CONFLICT(keyword) DO UPDATE SET payment_source=excluded.payment_source'
      await db.prepare(statement).bind(keyword,name).run()
      return json({ ok: true })
    }
    if (a === 'merchant-payment-rules' && m === 'DELETE') {
      const keyword = url.searchParams.get('keyword') || ''
      if (!keyword || keyword.length > 80) return json({ error: '店舗名を確認してください' }, 400)
      await db.batch([
        db.prepare('DELETE FROM merchant_rules WHERE keyword=?1 AND category IS NULL').bind(keyword),
        db.prepare('UPDATE merchant_rules SET payment_source=NULL WHERE keyword=?1').bind(keyword)
      ])
      return json({ ok: true })
    }

    if (a === 'payment-sources' && b === 'rename' && m === 'POST') {
      const body = await request.json()
      const oldName = typeof body?.oldName === 'string' ? body.oldName.trim() : ''
      const newName = typeof body?.newName === 'string' ? body.newName.trim() : ''
      if (!oldName || !newName || oldName === '現金' || oldName.length > 80 || newName.length > 80)
        return json({ error: 'カード名を確認してください' }, 400)
      if (!(await db.prepare('SELECT name FROM payment_sources WHERE name=?1').bind(oldName).first()))
        return json({error:'元のカードが見つかりません。明細は変更していません',code:'payment_source_not_found'},404)
      if (oldName === newName) return json({ ok: true, changes: 0 })
      if (await db.prepare('SELECT name FROM payment_sources WHERE name=?1').bind(newName).first()) return json({ error: '同じカード名が登録されています' }, 409)
      // Schema is provisioned by explicit migrations, never by business requests.
      // D1 batch keeps ledger, card and normalized finance references consistent.
      // A saved bill for the destination name/month must not be silently overwritten.
      const collision = await db.prepare('SELECT 1 AS found FROM card_bills WHERE payment_source=?1 AND bill_month IN (SELECT bill_month FROM card_bills WHERE payment_source=?2) LIMIT 1').bind(newName,oldName).first()
      if (collision) return json({error:'変更先に同月のカード請求が存在します'},409)
      // Place the parent-card rename last and guard every dependent UPDATE.
      // If another device removed the old card before this D1 batch starts,
      // none of its historical ledger rows may be re-labelled. D1 rolls back
      // the entire batch on a duplicate target name.
      const present="EXISTS (SELECT 1 FROM payment_sources WHERE name=?2)"
      const result = await db.batch([
        db.prepare('UPDATE merchant_rules SET payment_source=?1 WHERE payment_source=?2 AND '+present).bind(newName,oldName),
        db.prepare('UPDATE entries SET payment_source=?1 WHERE payment_source=?2 AND '+present).bind(newName,oldName),
        db.prepare(`UPDATE entries
          SET transfer_target=?1, merchant=CASE
            WHEN type='transfer' AND client_request_id LIKE 'point_charge_%'
              AND merchant IN ('ポイント還元',?3||'チャージ') THEN ?4||'チャージ'
            ELSE merchant END
          WHERE transfer_target=?2 AND EXISTS (SELECT 1 FROM payment_sources WHERE name=?5)`)
          .bind('prepaid:'+newName,'prepaid:'+oldName,oldName,newName,oldName),
        db.prepare('UPDATE entries SET transfer_target=?1 WHERE transfer_target=?2 AND EXISTS (SELECT 1 FROM payment_sources WHERE name=?3)').bind('credit:'+newName,'credit:'+oldName,oldName),
        db.prepare('UPDATE recurring_plans SET payment_source=?1 WHERE payment_source=?2 AND '+present).bind(newName,oldName),
        db.prepare('UPDATE card_bills SET payment_source=?1 WHERE payment_source=?2 AND '+present).bind(newName,oldName),
        db.prepare("UPDATE payment_sources SET name=?1,sort_order=CASE WHEN ?1 IN ('その他','其他') THEN 99999 WHEN ?2 IN ('その他','其他') THEN (SELECT COALESCE(MAX(sort_order),-1)+1 FROM payment_sources WHERE name NOT IN ('その他','其他') AND sort_order<99999) ELSE sort_order END WHERE name=?2").bind(newName,oldName)
      ])
      if (!result[6]?.meta?.changes) return json({error:'元のカードが見つかりません。明細は変更していません',code:'payment_source_not_found'},404)
      return json({ ok: true, changes: result[1]?.meta?.changes ?? 0 })
    }
    if (a === 'recurring-post' && m === 'POST') {
      const body = await request.json()
      const planId = typeof body?.planId === 'string' ? body.planId : ''
      const scheduledMonth = typeof body?.month === 'string' ? body.month : ''
      if (!/^[a-zA-Z0-9-]{8,80}$/.test(planId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(scheduledMonth))
        return json({error:'固定支出の対象を確認してください'},400)
      const plan=await db.prepare(`SELECT id,name,amount,day,weekday,schedule_type,workday_only,category,payment_source,start_month,enabled
        FROM recurring_plans WHERE id=?1
        AND NOT EXISTS(SELECT 1 FROM trash_items t WHERE t.item_type='recurring_plan' AND t.item_id=recurring_plans.id)`).bind(planId).first()
      if (!plan || !plan.enabled || !Number.isSafeInteger(Number(plan.amount)) || Number(plan.amount)<=0)
        return json({error:'有効な固定支出が見つかりません'},404)
      const approved=resolveRecurringApproval(body,plan)
      if(approved.error)return json({error:approved.error,code:approved.code},approved.status)
      const date=approved.date
      if(date>tokyoToday())return json({error:'予定日前の固定支出は登録できません'},409)
      const perDate=plan.schedule_type!=='monthly'
      const period=perDate?date:scheduledMonth
      const clientRequestId=recurringRequestId(plan.id,period)
      // A previously excluded occurrence must be rejected explicitly.
      // Keep this server-side even when the preview list is stale on another device.
      const excludedMonth=await db.prepare('SELECT 1 FROM recurring_candidate_exclusions WHERE plan_id=?1 AND month=?2').bind(planId,scheduledMonth).first()
      const excludedDate=perDate ? await db.prepare('SELECT 1 FROM recurring_date_exclusions WHERE plan_id=?1 AND date=?2').bind(planId,date).first() : null
      if(excludedMonth || excludedDate)
        return json({error:'この予定日は候補から除外されています。除外を解除してから登録してください',code:'recurring_excluded'},409)
      if(await db.prepare('SELECT id FROM entries WHERE client_request_id=?1').bind(clientRequestId).first())
        return json({ok:true,created:false,duplicate:true,conflict:false})
      const manualSlot=await recurringManualSlot(db,plan,date)
      // Indexed date range avoids full-ledger scans on monthly confirmations.
      const samePeriod=perDate?'e.date=?1':"e.date >= (?8 || '-01') AND e.date < date(?8 || '-01', '+1 month')"
      const result=await db.prepare(`INSERT INTO entries
        (date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source)
        SELECT ?1,'',p.amount,p.category,p.name,'定期固定費（確認記帳）','','expense',NULL,0,NULL,?2,p.payment_source
        FROM recurring_plans p WHERE p.id=?3 AND p.enabled=1
          AND p.name=?4 AND p.amount=?5 AND p.day=?6 AND p.weekday=?7
          AND p.schedule_type=?9 AND p.category=?10 AND p.payment_source=?11 AND p.workday_only=?12
          AND NOT EXISTS(SELECT 1 FROM trash_items t WHERE t.item_type='recurring_plan' AND t.item_id=p.id)
          AND NOT EXISTS(SELECT 1 FROM recurring_candidate_exclusions x WHERE x.plan_id=p.id AND x.month=?8)
          AND NOT EXISTS(SELECT 1 FROM recurring_date_exclusions x WHERE x.plan_id=p.id AND x.date=?1)
          AND (SELECT COUNT(*) FROM entries e WHERE ${samePeriod} AND e.type='expense'
            AND e.merchant=p.name AND COALESCE(e.payment_source,'')=p.payment_source
            AND (e.client_request_id IS NULL OR e.client_request_id NOT LIKE 'recurring_%' OR
          NOT EXISTS(SELECT 1 FROM recurring_plans owner WHERE owner.enabled=1
            AND owner.name=e.merchant AND owner.payment_source=COALESCE(e.payment_source,'')
            AND e.client_request_id=('recurring_'||replace(owner.id,'-','')||'_'||
              CASE WHEN owner.schedule_type='monthly' THEN replace(substr(e.date,1,7),'-','')
                ELSE replace(e.date,'-','') END)))) < ?13
        ON CONFLICT(client_request_id) DO NOTHING`)
        .bind(date,clientRequestId,plan.id,plan.name,plan.amount,plan.day,plan.weekday,scheduledMonth,plan.schedule_type,plan.category,plan.payment_source,plan.workday_only,manualSlot).run()
      return json({ok:true,created:!!result.meta?.changes,duplicate:false,conflict:!result.meta?.changes})
    }
    // Genuine deletions share one trash table; reviews/exclusions remain states.
    if (a === 'trash-items') {
      if (m === 'GET' && !b) {
        const {results}=await db.prepare(
          "SELECT item_id,payload_json,deleted_at FROM trash_items WHERE item_type='entry' ORDER BY deleted_at DESC,item_id DESC LIMIT "+(url.searchParams.get('full') === '1' ? '10000' : '500')
        ).all()
        if (url.searchParams.get('full') === '1') return json(results)
        return json(results.flatMap(item=>{
          try {
            const entry=JSON.parse(item.payload_json)?.entry
            if(!entry || String(entry.id)!==item.item_id)return []
            return [{id:entry.id,date:entry.date,amount:entry.amount,type:entry.type,
              merchant:entry.merchant,category:entry.category,deletedAt:item.deleted_at}]
          } catch { return [] }
        }))
      }
      if (!/^\d+$/.test(b||'') || !Number.isSafeInteger(Number(b)) || Number(b)<=0)
        return json({error:'対象の明細IDが正しくありません'},400)
      const id=Number(b)
      if (params.path?.[2]==='restore' && m==='POST') {
        const item=await db.prepare(
          "SELECT payload_json FROM trash_items WHERE item_type='entry' AND item_id=?1"
        ).bind(String(id)).first()
        if(!item)return json({error:'ゴミ箱に明細が見つかりません'},404)
        let saved
        try { saved=JSON.parse(item.payload_json) } catch {return json({error:'保管データを復元できません'},409)}
        const e=saved?.entry
        if(!e || e.id!==id || !validDate(e.date) || !Number.isSafeInteger(e.amount) || e.amount<=0 ||
          !['expense','income','transfer'].includes(e.type)) return json({error:'保管した明細が正しくありません'},409)
        if(isPointCharge(e))return json({error:'自動チャージは元のポイント還元収入と一緒に復元してください'},409)
        const pairedTrashId=Number(saved.pairedEntryId||0)
        let pairedEntry=null
        if(Number.isSafeInteger(pairedTrashId)&&pairedTrashId>0){
          const pairedTrash=await db.prepare("SELECT payload_json FROM trash_items WHERE item_type='entry' AND item_id=?1").bind(String(pairedTrashId)).first()
          if(pairedTrash){
            try { pairedEntry=JSON.parse(pairedTrash.payload_json)?.entry } catch { return json({error:'関連するチャージ記録を復元できません'},409) }
            if(!pairedEntry || pairedEntry.id!==pairedTrashId || !isPointCharge(pairedEntry) ||
               pairedEntry.client_request_id!==pointChargeId(e.client_request_id,e.id))
              return json({error:'関連するチャージ記録を確認してください'},409)
          }
        }
        // Stable IDs preserve on-device receipts and SBI transfer links.
        const collision=await db.prepare('SELECT id FROM entries WHERE id=?1 OR (client_request_id IS NOT NULL AND client_request_id=?2) LIMIT 1')
          .bind(id,e.client_request_id??null).first()
        if(collision)return json({error:'別の明細とIDが重複しています。復元を中止しました'},409)
        const statements=[
          db.prepare(`INSERT INTO entries(id,date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,
            transfer_date,client_request_id,payment_source,created_at)
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`)
            .bind(id,e.date,e.time||'',e.amount,e.category,e.merchant,e.note,e.raw,e.type,
              e.transfer_target??null,e.transfer_applied??0,e.transfer_date??null,e.client_request_id??null,
              e.payment_source||'',e.created_at||new Date().toISOString())
        ]
        if(saved.purchaseMonth)statements.push(db.prepare(
          'INSERT OR IGNORE INTO sbi_transfer_links(entry_id,purchase_month) VALUES(?1,?2)'
        ).bind(id,saved.purchaseMonth))
        if(saved.dismissed)statements.push(db.prepare(
          'INSERT OR IGNORE INTO dismissed_transfer_reminders(entry_id) VALUES(?1)'
        ).bind(id))
        if(pairedEntry){
          statements.push(db.prepare(`INSERT INTO entries(id,date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,
            transfer_date,client_request_id,payment_source,created_at)
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`)
            .bind(pairedEntry.id,pairedEntry.date,pairedEntry.time||'',pairedEntry.amount,pairedEntry.category,
              (pairedEntry.transfer_target?.startsWith('prepaid:') ? pairedEntry.transfer_target.slice(8)+'チャージ' : pairedEntry.merchant),pairedEntry.note,pairedEntry.raw,pairedEntry.type,pairedEntry.transfer_target??null,
              pairedEntry.transfer_applied??0,pairedEntry.transfer_date??null,pairedEntry.client_request_id,
              pairedEntry.payment_source||'',pairedEntry.created_at||new Date().toISOString()))
          statements.push(db.prepare("DELETE FROM trash_items WHERE item_type='entry' AND item_id=?1").bind(String(pairedEntry.id)))
        } else if(e.type==='income' && e.category==='ポイント還元' && e.transfer_target?.startsWith('prepaid:')){
          statements.push(db.prepare(pointTopUpSql.replace('client_request_id=?1 AND type=', 'id=?1 AND type='))
            .bind(id,pointChargeId(e.client_request_id,id),e.transfer_target))
        }
        // Restoring an entry undoes only the exclusion created by its deletion.
        // Never remove exclusions which the user had already set manually.
        const skip=saved.recurringSkip
        if(skip && typeof skip.planId==='string' && validDate(e.date) &&
            skip.month===e.date.slice(0,7) &&
            (!skip.date || skip.date===e.date)) {
          statements.push(db.prepare(skip.date
            ? 'DELETE FROM recurring_date_exclusions WHERE plan_id=?1 AND date=?2'
            : 'DELETE FROM recurring_candidate_exclusions WHERE plan_id=?1 AND month=?2')
            .bind(skip.planId,skip.date||skip.month))
        }
        statements.push(db.prepare("DELETE FROM trash_items WHERE item_type='entry' AND item_id=?1").bind(String(id)))
        await db.batch(statements)
        return json({ok:true,restored:true,id})
      }
      if (params.path?.[2]==='purge' && m==='DELETE') {
        if(request.headers.get('x-confirm-purge')!==String(id))
          return json({error:'削除対象の再確認が必要です'},428)
        const result=await db.prepare(
          "DELETE FROM trash_items WHERE item_type='entry' AND item_id=?1"
        ).bind(String(id)).run()
        if(!result.meta?.changes)return json({error:'ゴミ箱に明細が見つかりません'},404)
        return json({ok:true})
      }
      return json({error:'未対応の操作です'},405)
    }
    if (a === 'entry-years' && m === 'GET') {
      // Query actual ledger years instead of silently omitting records before 2018 or in future years.
      const { results } = await db.prepare("SELECT substr(date,1,4) AS year, COUNT(*) AS count FROM entries GROUP BY substr(date,1,4) ORDER BY year").all()
      return json((results || []).filter(row => /^\d{4}$/.test(String(row.year))).map(row => ({year:String(row.year),count:Number(row.count)})))
    }
    if (a === 'entries') {
      if (m === 'GET') {
        if ((entriesYear && !/^\d{4}$/.test(entriesYear)) ||
            (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) ||
            (!entriesYear && !month)) return json({ error: '対象期間が正しくありません' }, 400)
        const datePrefix = entriesYear || month
        const bounds=entryDateBounds(datePrefix)
        if(!bounds)return json({error:'対象期間が正しくありません'},400)
        // Stable ID-cursor pagination for full exports. Keep OFFSET for older clients.
        const cursorRaw = url.searchParams.get('cursor')
        if (cursorRaw !== null) {
          const cursor = Number(cursorRaw)
          if (!Number.isSafeInteger(cursor) || cursor < 0) return json({error:'読み込み位置が正しくありません'},400)
          const {results} = await db.prepare('SELECT * FROM entries WHERE date>=?1 AND date<?2 AND id>?3 ORDER BY id ASC LIMIT 500').bind(bounds.start,bounds.end,cursor).all()
          return json(results)
        }
        const offsetRaw = url.searchParams.get('offset')
        const offset = offsetRaw === null ? 0 : Number(offsetRaw)
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) return json({ error: '読み込み位置が正しくありません' }, 400)
        // Legacy clients get the same list shape; the annual view requests 500-row pages.
        const limit = offsetRaw === null ? 10000 : 500
        const { results } = await db
          .prepare('SELECT * FROM entries WHERE date>=?1 AND date<?2 ORDER BY date DESC, time DESC, id DESC LIMIT ?3 OFFSET ?4')
          .bind(bounds.start,bounds.end,limit,offset).all()
        return json(results)
      }
      if (m === 'POST') {
        const e = await request.json()
        const transfer = e.type === 'transfer' || (!['income', 'expense'].includes(e.type) && isInvestmentTransfer(e))
        const amount = Number(e.amount)
        if (!validDate(e.date) || !validTime(e.time) || !Number.isSafeInteger(Number(e.amount)) || !Number.isSafeInteger(amount) || amount <= 0)
          return json({ error: '日付または金額が正しくありません' }, 400)
        const paymentSource = e.paymentSource == null ? '' : String(e.paymentSource).trim()
        if (paymentSource.length > 80) return json({ error: '支払方法は80文字以内にしてください' }, 400)
        if(paymentSource && await db.prepare('SELECT 1 FROM payment_sources WHERE name=?1 AND is_archived=1').bind(paymentSource).first())
          return json({error:'アーカイブ済みの支払方法は新しい記帳に使用できません',code:'payment_source_archived'},409)
        const reward=await rewardDestination(db,e)
        if(reward.error)return json({error:reward.error},400)
        const rawTarget=transfer?String(e.transferTarget||''):''
        if(transfer&&rawTarget&&rawTarget!=='sbi'&&!await validPrepaidTarget(db,rawTarget))return json({error:'登録済みの振替先を選択してください'},400)
        if(transfer&&rawTarget.startsWith('prepaid:') &&
          await db.prepare('SELECT 1 FROM payment_sources WHERE name=?1 AND is_archived=1').bind(rawTarget.slice(8)).first())
          return json({error:'アーカイブ済みのプリペイドカードには新規チャージできません',code:'payment_source_archived'},409)
        const target=transfer?(rawTarget||null):null
         if(transfer&&target?.startsWith('prepaid:')&&paymentSource===target.slice('prepaid:'.length))
           return json({error:'同じプリペイドカードへの振替は登録できません'},400)
        const transferDate = transfer ? (e.transferDate || e.date) : null
        if (transfer && !validDate(transferDate)) return json({ error: '振替日を確認してください' }, 400)
        const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const applied = isAppliedSbiTransfer({ type: transfer ? 'transfer' : e.type, transferTarget: target, transferDate, date: e.date }, today) ? 1 : 0
        const clientRequestId = e.clientRequestId == null ? null : String(e.clientRequestId).trim()
        if (clientRequestId && !/^[a-zA-Z0-9_-]{8,128}$/.test(clientRequestId))
          return json({ error: '記録IDの形式が正しくありません' }, 400)
        // Advisory prechecks in the browser can race with another device. Make
        // the final duplicate decision in ONE SQL insert on D1. Explicitly
        // confirmed legitimate repeats remain possible.
        const type = transfer ? 'transfer' : (e.type === 'income' ? 'income' : 'expense')
        const checkDuplicate = e.duplicatePolicy === 'check' && e.allowDuplicate !== true
        const insertSql = checkDuplicate
          ? `INSERT INTO entries (date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source)
            SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13
            WHERE NOT EXISTS (SELECT 1 FROM entries WHERE date=?1 AND amount=?3
              AND (COALESCE(time,'')='' OR COALESCE(?2,'')=''
                OR ABS((CAST(SUBSTR(time,1,2) AS INTEGER)*60 + CAST(SUBSTR(time,4,2) AS INTEGER))
                  - (CAST(SUBSTR(?2,1,2) AS INTEGER)*60 + CAST(SUBSTR(?2,4,2) AS INTEGER))) <= 5)
              AND TRIM(COALESCE(merchant,''))=TRIM(?5) AND type=?8 AND COALESCE(payment_source,'')=?13
              AND (type<>'transfer' OR COALESCE(transfer_target,'')=COALESCE(?9,'')))
            ON CONFLICT(client_request_id) DO NOTHING`
          : 'INSERT INTO entries (date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13) ON CONFLICT(client_request_id) DO NOTHING'
        const insertStatement = db.prepare(insertSql).bind(e.date, e.time || '', amount,
          transfer ? '投資・資産移動' : (e.category || (e.type === 'income' ? '工资' : '日用品')),
          e.merchant || '', e.note || '', (e.raw || '').slice(0, 2000),
          type, reward.target || target, applied, transferDate, clientRequestId, reward.source || paymentSource)
        const rewardPrepaid=!!reward.target?.startsWith('prepaid:')
        if(rewardPrepaid && (!clientRequestId || clientRequestId.length>100))
          return json({error:'ポイントチャージ用の記録IDが必要です'},400)
        const batchResult=rewardPrepaid
          ? await db.batch([insertStatement,
              db.prepare(pointTopUpSql).bind(clientRequestId,pointChargeId(clientRequestId),reward.target)])
          : [await insertStatement.run()]
        const inserted=batchResult[0]
        if (checkDuplicate && inserted.meta?.changes === 0) {
          const ownRetry = clientRequestId && await db.prepare('SELECT id FROM entries WHERE client_request_id=?1').bind(clientRequestId).first()
          if (!ownRetry) return json({error:'同じ日付・金額・店舗・支払方法の記録が追加されました。内容を再確認してください',code:'duplicate_candidate'},409)
        }
        const savedEntry = clientRequestId
          ? await db.prepare('SELECT id FROM entries WHERE client_request_id = ?1').bind(clientRequestId).first()
          : await db.prepare('SELECT id FROM entries WHERE id = ?1').bind(inserted.meta.last_row_id).first()
        return json({ ok: true, duplicate: inserted.meta?.changes === 0, id: savedEntry?.id || null })
      }
      if (m === 'PUT' && b) {
        const e = await request.json()
        const transfer = e.type === 'transfer' || (!['income', 'expense'].includes(e.type) && isInvestmentTransfer(e))
        const id = Number(b)
        const amount = Number(e.amount)
        if (!Number.isSafeInteger(id) || id <= 0 || !validDate(e.date) || !validTime(e.time) || !Number.isSafeInteger(amount) || amount <= 0)
          return json({ error: '日付または金額が正しくありません' }, 400)
        const previous = await db.prepare('SELECT amount, type, category, client_request_id, transfer_target, transfer_applied, transfer_date, date, payment_source FROM entries WHERE id = ?1').bind(id).first()
        if (!previous) return json({ error: '明細が見つかりません' }, 404)
        if(isPointCharge(previous))return json({error:'自動チャージは元のポイント還元収入から編集してください'},409)
        const reward=await rewardDestination(db,{...e,rewardDestination:e.rewardDestination??(previous.type==='income' && previous.category==='ポイント還元' ? previous.transfer_target : '')},previous.transfer_target||'')
        if(reward.error)return json({error:reward.error},400)
        const linkedId=pointChargeId(previous.client_request_id,id)
        const paymentSource = e.paymentSource == null ? (previous.payment_source || '') : String(e.paymentSource).trim()
        if (paymentSource.length > 80) return json({ error: '支払方法は80文字以内にしてください' }, 400)
        if(paymentSource!==previous.payment_source && paymentSource &&
          await db.prepare('SELECT 1 FROM payment_sources WHERE name=?1 AND is_archived=1').bind(paymentSource).first())
          return json({error:'アーカイブ済みのカードへ変更できません',code:'payment_source_archived'},409)
        const rawTarget=transfer?String(e.transferTarget||''):''
        if(transfer&&rawTarget&&rawTarget!=='sbi'&&!await validPrepaidTarget(db,rawTarget))return json({error:'登録済みの振替先を選択してください'},400)
        if(transfer&&rawTarget!==previous.transfer_target&&rawTarget.startsWith('prepaid:') &&
          await db.prepare('SELECT 1 FROM payment_sources WHERE name=?1 AND is_archived=1').bind(rawTarget.slice(8)).first())
          return json({error:'アーカイブ済みのプリペイドカードへ変更できません',code:'payment_source_archived'},409)
        const target=transfer?(rawTarget||null):null
         if(transfer&&target?.startsWith('prepaid:')&&paymentSource===target.slice('prepaid:'.length))
           return json({error:'同じプリペイドカードへの振替は登録できません'},400)
        const transferDate = transfer ? (e.transferDate || previous.transfer_date || e.date) : null
        if (transfer && !validDate(transferDate)) return json({ error: '振替日を確認してください' }, 400)
        const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const applied = target==='sbi' && transferDate <= today ? 1 : 0
        // Compare the original row values before updating; simultaneous edits
        // from another device must never silently overwrite newer finances.
        const expectedKeys=['date','time','amount','category','merchant','note','raw','type','transfer_target','transfer_date','payment_source']
        const optimistic=e.expected && typeof e.expected==='object' && !Array.isArray(e.expected)
        if(optimistic && !expectedKeys.every(k=>Object.hasOwn(e.expected,k)))
          return json({error:'編集前の記録情報が不足しています'},400)
        const guard=optimistic ? ' AND '+expectedKeys.map((k,i)=>k+' IS ?'+(i+14)).join(' AND ') : ''
        const args=[e.date,e.time||'',amount,transfer?'投資・資産移動':(e.category||(e.type==='income'?'工资':'日用品')),
          e.merchant||'',e.note||'',(e.raw||'').slice(0,2000),
          transfer?'transfer':(e.type==='income'?'income':'expense'),
          reward.target || target,applied?1:0,transferDate,reward.source || paymentSource,id,
          ...(optimistic?expectedKeys.map(k=>e.expected[k]):[])]
        const entryUpdate=db.prepare('UPDATE entries SET date = ?1, time = ?2, amount = ?3, category = ?4, merchant = ?5, note = ?6, raw = ?7, type = ?8, transfer_target = ?9, transfer_applied = ?10, transfer_date = ?11, payment_source = ?12 WHERE id = ?13'+guard)
          .bind(...args)
        // Always keep the generated charge in the same D1 transaction as its
        // income record. Switching destinations removes the old generated row.
        // changes() reads the preceding UPDATE within the same D1 batch.
        // If a stale optimistic edit updates zero rows, no auto-charge mutation.
        const pairedWrite=reward.target?.startsWith('prepaid:')
          ? db.prepare(pointTopUpSql.replace('client_request_id=?1 AND type=', 'id=?1 AND type=')
              .replace('AND transfer_target=?3\n  ON CONFLICT',
                'AND transfer_target=?3 AND changes()>0\n  ON CONFLICT'))
              .bind(id,linkedId,reward.target)
          : db.prepare("DELETE FROM entries WHERE client_request_id=?1 AND type='transfer' AND category='投資・資産移動' AND changes()>0")
              .bind(linkedId)
        const needsPairUpdate=(previous.type==='income' && previous.category==='ポイント還元') ||
          reward.target?.startsWith('prepaid:')
        const [result]=needsPairUpdate ? await db.batch([entryUpdate,pairedWrite]) : [await entryUpdate.run()]
        if(optimistic && !result.meta?.changes)
          return json({error:'別の端末で明細が変更されました。最新の明細を再読込してください',code:'stale_entry'},409)
        return json({ok:true,changes:result.meta?.changes??null})
      }
      if (m === 'DELETE' && b) {
        const id = Number(b)
        // Prevent accidental deletion from upgrades, retries or malformed API calls.
        // Only an explicitly confirmed single-record UI operation may delete a row.
        if (!Number.isSafeInteger(id) || id <= 0 ||
            request.headers.get('x-confirm-delete') !== String(id))
          return json({ error: '削除する記録の確認が必要です' }, 428)
        // D1 batch() makes the recoverable snapshot+deletion atomic.
        const entry=await db.prepare('SELECT * FROM entries WHERE id=?1').bind(id).first()
        if (!entry) return json({error:'明細が見つかりません'},404)
        if(isPointCharge(entry))return json({error:'自動チャージは元のポイント還元収入を削除してください'},409)
        const paired=entry.type==='income' ? await db.prepare('SELECT * FROM entries WHERE client_request_id=?1')
          .bind(pointChargeId(entry.client_request_id,id)).first() : null
        const [link,dismissal]=await Promise.all([
          db.prepare('SELECT purchase_month FROM sbi_transfer_links WHERE entry_id=?1').bind(id).first(),
          db.prepare('SELECT 1 AS found FROM dismissed_transfer_reminders WHERE entry_id=?1').bind(id).first()
        ])
        // An explicitly deleted recurring entry must NOT be re-created by the
        // second Cron run later the same day, nor offered as a missed entry.
        // Identify the original occurrence by its server-generated request ID.
        // Unrelated manual entries and ordinary expenses are unaffected.
        const recurring=entry.type==='expense' && validDate(entry.date) &&
          typeof entry.client_request_id==='string' && entry.client_request_id.startsWith('recurring_')
          ? await db.prepare(`SELECT id, CASE
              WHEN ?2='recurring_'||REPLACE(id,'-','')||'_'||REPLACE(?1,'-','') THEN 'weekly'
              ELSE 'monthly' END AS occurrence_type
            FROM recurring_plans
            WHERE ?2 IN (
              'recurring_'||REPLACE(id,'-','')||'_'||REPLACE(?1,'-',''),
              'recurring_'||REPLACE(id,'-','')||'_'||REPLACE(substr(?1,1,7),'-','')
            ) LIMIT 1`).bind(entry.date,entry.client_request_id).first()
          : null
        const recurringSkip=recurring
          ? {planId:recurring.id,month:entry.date.slice(0,7),
              ...(recurring.occurrence_type==='weekly'?{date:entry.date}:{})}
          : null
        const skipSql=recurringSkip
          ? recurringSkip.date
            ? 'INSERT OR IGNORE INTO recurring_date_exclusions(plan_id,date) VALUES(?1,?2)'
            : 'INSERT OR IGNORE INTO recurring_candidate_exclusions(plan_id,month) VALUES(?1,?2)'
          : null
        // Preserve an existing user-added exclusion when restoring the entry.
        const alreadySkipped=recurringSkip ? await db.prepare(
          recurringSkip.date
            ? 'SELECT 1 FROM recurring_date_exclusions WHERE plan_id=?1 AND date=?2'
            : 'SELECT 1 FROM recurring_candidate_exclusions WHERE plan_id=?1 AND month=?2'
        ).bind(recurringSkip.planId,recurringSkip.date||recurringSkip.month).first() : null
        const snapshot=JSON.stringify({entry,purchaseMonth:link?.purchase_month||null,dismissed:!!dismissal,
          recurringSkip:alreadySkipped?null:recurringSkip,pairedEntryId:paired?.id||null})
        // All changes happen in one D1 transaction; a partial deletion cannot
        // leave a scheduled expense marked as skipped without its trash record.
        const statements=[
          db.prepare("INSERT INTO trash_items(item_type,item_id,payload_json) VALUES('entry',?1,?2) ON CONFLICT(item_type,item_id) DO NOTHING").bind(String(id),snapshot)
        ]
        if(paired){
          const pairedSnapshot=JSON.stringify({entry:paired,purchaseMonth:null,dismissed:false,recurringSkip:null})
          statements.push(db.prepare("INSERT INTO trash_items(item_type,item_id,payload_json) VALUES('entry',?1,?2) ON CONFLICT(item_type,item_id) DO NOTHING")
            .bind(String(paired.id),pairedSnapshot))
        }
        if(recurringSkip)statements.push(db.prepare(skipSql)
          .bind(recurringSkip.planId,recurringSkip.date||recurringSkip.month))
        statements.push(
          db.prepare('DELETE FROM sbi_transfer_links WHERE entry_id=?1').bind(id),
          db.prepare('DELETE FROM dismissed_transfer_reminders WHERE entry_id=?1').bind(id),
          ...(paired ? [db.prepare("DELETE FROM entries WHERE id=?1 AND EXISTS (SELECT 1 FROM trash_items WHERE item_type='entry' AND item_id=?2)")
            .bind(paired.id,String(paired.id))] : []),
          db.prepare("DELETE FROM entries WHERE id=?1 AND EXISTS (SELECT 1 FROM trash_items WHERE item_type='entry' AND item_id=?2)").bind(id,String(id))
        )
        const result=await db.batch(statements)
        if(!result[0]?.meta?.changes || !result[result.length-1]?.meta?.changes)
          return json({error:'明細をゴミ箱に移動できませんでした'},409)
        return json({ok:true,changes:1,trashed:true,skippedRecurring:!!recurringSkip})
      }
    }
    if (a === 'category-source' && m === 'GET') {
      const { results } = await db.prepare('SELECT category,sort_order,icon,display_name,entry_type,is_default FROM category_source ORDER BY sort_order,category').all()
      return json(results)
    }
    if (a === 'category-icons') {
      if (m === 'GET') {
        const { results } = await db.prepare('SELECT category, icon FROM category_source WHERE icon IS NOT NULL').all()
        return json(Object.fromEntries(results.map(r => [r.category, r.icon])))
      }
      if (m === 'POST' && b === 'restore-missing') {
        const data = await request.json()
        const category = typeof data?.category === 'string' ? data.category.trim() : ''
        const icon = typeof data?.icon === 'string' ? data.icon.trim() : ''
        if (!category || category.length > 20 || !/^[a-z][a-z-]{1,40}$/.test(icon))
          return json({error:'復元するカテゴリーアイコンを確認してください'},400)
        const result = await db.prepare(`INSERT INTO category_source(category,icon) VALUES(?1,?2)
          ON CONFLICT(category) DO UPDATE SET icon=excluded.icon WHERE category_source.icon IS NULL`).bind(category,icon).run()
        return json({ok:true,created:!!result.meta?.changes})
      }
    }
    if (a === 'categories') {
      if (m === 'GET') {
        // D1 category_source is the single source. Do not read historic
        // rules markers or manufacture categories absent from production.
        const {results}=await db.prepare("SELECT category FROM category_source WHERE entry_type='expense' ORDER BY CASE WHEN category IN ('其他','その他') THEN 1 ELSE 0 END,COALESCE(sort_order,10000),category").all()
        return json(results.map(row=>row.category))
      }
      if (m === 'POST') {
        const body = await request.json()
        const name = String(body.name || '').trim().slice(0,20)
        if (!name) return json({error:'カテゴリー名を入力してください'},400)
        const reserved = ['餐饮','饮食料品','日用品','交通','购物','居住','医疗','娱乐','宠物','其他','その他','其他收入','その他の収入','ポイント還元']
        const entryType = body.entryType === 'income' ? 'income' : body.entryType === 'expense' || body.entryType == null ? 'expense' : ''
        if(!entryType)return json({error:'収入または支出のカテゴリを選択してください'},400)
        const icon = String(body.icon || 'other')
        const validIcons = ['food','dining','daily','transport','shopping','home','medical','pet','beauty','education','insurance','utilities','phone','tax','travel','subscriptions','gift','electricity','water','gas','rent','internet','hair','cosmetics','clothes','shoes','books','lessons','childcare','family','car','bicycle','fuel','parking','fitness','health','medicine','dental','cafe','hobby','music','movie','electronics','furniture','repair','charity','bank','savings','fees','delivery','cleaning','events','work','phone-device','other']
        if (!validIcons.includes(icon)) return json({error:'アイコンを確認してください'},400)
        if (reserved.includes(name)) return json({error:'同じカテゴリが既にあります'},409)
        // User-confirmed category creation only; never write the old rules
        // table or reinsert historical category defaults.
        const result=await db.prepare(`INSERT INTO category_source(category,sort_order,icon,display_name,entry_type)
          VALUES(?1,(SELECT COALESCE(MAX(sort_order),CASE WHEN ?3='income' THEN 10000 ELSE 8 END)+1 FROM category_source WHERE entry_type=?3 AND sort_order<99999),?2,?1,?3)
          ON CONFLICT(category) DO NOTHING`).bind(name,icon,entryType).run()
        if (!result.meta?.changes) return json({error:'同じカテゴリが既にあります'},409)
        return json({ok:true,category:name})
      }
    }
    if (a === 'custom-rules') {
      // All merchant_rules category rows are user-defined, including old rows.
      if (m === 'POST') {
        const body = await request.json()
        const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : ''
        const category = typeof body?.category === 'string' ? body.category.trim() : ''
        if (keyword.length < 2 || keyword.length > 120 || !category || category.length > 120 || keyword.startsWith('__'))
          return json({error:'カテゴリー規則を確認してください'},400)
        // Restore adds missing category mappings, never overwrites a newer
        // user rule or payment selection; no default rules table mutation.
        await db.prepare('INSERT INTO merchant_rules(keyword,category) VALUES(?1,?2) ON CONFLICT(keyword) DO UPDATE SET category=COALESCE(merchant_rules.category,excluded.category)').bind(keyword,category).run()
        return json({ok:true})
      }
      if (m === 'GET') {
        const {results}=await db.prepare('SELECT keyword,category FROM merchant_rules WHERE category IS NOT NULL ORDER BY keyword').all()
        return json(results.map(rule=>({...rule,is_custom:true})))
      }
      if (m === 'DELETE') {
        const keyword = url.searchParams.get('keyword') || ''
        if (keyword.length < 2 || keyword.length > 80) return json({ error: '店舗名を確認してください' }, 400)
        await db.batch([
          db.prepare('DELETE FROM merchant_rules WHERE keyword=?1 AND payment_source IS NULL').bind(keyword),
          db.prepare('UPDATE merchant_rules SET category=NULL WHERE keyword=?1').bind(keyword)
        ])
        return json({ ok: true })
      }
    }
    if (a === 'rules') {
      if (m === 'GET') {
        // Both rule tables already exist in production D1. Read without
        // initializing anything: rules = defaults; merchant_rules = user edits.
        const sources=await db.batch([
          db.prepare('SELECT keyword,category FROM rules ORDER BY keyword'),
          db.prepare('SELECT keyword,category FROM merchant_rules WHERE category IS NOT NULL ORDER BY keyword')
        ])
        const merged=new Map()
        for(const rule of sources[0]?.results||[]) {
          if(rule.keyword && rule.category && !String(rule.keyword).startsWith('__'))
            merged.set(rule.keyword,{keyword:rule.keyword,category:rule.category,is_custom:false})
        }
        for(const rule of sources[1]?.results||[]) {
          if(rule.keyword && rule.category && !String(rule.keyword).startsWith('__'))
            merged.set(rule.keyword,{keyword:rule.keyword,category:rule.category,is_custom:true})
        }
        return json([...merged.values()])
      }
      if (m === 'POST') {
        const r=await request.json()
        const kw=String(r.keyword||'').trim()
        const category=String(r.category||'').trim()
        if(kw.length<2 || kw.length>120 || kw.startsWith('__'))return json({error:'キーワードは2文字以上で入力してください'},400)
        if(!category || category.length>120)return json({error:'カテゴリーを指定してください'},400)
        // User saves always belong to merchant_rules; default rules are read-only.
        await db.prepare('INSERT INTO merchant_rules(keyword,category) VALUES(?1,?2) ON CONFLICT(keyword) DO UPDATE SET category=excluded.category').bind(kw,category).run()
        return json({ok:true,keyword:kw,category})
      }
    }

    if (a === 'dismissed-transfer-reminders') {
      if(m==='GET') {
        if (url.searchParams.get('details') === '1') {
          const {results}=await db.prepare(`SELECT e.id, e.date, e.amount, e.merchant, e.note, e.transfer_date, e.transfer_applied
            FROM dismissed_transfer_reminders d
            JOIN entries e ON e.id = d.entry_id
            WHERE e.type='transfer' AND e.transfer_target='sbi'
            ORDER BY e.id DESC LIMIT 1000`).all()
          return json(results)
        }
        const {results}=await db.prepare('SELECT entry_id FROM dismissed_transfer_reminders ORDER BY entry_id').all()
        return json(results.map(x=>x.entry_id))
      }
      if(m==='DELETE') {
        const body=await request.json()
        const id=Number(body?.entryId)
        if(!Number.isSafeInteger(id)||id<=0)return json({error:'振替記録を確認してください'},400)
        await db.prepare('DELETE FROM dismissed_transfer_reminders WHERE entry_id=?1').bind(id).run()
        return json({ok:true})
      }
      if(m==='POST') {
        const body=await request.json()
        const id=Number(body?.entryId)
        if(!Number.isSafeInteger(id)||id<=0)return json({error:'振替記録を確認してください'},400)
        const entry=await db.prepare("SELECT id FROM entries WHERE id=?1 AND type='transfer' AND transfer_target='sbi'").bind(id).first()
        if(!entry)return json({error:'振替の記録が見つかりません'},404)
        await db.prepare('INSERT OR IGNORE INTO dismissed_transfer_reminders(entry_id) VALUES(?1)').bind(id).run()
        return json({ok:true})
      }
    }
    if (a === 'transfers' && b === 'process-due' && m === 'POST') {
      // Explicit mutation: ordinary GET requests no longer silently modify entries.
      await applyDueTransfers()
      return json({ok:true})
    }
    if (a === 'transfers' && b && params.path?.[2] === 'dismiss' && m === 'POST') {
      const id = Number(b)
      if (!Number.isSafeInteger(id) || id <= 0) return json({ error: '明細IDが正しくありません' }, 400)
      const entry = await db.prepare("SELECT id FROM entries WHERE id = ?1 AND type = 'transfer' AND transfer_target = 'sbi'").bind(id).first()
      if (!entry) return json({ error: '対象の資産移動が見つかりません' }, 404)
      await db.prepare('INSERT OR IGNORE INTO dismissed_transfer_reminders (entry_id) VALUES (?1)').bind(id).run()
      return json({ ok: true })
    }

    if (a === 'transfers' && b && m === 'POST') {
      const id = Number(b)
      const item = await db.prepare("SELECT id, amount, transfer_target, transfer_applied, transfer_date, date FROM entries WHERE id = ?1 AND type = 'transfer'").bind(id).first()
      if (!item || item.transfer_target !== 'sbi') return json({ error: '対象の資産移動が見つかりません' }, 404)
      if (String(item.transfer_date || item.date) > tokyoToday())
        return json({ error: '振替予定日前には処理できません' }, 409)
      await db.prepare("UPDATE entries SET transfer_applied = 1 WHERE id = ?1 AND type = 'transfer' AND transfer_target = 'sbi' AND COALESCE(transfer_applied,0) = 0")
        .bind(id).run()
      const updated = await db.prepare('SELECT id, date, amount, merchant, note, transfer_target, transfer_applied, transfer_date FROM entries WHERE id = ?1').bind(id).first()
      return json(updated)
    }

    if (a === 'transfers' && m === 'GET') {
      const { results } = await db.prepare("SELECT id, date, amount, merchant, note, transfer_target, transfer_applied, transfer_date FROM entries WHERE type = 'transfer' AND transfer_target = 'sbi' AND NOT EXISTS (SELECT 1 FROM dismissed_transfer_reminders d WHERE d.entry_id = entries.id) AND (COALESCE(transfer_date, date) >= date('now', '-60 days') OR COALESCE(transfer_applied, 0) = 0) ORDER BY COALESCE(transfer_date, date) ASC, id DESC LIMIT 100").all()
      return json(results)
    }

    if (a === 'investment-portfolio') {
      return handlePortfolio({db,request,method:m,sub:b,url})
    }

    if (a === 'investments') return json({error:'旧版の資産評価APIは廃止されました',code:'deprecated_investments'},410)
    if (a === 'stats' && m === 'GET') {
      // Only one additional, read-only aggregate query per visible statistics period.
      // Existing byDay data supplies the current period, avoiding a duplicate D1 scan.
      const periodComparison = async (rows, options) => {
        const window = comparisonWindow({ ...options, today: tokyoToday() })
        if (!window) return null
        const previous = await db.prepare(
          "SELECT COALESCE(SUM(amount), 0) total FROM entries WHERE type = 'expense' AND date >= ?1 AND date < ?2"
        ).bind(window.previousStart, nextCivilDay(window.previousEnd)).first()
        return calculateSpendingComparison(rows, previous?.total ?? 0, window)
      }
      const year = url.searchParams.get('year') || ''
      if (year) {
        if (!/^\d{4}$/.test(year)) return json({ error: '対象年の形式が正しくありません' }, 400)
        const {start:rangeStart,end:rangeEnd}=entryDateBounds(year)||{}
        if(!rangeStart)return json({error:'対象年の形式が正しくありません'},400)
        const total = await db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END),0) t, SUM(CASE WHEN type = 'expense' THEN 1 ELSE 0 END) n, COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN type = 'transfer' THEN amount ELSE 0 END),0) transferTotal, SUM(CASE WHEN type = 'transfer' THEN 1 ELSE 0 END) transferCount, COUNT(*) recordCount FROM entries WHERE date>=?1 AND date<?2").bind(rangeStart,rangeEnd).first()
        const cat = await db.prepare("SELECT category, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'expense' GROUP BY category ORDER BY amount DESC").bind(rangeStart,rangeEnd).all()
        const monthRows = await db.prepare("SELECT substr(date,1,7) month, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'expense' GROUP BY substr(date,1,7) ORDER BY month").bind(rangeStart,rangeEnd).all()
        const day = await db.prepare("SELECT substr(date,1,10) date, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'expense' GROUP BY substr(date,1,10) ORDER BY date").bind(rangeStart,rangeEnd).all()
        const incomeMonthRows = await db.prepare("SELECT substr(date,1,7) month, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'income' GROUP BY substr(date,1,7) ORDER BY month").bind(rangeStart,rangeEnd).all()
        const incomeCategoryRows = await db.prepare("SELECT category, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'income' GROUP BY category ORDER BY amount DESC").bind(rangeStart,rangeEnd).all()
        const incomeMonthCategoryRows = await db.prepare("SELECT substr(date,1,7) month, category, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'income' GROUP BY substr(date,1,7), category ORDER BY month, amount DESC").bind(rangeStart,rangeEnd).all()
        const paymentRows = await db.prepare("SELECT CASE WHEN e.type='income' AND e.category='ポイント還元' AND e.transfer_target LIKE 'credit:%' AND LENGTH(e.transfer_target)>7 THEN 'ポイント払い' WHEN e.type='transfer' AND (TRIM(COALESCE(e.payment_source,''))='' OR e.payment_source IN ('その他','其他')) THEN '振替元未指定' WHEN TRIM(COALESCE(e.payment_source,'')) = '' OR e.payment_source = '現金' THEN '現金' WHEN p.stat_group='points' THEN 'ポイント払い' ELSE 'カード・電子決済' END method, SUM(CASE WHEN e.type='expense' THEN 1 ELSE 0 END) count, COALESCE(SUM(CASE WHEN e.type='expense' THEN e.amount ELSE 0 END),0) amount, COALESCE(SUM(CASE WHEN e.type='expense' THEN e.amount ELSE 0 END),0) expenseAmount, COALESCE(SUM(CASE WHEN e.type='transfer' THEN e.amount ELSE 0 END),0) transferAmount, SUM(CASE WHEN e.type='expense' THEN 1 ELSE 0 END) expenseCount, SUM(CASE WHEN e.type='transfer' THEN 1 ELSE 0 END) transferCount, COALESCE(SUM(CASE WHEN e.type='income' THEN e.amount ELSE 0 END),0) creditOffsetAmount, SUM(CASE WHEN e.type='income' THEN 1 ELSE 0 END) creditOffsetCount FROM entries e LEFT JOIN payment_sources p ON p.name=e.payment_source WHERE e.date>=?1 AND date<?2 AND (e.type IN ('expense','transfer') OR (e.type='income' AND e.category='ポイント還元' AND e.transfer_target LIKE 'credit:%' AND LENGTH(e.transfer_target)>7)) GROUP BY method ORDER BY amount DESC").bind(rangeStart,rangeEnd).all()
        const comparison = await periodComparison(day.results, { year })
        return json({ periodComparison: comparison, paymentMethods: paymentRows.results, year: Number(year), total: total.t, count: total.n, income: total.income, transferTotal: total.transferTotal, transferCount: total.transferCount, recordCount: total.recordCount, byCategory: cat.results, byDay: day.results, byMonth: monthRows.results, incomeByMonth: incomeMonthRows.results, incomeByCategory: incomeCategoryRows.results, incomeByMonthCategory: incomeMonthCategoryRows.results })
      }
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({error:'集計月を確認してください'},400)
      const {start:rangeStart,end:rangeEnd}=entryDateBounds(month)||{}
      if(!rangeStart)return json({error:'集計月を確認してください'},400)
      const total = await db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END),0) t, SUM(CASE WHEN type = 'expense' THEN 1 ELSE 0 END) n, COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN type = 'transfer' THEN amount ELSE 0 END),0) transferTotal, SUM(CASE WHEN type = 'transfer' THEN 1 ELSE 0 END) transferCount, COUNT(*) recordCount FROM entries WHERE date>=?1 AND date<?2").bind(rangeStart,rangeEnd).first()
      const cat = await db.prepare("SELECT category, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'expense' GROUP BY category ORDER BY amount DESC").bind(rangeStart,rangeEnd).all()
      const day = await db.prepare("SELECT substr(date,1,10) date, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'expense' GROUP BY substr(date,1,10) ORDER BY date").bind(rangeStart,rangeEnd).all()
      const paymentRows = await db.prepare("SELECT CASE WHEN e.type='income' AND e.category='ポイント還元' AND e.transfer_target LIKE 'credit:%' AND LENGTH(e.transfer_target)>7 THEN 'ポイント払い' WHEN e.type='transfer' AND (TRIM(COALESCE(e.payment_source,''))='' OR e.payment_source IN ('その他','其他')) THEN '振替元未指定' WHEN TRIM(COALESCE(e.payment_source,'')) = '' OR e.payment_source = '現金' THEN '現金' WHEN p.stat_group='points' THEN 'ポイント払い' ELSE 'カード・電子決済' END method, SUM(CASE WHEN e.type='expense' THEN 1 ELSE 0 END) count, COALESCE(SUM(CASE WHEN e.type='expense' THEN e.amount ELSE 0 END),0) amount, COALESCE(SUM(CASE WHEN e.type='expense' THEN e.amount ELSE 0 END),0) expenseAmount, COALESCE(SUM(CASE WHEN e.type='transfer' THEN e.amount ELSE 0 END),0) transferAmount, SUM(CASE WHEN e.type='expense' THEN 1 ELSE 0 END) expenseCount, SUM(CASE WHEN e.type='transfer' THEN 1 ELSE 0 END) transferCount, COALESCE(SUM(CASE WHEN e.type='income' THEN e.amount ELSE 0 END),0) creditOffsetAmount, SUM(CASE WHEN e.type='income' THEN 1 ELSE 0 END) creditOffsetCount FROM entries e LEFT JOIN payment_sources p ON p.name=e.payment_source WHERE e.date>=?1 AND date<?2 AND (e.type IN ('expense','transfer') OR (e.type='income' AND e.category='ポイント還元' AND e.transfer_target LIKE 'credit:%' AND LENGTH(e.transfer_target)>7)) GROUP BY method ORDER BY amount DESC").bind(rangeStart,rangeEnd).all()
      const comparison = await periodComparison(day.results, { month })
      return json({ periodComparison: comparison, paymentMethods: paymentRows.results, total: total.t, count: total.n, income: total.income, transferTotal: total.transferTotal, transferCount: total.transferCount, recordCount: total.recordCount, byCategory: cat.results, byDay: day.results })
    }
    return json({ error: '対象が見つかりません' }, 404)
  } catch (err) {
    console.error('家計簿 API エラー', err)
    return json({ error: 'サーバー処理に失敗しました' }, 500)
  }
}
