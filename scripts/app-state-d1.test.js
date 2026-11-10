import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { onRequest } from '../functions/api/[[path]].js'

const token='b'.repeat(64)
const stateUrl='https://kakeibo-f17.pages.dev/api/app-state'
function database(migrated = true) {
  const values=new Map(),queries=[]
  const db={values,queries,
    prepare(sql) {
      const stmt={sql,args:[],
        bind(...args){this.args=args;return this},
        async first() {
          queries.push(sql)
          if(sql.includes('FROM device_sessions'))return {token_hash:'active'}
          throw Error('unexpected select '+sql)
        },
        async all(){
          queries.push(sql)
          if(!migrated)throw Error('D1_ERROR: no such table: app_client_state')
          if(sql==='SELECT state_key,value_json FROM app_client_state')
            return {results:[...values].map(([state_key,value_json])=>({state_key,value_json}))}
          throw Error('unexpected query '+sql)
        },
        async run(){
          queries.push(sql)
          if(!migrated)throw Error('D1_ERROR: no such table: app_client_state')
          if(sql.startsWith('INSERT INTO app_client_state')) {
            if(sql.includes("'remember_device'"))values.set('remember_device',this.args[0])
            else values.set(this.args[0],this.args[1])
          }
          else if(sql.startsWith('DELETE FROM app_client_state'))values.delete(this.args[0])
          else if(sql.startsWith('DELETE FROM device_sessions'))db.revocations=(db.revocations||0)+1
          else throw Error('unexpected mutation '+sql)
          return {meta:{changes:1}}
        }
      }
      return stmt
    }
  }
  return db
}
async function send(db,method='GET',body,url=stateUrl,headers={'x-session':token}){
  const request=new Request(url,{method,headers:{...headers,...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})})
  const response=await onRequest({request,env:{AUTH_TOKEN:'test',DB:db},params:{path:['app-state']}})
  return {status:response.status,body:await response.json()}
}
test('D1 saves cloud drafts and remember-device state, never local-only preferences',async()=>{
  const db=database()
  const draft={updatedAt:Date.now(),mode:'manual',input:'試験',forms:[{date:'2026-10-30',merchant:'Suicaチャージ',amount:1000}]}
  assert.equal((await send(db,'PUT',{key:'ai_ocr_enabled',value:true})).status,400)
  assert.equal((await send(db,'PUT',{key:'remember_device',value:false})).status,200)
  assert.equal((await send(db,'PUT',{key:'fx_currency',value:'CNY'})).status,400)
  assert.equal((await send(db,'PUT',{key:'unsaved_draft',value:draft})).status,200)
  // PWA reinstall has no browser storage but the D1 object remains.
  assert.deepEqual((await send(db)).body,{remember_device:false,unsaved_draft:draft})
  assert.equal((await send(db,'DELETE',null,stateUrl+'?key=unsaved_draft')).status,200)
  assert.equal('unsaved_draft' in (await send(db)).body,false)
  assert.ok(db.queries.every(q=>!/(INSERT INTO entries|UPDATE entries|DELETE FROM entries)/i.test(q)))
})
test('D1 app state prevents invalid and overlarge drafts without mutation',async()=>{
  const db=database()
  assert.equal((await send(db,'PUT',{key:'theme',value:'blue'})).status,400)
  assert.equal((await send(db,'PUT',{key:'unsaved_draft',value:{input:'bad',mode:'manual',forms:[]}})).status,200)
  assert.equal((await send(db,'PUT',{key:'unsaved_draft',value:{input:'x'.repeat(100001),mode:'manual',forms:[]}})).status,400)
  assert.equal((await send(db,'PUT',{key:'unknown',value:'x'})).status,400)
  assert.equal((await send(db,'PUT',{key:'unsaved_draft',value:{input:'private',mode:'manual',forms:[]}},stateUrl,{})).status,401)
})
test('HttpOnly cookie can access D1 without any persistent JavaScript browser token',async()=>{
  const db=database()
  const result=await send(db,'PUT',{key:'unsaved_draft',value:{updatedAt:Date.now(),mode:'manual',input:'認証済み',forms:[]}},stateUrl,{cookie:'kakeibo_session='+token})
  assert.equal(result.status,200)
  assert.equal((await send(db,'GET',null,stateUrl,{cookie:'kakeibo_session='+token})).body.unsaved_draft.input,'認証済み')
})
test('image-storage preference and cookie policy are committed together in D1',async()=>{
  const db=database()
  const response=await onRequest({
    request:new Request('https://kakeibo-f17.pages.dev/api/auth/remember',{
      method:'PUT',headers:{cookie:'kakeibo_session='+token,'content-type':'application/json'},
      body:JSON.stringify({remember:false})
    }),
    env:{AUTH_TOKEN:'test',DB:db},params:{path:['auth','remember']}
  })
  assert.equal(response.status,200)
  assert.equal(JSON.parse(db.values.get('remember_device')),false)
  assert.match(response.headers.get('set-cookie')||'',/kakeibo_session=.*HttpOnly/)
  assert.doesNotMatch(response.headers.get('set-cookie')||'',/Max-Age=/)
  // A missing D1 table must not issue a new cookie or silently store the preference locally.
  const failed=await onRequest({
    request:new Request('https://kakeibo-f17.pages.dev/api/auth/remember',{
      method:'PUT',headers:{'x-session':token,'content-type':'application/json'},
      body:JSON.stringify({remember:false})
    }),
    env:{AUTH_TOKEN:'test',DB:database(false)},params:{path:['auth','remember']}
  })
  assert.equal(failed.status,503)
  assert.equal(failed.headers.get('set-cookie'),null)
  const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
  const handler=app.match(/async function setRememberDevice\(remember\) \{([\s\S]*?)\n\}/)?.[1]||''
  assert.match(handler,/api\('auth\/remember'/)
  assert.doesNotMatch(handler,/api\('app-state'/)
})
test('cookie-only logout revokes the server-side D1 session and clears the cookie',async()=>{
  const db=database()
  const response=await onRequest({
    request:new Request('https://kakeibo-f17.pages.dev/api/auth/logout',{
      method:'POST',headers:{cookie:'kakeibo_session='+token}
    }),
    env:{AUTH_TOKEN:'test',DB:db},params:{path:['auth','logout']}
  })
  assert.equal(response.status,200)
  assert.equal(db.revocations,1)
  assert.match(response.headers.get('set-cookie')||'',/kakeibo_session=;.*HttpOnly.*Max-Age=0/)
  const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
  const logout=app.match(/async function logout\(\) \{([\s\S]*?)\n\}/)?.[1]||''
  assert.match(logout,/await completeServerLogout\(oldSession\)/)
  assert.match(app,/async function completeServerLogout\(oldSession=''/)
  assert.match(app,/fetch\('\/api\/auth\/logout'/)
  assert.match(app,/serverLogoutPending\.value=true/)
  assert.match(app,/localStorage\.setItem\(PENDING_LOGOUT_KEY,'1'\)/)
  assert.doesNotMatch(logout,/if \(oldSession\)/)
})
test('missing migration cannot silently fall back to browser state',async()=>{
  const result=await send(database(false))
  assert.equal(result.status,503)
  assert.equal(result.body.code,'app_state_schema_required')
})
test('only theme, AI consent and FX currency use localStorage, never D1',()=>{
  const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
  const amount=readFileSync(new URL('../src/AmountInput.vue',import.meta.url),'utf8')
  const api=readFileSync(new URL('../functions/api/[[path]].js',import.meta.url),'utf8')
  assert.match(app,/localStorage\.getItem\('kakeibo-theme'\)/)
  assert.match(app,/localStorage\.getItem\(OCR_PREF_KEY\)/)
  assert.match(app,/localStorage\.setItem\(OCR_PREF_KEY, String\(checked === true\)\)/)
  assert.match(amount,/localStorage\.getItem\(CURRENCY_PREF_KEY\)/)
  assert.match(amount,/localStorage\.setItem\(CURRENCY_PREF_KEY, selected\)/)
  assert.doesNotMatch(app,/key:'ai_ocr_enabled'|key:'fx_currency'|localStorage\.setItem\(DRAFT_KEY/)
  assert.doesNotMatch(amount,/appContext\.api\('app-state'/)
  assert.match(api,/new Set\(\['remember_device','unsaved_draft'\]\)/)
  const paths=['src/FinanceTools.vue','src/receipt-store.js','src/duplicate-review.js','src/review-trash.js']
  for (const file of paths) {
    const source=readFileSync(new URL('../'+file,import.meta.url),'utf8')
    assert.doesNotMatch(source,/\blocalStorage\b/,file)
  }
})

test('cloud D1 storage ignores legacy OCR and currency rows even if still present',async()=>{
  const db=database()
  db.values.set('ai_ocr_enabled','true')
  db.values.set('fx_currency','"USD"')
  const state=await send(db)
  assert.equal(state.status,200)
  assert.deepEqual(state.body,{})
  assert.equal(db.values.size,2,'existing settings remain unmodified')
})
