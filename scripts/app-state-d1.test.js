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
          if(sql.startsWith('INSERT INTO app_client_state'))values.set(this.args[0],this.args[1])
          else if(sql.startsWith('DELETE FROM app_client_state'))values.delete(this.args[0])
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
test('D1 saves OCR opt-in and drafts across PWA reinstallation',async()=>{
  const db=database()
  const draft={updatedAt:Date.now(),mode:'manual',input:'試験',forms:[{date:'2026-10-30',merchant:'Suicaチャージ',amount:1000}]}
  assert.equal((await send(db,'PUT',{key:'ai_ocr_enabled',value:true})).status,200)
  assert.equal((await send(db,'PUT',{key:'remember_device',value:false})).status,200)
  assert.equal((await send(db,'PUT',{key:'fx_currency',value:'CNY'})).status,200)
  assert.equal((await send(db,'PUT',{key:'unsaved_draft',value:draft})).status,200)
  // PWA reinstall has no browser storage but the D1 object remains.
  assert.deepEqual((await send(db)).body,{ai_ocr_enabled:true,remember_device:false,fx_currency:'CNY',unsaved_draft:draft})
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
  assert.equal((await send(db,'PUT',{key:'fx_currency',value:'USD'},stateUrl,{})).status,401)
})
test('HttpOnly cookie can access D1 without any persistent JavaScript browser token',async()=>{
  const db=database()
  const result=await send(db,'PUT',{key:'fx_currency',value:'EUR'},stateUrl,{cookie:'kakeibo_session='+token})
  assert.equal(result.status,200)
  assert.equal((await send(db,'GET',null,stateUrl,{cookie:'kakeibo_session='+token})).body.fx_currency,'EUR')
})
test('missing migration cannot silently fall back to browser state',async()=>{
  const result=await send(database(false))
  assert.equal(result.status,503)
  assert.equal(result.body.code,'app_state_schema_required')
})
test('only device theme uses localStorage; all other reviewed modules remain D1-backed',()=>{
  const paths=['src/FinanceTools.vue','src/AmountInput.vue','src/receipt-store.js','src/duplicate-review.js','src/review-trash.js']
  const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
  const api=readFileSync(new URL('../functions/api/[[path]].js',import.meta.url),'utf8')
  assert.match(app,/localStorage\.getItem\('kakeibo-theme'\)/)
  assert.match(app,/localStorage\.setItem\('kakeibo-theme', value\)/)
  assert.equal((app.match(/localStorage\./g)||[]).length,2)
  assert.doesNotMatch(app,/key:'theme'/)
  assert.doesNotMatch(app,/state\.theme/)
  assert.doesNotMatch(api,/body\.key === 'theme'/)
  for(const file of paths){
    const source=readFileSync(new URL('../'+file,import.meta.url),'utf8')
    assert.doesNotMatch(source,/\blocalStorage\b/,file)
  }
})
