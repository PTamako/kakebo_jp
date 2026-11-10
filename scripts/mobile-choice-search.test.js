import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {filterJapaneseChoices,normalizeJapaneseChoice} from '../src/japanese-choice-search.js'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('Japanese search normalizes katakana, hiragana and half-width kana locally',()=>{
  assert.equal(normalizeJapaneseChoice('ｶｰﾄﾞ'),'かーど')
  assert.equal(normalizeJapaneseChoice('カード'),'かーど')
  assert.equal(normalizeJapaneseChoice('かーど'),'かーど')
  assert.equal(normalizeJapaneseChoice('ＡＢＣ'),'abc')
  const list=[{value:'rakuten',label:'楽天カード',keywords:['らくてん']},
    {value:'suica',label:'Ｓｕｉｃａ'},
    {value:'tenpo',label:'テスト店舗'}]
  assert.deepEqual(filterJapaneseChoices(list,'てすと').map(x=>x.value),['tenpo'])
  assert.deepEqual(filterJapaneseChoices(list,'ﾃｽﾄ').map(x=>x.value),['tenpo'])
  assert.deepEqual(filterJapaneseChoices(list,'らくてん').map(x=>x.value),['rakuten'])
  assert.deepEqual(filterJapaneseChoices(list,'ＳＵＩ').map(x=>x.value),['suica'])
  assert.deepEqual(filterJapaneseChoices([{value:'r',label:'楽天カード'}],'らくてん').map(x=>x.value),['r'])
  assert.deepEqual(filterJapaneseChoices([{value:'rent',label:'家賃'}],'やちん').map(x=>x.value),['rent'])
  assert.deepEqual(filterJapaneseChoices([{value:'cash',label:'現金'}],'ｹﾞﾝｷﾝ').map(x=>x.value),['cash'])
  assert.deepEqual(filterJapaneseChoices(list,'存在しない'),[])
  assert.equal(filterJapaneseChoices(list,'').length,3)
})

test('bottom sheet keeps iPhone accessibility, native dates and Japanese search',()=>{
  const component=read('src/MobileChoiceSheet.vue')
  const form=read('src/TransactionForm.vue')
  const app=read('src/App.vue')
  const finance=read('src/FinanceTools.vue')
  assert.match(component,/<Teleport to="body">/)
  assert.match(component,/role="dialog" aria-modal="true"/)
  assert.match(component,/role="listbox"/)
  assert.match(component,/role="option"/)
  assert.match(component,/searchPlaceholder:\{type:String,default:'日本語で検索'\}/)
  assert.match(component,/showSearch=computed\(\(\)=>props.searchable===null\?items.value.length>10:props.searchable\)/)
  assert.match(component,/padding-bottom:env\(safe-area-inset-bottom/)
  assert.match(component,/nextTick\(\(\)=>trigger.value\?\.focus/)
  assert.match(component,/event\.key==='Escape'/)
  assert.match(form,/v-model="record.category" :options="categoryOptions"/)
  assert.match(finance,/label="固定費カテゴリ"/)
  assert.match(finance,/label="管理するカード"/)
  assert.match(form,/type="date"/)
  assert.match(form,/type="time"/)
  assert.match(finance,/type="month"/)
  assert.doesNotMatch(component,/fetch\(|sessionStorage|localStorage|indexedDB/)
})
