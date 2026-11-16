import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const app=read('src/App.vue')
const member=read('src/FamilyMemberWorkspace.vue')
const menu=read('src/FamilyAccountMenu.vue')
const tabs=read('src/FinanceSectionTabs.vue')
const mobile=read('src/mobile-ui.css')

test('account status lives in compact top-right menu rather than management card',()=>{
 assert.match(app,/<FamilyAccountMenu v-if="familyIdentity" :identity="familyIdentity" @logout="logout"/)
 assert.doesNotMatch(app,/<FamilyFinanceAccess v-if="tab === 'finance'"/)
 assert.match(member,/<FamilyAccountMenu :identity="user" @logout="emit\('logout'\)"/)
 assert.match(menu,/<summary aria-label="HomeFlow 家庭账户"/)
 assert.match(menu,/HomeFlow 家庭账户/)
 assert.match(menu,/identity\.display_name/)
 assert.match(menu,/已关联/)
 assert.match(menu,/退出家庭身份/)
 assert.match(menu,/emit\('logout'\)/)
})

test('all four management tabs stay side by side even with mobile CSS',()=>{
 const section=mobile.match(/main \.finance-tools \.finance-section-tabs\s*\{([^}]+)\}/)?.[1]
 assert.ok(section,'management tab grid mobile override exists')
 assert.match(section,/grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/)
 assert.doesNotMatch(section,/repeat\(3/)
 assert.match(tabs,/\['cards','カード'\]/)
 assert.match(tabs,/\['plans','固定費'\]/)
 assert.match(tabs,/\['investment','積立'\]/)
 assert.match(tabs,/\['tools','その他'\]/)
})

test('account menu does not lose explicit logout or member data isolation',()=>{
 assert.match(app,/async function logoutFamilyMember\(\)/)
 assert.match(app,/fetch\('\/api\/homeflow-sso\/logout'/)
 assert.match(app,/<FamilyMemberWorkspace v-if="familyIdentity\?\.role==='member'"/)
 assert.match(app,/@logout="logoutFamilyMember"/)
 assert.match(app,/<FamilyFinanceAccess v-if="!familyIdentity" identity-only/)
 assert.match(app,/onFamilyIdentityChange\(null\)/)
})
