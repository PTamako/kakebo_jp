import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { onRequest } from '../functions/api/[[path]].js'

const session = 'a'.repeat(64)
const sig = 'v1:0123456789abcdef'
const url = 'https://kakeibo-f17.pages.dev/api/review-notices'

function mockDb({ migrated = true } = {}) {
  const keys = new Set(), sqlLog = []
  const db = {
    keys, sqlLog,
    prepare(sql) {
      const statement = {
        sql,
        args:[],
        bind(...args) { this.args=args;return this },
        async first() {
          sqlLog.push(sql)
          if (sql.includes('FROM device_sessions')) return {token_hash:'valid'}
          throw Error('Unexpected first: '+sql)
        },
        async all() {
          sqlLog.push(sql)
          if (!migrated) throw Error('D1_ERROR: no such table: review_notice_states')
          if (sql.startsWith('SELECT notice_key FROM review_notice_states'))
            return {results:[...keys].sort().map(notice_key => ({notice_key}))}
          throw Error('Unexpected all: '+sql)
        },
        async run() {
          sqlLog.push(sql)
          if (!migrated) throw Error('D1_ERROR: no such table: review_notice_states')
          if (sql.startsWith('INSERT OR IGNORE INTO review_notice_states')) keys.add(this.args[0])
          else if (sql.startsWith('DELETE FROM review_notice_states')) keys.delete(this.args[0])
          else throw Error('Unexpected run: '+sql)
          return {meta:{changes:1}}
        }
      }
      return statement
    },
    async batch(statements) {
      const output=[]
      for (const statement of statements) output.push(await statement.run())
      return output
    }
  }
  return db
}
async function request(db, method='GET', payload, headers={'x-session':session}) {
  const response=await onRequest({
    request:new Request(url,{method,headers:{...headers,...(payload ? {'content-type':'application/json'} : {})},
      ...(payload ? {body:JSON.stringify(payload)} : {})}),
    env:{AUTH_TOKEN:'test-only-token',DB:db},params:{path:['review-notices']}
  })
  return {status:response.status,body:await response.json()}
}
test('review notices survive a new PWA install because D1 holds all confirmation and archive keys',async()=>{
  const db=mockDb()
  assert.deepEqual((await request(db)).body,{keys:[]})
  assert.deepEqual((await request(db,'PUT',{add:['c:'+sig,'d:'+sig],remove:[]})).body,{ok:true,count:2})
  // A freshly installed PWA has no localStorage; another read still returns all keys.
  assert.deepEqual((await request(db)).body.keys,['c:'+sig,'d:'+sig])
  assert.equal((await request(db,'PUT',{add:[],remove:['d:'+sig]})).status,200)
  assert.deepEqual((await request(db)).body.keys,['c:'+sig])
  assert.equal((await request(db,'PUT',{add:[],remove:['c:'+sig]})).status,200)
  assert.deepEqual((await request(db)).body.keys,[])
  assert.ok(db.sqlLog.every(sql=>!/(INSERT INTO entries|DELETE FROM entries|UPDATE entries)/i.test(sql)))
})
test('review-notice API rejects malformed keys and unauthenticated writes',async()=>{
  const db=mockDb()
  assert.equal((await request(db,'PUT',{add:['bad-key'],remove:[]})).status,400)
  assert.equal((await request(db,'PUT',{add:['c:'+sig],remove:['c:'+sig]})).status,400)
  assert.equal((await request(db,'PUT',{add:['c:'+sig],remove:[]},{ })).status,401)
  assert.deepEqual([...db.keys],[])
})
test('missing migration fails closed rather than silently saving notices on the device',async()=>{
  const db=mockDb({migrated:false})
  const result=await request(db)
  assert.equal(result.status,503)
  assert.equal(result.body.code,'review_schema_required')
  assert.deepEqual([...db.keys],[])
})
test('app uses only D1 review state; no startup backfill of old localStorage markers',()=>{
  const finance=readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
  const api=readFileSync(new URL('../functions/api/[[path]].js',import.meta.url),'utf8')
  assert.match(finance,/await loadReviewState\(\)/)
  assert.match(finance,/await writeReviewNotices\(\[key\]\)/)
  assert.doesNotMatch(finance,/(readArchivedTrash|saveArchivedTrash|readConfirmedDuplicateGroups|saveConfirmedDuplicateGroups)\(/)
  assert.match(api,/SELECT notice_key FROM review_notice_states/)
  assert.doesNotMatch(api,/CREATE TABLE IF NOT EXISTS review_notice_states/)
})
