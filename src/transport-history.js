import { isStationMerchant } from './station-merchant.js'

// Never infer an entire mixed card statement from a single station string.
// Called only for scanned images, after parsing all five-column IC rows.
const fiveColumn = row => typeof row?.raw === 'string' &&
  row.raw.normalize('NFKC').split(/[,，]/).length >= 5
const municipality = name =>
  /^(?:(?:.{2,12}[都道府県])?[^\s、,・（）()駅店]{2,20}(?:市|区|町|村))$/.test(String(name||'').normalize('NFKC').trim())

export function detectIcHistoryContext(rows, registeredSources = []) {
  if (!Array.isArray(rows) || rows.length < 3 || !rows.every(fiveColumn) ||
      !registeredSources.includes('Suica')) return null
  const stationRows=rows.filter(row=>isStationMerchant(row.merchant))
  const municipalityFares = new Set(rows.filter(row=>municipality(row.merchant)))
  if (stationRows.length < 2 || stationRows.length + municipalityFares.size !== rows.length) return null
  // An explicitly different statement card disproves the inferred source.
  if (rows.some(row=>row.paymentSource && row.paymentSource!=='Suica')) return null
  return {source:'Suica',municipalityFares}
}
