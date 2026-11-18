import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const topbar=readFileSync(new URL('../src/AppTopbar.vue',import.meta.url),'utf8')
const menu=readFileSync(new URL('../src/FamilyAccountMenu.vue',import.meta.url),'utf8')
const member=readFileSync(new URL('../src/FamilyMemberWorkspace.vue',import.meta.url),'utf8')

test('HomeFlow identity must finish resolving before owner ledger or member workspace is mounted',()=>{
 assert.match(app,/const identityBootstrapping=ref\(!locked\.value\)/)
 assert.match(app,/<main v-if="identityBootstrapping"/)
 assert.match(app,/<main v-else-if="locked"/)
 assert.match(app,/if\(proof\.ok===true&&proof\.ledger_access===false/)
 assert.match(app,/onFamilyIdentityChange\(identity\)/)
 assert.match(app,/return identity\.role==='member'/)
 assert.match(app,/onFamilyIdentityChange\(null\)\s+return true/)
 assert.doesNotMatch(app,/if\(old\.status===401\)/)
 assert.doesNotMatch(app,/fetch\('\/api\/payment-sources',\{credentials:'same-origin',cache:'no-store'\}\)/)
 assert.match(app,/identityBootstrapping\.value=false/)
})

test('verified member and verified owner both get the same account-person menu, wired to HomeFlow revocation',()=>{
 assert.match(topbar,/<FamilyAccountMenu v-if="identity" :identity="identity" @logout="emit\('logout'\)"/)
 assert.match(menu,/aria-label="HomeFlow 家庭账户"/)
 assert.match(menu,/退出家庭身份/)
 assert.match(member,/<OriginalKakeiboPages :identity="user"/)
 assert.match(app,/<OriginalKakeiboPages :identity="familyIdentity"/)
 assert.match(app,/@theme-change="setTheme" @logout="logoutFamilyMember"/)
 assert.match(app,/async function logoutFamilyMember\(\)/)
 assert.match(app,/fetch\('\/api\/homeflow-sso\/logout'/)
 assert.match(app,/if\(localStorage\.getItem\(PENDING_HF_LOGOUT_KEY\)==='1'\|\|familyIdentity\.value\)/)
})