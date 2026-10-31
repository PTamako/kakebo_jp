import { validateBackup } from '../../src/finance-tools.js'

// An entire bounded restore is one D1 transaction. No DELETE, REPLACE,
// destructive migrations or changes to non-empty SBI market valuations.
// Cloudflare D1's batch() rolls back ALL statements if any statement fails.
export async function restoreAtomic(db, archive) {
  validateBackup(archive)
  const entries = archive.entries
  const deferredPrepaidEntries = archive.deferredPrepaidEntries || []
  if(!Array.isArray(deferredPrepaidEntries))throw Error('atomic_restore_invalid_deferred')
  const allEntries = [...entries,...deferredPrepaidEntries]
  if(deferredPrepaidEntries.length)validateBackup({...archive,entries:allEntries})
  const collections = ['paymentSources','merchantPaymentRules','customRules','categories','plans','bills','recurringExclusions','dismissedTransfers','categoryMetadata','investmentPlans','investmentPlanHistory','investmentHoldings','fundPrices','transferLinks']
  const totalSettings = collections.reduce((n,k)=>n+(archive[k]?.length||0),0) + Object.keys(archive.categoryIcons||{}).length
  // Each request is atomic. The client sends bounded, idempotent stages
  // rather than dropping settings from a large archive.
  if (allEntries.length > 500 || totalSettings > 500) throw Error('atomic_restore_too_large')
  if (!allEntries.every(e=>typeof e.clientRequestId === 'string' && /^restore_[a-f0-9]{32}$/.test(e.clientRequestId)))
    throw Error('atomic_restore_invalid_ids')
  if (new Set(allEntries.map(e=>e.clientRequestId)).size!==allEntries.length)
    throw Error('atomic_restore_duplicate_ids')
  if (deferredPrepaidEntries.length && archive.prepaidRestoreInProgress!==true)
    throw Error('atomic_restore_invalid_deferred')
  const validText = (s,max) => typeof s === 'string' && s.trim().length>0 && s.length<=max
  if (allEntries.some(e=>!validText(e.merchant ?? '',500) && e.merchant !== '' && e.merchant != null) ||
      allEntries.some(e=>typeof e.note==='string' && e.note.length>2000))
    throw Error('atomic_restore_invalid_entries')
  const prepaidSources=(archive.paymentSources||[]).filter(x=>x?.source_type==='prepaid')
  const prepaidFinal=archive.prepaidFinalize||[]
  if((prepaidSources.length||prepaidFinal.length) && archive.prepaidRestoreInProgress!==true)
    throw Error('atomic_restore_prepaid_requires_review')
  if(!Array.isArray(prepaidFinal)||prepaidFinal.length>100 ||
    prepaidFinal.some(x=>!validText(x?.name,80)||!Number.isSafeInteger(x?.openingBalance)||x.openingBalance<0||x.openingBalance>100000000))
    throw Error('atomic_restore_invalid_prepaid')
  if(prepaidSources.length||prepaidFinal.length){
    const {results:cols}=await db.prepare('PRAGMA table_info(payment_sources)').all()
    if(!['source_type','opening_balance','opening_date','opening_entry_id'].every(k=>cols.some(x=>x.name===k)))
      throw Error('atomic_restore_prepaid_requires_migration')
  }
  const statements=[]
  const add = (sql,...args) => statements.push(db.prepare(sql).bind(...args))
  for (const source of archive.paymentSources||[]) {
    if(source.source_type==='prepaid'){
      add("INSERT OR IGNORE INTO payment_sources(name,sort_order,closing_day,source_type,opening_balance,opening_date,opening_entry_id) VALUES(?1,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM payment_sources WHERE sort_order<99999),?2,'prepaid',0,'__restore_pending__',0)",source.name,source.closing_day??null)
    }else{
      add("INSERT OR IGNORE INTO payment_sources(name,sort_order,closing_day) VALUES(?1,CASE WHEN ?1 IN ('その他','其他') THEN 99999 ELSE (SELECT COALESCE(MAX(sort_order),-1)+1 FROM payment_sources WHERE name NOT IN ('その他','其他') AND sort_order<99999) END,?2)",source.name,source.closing_day??null)
    }
  }
  const preferred=(archive.paymentSources||[]).find(s=>s.is_default)
  if(preferred)add('UPDATE payment_sources SET is_default=1 WHERE name=?1 AND NOT EXISTS(SELECT 1 FROM payment_sources WHERE is_default=1)',preferred.name)
  for (const row of archive.categoryMetadata||[]) {
    add(`INSERT INTO category_source(category,sort_order,icon,display_name) VALUES(?1,?2,?3,?4)
      ON CONFLICT(category) DO UPDATE SET
        sort_order=COALESCE(category_source.sort_order,excluded.sort_order),
        icon=COALESCE(category_source.icon,excluded.icon),
        display_name=COALESCE(category_source.display_name,excluded.display_name)`,
      row.category,row.sort_order??null,row.icon??null,row.display_name??null)
  }
  for(const category of archive.categories||[]) {
    // Never rewrite historical category assignments; these rows only register
    // a user-added category in the category dropdown.
    add("INSERT INTO category_source(category,sort_order) VALUES(?1,CASE WHEN ?1 IN ('其他','其他收入') THEN 99999 ELSE (SELECT COALESCE(MAX(sort_order),8)+1 FROM category_source WHERE sort_order<99999) END) ON CONFLICT(category) DO NOTHING",category)
  }
  for(const [category,icon] of Object.entries(archive.categoryIcons||{})) {
    if(!/^[a-z][a-z-]{1,40}$/.test(icon))throw Error('atomic_restore_invalid_icon')
    add('INSERT INTO category_source(category,icon) VALUES(?1,?2) ON CONFLICT(category) DO UPDATE SET icon=excluded.icon WHERE category_source.icon IS NULL',category,icon)
  }
  // Backup user rules go into merchant_rules only. Never seed the defaults.
  for(const rule of archive.customRules||[])
    add('INSERT INTO merchant_rules(keyword,category) VALUES(?1,?2) ON CONFLICT(keyword) DO UPDATE SET category=COALESCE(merchant_rules.category,excluded.category)',rule.keyword,rule.category)
  for(const rule of archive.merchantPaymentRules||[]) {
    // Missing cards are not imported as dangling rules.
    add('INSERT INTO merchant_rules(keyword,payment_source) SELECT ?1,?2 WHERE EXISTS(SELECT 1 FROM payment_sources WHERE name=?2) ON CONFLICT(keyword) DO UPDATE SET payment_source=COALESCE(merchant_rules.payment_source,excluded.payment_source)',rule.keyword,rule.payment_source)
  }
  for(const bill of archive.bills||[])add('INSERT OR IGNORE INTO card_bills(payment_source,bill_month,period_start,period_end,total_amount,transaction_count) VALUES(?1,?2,?3,?4,?5,?6)',bill.name,bill.month,bill.start,bill.end,bill.total,bill.count)
  // Legacy v1-v3 investments snapshots are accepted but never restored.
  // Optional v4 portfolio data. Restore is insert-only and never replaces
  // the newer local holdings, allocations or prices.
  for(const p of archive.investmentPlans||[])
    add('INSERT OR IGNORE INTO investment_plans(fund_code,account_type,fund_name,monthly_amount,order_day,enabled,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7)',
      p.fund_code,p.account_type,p.fund_name,p.monthly_amount,p.order_day,p.enabled,p.updated_at||new Date().toISOString())
  for(const p of archive.investmentPlanHistory||[])
    add('INSERT OR IGNORE INTO investment_plan_history(fund_code,account_type,effective_month,fund_name,monthly_amount,order_day,enabled,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)',
      p.fund_code,p.account_type,p.effective_month,p.fund_name,p.monthly_amount,p.order_day,p.enabled,p.updated_at||new Date().toISOString())
  for(const h of archive.investmentHoldings||[])
    add('INSERT OR IGNORE INTO investment_holdings(fund_code,account_type,fund_name,units,acquisition_cost,reported_value,reported_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)',
      h.fund_code,h.account_type,h.fund_name,h.units,h.acquisition_cost,h.reported_value??null,h.reported_at??null,h.updated_at||new Date().toISOString())
  for(const p of archive.fundPrices||[])
    add('INSERT OR IGNORE INTO fund_prices(fund_code,nav_per_10000,price_date,source,updated_at) VALUES(?1,?2,?3,?4,?5)',
      p.fund_code,p.nav_per_10000,p.price_date,p.source,p.updated_at||new Date().toISOString())
  const insertedIndexes=[]
  const appendEntry=e=>{
    const type=e.type, transfer=type==='transfer'
    const target=transfer && (e.transfer_target==='sbi' || /^prepaid:[^:]{1,80}$/.test(e.transfer_target||'')) ? e.transfer_target : null
    const transferDate=transfer?(e.transfer_date||e.date):null
    // Applied status is a derived fact, NEVER trust a backup's flag for
    // future-dated SBI transfers. Preserve the manual valuation separately.
    const tokyoToday=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10)
    const transferApplied=target==='sbi' && transferDate<=tokyoToday ? 1 : 0
    if(transfer && transferDate!==null && !/^\d{4}-\d{2}-\d{2}$/.test(transferDate))throw Error('atomic_restore_invalid_transfer_date')
    insertedIndexes.push(statements.length)
    add('INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13) ON CONFLICT(client_request_id) DO NOTHING',
      e.date,e.time||'',Number(e.amount),transfer?'投資・資産移動':e.category||'其他',e.merchant||'',e.note||'',String(e.raw||'').slice(0,2000),
      type,target,transferApplied,transferDate,e.clientRequestId,e.payment_source||e.paymentSource||'')
  }
  for(const e of entries)appendEntry(e)
  // Only the card inserted by this restore has the temporary marker. Existing
  // records and their manually entered opening balances are never overwritten.
  const restoredAt=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
  for(const card of prepaidFinal)
    add("UPDATE payment_sources SET opening_balance=?1,opening_date=?2,opening_entry_id=(SELECT COALESCE(MAX(id),0) FROM entries) WHERE name=?3 AND source_type='prepaid' AND opening_date='__restore_pending__'",
      card.openingBalance,restoredAt,card.name)
  // The finalization anchor must be set BEFORE scheduled prepaid movements
  // are inserted; they get fresh IDs and will count when their dates arrive.
  for(const e of deferredPrepaidEntries)appendEntry(e)
  // Restore dismissal on transaction IDs actually imported (or idempotent retries).
  const byOldId=new Map(allEntries.filter(e=>e.type==='transfer'&&e.transfer_target==='sbi').map(e=>[Number(e.id),e]))
  for(const oldId of archive.dismissedTransfers||[]){
    const e=byOldId.get(Number(oldId))
    if(e)add('INSERT OR IGNORE INTO dismissed_transfer_reminders(entry_id) SELECT id FROM entries WHERE client_request_id=?1',e.clientRequestId)
  }
  // Transfer IDs change on restore. Map to a stable restore client request
  // ID and never guess a match from amount/date alone.
  const oldTransfers=new Map(allEntries.filter(e=>e.type==='transfer'&&e.transfer_target==='sbi'&&Number.isSafeInteger(Number(e.id))).map(e=>[Number(e.id),e]))
  for(const link of archive.transferLinks||[]){
    const e=oldTransfers.get(Number(link.entry_id))
    if(e)add("INSERT OR IGNORE INTO sbi_transfer_links(entry_id,purchase_month) SELECT id,?1 FROM entries WHERE client_request_id=?2 AND type='transfer' AND transfer_target='sbi'",
      link.purchase_month,e.clientRequestId)
  }
  for(const plan of archive.plans||[])add('INSERT OR IGNORE INTO recurring_plans(id,name,amount,day,category,payment_source,start_month,enabled) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)',
    plan.id,plan.name,plan.amount,plan.day,plan.category,plan.paymentSource,plan.startMonth,plan.enabled?1:0)
  // Restore only exclusion links that still point to an existing fixed-expense plan.
  for(const item of archive.recurringExclusions||[])
    add('INSERT OR IGNORE INTO recurring_candidate_exclusions(plan_id,month) SELECT ?1,?2 WHERE EXISTS(SELECT 1 FROM recurring_plans WHERE id=?1)',
      item.planId,item.month)
  if(!statements.length) return {ok:true,created:0,settings:0,skipped:0}
  const result=await db.batch(statements)
  if(!Array.isArray(result)||result.length!==statements.length||result.some(r=>r?.success===false))
    throw Error('atomic_restore_db_failed')
  const insertedSet=new Set(insertedIndexes)
  const created=insertedIndexes.reduce((n,i)=>n+Number(result[i]?.meta?.changes||0),0)
  return {ok:true,created,settings:result.reduce((n,r,i)=>n+(!insertedSet.has(i)?Number(r.meta?.changes||0):0),0),skipped:allEntries.length-created}
}
