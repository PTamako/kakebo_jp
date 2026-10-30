// Explicit official provider for MUFG-managed funds only.
// Never fetch the SBI portfolio or infer a purchase from a price update.
import { MUFG_FUNDS, KNOWN_MANUAL_NAV_FUNDS } from '../../src/fund-nav-coverage.js'
import { DAIWA_FUND_CODE, fetchDaiwaNav } from './daiwa-nav.js'
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
    // Workers supports only 'follow' or 'manual'; never follow provider redirects.
    redirect:'manual',
    signal:AbortSignal.timeout(10000)
  })
  // Reject redirects explicitly instead of following another host.
  if(response.status>=300 && response.status<400)throw Error('provider_redirect_blocked')
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

// The experimental Daiwa provider is isolated: failure never blocks MUFG updates.
export async function syncFundNav(db,{
  fetcher=fetch,now=new Date(),logger=console,enableDaiwaCsv=false,retryOnlyDaiwa=false,retryPendingNav=false
}={}) {
  if(!db)throw Error('missing_d1_binding')
  const {results=[]}=await db.prepare(
    'SELECT DISTINCT fund_code FROM investment_holdings ORDER BY fund_code LIMIT 100'
  ).all()
  const codes=results.map(x=>String(x.fund_code||'').trim().toUpperCase())
  const hasDaiwa=codes.includes(DAIWA_FUND_CODE)
  const jstToday=todayJstDate(now)
  const weekday=new Date(jstToday+'T00:00:00Z').getUTCDay()
  const skipLateRetry=retryPendingNav && (weekday===0||weekday===6)
  const activeDaiwa=hasDaiwa && enableDaiwaCsv && !skipLateRetry
  const ordinaryCodes=(retryOnlyDaiwa||skipLateRetry)?[]:codes.filter(code=>code!==DAIWA_FUND_CODE)
  const unsupported=ordinaryCodes.filter(code=>Object.hasOwn(PENDING_NAV_FUNDS,code))
  if(hasDaiwa&&!activeDaiwa&&!retryOnlyDaiwa)unsupported.push(DAIWA_FUND_CODE)
  const targetCodes=ordinaryCodes.filter(code=>!Object.hasOwn(PENDING_NAV_FUNDS,code))
  const summary={checked:targetCodes.length,updated:[],unchanged:[],failed:[],unsupported}
  if(activeDaiwa)summary.optionalFailed=[]
  const store=async quote=>{
    const result=await db.prepare(`INSERT INTO fund_prices(fund_code,nav_per_10000,price_date,source,updated_at)
      VALUES(?1,?2,?3,?4,?5)
      ON CONFLICT(fund_code) DO UPDATE SET
        nav_per_10000=excluded.nav_per_10000,
        price_date=excluded.price_date,
        source=excluded.source,
        updated_at=excluded.updated_at
      WHERE fund_prices.source='sbi_screenshot' OR fund_prices.price_date<excluded.price_date`)
      .bind(quote.fundCode,quote.navPer10000,quote.priceDate,quote.source,now.toISOString()).run()
    ;(Number(result.meta?.changes||0)>0?summary.updated:summary.unchanged).push(quote.fundCode)
  }
  for(const code of targetCodes){
    try{
      if(retryPendingNav){
        const {results:currentQuotes=[]}=await db.prepare('SELECT price_date,source FROM fund_prices WHERE fund_code=?1').bind(code).all()
        const current=currentQuotes[0]
        if(current?.source?.startsWith('official_') && current.price_date>=jstToday){
          summary.unchanged.push(code)
          continue
        }
      }
      await store(await fetchMufgNav(code,{fetcher,now}))
    }catch(error){
      const reason=String(error?.message||error)
      if(/^(provider_http_404|unsupported_mufg_fund)$/.test(reason)){
        summary.unsupported.push(code)
        continue
      }
      summary.failed.push({fund_code:code,reason:reason.slice(0,120)})
      logger.warn('NAV refresh skipped',code,String(error))
    }
  }
  if(activeDaiwa){
    // Only the extra 23:15 event is conditional. Never request the same day's
    // official quote a second time, and never run an unnecessary weekend retry.
    let shouldFetch=true
    if(retryOnlyDaiwa){
      const weekday=new Date(todayJstDate(now)+'T00:00:00Z').getUTCDay()
      if(weekday===0||weekday===6)shouldFetch=false
      if(shouldFetch){
        const current=await db.prepare('SELECT price_date,source FROM fund_prices WHERE fund_code=?1')
          .bind(DAIWA_FUND_CODE).first()
        if(current?.source?.startsWith('official_') && current.price_date>=todayJstDate(now))
          shouldFetch=false
      }
    }
    if(shouldFetch){
      summary.checked++
      try{
        await store(await fetchDaiwaNav({fetcher,now}))
      }catch(error){
        const reason=String(error?.message||error).slice(0,120)
        summary.optionalFailed.push({fund_code:DAIWA_FUND_CODE,reason})
        logger.warn('NAV optional Daiwa skipped',DAIWA_FUND_CODE,reason)
        // Keep the previous manual/official quote; do not fail the MUFG job.
      }
    }
  }
  return summary
}
const todayJstDate = now => new Date(now.getTime()+9*3600000).toISOString().slice(0,10)
