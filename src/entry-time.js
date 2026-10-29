// 時刻は印字された取引日時からのみ補完する。OCR時点の現在時刻は代入しない。
const pad = number => String(number).padStart(2, '0')
const FULL_WIDTH = text => String(text || '').normalize('NFKC')
const DATE_MARKER = /(?:20\d{2}\s*[年/.\-]\s*\d{1,2}\s*[月/.\-]\s*\d{1,2}|(?<!\d)\d{2}[.\/\-]\d{1,2}[.\/\-]\d{1,2}(?!\d)|\d{1,2}\s*月\s*\d{1,2}\s*日?|(?<!\d)\d{1,2}\/\d{1,2}(?!\d))/
const CLOCK_MARKER = /(?<!\d)(?:(午前|午後|AM|PM)\s*)?([01]?\d|2[0-3])\s*(?:[:：]\s*([0-5]\d)|時\s*([0-5]?\d)\s*分?)(?!\d)/i
const TIME_LABEL = /^(?:(?:お?買上|お?買い上げ|ご?利用|お?支払|購入|取引|決済|会計|精算|レジ)?\s*(?:時刻|時間|日時)|ご?利用時刻)\s*[:：]?\s*/i

export function localHHMM(now = new Date()) {
  return pad(now.getHours()) + ':' + pad(now.getMinutes())
}
export function readClockTime(text) {
  const m = FULL_WIDTH(text).match(CLOCK_MARKER)
  if (!m) return ''
  let hour = Number(m[2])
  const minute = Number(m[3] ?? m[4])
  if (!Number.isInteger(minute) || minute > 59) return ''
  if (m[1]) {
    if (hour < 1 || hour > 12) return ''
    const pm = /^(午後|PM)$/i.test(m[1])
    hour = hour % 12 + (pm ? 12 : 0)
  }
  return pad(hour) + ':' + pad(minute)
}
function standaloneTime(line) {
  if (/営業|開店|閉店|受付|予約|営業時間|TEL|電話|問い合わせ|発行/.test(line)) return ''
  const labeled = line.match(TIME_LABEL)
  if (labeled) return readClockTime(line.slice(labeled[0].length))
  const clock = line.match(CLOCK_MARKER)
  if (!clock) return ''
  // Adjacent lines can contain a standalone time, but not store hours,
  // item amounts, discounts, or phone/reference numbers.
  const trailing = (line.slice(0, clock.index) + line.slice(clock.index + clock[0].length)).trim()
  return trailing === '' || /^[（(][月火水木金土日][)）]$/.test(trailing) ? readClockTime(clock[0]) : ''
}
export function findTransactionTime(raw, preferredDateLine = '') {
  const lines = FULL_WIDTH(raw).split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  if (!lines.length) return ''
  const probe = i => {
    const line = lines[i]
    if (!line || /営業時間|開店|閉店/.test(line)) return ''
    const directlyPrinted = readClockTime(line)
    if (directlyPrinted) return directlyPrinted
    return standaloneTime(lines[i + 1] || '') || standaloneTime(lines[i - 1] || '')
  }
  if (preferredDateLine) {
    const target = FULL_WIDTH(preferredDateLine).trim()
    const index = lines.indexOf(target)
    if (index >= 0) return probe(index)
  }
  for (let i = 0; i < lines.length; i++) {
    if (DATE_MARKER.test(lines[i])) {
      const value = probe(i)
      if (value) return value
    }
  }
  // An explicitly labelled transaction time can be trusted even if OCR
  // damaged the date. Never use opening hours or bare times elsewhere.
  for (const line of lines) {
    if (TIME_LABEL.test(line)) {
      const value = standaloneTime(line)
      if (value) return value
    }
  }
  return ''
}
