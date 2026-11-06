import { prepaidTarget } from '../../src/prepaid-card.js'
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const todayJST=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
export async function prepaidSchemaReady(db) {
  const {results}=await db.prepare('PRAGMA table_info(payment_sources)').all()
  return ['source_type','opening_balance','opening_date','opening_entry_id'].every(col=>results.some(x=>x.name===col))
}
export async function handlePrepaid({db,request,method,sub}) {
  if(!await prepaidSchemaReady(db))return json({error:'プリペイド管理の追加移行が必要です',code:'prepaid_migration_required'},409)
  const pending=await db.prepare("SELECT name FROM payment_sources WHERE source_type='prepaid' AND opening_date='__restore_pending__' LIMIT 1").first()
  if(pending)return json({error:'プリペイド残高の復元が完了していません。バックアップ復元を再開してください',code:'prepaid_restore_incomplete'},409)
  if(method==='POST' && sub==='opening'){
    const body=await request.json().catch(()=>null)
    const name=typeof body?.name==='string'?body.name.trim():''
    const balance=body?.openingBalance
    if(!name || name.length>80 || !Number.isSafeInteger(balance) || balance<0 || balance>100000000)
      return json({error:'期首残高は0円以上の整数で入力してください'},400)
    // Preserve original start-date / ledger-ID anchor: editing baseline must never
    // reset transaction history or cause double counting.
    const updated=await db.prepare("UPDATE payment_sources SET opening_balance=?1 WHERE name=?2 AND source_type='prepaid'")
      .bind(balance,name).run()
    if(!updated.meta?.changes)return json({error:'登録済みのプリペイドカードが見つかりません'},404)
    return json({ok:true,name,opening_balance:balance})
  }
  if(method!=='GET'||sub)return json({error:'未対応の操作です'},405)
  const today=todayJST()
  const monthStart=today.slice(0,7)+'-01'
  const {results:cards}=await db.prepare(`SELECT p.name,p.opening_balance,p.opening_entry_id,p.opening_date,
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='transfer' AND e.transfer_target='prepaid:'||p.name
        AND e.id>p.opening_entry_id AND (e.date>=p.opening_date OR COALESCE(e.transfer_date,e.date)>=p.opening_date) AND e.date<=?1
        AND COALESCE(e.transfer_date,e.date)<=?1
        AND COALESCE(e.payment_source,'')<>p.name),0) charged,
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='transfer' AND e.transfer_target='prepaid:'||p.name
        AND e.id>p.opening_entry_id AND (e.date>=p.opening_date OR COALESCE(e.transfer_date,e.date)>=p.opening_date) AND e.date<=?1
        AND COALESCE(e.transfer_date,e.date) BETWEEN ?2 AND ?1
        AND COALESCE(e.payment_source,'')<>p.name),0) charged_month,
    -- Point rewards credited to the wallet are receipts, not transfers. The
    -- generated top-up is a separate outgoing transfer; both sides must count.
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='income' AND e.category='ポイント還元' AND e.payment_source=p.name
        AND e.id>p.opening_entry_id AND e.date>=p.opening_date AND e.date<=?1),0) earned,
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='income' AND e.category='ポイント還元' AND e.payment_source=p.name
        AND e.id>p.opening_entry_id AND e.date>=p.opening_date
        AND e.date BETWEEN ?2 AND ?1),0) earned_month,
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='expense' AND e.payment_source=p.name
        AND e.id>p.opening_entry_id AND e.date>=p.opening_date AND e.date<=?1),0) spent,
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='expense' AND e.payment_source=p.name
        AND e.id>p.opening_entry_id AND e.date>=p.opening_date
        AND e.date BETWEEN ?2 AND ?1),0) spent_month,
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='transfer' AND e.payment_source=p.name
        AND e.id>p.opening_entry_id AND (e.date>=p.opening_date OR COALESCE(e.transfer_date,e.date)>=p.opening_date) AND e.date<=?1
        AND COALESCE(e.transfer_date,e.date)<=?1
        AND COALESCE(e.transfer_target,'')<>'prepaid:'||p.name),0) transferred_out,
    COALESCE((SELECT SUM(e.amount) FROM entries e
      WHERE e.type='transfer' AND e.payment_source=p.name
        AND e.id>p.opening_entry_id AND (e.date>=p.opening_date OR COALESCE(e.transfer_date,e.date)>=p.opening_date) AND e.date<=?1
        AND COALESCE(e.transfer_date,e.date) BETWEEN ?2 AND ?1
        AND COALESCE(e.transfer_target,'')<>'prepaid:'||p.name),0) transferred_out_month
    FROM payment_sources p WHERE p.source_type='prepaid'
    ORDER BY p.sort_order,p.name`).bind(today,monthStart).all()
  // Latest activity is read-only and uses exactly the same opening anchor/date
  // predicates as the balance and card-history filters. No extra ledger table.
  const [latestUsage,latestCharge] = await Promise.all([
    db.prepare(`SELECT p.name AS card,e.id,e.date,e.amount,e.merchant
      FROM entries e
      JOIN payment_sources p ON p.source_type='prepaid' AND e.payment_source=p.name
      WHERE e.type='expense' AND e.id>p.opening_entry_id
        AND e.date>=p.opening_date AND e.date<=?1
      ORDER BY e.date DESC,COALESCE(e.time,'') DESC,e.id DESC LIMIT 1`).bind(today).first(),
    db.prepare(`SELECT p.name AS card,e.id,COALESCE(e.transfer_date,e.date) AS date,
        e.amount,e.payment_source AS funding_source
      FROM entries e
      JOIN payment_sources p ON p.source_type='prepaid' AND e.transfer_target='prepaid:'||p.name
      WHERE e.type='transfer' AND e.id>p.opening_entry_id
        AND (e.date>=p.opening_date OR COALESCE(e.transfer_date,e.date)>=p.opening_date) AND e.date<=?1
        AND COALESCE(e.transfer_date,e.date)<=?1
        AND COALESCE(e.payment_source,'')<>p.name
      ORDER BY COALESCE(e.transfer_date,e.date) DESC,
        e.date DESC,COALESCE(e.time,'') DESC,e.id DESC LIMIT 1`).bind(today).first()
  ])
  return json({
    cards:cards.map(p=>({...p,balance:Number(p.opening_balance)+Number(p.charged)+Number(p.earned)-Number(p.spent)-Number(p.transferred_out)})),
    latestUsage:latestUsage || null,
    latestCharge:latestCharge || null
  })
}
export async function validPrepaidTarget(db,target){
  if(typeof target!=='string'||!target.startsWith('prepaid:')||target.length>88)return false
  const name=target.slice('prepaid:'.length)
  if(!name||name==='現金')return false
  const row=await db.prepare("SELECT name FROM payment_sources WHERE name=?1 AND source_type='prepaid'").bind(name).first()
  return !!row
}
