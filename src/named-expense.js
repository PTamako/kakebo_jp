import { parseRepeatedExpense } from './natural-repeat.js'

// 手入力: 名称 / 日付 / 金額の3行（複数組も可）。
// No API writes here: return reviewable drafts only.
const kanjiMonths = { 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10, 十一:11, 十二:12 }
const monthValue = text => kanjiMonths[text] ?? Number(text)
const monthToken = '(?:1[0-2]|0?[1-9]|十[一二]?|[一二三四五六七八九])'
const pad = n => String(n).padStart(2, '0')
const dateString = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`

function singleDate(text, now) {
  let match, year, month, day
  const monthDay = new RegExp(`^(?:(20\\d{2})\\s*年\\s*)?(${monthToken})\\s*月\\s*(\\d{1,2})\\s*日?$`)
  if ((match = text.match(monthDay))) {
    year=match[1] ? Number(match[1]) : now.getFullYear()
    month=monthValue(match[2]); day=Number(match[3])
  } else if ((match=text.match(/^(20\d{2})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{1,2})$/))) {
    year=Number(match[1]);month=Number(match[2]);day=Number(match[3])
  } else if ((match=text.match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/))) {
    year=now.getFullYear();month=Number(match[1]);day=Number(match[2])
  } else if (/^(今日|昨日|一昨日)$/.test(text)) {
    const date = new Date(now.getFullYear(),now.getMonth(),now.getDate())
    date.setDate(date.getDate() - ({今日:0,昨日:1,一昨日:2}[text]))
    return dateString(date)
  } else return null

  if(year<2000 || year>2100 || month<1 || month>12 || day<1 || day>31)return null
  const date=new Date(year,month-1,day)
  return date.getFullYear()===year && date.getMonth()+1===month && date.getDate()===day ? dateString(date) : null
}
function amountFromLine(text) {
  const match=text.match(/^(?:[¥￥]\s*)?((?:\d{1,3}(?:,\d{3})+)|\d{1,8})\s*(?:円)?$/)
  if(!match)return null
  const amount=Number(match[1].replace(/,/g,''))
  return Number.isSafeInteger(amount)&&amount>0&&amount<=99999999 ? amount : null
}

// Single-line variation, such as 勉強会10月毎週の金曜日 100円.
// Reuse the three-line validation instead of guessing OCR statement fields.
function splitInlineNamedExpense(line) {
  const month = String.raw`(?:(?:20\d{2})\s*年\s*)?${monthToken}\s*月`
  const weekday = String.raw`(?:毎週|每周|每週)\s*(?:の)?\s*(?:星期|礼拜|週)?\s*[月火水木金土日一二三四五六天]\s*(?:曜日)?`
  const when = String.raw`(?:${month}\s*(?:の\s*)?${weekday}|${month}\s*\d{1,2}\s*日?|20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})`
  const match = line.match(new RegExp(String.raw`^(.{1,60}?)\s*(${when})\s+(\S{1,25})import { parseRepeatedExpense } from './natural-repeat.js'

// 手入力: 名称 / 日付 / 金額の3行（複数組も可）。
// No API writes here: return reviewable drafts only.
const kanjiMonths = { 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10, 十一:11, 十二:12 }
const monthValue = text => kanjiMonths[text] ?? Number(text)
const monthToken = '(?:1[0-2]|0?[1-9]|十[一二]?|[一二三四五六七八九])'
const pad = n => String(n).padStart(2, '0')
const dateString = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`

function singleDate(text, now) {
  let match, year, month, day
  const monthDay = new RegExp(`^(?:(20\\d{2})\\s*年\\s*)?(${monthToken})\\s*月\\s*(\\d{1,2})\\s*日?$`)
  if ((match = text.match(monthDay))) {
    year=match[1] ? Number(match[1]) : now.getFullYear()
    month=monthValue(match[2]); day=Number(match[3])
  } else if ((match=text.match(/^(20\d{2})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{1,2})$/))) {
    year=Number(match[1]);month=Number(match[2]);day=Number(match[3])
  } else if ((match=text.match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/))) {
    year=now.getFullYear();month=Number(match[1]);day=Number(match[2])
  } else if (/^(今日|昨日|一昨日)$/.test(text)) {
    const date = new Date(now.getFullYear(),now.getMonth(),now.getDate())
    date.setDate(date.getDate() - ({今日:0,昨日:1,一昨日:2}[text]))
    return dateString(date)
  } else return null

  if(year<2000 || year>2100 || month<1 || month>12 || day<1 || day>31)return null
  const date=new Date(year,month-1,day)
  return date.getFullYear()===year && date.getMonth()+1===month && date.getDate()===day ? dateString(date) : null
}
function amountFromLine(text) {
  const match=text.match(/^(?:[¥￥]\s*)?((?:\d{1,3}(?:,\d{3})+)|\d{1,8})\s*(?:円)?$/)
  if(!match)return null
  const amount=Number(match[1].replace(/,/g,''))
  return Number.isSafeInteger(amount)&&amount>0&&amount<=99999999 ? amount : null
}

))
  if (!match) return null
  const name = match[1].trim()
  // A bare month must not be split into a numeric "name" and date.
  if (!name || !/[^\d\s¥￥,./-]/.test(name)) return null
  if (!/[¥￥円]/.test(match[3])) return null
  return [name, match[2].trim(), match[3].trim()]
}
// null = unrelated text; {rows} = recognized; {error} = structured input invalid.
// A malformed 3-line block must never fall through to generic OCR heuristics.
export function parseNamedExpenseBlocks(raw, now = new Date()) {
  if(typeof raw!=='string' || raw.length>100000)return null
  let lines=raw.normalize('NFKC').split(/\r?\n/).map(s=>s.trim()).filter(Boolean)
  // Single-line named expenses and multiple one-line entries share the
  // original three-field validation and never save without confirmation.
  const inline=lines.map(splitInlineNamedExpense)
  if(inline.length && inline.every(Boolean))lines=inline.flat()
  if(lines.length<2)return null
  const dateHint=/毎週|每周|每週|月|^\d{1,4}[\/.-]|^(今日|昨日|一昨日)$/
  if(!dateHint.test(lines[1]))return null
  if(lines.length%3!==0)return {error:'名称・日付・金額を3行ずつ入力してください'}
  if(lines.length/3>30)return {error:'一度に読み取れる記録は30組までです'}
  const rows=[]
  for(let i=0;i<lines.length;i+=3){
    const [name,when,price]=lines.slice(i,i+3)
    if(!name || name.length>60 || /^[\d¥￥,.\s]+$/.test(name))return {error:`${i/3+1}組目の名称を確認してください`}
    const amount=amountFromLine(price)
    if(amount===null)return {error:`${i/3+1}組目の金額を確認してください（円で入力）`}
    const expanded=parseRepeatedExpense(when+' '+price,now)
    const dates=expanded?.map(row=>row.date) ?? (singleDate(when,now) ? [singleDate(when,now)] : null)
    if(!dates)return {error:`${i/3+1}組目の日付を確認してください`}
    for(const date of dates){
      rows.push({
        date,time:'',amount,type:'expense',merchant:name,category:'日用品',
        note:expanded ? expanded[0].note : '',raw:[name,when,price].join('\n'),
        suggested:'日用品',keyword:''
      })
    }
    if(rows.length>150)return {error:'明細が150件を超えます。入力を分けてください'}
  }
  return {rows}
}
