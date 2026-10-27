// 文字 / OCR 结果解析：日期、时间、金额、商家、分类（全部在浏览器本地完成，免费）
export const CATEGORIES = ['餐饮', '饮食料品', '日用品', '交通', '购物', '居住', '医疗', '娱乐', '宠物', '其他']

const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function normalize(text) {
  return text
    .normalize('NFKC')
    .replace(/(?<=[\u3040-\u30ff\u4e00-\u9fff])[ \t]+(?=[\u3040-\u30ff\u4e00-\u9fff])/g, '')
    .trim()
}

function findDate(t, today = new Date()) {
  let m
  // In card statements, OCR sometimes splits the day "11" as "1 1" just before "回払い".
  if ((m = t.match(/(20\d{2})\s*\/\s*(\d{1,2})\s*\/\s*1\s+1\s*(?=回\s*払)/))) return m[1] + '-' + pad(m[2]) + '-11'
  if ((m = t.match(/(20\d{2})\s*[年\/.\-]\s*(\d{1,2})\s*[月\/.\-]\s*(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  // Japanese card apps often abbreviate the year: 26.10.18 means 2026-10-18.
  if ((m = t.match(/(?<!\d)(\d{2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})(?!\d)/))) return `20${m[1]}-${pad(m[2])}-${pad(m[3])}`
  if ((m = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/))) return `${today.getFullYear()}-${pad(m[1])}-${pad(m[2])}`
  if ((m = t.match(/(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/))) return `${today.getFullYear()}-${pad(m[1])}-${pad(m[2])}`
  const off = /前天|一昨日/.test(t) ? 2 : /昨天|昨日/.test(t) ? 1 : 0
  const d = new Date(today); d.setDate(d.getDate() - off)
  return ymd(d)
}

function findTime(t) {
  const m = t.match(/(?<!\d)([01]?\d|2[0-3])[:：时時]([0-5]\d)(?!\d)/)
  return m ? `${pad(m[1])}:${pad(m[2])}` : ''
}

function findAmount(t) {
  const num = s => Number(s.replace(/[,，\s]/g, ''))
  let m
  if ((m = t.match(/(?:合\s*計|合计|お?買上(?:げ)?(?:金額)?|総\s*額|total|請求額)[^\d¥]{0,8}¥?\s*([\d,]{2,9})/i))) return num(m[1])
  const yen = [...t.matchAll(/[¥￥]\s*([\d,]{1,9})/g)].map(x => num(x[1]))
  if (yen.length) return Math.max(...yen)
  const unit = [...t.matchAll(/([\d,]{1,9})\s*(?:円|日元|元|块|塊)/g)].map(x => num(x[1]))
  if (unit.length) return Math.max(...unit)
  const cleaned = t.replace(/\d{4}[年\/.\-]\d{1,2}[月\/.\-]\d{1,2}日?/g, '').replace(/\d{1,2}[:：]\d{2}/g, '')
  const all = [...cleaned.matchAll(/(?<![\d.])(\d{2,7})(?![\d.])/g)].map(x => Number(x[1]))
  return all.length ? Math.max(...all) : 0
}

// Supermarket names must be checked before generic keywords such as 「バス」.
// 「まいばすけっと」 contains the characters 「バス」, but is a supermarket, not transport.
const SUPERMARKET_KEYWORDS = [
  'まいばすけっと', 'まいばす', 'イオン', 'AEON', 'マックスバリュ', 'ダイエー',
  'ライフ', 'LIFE', 'サミットストア', 'サミット', 'マルエツ', '西友', 'SEIYU',
  'オーケーストア', 'オーケー', 'OKストア', 'ベルク', 'ヤオコー', 'オオゼキ',
  'いなげや', 'コモディイイダ', 'アコレ', 'ビッグ・エー', 'ビッグエー', 'ロピア',
  '業務スーパー', '業務スーパ', 'イトーヨーカドー', 'イトーヨーカ堂', 'ヨークフーズ',
  'ヨークマート', 'ヨークプライス', 'マルエツプチ', 'ミニピアゴ', '肉のハナマサ',
  'ハナマサ', '食品館あおば', 'アタック', '全日食チェーン', 'トライアル',
  'スーパーセンタートライアル', '成城石井', '紀ノ国屋', 'KINOKUNIYA',
  'クイーンズ伊勢丹', '北野エース', '東急ストア', '京王ストア', '京急ストア',
  '小田急OX', '文化堂', 'スーパーバリュー', 'ベルクス', 'コープ', '生協',
  'コンビニ', 'セブン-イレブン', 'セブンイレブン', 'ローソン', 'ファミリーマート',
  'ファミマ', 'ミニストップ'
]

export function classify(text, rules) {
  const normalizedText = normalize(text).toLowerCase()
  const supermarket = [...SUPERMARKET_KEYWORDS]
    .sort((a, b) => b.length - a.length)
    .find(keyword => normalizedText.includes(normalize(keyword).toLowerCase()))
  if (supermarket) return { category: '饮食料品', keyword: supermarket }

  const hit = [...rules].sort((a, b) => b.keyword.length - a.keyword.length)
    .find(r => normalizedText.includes(normalize(r.keyword).toLowerCase()))
  return hit ? { category: hit.category, keyword: hit.keyword } : { category: '日用品', keyword: '' }
}

export function parseEntry(raw, rules) {
  const text = normalize(raw)
  const { category, keyword } = classify(text, rules)
  const firstLine = text.split('\n').map(s => s.trim()).find(s => s.length >= 2 && !/^[\d¥\s:\/.\-]+$/.test(s)) || ''
  const merchant = firstLine.slice(0, 40) || keyword
  return {
    date: findDate(text), time: findTime(text), amount: findAmount(text),
    category, merchant, note: text.length <= 40 ? text.replace(/\s+/g, ' ') : '',
    raw: text, suggested: category, keyword
  }
}

// 将一段粘贴文字或一张 OCR 图片拆分为多笔记录。
export function parseEntries(raw, rules) {
  const text = normalize(raw)
  if (!text) return []

  // Normalize card-statement rows such as "QUICPay 利用 (QP/ マイバスケット ) 628gm"
  // into the existing QP-row format before parsing each transaction independently.
  const lines = text.split(/\r?\n/).map(s => s.trim())
    .filter(Boolean)
    .map(line => line.replace(/^.*?\(\s*Q?O?P\s*\//i, 'QP / '))

  // Robust transaction-block fallback for QUICPay OCR. Keep every detected transaction,
  // even if OCR misses its amount; zero-amount drafts remain editable instead of being dropped.
  const qpStart = line => /^(?:QUICPay\s*利用\s*)?QP\s*\//i.test(line)
  const qpStarts = lines.map((line, index) => qpStart(line) ? index : -1).filter(index => index >= 0)
  if (qpStarts.length >= 2) {
    const recovered = []
    for (let n = 0; n < qpStarts.length; n++) {
      const start = qpStarts[n]
      const block = lines.slice(start, qpStarts[n + 1] ?? lines.length)
      const dateRaw = block.find(dateLine)
      if (!dateRaw) continue
      const first = block[0].replace(/^QP\s*\/\s*/i, '').trim()
      const joined = block.join(' ')
      const dateIndex = block.indexOf(dateRaw)
      const amountSources = block.slice(0, dateIndex < 0 ? block.length : dateIndex)
      let amount = 0
      for (const candidate of amountSources) {
        const stripped = candidate.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        const matches = [...stripped.matchAll(/(\d[\d,，.]{0,7})\s*(円|m{1,2}|g(?:m)?|mm|ロ|口|=|＝|[Nn＞>2ンてvく～〜])/ig)]
        if (matches.length) {
          const rawAmount = matches[matches.length - 1][1]
          const parsed = Number(rawAmount.replace(/[,，.]/g, '').replace(/[oOｏＯ]/g, '6'))
          if (parsed > 0 && parsed <= 999999) { amount = parsed; break }
        }
      }
      // Merchant may wrap across OCR lines; remove amount/date/payment noise from the block.
      let merchant = first
        .replace(/\s*[（(].*$/, '')
        .replace(/[＞>」】）)]+\s*$/, '')
      const wrapped = block.slice(1, dateIndex < 0 ? block.length : dateIndex)
        .filter(line => !/回\s*払|^[\d,，.]+\s*(?:円|m|g|=|＝)?$/i.test(line))
        .filter(line => !/(\d[\d,，.]{0,7})\s*(?:円|m{1,2}|g(?:m)?|mm|ロ|口|=|＝)/i.test(line))
      if (wrapped.length) merchant += wrapped.join('')
      merchant = cleanQpMerchant(merchant)
      if (!merchant || !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(merchant)) {
        merchant = cleanQpMerchant(first)
      }
      if (!merchant) continue
      const { category, keyword } = classify(merchant, rules)
      recovered.push({
        date: findDate(dateRaw), time: '', amount, category,
        merchant: merchant.slice(0, 60),
        note: amount ? '' : '金額を読み取れませんでした。明細を確認してください',
        raw: block.join('\n'), suggested: category, keyword
      })
    }
    if (recovered.length >= 2) return recovered
  }
  function cleanQpMerchant(value) {
    return value
      .replace(/\s*\d[\d,，.]{0,7}\s*(?:円|m{1,2}|g(?:m)?|mm|ロ|口|=|＝|[Nn＞>2ンてvく～〜])\s*[、,，。．.）)]*\s*$/i, '')
      .replace(/[＞>」】）)]+\s*$/, '')
      .replace(/[\s,，、。．.]+$/, '')
      .trim()
      .replace(/マイバスケツト/g, 'マイバスケット')
  }
  const dateLine = line => /20\d{2}\s*[年/. -]\s*\d{1,2}\s*[月/. -]\s*\d{1,2}/.test(line)
    || /(?<!\d)\d{2}\s*[.\/-]\s*\d{1,2}\s*[.\/-]\s*\d{1,2}(?!\d)/.test(line)
    || /\d{1,2}\s*月\s*\d{1,2}/.test(line)
    || /\d{1,2}\s*\/\s*\d{1,2}/.test(line)
  const paymentLine = line => /^(?:1回払い|一回払い|分割払い|リボ払い|ボーナス払い|支払回数|クレジット|カード利用|ご利用日|利用日|利用金額|お支払方法|お支払い方法)$/i.test(line.replace(/[\s＞>]/g, ''))
  const amountLine = line => {
    const s = line.replace(/[＞>」】]/g, '').trim()
    if (!/^(?:[¥￥]\s*)?\d[\d,]*(?:\s*円)?$/.test(s)) return false
    const digits = s.replace(/[^\d]/g, '')
    const hasCurrency = /[¥￥円]/.test(s)
    const hasThousandsSeparator = /^\s*(?:[¥￥]\s*)?\d{1,3}(?:,\d{3})+(?:\s*円)?\s*$/.test(s)
    // Long unformatted numbers in card statements are ambiguous and often reference IDs.
    // Accept long amounts only when currency or thousands separators make them explicit.
    if (!hasCurrency && !hasThousandsSeparator && digits.length >= 6) return false
    const amount = Number(digits)
    return amount > 0 && amount <= 9999999
  }
  const cleanAmountLine = line => {
    const s = line.replace(/[＞>」】]/g, '').trim()
    const m = s.match(/(?:[¥￥]\s*)?([\d,]+)(?:\s*円)?/)
    return m ? Number(m[1].replace(/,/g, '')) : 0
  }
  const extractTrailingAmount = line => {
    // Japanese card-statement OCR often misreads 円 as m/g/gm and thousand separators as periods.
    // Only accept a number at the very end with a currency-like marker, to avoid treating address digits as amounts.
    const m = line.match(/(?:[¥￥]\s*)?(\d[\d,，.]{1,7})\s*(円|m{1,2}|g(?:m)?|mm|H)?\s*(?:[Nn＞>2ンてvく～〜]+)?\s*[、,，。．.）)」】]*\s*$/i)
    if (!m) return null
    const rawNumber = m[1]
    // Amounts in these Japanese statements are whole yen; OCR may render 5,931 as 5.931.
    const amount = Number(rawNumber.replace(/[,，.]/g, ''))
    if (!Number.isFinite(amount) || amount < 1 || amount > 999999) return null
    const marker = m[2] || ''
    const hasCurrency = /円|[¥￥]|m|g|H/i.test(marker) || /[Nn＞>2ンてvく～〜]\s*$/.test(line)
    if (!hasCurrency) return null
    return { amount, raw: m[0], index: m.index }
  }
  const cleanMerchant = value => value
    // Card statements may append a reference number to every merchant row, not only Suica.
    // Strip visible numeric references and OCR-truncated forms such as "7...".
    .replace(/\s+\d{6,}\s*$/g, '')
    .replace(/\s+\d{1,3}\s*[.…・]{2,}\s*$/g, '')
    .replace(/[＞>」】）)]+\s*$/g, '')
    .replace(/[Nn]\s*$/g, '')
    .replace(/[\s,，、。．.]+$/g, '')
    .trim()
    .replace(/マイバスケツト/g, 'マイバスケット')
  // QP statements: each transaction is a QP-prefixed merchant/amount line,
  // followed by a date and payment-method line. Parse the final numeric token explicitly.
  const qpRows = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/^QP\s*\//i.test(line)) continue
    const body = line.replace(/^QP\s*\/\s*/i, '').trim()
    // Capture the final amount token, not the merchant/reference text.
    // The OCR engine may remove the space before the amount entirely (e.g. "ダイソー880m").
    // Anchor the amount to the line ending marker instead of requiring a separator from the merchant.
    const m = body.match(/^(.*?)([0-9０-９oOｏＯ][0-9０-９oOｏＯ\]\[\s,，.]{0,8})\s*(?:円|m{1,2}|g(?:m)?|ロ|口)?\s*[、,，。．.'’vV|]+\s*$/i)
      || body.match(/^(.*?)([0-9０-９oOｏＯ][0-9０-９oOｏＯ\]\[\s,，.]{0,8})\s*(?:円|m{1,2}|g(?:m)?|ロ|口)\s*$/i)
    if (!m || !m[1].trim()) continue
    let token = m[2]
      // In this QP statement font, OCR commonly confuses 6 with "o"; "]" is a noisy thousands separator.
      .replace(/[oOｏＯ]/g, '6')
      .replace(/[\]\[]/g, '')
      .replace(/[\s,，.]/g, '')
    const amount = Number(token)
    if (!Number.isFinite(amount) || amount < 1 || amount > 999999) continue
    let nextDate = null
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      if (/^QP\s*\//i.test(lines[j])) break
      if (dateLine(lines[j])) { nextDate = lines[j]; break }
    }
    if (!nextDate) continue
    const merchant = cleanMerchant(m[1])
    if (!merchant || !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(merchant)) continue
    const { category, keyword } = classify(merchant, rules)
    qpRows.push({
      date: findDate(nextDate), time: '', amount, category,
      merchant: merchant.slice(0, 60), note: '',
      raw: merchant + '\n' + nextDate + '\n' + m[2],
      suggested: category, keyword
    })
  }
  if (qpRows.length >= 2) return qpRows

  // Some issuers put merchant and reference on one line, then date/cardholder/payment/amount on another.
  // Other issuers put amount beside merchant and date on a separate line. Keep these layouts distinct.
  const isCardMetadata = line => /^(?:ご本人|本人|家族|家族会員|1回払い|一回払い|分割払い|リボ払い|ボーナス払い|ご本人\s+1回払い|本人\s+1回払い)$/i
    .test(line.replace(/[\s＞>]/g, ''))
  const pairedStatementRows = []
  for (let i = 0; i < lines.length; i++) {
    const detailLine = lines[i]
    if (!dateLine(detailLine) || !/[¥￥]\s*[\d,]+/.test(detailLine)) continue
    const amountMatch = detailLine.match(/[¥￥]\s*([\d,]+)/)
    if (!amountMatch) continue
    const amount = Number(amountMatch[1].replace(/,/g, ''))
    if (amount <= 0 || amount > 9999999) continue

    // Collect merchant text directly above this detail line. Skip cardholder/payment metadata,
    // and join OCR-wrapped suffixes such as "マクドナルドモバイルオーダ" + "ー".
    const parts = []
    for (let j = i - 1; j >= 0; j--) {
      const candidate = lines[j]
      if (dateLine(candidate)) break
      if (isCardMetadata(candidate) || paymentLine(candidate) || amountLine(candidate)) continue
      if (/^(?:ご本人|本人|家族|1回払い|一回払い|分割払い|リボ払い|ボーナス払い)$/.test(candidate.replace(/[\s＞>]/g, ''))) continue
      if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(candidate)) {
        // Ignore standalone reference numbers and other OCR noise.
        if (/^\d{4,}$/.test(candidate)) continue
        break
      }
      parts.unshift(candidate)
      // Usually merchant names occupy one or two lines; don't absorb unrelated page headings.
      if (parts.length >= 3) break
    }
    if (!parts.length) continue
    const merchantLine = cleanMerchant(parts.join(''))
    if (!merchantLine || isCardMetadata(merchantLine)) continue
    const { category, keyword } = classify(merchantLine, rules)
    pairedStatementRows.push({
      date: findDate(detailLine), time: '', amount, category,
      merchant: merchantLine.slice(0, 60), note: '',
      raw: merchantLine + '\n' + detailLine,
      suggested: category, keyword
    })
  }
  if (pairedStatementRows.length >= 2) return pairedStatementRows

  const merchantRows = []
  const dateLines = lines.filter(dateLine)
  let activeMerchantRow = null

  // OCR frequently returns one merchant+amount line, then a date/payment line.
  // Example: "セブンイレブン葛飾柴又4丁目店 521mM N".
  // Keep wrapped merchant suffixes attached to the immediately preceding row.
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (dateLine(line) || paymentLine(line)) {
      activeMerchantRow = null
      continue
    }
    if (/^目\s*店\s*[＞>]*$/.test(line)) {
      if (activeMerchantRow) activeMerchantRow.merchant += '目店'
      continue
    }
    if (amountLine(line)) {
      activeMerchantRow = null
      continue
    }
    let found = extractTrailingAmount(line)
    // If OCR wraps a long merchant name and places the amount on the next visual line,
    // join the two before parsing (e.g. "マクドナルドモバイルオーダ" + "ー 420 円").
    if (!found && i + 1 < lines.length && !dateLine(lines[i + 1]) && !paymentLine(lines[i + 1])) {
      const nextFound = extractTrailingAmount(lines[i + 1])
      if (nextFound && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(line)) {
        line = line + lines[i + 1]
        i++
        found = extractTrailingAmount(line)
      }
    }
    if (!found) continue
    // Some card apps put parenthetical merchant details on the line after the amount.
    // Keep that continuation with the merchant when the next line is the transaction date.
    let merchantSource = line.slice(0, found.index)
    if (i + 1 < lines.length && /^\s*[（(]/.test(lines[i + 1]) &&
        !dateLine(lines[i + 1]) && !extractTrailingAmount(lines[i + 1]) &&
        i + 2 < lines.length && dateLine(lines[i + 2])) {
      merchantSource += lines[i + 1]
      i++
    }
    const merchant = cleanMerchant(merchantSource)
    if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(merchant)) continue
    activeMerchantRow = { merchant, amount: found.amount, amountRaw: found.raw }
    merchantRows.push(activeMerchantRow)
  }

  if (merchantRows.length >= 2 && merchantRows.length === dateLines.length) {
    return merchantRows.map((row, i) => {
      const dateRaw = dateLines[i]
      const { category, keyword } = classify(row.merchant, rules)
      return {
        date: findDate(dateRaw), time: '', amount: row.amount, category,
        merchant: row.merchant.slice(0, 60), note: '',
        raw: row.merchant + '\n' + dateRaw + '\n' + row.amountRaw,
        suggested: category, keyword
      }
    }).filter(e => e.amount > 0)
  }

  const merchantLike = line => {
    if (dateLine(line) || amountLine(line) || paymentLine(line)) return false
    if (/^(?:目店|丁目店|店|円|¥|￥)$/i.test(line.replace(/[\s＞>]/g, ''))) return false
    return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(line)
  }

  // Card statements may also OCR as columns: merchant names first, then dates, then amounts.
  const merchants = []
  for (const line of lines) {
    if (!merchantLike(line)) continue
    if (/^(?:目店|丁目店|店)$/.test(line.replace(/[\s＞>]/g, '')) && merchants.length) {
      merchants[merchants.length - 1] += line.replace(/[＞>]/g, '')
    } else {
      merchants.push(cleanMerchant(line))
    }
  }
  const amountLines = lines.filter(amountLine)
  const hasColumnarShape = merchants.length >= 2 && dateLines.length >= 2 && amountLines.length >= 2
    && merchants.length === dateLines.length && dateLines.length === amountLines.length

  if (hasColumnarShape) {
    return merchants.map((merchant, i) => {
      const dateRaw = dateLines[i]
      const amount = cleanAmountLine(amountLines[i])
      const { category, keyword } = classify(merchant, rules)
      return {
        date: findDate(dateRaw), time: '', amount, category,
        merchant: merchant.slice(0, 60), note: '',
        raw: merchant + '\n' + dateRaw + '\n' + amountLines[i],
        suggested: category, keyword
      }
    }).filter(e => e.amount > 0)
  }

  const blocks = text.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean)
  if (blocks.length > 1) return blocks.map(block => parseEntry(block, rules)).filter(e => e.amount > 0)

  const hasReceiptTotal = /合\s*計|合计|小計|小计|総\s*額|total|請求額|お買上(?:げ)?金額/i.test(text)
  const transactionLines = lines.filter(line =>
    line.length >= 3 &&
    /(?:[¥￥]\s*[\d,]+|[\d,]+\s*(?:円|元|日元|块|塊))/.test(line) &&
    !/^(?:小計|合計|合计|消費税|税|お預り|お釣り|釣銭|現金|クレジット|total|tax)\b/i.test(line)
  )
  if (!hasReceiptTotal && transactionLines.length >= 2 && transactionLines.length === lines.length) {
    return transactionLines.map(line => parseEntry(line, rules)).filter(e => e.amount > 0)
  }

  // Do not mistake month/day digits for a transaction amount when OCR omitted the amount
  // from a card-statement row that still contains payment metadata.
  const hasCardPaymentMetadata = lines.some(line => /回\s*払(?:い)?/.test(line))
  const hasExplicitAmount = lines.some(line =>
    /[¥￥]\s*[\d,]+|[\d,]+\s*円|\d[\d,，.]{1,7}\s*(?:m{1,2}|g(?:m)?|mm|ロ|口)\b/i.test(line)
  )
  const entry = parseEntry(text, rules)
  if (hasCardPaymentMetadata && dateLines.length && !hasExplicitAmount) return [{ ...entry, amount: 0 }]
  return [entry]
}
// 图片 → 文字：Tesseract.js 在手机浏览器本地运行，不上传、不收费
export async function ocrImage(file, onProgress) {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(['jpn', 'eng'], 1, {
    logger: m => m.status === 'recognizing text' && onProgress?.(Math.round(m.progress * 100))
  })
  try { return (await worker.recognize(file)).data.text } finally { await worker.terminate() }
}
