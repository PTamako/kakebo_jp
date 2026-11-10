import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = name => readFileSync(new URL('../'+name,import.meta.url),'utf8')
const merchant=read('src/MobileMerchantRulesPanel.vue')
const card=read('src/MobileCardEditorSheet.vue')
const single=read('src/MobileChoiceSheet.vue')
const multiple=read('src/MobileMultiChoiceSheet.vue')
const login=read('src/MobileLoginSheet.vue')
const sbi=read('src/SbiPortfolio.vue')
const smoke=read('scripts/mobile-browser-smoke.mjs')

test('merchant-rule successful Save and Cancel close entire sheet, clearing all transients',()=>{
  assert.match(merchant,/function clearPanelDraft\(\)\{[\s\S]*?query\.value=''[\s\S]*?limit\.value=8[\s\S]*?activeKeyword\.value=''[\s\S]*?category\.value=''[\s\S]*?payment\.value=''[\s\S]*?error\.value=''/)
  assert.match(merchant,/function closePanel\(force=false\)\{[\s\S]*?if\(saving\.value&&!force\)return[\s\S]*?open\.value=false[\s\S]*?clearPanelDraft\(\)/)
  assert.match(merchant,/await props\.onSave\([\s\S]*?closePanel\(true\)/)
  assert.match(merchant,/class="merchant-sheet-cancel" :disabled="saving" @click="closePanel\(\)"/)
  assert.match(merchant,/catch\(e\)\{error\.value='保存できませんでした/)
  assert.match(merchant,/function back\(\)\{[\s\S]*?activeKeyword\.value=''[\s\S]*?category\.value=''[\s\S]*?payment\.value=''/)
})

test('single choice closes and clears search, while multiple choice discards only unfinished draft',()=>{
  assert.match(single,/function close\(\)\{\s*open\.value=false\s*query\.value=''/)
  assert.match(single,/function pick\(item\)\{[\s\S]*?emit\('update:modelValue',item\.value\)[\s\S]*?close\(\)/)
  assert.match(multiple,/function close\(\)\{[\s\S]*?open\.value=false[\s\S]*?draft\.value=\[\]/)
  assert.match(multiple,/function start\(\)\{[\s\S]*?draft\.value=\[\.\.\.props\.modelValue\]/)
  assert.match(multiple,/function commit\(\)\{[\s\S]*?emit\('update:modelValue',\[\.\.\.draft\.value\]\)[\s\S]*?close\(\)/)
})

test('card editor resets after parent closes without losing a failed-save draft',()=>{
  assert.match(card,/await props\.onSave\(payload\)\s*emit\('close'\)/)
  assert.match(card,/catch\(e\)\{error\.value='保存できませんでした/)
  assert.match(card,/watch\(\(\)=>\[props\.mode,props\.cardName\],[\s\S]*?if\(!mode\)\{[\s\S]*?resetDraft\(\)/)
  assert.match(card,/if\(dirty\.value&&!window\.confirm\('変更内容を破棄しますか？'\)\)return/)
})

test('login code and SBI editor fields are cleared only when their sheet is closed',()=>{
  assert.match(login,/if\(opened\)\{\s*code\.value=''/)
  assert.match(login,/\}else\{[\s\S]*?code\.value=''[\s\S]*?document\.body\.style\.overflow=previousOverflow/)
  assert.match(sbi,/watch\(\[editing,editingTransfer\],\(\[mode,transfer\]\)=>\{[\s\S]*?if\(mode \|\| transfer!==null\)return[\s\S]*?plan\.value=emptyPlan\(\)[\s\S]*?holding\.value=emptyHolding\(\)[\s\S]*?bulkRows\.value=\[\]/)
  assert.match(sbi,/function closeEditor\(\)\s*\{\s*if\(saving\.value \|\| bulkBusy\.value\)return/)
  assert.doesNotMatch(sbi,/@click="editing=''"|@click="editingTransfer=null"/)
  assert.match(sbi,/catch\(e\)\{\s*error\.value = e\.message\s*\}/)
})

test('WebKit smoke covers cancelled multi-choice and merchant save/cancel lifecycle',()=>{
  assert.match(smoke,/Cancel discards the temporary selection/)
  assert.match(smoke,/Successful Save must close and unlock the merchant sheet/)
  assert.match(smoke,/Cancel must close and unlock the merchant sheet/)
})
