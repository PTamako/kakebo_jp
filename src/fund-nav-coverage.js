// Public, provider-verified coverage only. Both the scheduled Worker and the
// portfolio UI use this list; unsupported fund codes are always manual.
export const MUFG_FUNDS = Object.freeze({
  '0331418A': 'eMAXIS Slim 全世界株式（オール・カントリー）',
  '03311187': 'eMAXIS Slim 米国株式（S&P500）',
  '0331A172': 'eMAXIS Slim 先進国債券インデックス（除く日本）'
})
export const autoNavSupported = code => Object.hasOwn(MUFG_FUNDS,String(code||'').trim().toUpperCase())
