// Preview-only natural language expansion: never write to the ledger here.
// Recognizes a whole-month weekday recurrence, not a standing billing plan.
const weekdayNumber={月:1,火:2,水:3,木:4,金:5,土:6,日:0,一:1,二:2,三:3,四:4,五:5,六:6,天:0}
export function parseRepeatedExpense(text, now=new Date()) {
  if(typeof text!=='string'||text.length>1000)return null
  const input=text.normalize('NFKC').trim().replace(/[，,]/g,'')
  const when=input.match(/(?:(20\d{2})[年/-])?\s*(1[0-2]|0?[1-9])\s*月/)
  if(!when)return null
  const repeated=input.match(/(?:毎週|每周|每週)\s*(?:の)?\s*(?:星期|礼拜|週)?\s*([月火水木金土日一二三四五六天])(?:曜日)?/)
  if(!repeated)return null
  const amountMatch=input.match(/(?:[¥￥]\s*(\d{1,8})|(\d{1,8})\s*(?:円|元|日元))/)
  if(!amountMatch)return null
  const amount=Number(amountMatch[1]||amountMatch[2])
  if(!Number.isSafeInteger(amount)||amount<1||amount>99999999)return null
  const year=when[1]?Number(when[1]):now.getFullYear(),month=Number(when[2])
  if(year<2000||year>2100)return null
  const weekday=weekdayNumber[repeated[1]]
  if(weekday===undefined)return null
  // Never infer a payment source, merchant or an account transfer from a sentence.
  const drafts=[]
  for(let day=1,limit=new Date(year,month,0).getDate();day<=limit;day++){
    const date=new Date(year,month-1,day)
    if(date.getDay()!==weekday)continue
    const iso=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    drafts.push({date:iso,time:'',amount,category:'日用品',merchant:'',note:`毎週${repeated[1]}曜日の支出（内容を確認）`,raw:input,suggested:'日用品',keyword:'',type:'expense'})
  }
  return drafts.length?drafts:null
}
