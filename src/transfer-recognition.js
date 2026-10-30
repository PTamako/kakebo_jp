import { detectPrepaidRecharge, prepaidTarget } from './prepaid-card.js'

// Auto-classify only a single parsed entry, never a whole batch of unrelated rows.
// Recognition creates an editable draft, not a transaction or a new payment card.
const normalizeText = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s　]+/g, '')

const reversal = value => /返金|取消|キャンセル|払戻|チャージバック/.test(value)
const feeOrGoods = value => /チャージ(?:ャー|ケーブル|器|機|料金|手数料|料(?:金)?|代行|券)|手数料.*チャージ/.test(value)

export function detectInvestmentFunding(text) {
  const value = normalizeText(text)
  if (!value || reversal(value) || /手数料|年会費|配当|利息|税金/.test(value)) return false
  // Japanese card statements may omit "SBI" or wrap the buy-month label.
  if (/証券投信|投信積立|投資信託(?:の)?積立|(?:投信|投資信託)買付|翌月買付分/.test(value)) return true
  if (/^sbi証券(?:口座)?$/.test(value)) return true
  // "SBI" alone can refer to banking, insurance and ordinary merchants.
  // Require brokerage AND an investment/funding operation.
  return /sbi(?:証券)?/.test(value)
    && /(?:証券|投信|投資信託)/.test(value)
    && /(?:積立|買付|振替|入金|引落|購入)/.test(value)
}

export function detectGenericRecharge(merchant, note = '', raw = '') {
  // Never scan a full receipt for "charge" when a different merchant was parsed.
  const label = normalizeText([merchant, note].filter(Boolean).join(' ') || raw)
  if (!label || reversal(label) || feeOrGoods(label)) return false
  return /チャージ|(?:top[\s-]?up)|(?:^|[^a-z])charge(?:$|[^a-z])/.test(label)
}

export function recognizeAssetTransfer({ merchant = '', note = '', raw = '', prepaidNames = [] } = {}) {
  const text = [merchant, note, raw].filter(Boolean).join(' ')
  if (detectInvestmentFunding(text)) return { isTransfer: true, transferTarget: 'sbi', kind: 'investment' }
  const label = normalizeText([merchant, note].filter(Boolean).join(' ') || raw)
  if (reversal(label) || feeOrGoods(label)) return { isTransfer: false, transferTarget: '', kind: '' }

  // Only the parsed merchant/memo determines the target. OCR receipts can
  // contain unrelated product lines mentioning another wallet.
  const matchingPrepaid = detectPrepaidRecharge([merchant, note].filter(Boolean).join(' ') || raw, prepaidNames)
  if (matchingPrepaid) return { isTransfer: true, transferTarget: prepaidTarget(matchingPrepaid), kind: 'recharge' }
  // Generic "○○チャージ": recognized, but never guess the destination or
  // fabricate a prepaid card. The existing form requires manual destination.
  if (detectGenericRecharge(merchant, note, raw))
    return { isTransfer: true, transferTarget: '', kind: 'recharge' }
  return { isTransfer: false, transferTarget: '', kind: '' }
}
