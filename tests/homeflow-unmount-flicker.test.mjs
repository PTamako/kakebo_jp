import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const identity=readFileSync(new URL('../src/FamilyFinanceAccess.vue',import.meta.url),'utf8')
const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')

test('HomeFlow owner original-ledger transition never emits logout during child unmount',()=>{
 const unmount=identity.match(/onUnmounted\(\(\)=>\{([\s\S]*?)\n\}\)/)?.[1]
 assert.ok(unmount,'identity component must clean up on unmount')
 assert.doesNotMatch(unmount,/resetIdentity\(/,
  'resetIdentity emits identity-change(null) and re-locks the original owner')
 assert.doesNotMatch(unmount,/emit\(['"]identity-change['"]/,
  'unmount is not a user-triggered sign out')
 assert.match(unmount,/epoch\+\+/)
 assert.match(unmount,/removeEventListener\('visibilitychange',foreground\)/)
 assert.match(identity,/emit\('identity-change',user\.identity\)/,
  'successful SSO should send owner identity to the parent')
 assert.match(app,/if\(identity\.role==='owner'\)/)
 assert.match(app,/locked\.value=false/)
 assert.match(app,/<FamilyFinanceAccess :identity-only=/)
 assert.match(app,/<main v-else :class=/)
})

test('explicit sign-out still revokes identity and clears previous account',()=>{
 assert.match(identity,/async function logout\(\)\{/)
 assert.match(identity,/resetIdentity\(\)/)
 assert.match(identity,/await call\('\/api\/homeflow-sso\/logout'/)
 assert.match(identity,/emit\('identity-change',null\)/)
 assert.match(app,/familyIdentity\.value=null/)
 assert.match(app,/paymentSources\.value=\[\]/)
})
