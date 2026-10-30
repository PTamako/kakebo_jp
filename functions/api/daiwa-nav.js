// Experimental first-party CSV reader for ONE Daiwa fund, deliberately fail-closed.
// Official CSV availability and automated access are NOT guaranteed.
export const DAIWA_FUND_CODE = '04317188'
export const DAIWA_FUND_NAME = 'iFreeNEXT NASDAQ100インデックス'
export const DAIWA_FUND_URL = 'https://www.daiwa-am.co.jp/funds/detail/3373/detail_top.html'
const OFFICIAL_HOST = 'www.daiwa-am.co.jp'
const validDate = raw => {
  const str=String(raw||'').trim().replace(/\//g,'-')
  const date=/^\d{8}$/.test(str)?str.slice(0,4)+'-'+str.slice(4,6)+'-'+str.slice(6):str
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('daiwa_invalid_date')
  const d=new Date(date+'T00:00:00Z')
  if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==date)throw Error('daiwa_invalid_date')
  return date
}
const todayJst = now => new Date(now.getTime()+9*3600000).toISOString().slice(0,10)
const normalize = s => String(s||'').replace(/\s+/g,'').replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,'')
const safeOfficialUrl = (href,base) => {
  const url=new URL(String(href).replaceAll('&amp;','&'),base)
  if(url.protocol!=='https:'||url.hostname!==OFFICIAL_HOST||url.username||url.password||
     !url.pathname.startsWith('/funds/'))throw Error('daiwa_untrusted_csv_url')
  return url.toString()
}
// The link must come from Daiwa's page for fund 3373, NOT from an unrelated index.
export function discoverDaiwaCsvUrl(html){
  if(!/iFreeNEXT\s*NASDAQ100/i.test(normalize(html)))throw Error('daiwa_fund_identity_missing')
  const anchors=String(html).match(/<a\b[^>]*>[\s\S]*?<\/a>/gi)||[]
  for(const anchor of anchors){
    if(!/時系列データ|CSV.*ダウンロード/i.test(normalize(anchor)))continue
    const href=anchor.match(/\shref\s*=\s*["']([^"']+)["']/i)?.[1]
    if(href && !/^javascript:/i.test(href))
      return safeOfficialUrl(href,DAIWA_FUND_URL)
  }
  throw Error('daiwa_csv_link_not_exposed')
}
export function parseDaiwaCsv(csv,now=new Date()){
  const lines=String(csv||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim())
  if(lines.length<2)throw Error('daiwa_csv_empty')
  const head=lines[0].split(',').map(s=>s.replace(/^\uFEFF/,'').trim().replace(/^"|"$/g,''))
  const dateIndex=head.indexOf('基準日'),priceIndex=head.indexOf('基準価額')
  if(dateIndex<0||priceIndex<0||dateIndex===priceIndex)throw Error('daiwa_csv_header_invalid')
  // A CSV without a fund code is accepted ONLY after following a download link
  // discovered from the verified Daiwa 3373 page. Never accept generic feeds.
  const codeIndex=head.indexOf('投信協会コード')
  let latest=null
  for(const line of lines.slice(1)){
    const cols=line.split(',').map(s=>s.trim().replace(/^"|"$/g,''))
    if(codeIndex>=0 && cols[codeIndex]!==DAIWA_FUND_CODE)throw Error('daiwa_fund_code_mismatch')
    if(!cols[dateIndex]&&!cols[priceIndex])continue
    const date=validDate(cols[dateIndex])
    const priceRaw=cols[priceIndex]
    if(!/^[1-9]\d*(?:\.0{1,2})?$/.test(priceRaw))throw Error('daiwa_nav_invalid')
    const price=Number(priceRaw)
    if(!Number.isSafeInteger(price)||price>1_000_000_000)throw Error('daiwa_nav_invalid')
    if(!latest || date>latest.priceDate) latest={priceDate:date,navPer10000:price}
    else if(date===latest.priceDate && price!==latest.navPer10000)throw Error('daiwa_csv_duplicate_date')
  }
  if(!latest)throw Error('daiwa_csv_empty')
  const today=todayJst(now)
  const age=(Date.parse(today+'T00:00:00Z')-Date.parse(latest.priceDate+'T00:00:00Z'))/86400000
  if(age<0||age>14)throw Error('daiwa_nav_stale_or_future')
  return {fundCode:DAIWA_FUND_CODE,...latest,source:'official_daiwa'}
}
const readResponse = async (response,maxBytes) => {
  if(response.status>=300&&response.status<400)throw Error('daiwa_redirect_blocked')
  if(!response.ok)throw Error('daiwa_http_'+response.status)
  const bytes=new Uint8Array(await response.arrayBuffer())
  if(!bytes.length||bytes.length>maxBytes)throw Error('daiwa_response_size_invalid')
  const utf8=new TextDecoder('utf-8',{fatal:true})
  try{
    const s=utf8.decode(bytes)
    if(s.includes('基準日')&&s.includes('基準価額'))return s
    if(maxBytes===500_000)return s
  }catch{}
  return new TextDecoder('shift_jis',{fatal:true}).decode(bytes)
}
export async function fetchDaiwaNav({fetcher=fetch,now=new Date()}={}){
  const options={redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html,text/csv'}}
  const page=await readResponse(await fetcher(DAIWA_FUND_URL,options),500_000)
  const csvUrl=discoverDaiwaCsvUrl(page)
  const csv=await readResponse(await fetcher(csvUrl,{...options,headers:{Accept:'text/csv,application/octet-stream'}}),1_500_000)
  return parseDaiwaCsv(csv,now)
}
