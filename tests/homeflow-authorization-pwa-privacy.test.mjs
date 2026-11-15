import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {validateKakeiboHomeflowAuthorizationUrl as validate} from '../src/homeflow-authorization-url.js'
const app='https://kakeibo.example.jp',state='a'.repeat(64)
function valid(){const u=new URL('https://homeflow.example.jp/authorize')
 for(const [name,value] of Object.entries({response_type:'code',client_id:'kakeibo',
 redirect_uri:app+'/api/homeflow-sso/callback',code_challenge:'B'.repeat(43),
 code_challenge_method:'S256',state,nonce:'c'.repeat(64)}))u.searchParams.set(name,value)
 return u
}
test('Kakeibo installed iPhone PWA binds OAuth state, client and callback before leaving Safari',()=>{
 const u=valid();assert.equal(validate(u.href,state,app).href,u.href)
 const ui=readFileSync(new URL('../src/FamilyFinanceAccess.vue',import.meta.url),'utf8')
 assert.match(ui,/validateKakeiboHomeflowAuthorizationUrl\(result\.authorization_url,result\.state,window\.location\.origin\)/)
})
test('Kakeibo PWA refuses OAuth injected callback, PKCE downgrade, phishing query and altered state',()=>{
 const changes=[
  u=>u.searchParams.set('client_id','other'),
  u=>u.searchParams.set('state','d'.repeat(64)),
  u=>u.searchParams.set('redirect_uri','https://evil.test/steal'),
  u=>u.searchParams.set('response_type','token'),
  u=>u.searchParams.set('code_challenge_method','plain'),
  u=>u.searchParams.set('code_challenge','short'),
  u=>u.searchParams.set('nonce','fake'),
  u=>u.searchParams.append('state',state),
  u=>u.username='admin',
  u=>u.hash='access_token=bad',
  u=>u.pathname='/token'
 ]
 for(const fn of changes){const u=valid();fn(u)
  assert.throws(()=>validate(u.href,state,app),/链接验证失败/,u.href)}
 assert.throws(()=>validate('javascript:alert(1)',state,app),/链接验证失败/)
 assert.throws(()=>validate(valid().href,state,'http://kakeibo.example.jp'),/链接验证失败/)
})
test('PWA workbox shell never precaches /api ledger and finance actions cannot enter offline task queue',()=>{
 const config=readFileSync(new URL('../vite.config.js',import.meta.url),'utf8')
 const recurring=readFileSync(new URL('../src/FamilyRecurringFinance.vue',import.meta.url),'utf8')
 const shared=readFileSync(new URL('../src/FamilySharedMutationRequests.vue',import.meta.url),'utf8')
 assert.match(config,/navigateFallbackDenylist:\s*\[\/\^\\\/api\//)
 assert.match(recurring,/navigator\.onLine!==false/)
 assert.match(recurring,/cache:'no-store'/)
 assert.match(shared,/cache:'no-store'/)
 assert.doesNotMatch(recurring,/localStorage\.setItem|indexedDB\.open/)
 assert.doesNotMatch(shared,/localStorage\.setItem|indexedDB\.open/)
})
