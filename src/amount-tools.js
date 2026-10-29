// Pure helpers shared by the mobile money field and regression tests.
// Ledger/API amounts stay plain, safe integer JPY; separators are display-only.
const yenFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 })
export function formatYenInput(value) {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? yenFormatter.format(n) : ''
}
export function normalizeYenInput(value) {
  const text = String(value ?? '').replace(/[０-９]/g, ch => String(ch.charCodeAt(0) - 0xff10))
  // Accept pasted Japanese currency markers but never reinterpret decimal/negative text.
  if (!/^[\d,，\s¥￥円]*$/.test(text)) return null
  const digits = text.replace(/[,，\s¥￥円]/g, '').replace(/^0+(?=\d)/, '')
  if (!digits) return 0
  const amount = Number(digits)
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null
}

export function calculateYenExpression(expression) {
  const source = String(expression ?? '').replace(/[０-９]/g, ch => String(ch.charCodeAt(0) - 0xff10))
    .replace(/[×＊]/g, '*').replace(/[÷／]/g, '/').replace(/[−－]/g, '-').replace(/\s/g, '').replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1')
  if (!source || source.length > 80 || !/^[\d.()+*/-]+$/.test(source)) return null
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+*/-]/g)
  if (!tokens || tokens.join('') !== source) return null
  let i = 0
  function atom() {
    const token = tokens[i++]
    if (token === '+') return atom()
    if (token === '-') return -atom()
    if (token === '(') {
      const n = sum()
      if (tokens[i++] !== ')') throw Error('parenthesis')
      return n
    }
    if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) throw Error('number')
    return Number(token)
  }
  function product() {
    let n = atom()
    while (tokens[i] === '*' || tokens[i] === '/') {
      const operator = tokens[i++], right = atom()
      n = operator === '*' ? n * right : n / right
    }
    return n
  }
  function sum() {
    let n = product()
    while (tokens[i] === '+' || tokens[i] === '-') {
      const operator = tokens[i++], right = product()
      n = operator === '+' ? n + right : n - right
    }
    return n
  }
  try {
    const value = sum()
    if (i !== tokens.length || !Number.isFinite(value)) return null
    const rounded = Math.round(value)
    return Number.isSafeInteger(rounded) && rounded > 0 ? rounded : null
  } catch { return null }
}
export function convertToYen(rawAmount, rawRate) {
  const amount = Number(rawAmount), rate = Number(rawRate)
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(rate) || rate <= 0) return null
  const result = Math.round(amount * rate)
  return Number.isSafeInteger(result) && result > 0 ? result : null
}

/**
 * Quick price estimation for a single Japanese consumption-tax rate.
 * Prices for multiple rates, exempt items, and individual store rounding
 * must be checked against the receipt rather than guessed here.
 */
export function calculateJapaneseConsumptionTax(subtotal, rate = 0, rounding = 'floor') {
  const value = Number(subtotal)
  if (!Number.isSafeInteger(value) || value <= 0 || ![0, 8, 10].includes(rate)) return null
  if (!['floor', 'round', 'ceil'].includes(rounding)) return null
  if (rate === 0) return { subtotal: value, tax: 0, total: value }
  const rawTax = value * rate / 100
  if (!Number.isFinite(rawTax)) return null
  const tax = Math[rounding](rawTax)
  const total = value + tax
  if (!Number.isSafeInteger(tax) || !Number.isSafeInteger(total)) return null
  return { subtotal: value, tax, total }
}
