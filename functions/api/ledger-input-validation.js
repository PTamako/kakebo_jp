// Validate user-facing ledger fields before writing financial rows to D1.
// Legacy clients may omit a field, but no JSON object/array can be coerced
// silently into a merchant, note or category. OCR raw text is truncated at
// storage; cap its incoming size to avoid oversized requests.
const TEXT_LIMITS = Object.freeze({
  category: 120,
  merchant: 500,
  note: 2000,
  raw: 20000
})
export function validateLedgerTextFields(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry))
    return {code:'invalid_entry',error:'明細の形式が正しくありません'}
  for (const [key,max] of Object.entries(TEXT_LIMITS)) {
    const value = entry[key]
    if (value == null) continue
    if (typeof value !== 'string' || value.length > max)
      return {code:'invalid_entry_text',error:'明細の文字数・形式を確認してください（'+key+'）'}
  }
  if (entry.type != null && !['expense','income','transfer'].includes(entry.type))
    return {code:'invalid_entry_type',error:'記帳種類を確認してください'}
  for (const key of ['rewardDestination','transferTarget']) {
    if (entry[key] != null && (typeof entry[key] !== 'string' || entry[key].length > 100))
      return {code:'invalid_transfer_target',error:'振替先を確認してください'}
  }
  return null
}
