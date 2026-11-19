import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {handleVariableRecurring} from '../functions/api/variable-recurring.js'
const migration=readFileSync(new URL('../migrations/0109_variable_recurring_bills.sql',import.meta.url),'utf8')
const origin='https://kakeibo.example'
const uuid='11111111-1111-4111-8111-111111111111'
const other='22222222-2222-4222-8222-222222222222'
function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec("PRAGMA foreign_keys=ON;CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT);"+
  "CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,category TEXT,"+
  "merchant TEXT,note TEXT,raw TEXT,type TEXT,client_request_id TEXT UNIQUE,payment_source TEXT);")
 sql.exec(migration)
 const stmt=(query,args=[])=>({
  bind(...values){return stmt(query,values)},
  async first(){return sql.prepare(query).get(...args)||null},
  async all(){return {results:sql.prepare(query).all(...args)}},
  async run(){return {meta:{changes:sql.prepare(query).run(...args).changes}}},
  async execute(){
   if(/^\s*SELECT\b/i.test(query))return this.all()
   return this.run()
  }
 })
 const db={prepare:query=>stmt(query),async batch(queries){
  sql.exec('BEGIN')
  try{
   const results=[]
   for(const q of queries)results.push(await q.execute())
   sql.exec('COMMIT')
   return results
  }catch(e){sql.exec('ROLLBACK');throw e}
 }}
 const send=async (method,path,payload)=>{
  const headers=payload===undefined?{}:{'content-type':'application/json'}
  const req=new Request(origin+'/api/variable-recurring'+path,{method,headers,
   body:payload===undefined?undefined:JSON.stringify(payload)})
  const parts=['variable-recurring',...path.split('/').filter(Boolean)]
  const response=await handleVariableRecurring(req,db,parts)
  return {httpStatus:response.status,...await response.json()}
 }
 const plan=(id=uuid,overrides={})=>({id,name:'オクトパスエナジー',
  category:'光熱費',paymentSource:'現金',startMonth:'2026-11',intervalMonths:1,
  budgetJpy:null,enabled:true,...overrides})
 const bill=(periodMonth='2026-11',overrides={})=>({periodMonth,amountJpy:null,
  billDate:null,expenseDate:null,paidDate:null,serviceStart:null,serviceEnd:null,...overrides})
 return {sql,db,send,plan,bill}
}
test('draft variable bill has no ledger effect and does not require amount or payment date',async()=>{
 const f=fixture()
 assert.equal((await f.send('POST','',f.plan())).httpStatus,201)
 assert.equal((await f.send('POST','/'+uuid+'/bill',f.bill())).httpStatus,200)
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM entries').get().n,0)
 const list=await f.send('GET','')
 assert.equal(list.plans[0].budgetJpy,null)
 assert.equal(list.bills[0].status,'draft')
 assert.equal(list.bills[0].amountJpy,null)
 assert.equal((await f.send('POST','/'+uuid+'/confirm',{periodMonth:'2026-11'})).httpStatus,409)
})
test('explicit confirmation posts exactly once; replay never adds a second expense',async()=>{
 const f=fixture()
 await f.send('POST','',f.plan())
 const due=f.bill('2026-11',{amountJpy:6800,billDate:'2026-11-02',
  expenseDate:'2026-11-05',paidDate:'2026-12-02',serviceStart:'2026-10-01',
  serviceEnd:'2026-10-31'})
 assert.equal((await f.send('POST','/'+uuid+'/bill',due)).ok,true)
 const first=await f.send('POST','/'+uuid+'/confirm',{periodMonth:'2026-11'})
 assert.equal(first.posted,true)
 const second=await f.send('POST','/'+uuid+'/confirm',{periodMonth:'2026-11'})
 assert.equal(second.alreadyPosted,true)
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM entries').get().n,1)
 assert.equal(f.sql.prepare('SELECT amount FROM entries').get().amount,6800)
 assert.equal((await f.send('POST','/'+uuid+'/bill',due)).httpStatus,409)
})
test('existing document/manual expense blocks duplicate; bimonthly cannot create off-cycle bill',async()=>{
 const f=fixture()
 const p=f.plan(other,{name:'東京都水道局',intervalMonths:2})
 await f.send('POST','',p)
 assert.equal((await f.send('POST','/'+other+'/bill',f.bill('2026-12'))).httpStatus,400)
 f.sql.prepare("INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,payment_source) "+
 "VALUES('2026-11-08','',3100,'光熱費','東京都水道局','','','expense','現金')").run()
 await f.send('POST','/'+other+'/bill',f.bill('2026-11',
  {amountJpy:3100,expenseDate:'2026-11-05'}))
 const res=await f.send('POST','/'+other+'/confirm',{periodMonth:'2026-11'})
 assert.equal(res.httpStatus,409)
 assert.ok(res.conflictEntryId)
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM entries').get().n,1)
})
test('cannot change the cycle or anchor once a bill draft exists',async()=>{
 const f=fixture()
 await f.send('POST','',f.plan())
 await f.send('POST','/'+uuid+'/bill',f.bill())
 assert.equal((await f.send('PUT','/'+uuid,f.plan(uuid,{intervalMonths:2}))).httpStatus,409)
 assert.equal((await f.send('PUT','/'+uuid,f.plan(uuid,{startMonth:'2026-10'}))).httpStatus,409)
})
test('the existing fixed-cost screen keeps its legacy posting path and embeds variable bills',()=>{
 const finance=readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
 const editor=readFileSync(new URL('../src/VariableRecurringCosts.vue',import.meta.url),'utf8')
 const auth=readFileSync(new URL('../functions/api/[[path]].js',import.meta.url),'utf8')
 assert.match(finance,/<VariableRecurringCosts v-if="managementTab==='plans'/)
 assert.match(editor,/確認して記帳/)
 assert.match(editor,/文書助手/)
 assert.match(auth,/handleVariableRecurring\(request,db,params\.path/)
})
