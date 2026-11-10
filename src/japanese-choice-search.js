// Japanese-first label matching: full/half-width characters, katakana and
// hiragana share the same search form. Search never calls a remote service.
export function normalizeJapaneseChoice(value){
  return String(value??'').normalize('NFKC').toLocaleLowerCase('ja-JP')
    .replace(/[\u30a1-\u30f6]/g, char=>String.fromCharCode(char.charCodeAt(0)-0x60))
    .replace(/[\s\u3000]+/g,'')
}
export function filterJapaneseChoices(options,query){
  const words=String(query??'').trim().split(/\s+/).map(normalizeJapaneseChoice).filter(Boolean)
  if(!words.length)return options
  return options.filter(item=>{
    const text=normalizeJapaneseChoice([item.label,...(item.keywords||[])].join(' '))
    return words.every(word=>text.includes(word))
  })
}
