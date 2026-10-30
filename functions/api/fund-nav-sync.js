// Explicit official provider for MUFG-managed funds only.
// Never fetch the SBI portfolio or infer a purchase from a price update.
import { MUFG_FUNDS, KNOWN_MANUAL_NAV_FUNDS } from '../../src/fund-nav-coverage.js'
export { MUFG_FUNDS } from '../../src/fund-nav-coverage.js'
export const PENDING_NAV_FUNDS = KNOWN_MANUAL_NAV_FUNDS
const provider = 'official_mufg'
const isoDate = value => {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  const normalized = /^\d{8}$/.test(raw)
    ? raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6,8)
    : raw.replaceAll('/','-')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null
  const d = new Date(normalized+'T00:00:00Z')
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0,10)!==normalized ? null : normalized
}
const dateInJapan = now => new Date(now.getTime()+9*3600_000).toISOString().slice(0,10)
export function parseMufgNav(payload, expectedCode, now=new Date()) {
  const entry=payload?.datasets?.[0]
  if (!entry || typeof entry !== 'object' || !/^[A-Z0-9]{8}$/.test(expectedCode))
    throw Error('provider_payload_invalid')
  // If the endpoint includes an association code, verify it is the requested fund.
  const returned=entry.association_fund_cd ?? entry.association_fund_code
  if ((returned == null && !Object.hasOwn(MUFG_FUNDS,expectedCode)) ||
      (returned != null && String(returned).toUpperCase()!==expectedCode))
    throw Error('provider_fund_mismatch')
  const navRaw=String(entry.nav??'').replaceAll(',','').trim()
  const price=/^[1-9]\d*$/.test(navRaw)?Number(navRaw):NaN
  const date=isoDate(String(entry.base_date??''))
  if (!Number.isSafeInteger(price) || price>1_000_000_000 || !date)
    throw Error('provider_nav_invalid')
  const today=dateInJapan(now)
  const age=(Date.parse(today+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000
  if(age<0 || age>14)throw Error('provider_nav_stale_or_future')
  // Avoid confusing another product's NAV with this holding if name is supplied.
  return {fundCode:expectedCode,navPer10000:price,priceDate:date,source:provider}
}
export async function fetchMufgNav(fundCode,{fetcher=fetch,now=new Date()}={}) {
  // No arbitrary URLs or data writes: only 8-character fund association codes
  // can be queried from MUFG's fixed official endpoint. A live, code-matching
  // quote is required before declaring a new fund automatically supported.
  if (!/^[A-Z0-9]{8}$/.test(fundCode) || Object.hasOwn(PENDING_NAV_FUNDS,fundCode))
    throw Error('unsupported_mufg_fund')
  const url='https://developer.am.mufg.jp/fund_information_latest/association_fund_cd/'+fundCode
  const response=await fetcher(url,{
    headers:{Accept:'application/json'},
    redirect:'error',
    signal:AbortSignal.timeout(10000)
  })
  if(!response.ok)throw Error('provider_http_'+response.status)
  const text=await response.text()
  if(text.length>150_000)throw Error('provider_response_too_large')
  let body
  try{body=JSON.parse(text)}catch{throw Error('provider_non_json')}
  return parseMufgNav(body,fundCode,now)
}
// Read-only live support check used while a user enters a NEW fund code.
// An unreachable provider is not the same as "manual-only".
export async function probeFundNavSupport(fundCode,{fetcher=fetch,now=new Date()}={}) {
  const code=String(fundCode||'').trim().toUpperCase()
  if(!/^[A-Z0-9]{8}$/.test(code))return {status:'invalid'}
  if(Object.hasOwn(PENDING_NAV_FUNDS,code))return {status:'manual'}
  if(Object.hasOwn(MUFG_FUNDS,code))return {status:'auto'}
  try{
    const quote=await fetchMufgNav(code,{fetcher,now})
    return {status:'auto',priceDate:quote.priceDate}
  }catch(error){
    const reason=String(error?.message||error)
    if(/^(unsupported_mufg_fund|provider_http_404|provider_fund_mismatch|provider_payload_invalid)$/.test(reason))
      return {status:'manual'}
    return {status:'unknown'}
  }
}

export async function syncFundNav(db,{fetcher=fetch,now=new Date(),logger=console}={}) {
  if(!db)throw Error('missing_d1_binding')
  // Funds not held by this user are never inserted. Orders and acquisitions
  // are not queried or mutated by this scheduled task.
  const result=await db.prepare(
    'SELECT DISTINCT fund_code FROM investment_holdings ORDER BY fund_code LIMIT 100'
  ).all()
  const codes=(result.results||[]).map(x=>String(x.fund_code||'').trim().toUpperCase())
  const unsupported=codes.filter(code=>Object.hasOwn(PENDING_NAV_FUNDS,code))
  const targetCodes=codes.filter(code=>!Object.hasOwn(PENDING_NAV_FUNDS,code))
  const summary={checked:targetCodes.length,updated:[],unchanged:[],failed:[],unsupported}
  for (const code of targetCodes) {
    try{
      const quote=await fetchMufgNav(code,{fetcher,now})
      // D1 performs a conditional atomic UPSERT, preventing older job runs
      // from overwriting a more recent manual/automatic quote. The legacy
      // screenshot date is observation time, not the actual fund NAV date.
      const result=await db.prepare(`INSERT INTO fund_prices(fund_code,nav_per_10000,price_date,source,updated_at)
        VALUES(?1,?2,?3,?4,?5)
        ON CONFLICT(fund_code) DO UPDATE SET
          nav_per_10000=excluded.nav_per_10000,
          price_date=excluded.price_date,
          source=excluded.source,
          updated_at=excluded.updated_at
        WHERE fund_prices.source='sbi_screenshot' OR fund_prices.price_date<excluded.price_date`)
        .bind(quote.fundCode,quote.navPer10000,quote.priceDate,quote.source,now.toISOString()).run()
      ;(Number(result.meta?.changes||0)>0?summary.updated:summary.unchanged).push(code)
    }catch(error){
      summary.failed.push({fund_code:code,reason:String(error?.message||error).slice(0,120)})
      logger.warn('NAV refresh skipped',code,String(error))
    }
  }
  return summary
}
