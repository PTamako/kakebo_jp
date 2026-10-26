// 文字 / OCR 结果解析：日期、时间、金额、商家、分类（全部在浏览器本地完成，免费）
export const CATEGORIES = ['餐饮', '日用品', '交通', '购物', '居住', '医疗', '娱乐', '宠物', '其他']

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
  if ((m = t.match(/(20\d{2})\s*[年\/.\-]\s*(\d{1,2})\s*[月\/.\-]\s*(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
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

export function classify(text, rules) {
  const hit = [...rules].sort((a, b) => b.keyword.length - a.keyword.length)
    .find(r => text.toLowerCase().includes(r.keyword.toLowerCase()))
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

  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const dateLine = line => /20\d{2}\s*[年/. -]\s*\d{1,2}\s*[月/. -]\s*\d{1,2}/.test(line)
    || /\d{1,2}\s*月\s*\d{1,2}/.test(line)
    || /\d{1,2}\s*\/\s*\d{1,2}/.test(line)
  const paymentLine = line => /^(?:1回払い|一回払い|分割払い|リボ払い|ボーナス払い|支払回数|クレジット|カード利用|ご利用日|利用日|利用金額|お支払方法|お支払い方法)$/i.test(line.replace(/[\s＞>]/g, ''))
  const amountLine = line => {
    const s = line.replace(/[＞>」】]/g, '').trim()
    return /^(?:[¥￥]\s*)?\d[\d,]*(?:\s*円)?$/.test(s)
      && Number(s.replace(/[¥￥円,\s]/g, '')) > 0
  }
  const cleanAmountLine = line => {
    const s = line.replace(/[＞>」】]/g, '').trim()
    const m = s.match(/(?:[¥￥]\s*)?([\d,]+)(?:\s*円)?/)
    return m ? Number(m[1].replace(/,/g, '')) : 0
  }
  const extractTrailingAmount = line => {
    // Currency labels and common OCR noise after the amount are allowed; store-address digits are not.
    const m = line.match(/(?:[¥￥]\s*)?(\d[\d,]{1,6})\s*(?:円|m[mn]|mm)?\s*(?:[Nn＞>2]+)?\s*$/i)
    if (!m) return null
    const amount = Number(m[1].replace(/,/g, ''))
    if (!Number.isFinite(amount) || amount < 1 || amount > 999999) return null
    // Without a currency marker, only trust an amount at the end when OCR left a known trailing marker.
    const tail = line.slice(m.index + m[0].length)
    const hasCurrency = /円|[¥￥]|m[mn]|mm/i.test(m[0])
    if (!hasCurrency && !/[Nn＞>2]\s*$/.test(line)) return null
    return { amount, raw: m[0], index: m.index }
  }
  const cleanMerchant = value => value
    .replace(/[＞>」】]+\s*$/g, '')
    .replace(/[Nn]\s*$/g, '')
    .replace(/[\s,，]+$/g, '')
    .trim()
  const merchantRows = []
  const dateLines = lines.filter(dateLine)

  // OCR frequently returns one merchant+amount line, then a date/payment line.
  // Example: "セブンイレブン葛飾柴又4丁目店 521mM N".
  for (const line of lines) {
    if (dateLine(line) || paymentLine(line) || amountLine(line)) continue
    const found = extractTrailingAmount(line)
    if (!found) continue
    const merchant = cleanMerchant(line.slice(0, found.index))
    if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(merchant)) continue
    merchantRows.push({ merchant, amount: found.amount, amountRaw: found.raw })
  }

  // A wrapped store suffix ("目店 >") belongs to the preceding merchant row.
  for (const line of lines) {
    if (/^目\s*店\s*[＞>]*$/.test(line) && merchantRows.length) {
      const last = merchantRows[merchantRows.length - 1]
      last.merchant = (last.merchant.replace(/\s*$/, '') + '目店').replace(/目店目店$/, '目店')
    }
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
      merchants.push(line)
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

  const entry = parseEntry(text, rules)
  return entry.amount > 0 ? [entry] : [entry]
}
// 图片 → 文字：Tesseract.js 在手机浏览器本地运行，不上传、不收费
export async function ocrImage(file, onProgress) {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(['jpn', 'eng'], 1, {
    logger: m => m.status === 'recognizing text' && onProgress?.(Math.round(m.progress * 100))
  })
  try { return (await worker.recognize(file)).data.text } finally { await worker.terminate() }
}
