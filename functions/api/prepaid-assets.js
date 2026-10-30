import { prepaidTarget } from '../../src/prepaid-card.js'
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8'}})
export async function prepaidSchemaReady(db){
  const row=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='prepaid_cards'").first()
  return !!row
}
const dateOk=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value
const japanToday=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
export async function handlePrepaid({db,request,method,sub}){
  const ready=await prepaidSchemaReady(db)
  if(!ready)return json({error:'プリペイド管理の追加移行が必要です',code:'prepaid_migration_required'},409)
  if(method==='GET'&&!sub){
    const today=japanToday()
    const {results:cards}=await db.prepare(`SELECT p.name,p.opening_balance,p.opening_entry_id,p.opening_date,
      COALESCE((SELECT SUM(e.amount) FROM entries e WHERE e.type='transfer' AND e.transfer_target='prepaid:'||p.name AND e.id>p.opening_entry_id AND e.date>=p.opening_date AND e.date<=?1 AND COALESCE(e.transfer_date,e.date)<=?1),0) charged,
      COALESCE((SELECT SUM(e.amount) FROM entries e WHERE e.type='expense' AND e.payment_source=p.name AND e.id>p.opening_entry_id AND e.date>=p.opening_date AND e.date<=?1),0) spent
      FROM prepaid_cards p INNER JOIN payment_sources s ON s.name=p.name ORDER BY s.sort_order,s.name`).bind(today).all()
    const {results:recharges}=await db.prepare(`SELECT e.id,e.date,e.amount,e.merchant,e.payment_source,e.transfer_target
      FROM entries e WHERE e.type='transfer' AND e.transfer_target LIKE 'prepaid:%' AND e.date<=?1
      AND EXISTS (SELECT 1 FROM prepaid_cards p WHERE e.transfer_target='prepaid:'||p.name AND e.id>p.opening_entry_id AND e.date>=p.opening_date)
      ORDER BY e.date DESC,e.id DESC LIMIT 40`).bind(today).all()
    return json({cards:cards.map(p=>({...p,balance:Number(p.opening_balance)+Number(p.charged)-Number(p.spent)})),recharges})
  }
  if(method==='POST'&&sub==='setup'){
    const body=await request.json(),name=String(body?.name||'').trim()
    const raw=body?.openingBalance
    const amount=Number(raw)
    if(!name||name.length>80||['現金','その他','其他'].includes(name)||!Number.isSafeInteger(amount)||amount<0||raw==null||raw==='')return json({error:'カード名と残高を確認してください'},400)
    const source=await db.prepare('SELECT name FROM payment_sources WHERE name=?1').bind(name).first()
    if(!source)return json({error:'先にカードを登録してください'},404)
    const existing=await db.prepare('SELECT name FROM prepaid_cards WHERE name=?1').bind(name).first()
    if(existing)return json({error:'登録済みです。残高を上書きする場合は個別の再設定が必要です',code:'prepaid_already_exists'},409)
    const today=japanToday()
    // Snapshot anchor prevents historical entries being silently counted again.
    await db.prepare(`INSERT INTO prepaid_cards(name,opening_balance,opening_entry_id,opening_date)
      VALUES(?1,?2,(SELECT COALESCE(MAX(id),0) FROM entries),?3)`).bind(name,amount,today).run()
    return json({ok:true})
  }
  if(method==='POST'&&sub==='disable'){
    const body=await request.json(),name=String(body?.name||'').trim()
    if(!name)return json({error:'カードを指定してください'},400)
    const referenced=await db.prepare("SELECT id FROM entries WHERE type='transfer' AND transfer_target=?1 LIMIT 1").bind(prepaidTarget(name)).first()
    if(referenced)return json({error:'チャージ履歴があるため解除できません。明細を確認してください'},409)
    await db.prepare('DELETE FROM prepaid_cards WHERE name=?1').bind(name).run()
    return json({ok:true})
  }
  return json({error:'未対応の操作です'},405)
}
