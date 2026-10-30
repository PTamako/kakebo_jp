// Shared by text/OCR category parsing and payment selection.
// Treat an actual station entry as travel, not a shop whose name includes
// station characters (e.g. 新宿駅店 / 新宿駅前店 / 新宿駅ビル店).
// Match only standalone station names or names followed by numeric fare,
// avoiding broad "contains 駅" rules that misclassify convenience stores.
export function isStationMerchant(value) {
  const merchant=String(value||'').normalize('NFKC').trim()
  return /(?:^|[\s、,・（(])[^\s、,・（）()¥￥]{1,32}駅(?=$|[（(]|[ \t\n]+(?:[¥￥]?\d|$))/u.test(merchant)
}
