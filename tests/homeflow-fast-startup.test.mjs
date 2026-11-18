import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const access=readFileSync(new URL('../src/FamilyFinanceAccess.vue',import.meta.url),'utf8')

test('cold launch shows no private ledger before a single HomeFlow identity verification',()=>{
 const bootstrap=app.match(/async function requestVerifiedHomeflowIdentity\(\)\{([\s\S]*?)\n\}/)?.[1]
 assert.ok(bootstrap)
 assert.match(bootstrap,/fetch\('\/api\/homeflow-sso\/me'/)
 assert.doesNotMatch(bootstrap,/localStorage|sessionStorage|\/api\/homeflow-sso\/status/)
 assert.match(app,/if\(proof\.ok===true&&proof\.ledger_access===false/)
 assert.match(app,/<main v-if="identityBootstrapping"[^>]*aria-busy="true"/)
 assert.match(app,/<!-- Never display private amounts, cached identity or finance actions before \/me\. -->/)
 assert.match(app,/<main v-else-if="locked"/)
})

test('verified screen is released before draft and ledger reads complete',()=>{
 const startup=app.match(/onMounted\(\(\)=>\{\n window\.addEventListener\('online',onConnectionRestored\)([\s\S]*?)\n\}\)/)?.[1]
 assert.ok(startup)
 assert.match(startup,/await routeNewFamilyMemberToIsolatedLogin\(\)/)
 assert.match(startup,/identityBootstrapping\.value=false\s+if\(familyIdentity\.value\?\.role==='owner'\)\s+void restoreVerifiedOwner/)
 assert.doesNotMatch(startup,/await restoreAppState\(\)/)
 assert.doesNotMatch(startup,/await load\(\)/)
 assert.doesNotMatch(startup,/await loadYear\(\)/)
 assert.doesNotMatch(startup,/await loadTransfers\(\)/)
})

test('foreground revalidates live HomeFlow and locks revoked, expired or switched identities',()=>{
 assert.match(app,/document\.addEventListener\('visibilitychange',onHomeflowForeground\)/)
 assert.match(app,/document\.removeEventListener\('visibilitychange',onHomeflowForeground\)/)
 assert.match(app,/HOMEFLOW_FOREGROUND_RECHECK_MS=60_000/)
 assert.match(app,/current\.household_id!==previous\.household_id/)
 assert.match(app,/current\.role!==previous\.role\)onFamilyIdentityChange\(null\)/)
 assert.match(app,/loadRequestId\+\+;yearRequestId\+\+/)
 assert.match(app,/if\(!stillActive\(\)\)return/)
 assert.match(app,/:skip-initial-check="ssoBootstrapChecked"/)
 assert.match(access,/if\(props\.identityOnly&&props\.skipInitialCheck\)restorePending\(\)/)
 assert.match(access,/if\(!props\.identityOnly\)\{/)
})
