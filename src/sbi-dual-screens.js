// SBI provides separate "評価損益" and "保有数量" screens.
// A position's acquisition cost is exact only when valuation and cumulative PnL
// are from the same snapshot: acquisition = market valuation - cumulative PnL.
// Never use "評価額前日比" or "取得単価" as cumulative PnL.
const number = value => {
  const raw=String(value||'').normalize('NFKC').replace(/[¥￥,\s円]/g,'')
  return /^-?\+?\d{1,13}$/.test(raw) ? Number(raw) : null
}
const safe = x => Number.isSafeInteger(x) && Math.abs(x)<=1000000000000
const key = row => row.fundCode+':'+row.accountType
const normalizeDate = value => String(value||'').normalize('NFKC').trim()
const validSnapshot = stamp => {
  const m=normalizeDate(stamp).match(/^(\d{4})[/-](\d\d)[/-](\d\d)\s+(\d\d):(\d\d)$/)
  if(!m)return false
  const iso=m[1]+'-'+m[2]+'-'+m[3]
  const parsed=new Date(iso+'T00:00:00Z')
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0,10)===iso && Number(m[4])<24 && Number(m[5])<60
}
const accountFrom = value => {
  const v=String(value||'').normalize('NFKC').toLowerCase().replace(/\s/g,'')
  if(/^(combined|合算)$/.test(v))return 'combined'
  if(/^(growth|成長|成長投資枠)$/.test(v))return 'growth'
  if(/^(tsumitate|積立|つみたて|つみたて投資枠)$/.test(v))return 'tsumitate'
  return null
}
export function parseSbiScreen(text,kind,holdings){
  if(!['profit','positions'].includes(kind))return {error:'画像の種類を確認してください',items:[]}
  const lines=String(text||'').normalize('NFKC').split(/\r?\n/).map(s=>s.trim()).filter(Boolean)
  const meta=lines.filter(s=>s.startsWith('META|'))
  if(meta.length!==1)return {error:'更新日時と評価額合計を読み取れませんでした',items:[]}
  const parts=meta[0].split('|').map(s=>s.trim())
  if(parts.length!==(kind==='profit'?4:3)||!validSnapshot(parts[1]))
    return {error:'SBI画面の更新日時を確認してください',items:[]}
  const totalValue=number(parts[2]),totalPnl=kind==='profit'?number(parts[3]):null
  if(!safe(totalValue)||totalValue<0||(kind==='profit'&&!safe(totalPnl)))
    return {error:'合計金額を確認してください',items:[]}
  const seen=new Set(),items=[]
  const all=Array.isArray(holdings)?holdings:[]
  if(!all.length)return {error:'登録済みの保有銘柄がありません',items:[]}
  for(const line of lines){
    if(line.startsWith('META|'))continue
    const p=line.split('|').map(s=>s.trim())
    if(p.length!==(kind==='profit'?4:4)||!/^[A-Z0-9]{8}$/.test(p[0].toUpperCase()))
      return {error:'銘柄コードと金額を確認してください',items:[]}
    const account=accountFrom(p[1]),fundCode=p[0].toUpperCase()
    const h=all.find(h=>h.fund_code===fundCode&&h.account_type===account)
    if(!h)return {error:'未登録または口座不一致の銘柄があります：'+fundCode,items:[]}
    const id=fundCode+':'+account
    if(seen.has(id))return {error:'同じ銘柄が重複しています：'+fundCode,items:[]}
    seen.add(id)
    const a=number(p[2]),b=number(p[3])
    if(!safe(a)||!safe(b)||(kind==='positions'&&(a<0||b<0))||(kind==='profit'&&b<=0))
      return {error:'口数・評価額・評価損益を確認してください：'+fundCode,items:[]}
    items.push(kind==='positions'
      ? {fundCode,accountType:account,units:a,marketValue:b}
      : {fundCode,accountType:account,pnl:a,acquisitionUnitPrice:b})
  }
  if(!items.length||items.length!==all.length)return {error:'保有銘柄が揃っていません。両画面の全銘柄を表示してください',items:[]}
  if(kind==='positions'&&items.reduce((sum,h)=>sum+h.marketValue,0)!==totalValue)
    return {error:'各銘柄の評価額合計が画面の合計と一致しません',items:[]}
  if(kind==='profit'&&items.reduce((sum,h)=>sum+h.pnl,0)!==totalPnl)
    return {error:'各銘柄の評価損益合計が画面の合計と一致しません',items:[]}
  return {stamp:normalizeDate(parts[1]).replace(/\//g,'-'),totalValue,totalPnl,items,error:''}
}
export function reconcileSbiScreens(profitText,positionsText,holdings){
  const profit=parseSbiScreen(profitText,'profit',holdings)
  if(profit.error)return {updates:[],error:'損益画面：'+profit.error}
  const positions=parseSbiScreen(positionsText,'positions',holdings)
  if(positions.error)return {updates:[],error:'保有数量画面：'+positions.error}
  if(profit.stamp!==positions.stamp)return {updates:[],error:'2枚の更新日時が違います。同じ時点の画面を選んでください'}
  if(profit.totalValue!==positions.totalValue)return {updates:[],error:'2枚の評価額合計が一致しません'}
  const profits=new Map(profit.items.map(x=>[key(x),x]))
  const updates=[]
  for(const h of positions.items){
    const p=profits.get(key(h))
    if(!p)return {updates:[],error:'2枚の銘柄・口座が一致しません'}
    const acquisitionCost=h.marketValue-p.pnl
    if(!safe(acquisitionCost)||acquisitionCost<0)
      return {updates:[],error:'取得金額を計算できません：'+h.fundCode}
    // Acquisition unit prices are rounded to whole yen. Cross-check within
    // small rounding variance; do not override exact value from NAV-PnL.
    const approx=Math.round(h.units*p.acquisitionUnitPrice/10000)
    if(Math.abs(approx-acquisitionCost)>Math.max(2,Math.ceil(h.units/20000)+1))
      return {updates:[],error:'取得単価・評価損益の整合性がありません：'+h.fundCode}
    updates.push({fundCode:h.fundCode,accountType:h.accountType,units:h.units,acquisitionCost})
  }
  const totalCost=updates.reduce((sum,x)=>sum+x.acquisitionCost,0)
  if(totalCost!==positions.totalValue-profit.totalPnl)
    return {updates:[],error:'取得金額の合計が整合しません'}
  return {updates,error:'',stamp:positions.stamp,totalValue:positions.totalValue,totalPnl:profit.totalPnl,totalCost}
}
