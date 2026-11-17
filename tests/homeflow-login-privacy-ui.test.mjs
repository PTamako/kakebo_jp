import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const tools=readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
const member=readFileSync(new URL('../src/FamilyMemberWorkspace.vue',import.meta.url),'utf8')
const router=readFileSync(new URL('../functions/api/[[path]].js',import.meta.url),'utf8')

test('privacy management cannot override HomeFlow session persistence',()=>{
 assert.doesNotMatch(tools,/ログイン状態の保存|ログイン状態を保持（最長30日）|セッション内のみ保持/)
 assert.doesNotMatch(tools,/change-remember-device|rememberDevice|MobileChoiceSegments/)
 assert.doesNotMatch(member,/<strong>ログイン状態の保存<\/strong>/)
 assert.doesNotMatch(app,/setRememberDevice|onChangeRememberDevice|auth\/remember/)
})
test('owner login still requires HomeFlow and legacy compatibility does not silently expire sessions',()=>{
 assert.match(router,/verifyLegacyOwner\(request,env,url,ownerProof\)/)
 assert.match(app,/if\(identity\.role==='owner'\)/)
 assert.match(app,/await restoreAppState\(\)/)
 assert.match(app,/api\/auth\/login/)
 assert.match(app,/async function logout\(\)/)
 assert.match(app,/async function logoutFamilyMember\(\)/)
})
test('privacy remains available for actual receipts without misrepresenting disabled member image storage',()=>{
 assert.match(tools,/<strong>保存済みレシート画像<\/strong>/)
 assert.match(member,/OCR のみ対応/)
 assert.match(member,/receiptEnabled:computed\(\(\)=>false\)/)
 assert.match(member,/本人の画像を保存・再表示・一括ダウンロードする機能は未対応/)
})
