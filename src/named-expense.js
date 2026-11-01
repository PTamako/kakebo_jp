import { parseRepeatedExpense } from './natural-repeat.js'
import { relativeDateInTokyo, relativeDayTokens } from './relative-entry-time.js'

// 手入力: 名称 / 日付 / 金額の3行（複数組も可）。
// No API writes here: return reviewable drafts only.
const kanjiMonths = { 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10, 十一:11, 十二:12 }
const monthValue = text => kanjiMonths[text] ?? Number(text)
const monthToken = '(?:1[0-2]|0?[1-9]|十[一二]?|[一二三四五六七八九])'
const pad = n => String(n).padStart(2, '0')
// 「今」 is an explicit timestamp, resolved once against the recognition instant in JST.
const nowInTokyo = instant => {
  const iso = new Date(instant.getTime() + 9 * 60 * 60 * 1000).toISOString()
  return {date:iso.slice(0,10),time:iso.slice(11,16)}
}
const relativeDayPattern = `(?:${relativeDayTokens.join('|')}|今)`
const dateString = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`

function singleDate(text, now) {
  const relative = relativeDateInTokyo(text, now)
  if (relative) return relative
  if (text === '今') return nowInTokyo(now).date
  let match, year, month, day
  const monthDay = new RegExp(`^(?:(20\\d{2})\\s*年\\s*)?(${monthToken})\\s*月\\s*(\\d{1,2})\\s*日?$`)
  if ((match = text.match(monthDay))) {
    year=match[1] ? Number(match[1]) : now.getFullYear()
    month=monthValue(match[2]); day=Number(match[3])
  } else if ((match=text.match(/^(20\d{2})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{1,2})$/))) {
    year=Number(match[1]);month=Number(match[2]);day=Number(match[3])
  } else if ((match=text.match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/))) {
    year=now.getFullYear();month=Number(match[1]);day=Number(match[2])
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
  const match = line.match(new RegExp(String.raw`^(.{1,60}?)\s*(${when})\s+(\S{1,25})$`))
  if (!match) return splitFlexibleInlineNamedExpense(line)
  const name = match[1].trim()
  // A bare month must not be split into a numeric "name" and date.
  if (!name || !/[^\d\s¥￥,./-]/.test(name)) return null
  if (!/[¥￥円]/.test(match[3])) return null
  return [name, match[2].trim(), match[3].trim()]
}
// Detect a dated expense in one line without requiring field order.
// A yen marker is mandatory in one-line mode; plain numbers are ambiguous.
function splitFlexibleInlineNamedExpense(line) {
  const month = String.raw`(?:(?:20\d{2})\s*年\s*)?${monthToken}\s*月`
  const weekday = String.raw`(?:毎週|每周|每週)\s*(?:の)?\s*(?:星期|礼拜|週)?\s*[月火水木金土日一二三四五六天]\s*(?:曜日)?`
  const dates = [
    String.raw`${month}\s*(?:の\s*)?${weekday}`,
    String.raw`${month}\s*\d{1,2}\s*日?`,
    String.raw`20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}`,
    String.raw`\d{1,2}/\d{1,2}`,
    String.raw`(?<!\S)${relativeDayPattern}(?!\S)`
  ]
  const datePattern = new RegExp(String.raw`(?<![\d一二三四五六七八九十])(?:${dates.join('|')})`,'g')
  const dateHits=[...line.matchAll(datePattern)]
  const priceHits=[...line.matchAll(/[¥￥]\s*\d[\d,]*(?:\s*円)?|(?<!\d)\d[\d,]*\s*円/g)]
  if(dateHits.length!==1||priceHits.length!==1)return null
  const [date,price]=[dateHits[0],priceHits[0]]
  const dateEnd=date.index+date[0].length,priceEnd=price.index+price[0].length
  if(!(dateEnd<=price.index||priceEnd<=date.index))return null
  const remainder = [
    [date.index,dateEnd],[price.index,priceEnd]
  ].sort((a,b)=>b[0]-a[0]).reduce((text,[start,end])=>text.slice(0,start)+text.slice(end),line)
  // Comma-separated bank/card rows belong to the existing statement parser.
  if(remainder.includes(','))return null
  const name=remainder.replace(/^[\s:：・、|/\-]+|[\s:：・、|/\-]+$/g,'').trim()
  if(!name||name.length>60||!/[^\d\s¥￥,./-]/.test(name))return null
  return [name,date[0].trim(),price[0].trim()]
}
// null = unrelated text; {rows} = recognized; {error} = structured input invalid.
// A malformed 3-line block must never fall through to generic OCR heuristics.
export function parseNamedExpenseBlocks(raw, now = new Date()) {
  if(typeof raw!=='string' || raw.length>100000)return null
  let lines=raw.normalize('NFKC').split(/\r?\n/).map(s=>s.trim()).filter(Boolean)
  // Accept mixed single-line and three-line groups. The ledger is never
  // written until the user reviews and saves the resulting drafts.
  lines=lines.flatMap(line=>splitInlineNamedExpense(line)||[line])
  if(lines.length<2)return null
  const dateHint = new RegExp(String.raw`(?:毎週|每周|每週|[0-9一二三四五六七八九十]月|^\d{1,4}[\/.-]|^${relativeDayPattern}$)`)
  if(!lines.some(line=>dateHint.test(line)))return null
  if(lines.length%3!==0)return {error:'名称・日付・金額を3行ずつ入力してください'}
  if(lines.length/3>30)return {error:'一度に読み取れる記録は30組までです'}
  const rows=[]
  for(let i=0;i<lines.length;i+=3){
    const group=lines.slice(i,i+3)
    const datePositions=group.map((value,index)=>dateHint.test(value)?index:-1).filter(index=>index>=0)
    if(datePositions.length!==1)return {error:`${i/3+1}組目の日付を確認してください`}
    const when=group[datePositions[0]]
    const amounts=group.map((value,index)=>index===datePositions[0]?-1:amountFromLine(value)!==null||/^[¥￥\d]/.test(value)?index:-1).filter(index=>index>=0)
    if(amounts.length!==1)return {error:`${i/3+1}組目の金額を確認してください`}
    const price=group[amounts[0]]
    const name=group[3-datePositions[0]-amounts[0]]
    if(!name || name.length>60 || /^[\d¥￥,.\s]+$/.test(name))return {error:`${i/3+1}組目の名称を確認してください`}
    const amount=amountFromLine(price)
    if(amount===null)return {error:`${i/3+1}組目の金額を確認してください（円で入力）`}
    const expanded=parseRepeatedExpense(when+' '+price,now)
    const dates=expanded?.map(row=>row.date) ?? (singleDate(when,now) ? [singleDate(when,now)] : null)
    if(!dates)return {error:`${i/3+1}組目の日付を確認してください`}
    const nowClock = when === '今' ? nowInTokyo(now).time : ''
    for(const date of dates){
      rows.push({
        date,time:nowClock,amount,type:'expense',merchant:name,category:'日用品',
        note:expanded ? expanded[0].note : '',raw:[name,when,price].join('\n'),
        suggested:'日用品',keyword:''
      })
    }
    if(rows.length>150)return {error:'明細が150件を超えます。入力を分けてください'}
  }
  return {rows}
}
