// Parse only already-registered holdings. Unidentified or ambiguous funds are never created.
// Amounts must be explicitly labelled as cumulative acquisition, not market value
// or a monthly plan. OCR is only a draft and must be reviewed by the user.
const flat = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[\s\u3000\p{P}\p{S}]/gu, '')
const cleanNumber = value => {
  const raw = String(value || '').normalize('NFKC').replace(/[¥￥円,\s]/g, '')
  return /^\d{1,13}$/.test(raw) ? Number(raw) : null
}
const validNumber = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000000
const accountFrom = value => {
  const s = String(value || '').normalize('NFKC').toLowerCase()
  if (/合算|成長.{0,8}(?:つみたて|積立)|(?:つみたて|積立).{0,8}成長/.test(s)) return 'combined'
  if (/成長/.test(s)) return 'growth'
  if (/つみたて|積立/.test(s)) return 'tsumitate'
  return ''
}
const aliases = {
  '0331418A':['オールカントリー','オルカン'],
  '03311187':['S&P500','S&P 500'],
  '0331A172':['先進国債券（除く日本）'],
  '04317188':['NASDAQ100']
}
function identify(label, holdings) {
  const normalized = flat(label)
  if (!normalized) return null
  const candidates = holdings.filter(h => {
    const code = String(h.fund_code || '').toUpperCase()
    return normalized.includes(code.toLowerCase()) ||
      (flat(h.fund_name).length >= 7 && normalized.includes(flat(h.fund_name))) ||
      (aliases[code] || []).some(alias => normalized.includes(flat(alias)))
  })
  if (!candidates.length) return null
  const account = accountFrom(label)
  const selected = account ? candidates.filter(h => h.account_type === account) : candidates
  return selected.length === 1 ? selected[0] : 'ambiguous'
}
const UNIT_LABEL = /(?:保有口数|保有数量|預り口数|お預り口数)\s*[:：]?\s*([0-9][0-9,，]*)\s*(?:口)?/i
const COST_LABEL = /(?:取得金額|取得額|取得総額|累計取得金額|累計買付金額)\s*[:：]?\s*[¥￥]?\s*([0-9][0-9,，]*)\s*(?:円)?/i
const unitHeading = /^(?:保有口数|保有数量|預り口数|お預り口数)\s*[:：]?$/
const costHeading = /^(?:取得金額|取得額|取得総額|累計取得金額|累計買付金額)\s*[:：]?$/
const numberLine = /^[¥￥]?\s*([0-9][0-9,，]*)\s*(?:円|口)?$/
function labelledValue(block, regex, heading) {
  for (let i=0;i<block.length;i++) {
    const line = block[i].normalize('NFKC')
    const direct = line.match(regex)
    if (direct) return cleanNumber(direct[1])
    if (heading.test(line.trim()) && i+1<block.length) {
      const next = block[i+1].normalize('NFKC').trim().match(numberLine)
      if (next) return cleanNumber(next[1])
    }
  }
  return null
}
export function parseSbiHoldingsText(text, holdings) {
  const result = { updates: [], warnings: [] }
  if (!Array.isArray(holdings) || !holdings.length) return result
  const lines = String(text || '').normalize('NFKC').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0,250)
  const candidates = []
  // AI can produce a strict pipe-delimited row; this also makes pasted rows easy.
  // Require four fields with an explicit account column, unless the fund occurs once.
  for (const line of lines) {
    if (!line.includes('|')) continue
    const p = line.split('|').map(x => x.trim())
    if (p.length !== 4) continue
    const h = identify(p[0] + ' ' + p[1],holdings)
    if (h === 'ambiguous') { result.warnings.push('口座を特定できない銘柄があります'); continue }
    if (!h) continue
    const units=cleanNumber(p[2]), acquisitionCost=cleanNumber(p[3])
    if (validNumber(units)&&validNumber(acquisitionCost))
      candidates.push({fundCode:h.fund_code,accountType:h.account_type,units,acquisitionCost})
    else result.warnings.push('口数・取得金額を読み取れない行があります')
  }
  // Raw SBI text or on-device OCR often prints each label/value on its own line.
  let current = null
  const flush = () => {
    if (!current) return
    if (current.h === 'ambiguous') { result.warnings.push('口座を特定できない銘柄があります');current=null;return }
    const units = labelledValue(current.block,UNIT_LABEL,unitHeading)
    const acquisitionCost = labelledValue(current.block,COST_LABEL,costHeading)
    if (validNumber(units)&&validNumber(acquisitionCost))
      candidates.push({fundCode:current.h.fund_code,accountType:current.h.account_type,units,acquisitionCost})
    else if (current.block.some(line => UNIT_LABEL.test(line) || COST_LABEL.test(line) || unitHeading.test(line) || costHeading.test(line)))
      result.warnings.push('口数と取得金額の両方が必要です：'+current.h.fund_name)
    current=null
  }
  for(const line of lines) {
    if(line.includes('|') && line.split('|').length === 4) continue
    const h = identify(line,holdings)
    if(h){
      flush()
      current = {h,block:[line]}
    } else if(current && current.block.length < 12) {
      current.block.push(line)
    }
  }
  flush()
  const once = new Map()
  const duplicates = new Set()
  for(const item of candidates){
    const key=item.fundCode+':'+item.accountType
    if (once.has(key)) duplicates.add(key)
    else once.set(key,item)
  }
  for(const key of duplicates) {
    once.delete(key)
    result.warnings.push('同じ銘柄・口座が重複しています：'+key)
  }
  result.updates = [...once.values()]
  result.warnings = [...new Set(result.warnings)]
  return result
}
