// User-confirmed SBI grouped-by-fund snapshot, displayed 2026-10-30 00:41 JST.
// Positions tagged 成長 + つみたて are aggregated. Do not invent per-account splits.
// reportedValue is the exact SBI screenshot value, not a derived NAV calculation.
// screenshotNav is the price DISPLAYED in the screenshot; its official valuation
// date is not independently confirmed, so label its date as an observation date.
export const SBI_SNAPSHOT_OBSERVED_AT = '2026-10-30T00:41:00+09:00'
export const SBI_SNAPSHOT_DAY = '2026-10-30'

export const sbiInitialHoldings = Object.freeze([
  { fundCode:'03311187', accountType:'combined', fundName:'eMAXIS Slim 米国株式（S&P500）', units:4043, acquisitionCost:18000, reportedValue:18230, screenshotNav:45093 },
  { fundCode:'0331418A', accountType:'combined', fundName:'eMAXIS Slim 全世界株式（オール・カントリー）', units:8033, acquisitionCost:30559, reportedValue:30446, screenshotNav:37902 },
  { fundCode:'0331A172', accountType:'growth', fundName:'eMAXIS Slim 先進国債券インデックス（除く日本）', units:5293, acquisitionCost:8000, reportedValue:7999, screenshotNav:15114 },
  { fundCode:'04317188', accountType:'combined', fundName:'iFreeNEXT NASDAQ100インデックス', units:2651, acquisitionCost:14880, reportedValue:14885, screenshotNav:56153 }
])
