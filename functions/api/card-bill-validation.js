// One authoritative policy for both the modern recalculate API and legacy PUT.
// Do not mutate saved bill snapshots or ledger entries during validation.
import { billingPeriodForMonth } from '../../src/card-billing.js'

const validDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value+'T00:00:00Z')) &&
  new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value

const invalid=()=>({error:'カードの締め期間・支払方法を確認してください',code:'invalid_card_bill_period'})

export async function validateCardBillRecalculation(db,item) {
  if (!item || typeof item!=='object' || Array.isArray(item) ||
      typeof item.name!=='string' || item.name.trim()!==item.name ||
      item.name.length<1 || item.name.length>80 ||
      ['現金','その他','其他'].includes(item.name) ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month||'') ||
      !validDate(item.start) || !validDate(item.end) || item.start>item.end ||
      item.end.slice(0,7)!==item.month) return invalid()
  const days=(Date.parse(item.end+'T00:00:00Z')-Date.parse(item.start+'T00:00:00Z'))/86400000
  if(!Number.isFinite(days)||days>35)return invalid()
  const card=await db.prepare(
    'SELECT source_type,is_archived,closing_day,stat_group FROM payment_sources WHERE name=?1'
  ).bind(item.name).first()
  if(!card||card.source_type!=='standard'||Number(card.is_archived)===1||
      card.stat_group==='points')return invalid()
  // A missing/zero closing day means end-of-month, not "no validation".
  const day=Number(card.closing_day||0)
  const canonical=billingPeriodForMonth(item.month,day===0?'末日':day)
  if(!canonical||canonical.start!==item.start||canonical.end!==item.end)return invalid()
  return null
}
