// Resolve relative transaction timestamps against the moment an OCR import starts.
// A displayed "3時間前" is approximate; still populate the editable date/time
// by subtracting three hours from the capture/recognition reference (Japan time).
const normalize = value => String(value ?? '').normalize('NFKC').replace(/[\s\u3000]+/g, '').trim()
const DAY_OFFSETS = new Map([
  ['今日',0],['本日',0],['きょう',0],['今天',0],['今日中',0],
  ['明日',-1],['あした',-1],['あす',-1],['明天',-1],
  ['明後日',-2],['あさって',-2],['后天',-2],['後天',-2],
  ['明々後日',-3],['明明後日',-3],['しあさって',-3],['大后天',-3],['大後天',-3],
  ['昨日',1],['きのう',1],['昨天',1],
  ['一昨日',2],['おととい',2],['前天',2]
])
// Shared with manual text parsing so tomorrow/yesterday have one definition.
export const relativeDayTokens = Object.freeze([...DAY_OFFSETS.keys()].sort((a,b) => b.length-a.length))
export const relativeDayOffset = value => DAY_OFFSETS.get(normalize(value)) ?? null
const NOW_WORDS = new Set(['今','いま','現在','ただ今','たった今','今現在','现在','現在時間','刚刚','剛剛','刚才'])
const ELAPSED = /^(\d{1,4})(時間|小时|小時|分|分钟|分鐘|日|天|週間|周)前$/
const HOUR_MS = 3600000
const DAY_MS = 86400000
const JST_OFFSET_MS = 9 * HOUR_MS

export const isRelativeDateToken = value => DAY_OFFSETS.has(normalize(value)) || NOW_WORDS.has(normalize(value))
export const isElapsedTimeToken = value => {
  const match = normalize(value).replace(/^約/, '').match(ELAPSED)
  if (!match) return false
  const count = Number(match[1])
  return count >= 0 && count <= 1440
}
export const isRelativeTimeToken = value =>
  NOW_WORDS.has(normalize(value)) || isElapsedTimeToken(value) || isRelativeDateToken(value)

const tokyoParts = instant => {
  const shifted = new Date(instant.getTime() + JST_OFFSET_MS)
  return {
    date: shifted.toISOString().slice(0, 10),
    time: shifted.toISOString().slice(11, 16)
  }
}
const minusDays = (instant, count) => tokyoParts(new Date(instant.getTime() - count * DAY_MS)).date

// Calculate the calendar day in Tokyo, even if the device's system timezone differs.
export function relativeDateInTokyo(token, reference = new Date()) {
  const offset = relativeDayOffset(token)
  if (offset === null) return null
  const instant = reference instanceof Date ? reference : new Date(reference)
  if (!Number.isFinite(instant.getTime())) return null
  return minusDays(instant, offset)
}

function elapsedMilliseconds(token) {
  const match = normalize(token).replace(/^約/, '').match(ELAPSED)
  if (!match) return null
  const amount = Number(match[1])
  const unit = match[2]
  const factor = /^(?:時間|小时|小時)$/.test(unit) ? HOUR_MS
    : /^(?:分|分钟|分鐘)$/.test(unit) ? 60000
      : /^(?:日|天)$/.test(unit) ? DAY_MS : 7 * DAY_MS
  const ms = amount * factor
  return Number.isSafeInteger(ms) && ms <= 366 * DAY_MS ? ms : null
}

export function resolveRelativeEntryTime(row, reference = new Date()) {
  if (!row || typeof row.raw !== 'string') return row
  // Only treat already-recognized five-field OCR rows as temporal input.
  // Merchant names, receipt item text, and other card formats are untouched.
  const m = row.raw.normalize('NFKC').trim().match(/^([^,，]+)\s*[,，]\s*([^,，]+)\s*[,，]/)
  if (!m) return row
  const dateToken = normalize(m[1]), timeToken = normalize(m[2])
  const dateIsRelative = isRelativeDateToken(dateToken)
  const timeIsRelative = isRelativeTimeToken(timeToken)
  if (!dateIsRelative && !timeIsRelative) return row
  const instant = reference instanceof Date ? reference : new Date(reference)
  if (!Number.isFinite(instant.getTime())) return row
  let {date, time} = row
  const now = tokyoParts(instant)

  // Explicit day words have precedence over today's date; a time such as
  // "3時間前" additionally supplies the rolled-over date when no printed
  // calendar date was present.
  if (DAY_OFFSETS.has(dateToken)) date = minusDays(instant, DAY_OFFSETS.get(dateToken))
  else if (NOW_WORDS.has(dateToken)) {
    date = now.date
    if (!time) time = now.time
  }
  const elapsed = elapsedMilliseconds(timeToken)
  if (elapsed !== null) {
    const calculated = tokyoParts(new Date(instant.getTime() - elapsed))
    // An elapsed duration determines both date and time; only a printed
    // explicit calendar date overrides the derived day.
    if (!date || dateIsRelative) date = calculated.date
    // "2日前" and "1週間前" indicate a date only, never an exact clock.
    const dateOnly = /(?:日|天|週間|周)前$/.test(normalize(timeToken))
    time = dateOnly ? '' : calculated.time
  } else if (NOW_WORDS.has(timeToken)) {
    // A relative "now" has a real clock value and is today unless a
    // separate explicit date says otherwise.
    if (!date) date = now.date
    time = now.time
  } else if (DAY_OFFSETS.has(timeToken)) {
    // "昨日" supplies a calendar date but no precise HH:mm.
    if (!date) date = minusDays(instant, DAY_OFFSETS.get(timeToken))
  }
  const original = normalize(timeToken)
  const relativeLabel = (elapsed !== null || NOW_WORDS.has(timeToken)) ? original : ''
  const originalNote = String(row.note || '')
  const note = relativeLabel
    ? '画面表示：' + relativeLabel + '（取込時刻から計算した目安）'
    : originalNote
  return {...row, date, time, note}
}
