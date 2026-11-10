// Japanese-first label matching: full/half-width characters, katakana and
// hiragana share the same search form. Search never calls a remote service.
export function normalizeJapaneseChoice(value){
  return String(value??'').normalize('NFKC').toLocaleLowerCase('ja-JP')
    .replace(/[\u30a1-\u30f6]/g, char=>String.fromCharCode(char.charCodeAt(0)-0x60))
    .replace(/[\s\u3000]+/g,'')
}
// Lightweight offline readings for common labels. Custom merchant kanji need
// an explicit reading keyword; do not guess arbitrary names or call a service.
const COMMON_READINGS=[
  ['楽天','らくてん'],['三井住友','みついすみとも'],['現金','げんきん'],
  ['日用品','にちようひん'],['食費','しょくひ'],['交通費','こうつうひ'],
  ['通信費','つうしんひ'],['光熱費','こうねつひ'],['家賃','やちん'],
  ['給与','きゅうよ'],['美容','びよう'],['医療','いりょう'],
  ['娯楽','ごらく'],['支出','ししゅつ'],['収入','しゅうにゅう'],
  ['ポイント還元','ぽいんとかんげん'],['その他','そのた'],
  ['店舗','てんぽ'],['商店','しょうてん']
]
export function filterJapaneseChoices(options,query){
  const words=String(query??'').trim().split(/\s+/).map(normalizeJapaneseChoice).filter(Boolean)
  if(!words.length)return options
  return options.filter(item=>{
    const labels=[item.label,...(item.keywords||[])].join(' ')
    const readings=COMMON_READINGS.filter(([kanji])=>labels.includes(kanji)).map(([,reading])=>reading)
    const text=normalizeJapaneseChoice([labels,...readings].join(' '))
    return words.every(word=>text.includes(word))
  })
}
