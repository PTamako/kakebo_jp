import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {restoreAtomic} from '../functions/api/restore-atomic.js'
import {onRequest} from '../functions/api/[[path]].js'

class D1 {
  constructor(){
    this.sqlite=new DatabaseSync(':memory:')
    this.sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'))
  }
  prepare(sql){
    const statement=this.sqlite.prepare(sql)
    const query={args:[],bind(...args){this.args=args;return this}}
    query.first=async()=>statement.get(...query.args)||null
    query.all=async()=>({results:statement.all(...query.args)})
    query.run=async()=>{
      const result=statement.run(...query.args)
      return {success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}}
    }
    return query
  }
  async batch(statements){
    this.sqlite.exec('BEGIN IMMEDIATE')
    try{
      const results=[]
      for(const statement of statements)results.push(await statement.run())
      this.sqlite.exec('COMMIT')
      return results
    }catch(e){
      this.sqlite.exec('ROLLBACK')
      throw e
    }
  }
  close(){this.sqlite.close()}
}
const archived=(id,merchant,clientId,extras={})=>{
  const entry={
    id,date:'2026-10-02',time:'',amount:250,category:'日用品',
    merchant,note:'',raw:'',type:'expense',transfer_target:null,
    transfer_applied:0,transfer_date:null,client_request_id:clientId,
    payment_source:'現金',...extras
  }
  return {item_id:String(id),deleted_at:'2026-10-03 12:00:00',
    payload_json:JSON.stringify({entry,purchaseMonth:null,dismissed:false,recurringSkip:null})}
}
const archive=(items,extras={})=>({
  format:'kakeibo-ledger-backup',version:4,entries:[],trashedEntries:items,...extras
})
const trash=db=>db.sqlite.prepare("SELECT item_id,payload_json FROM trash_items WHERE item_type='entry' ORDER BY CAST(item_id AS INTEGER)").all()

test('restore preserves a conflicting deleted entry, never overwriting a live row, and retries are idempotent',async()=>{
  const db=new D1()
  try{
    db.sqlite.prepare("INSERT INTO entries(id,date,amount,type,merchant) VALUES(1,'2026-10-02',300,'expense','existing')").run()
    const a=archive([archived(1,'deleted source A','deleted_source_1')])
    assert.equal((await restoreAtomic(db,a)).settings,1)
    assert.equal(db.sqlite.prepare('SELECT merchant FROM entries WHERE id=1').get().merchant,'existing')
    const saved=trash(db)
    assert.equal(saved.length,1)
    assert.notEqual(saved[0].item_id,'1')
    assert.equal(JSON.parse(saved[0].payload_json).entry.id,Number(saved[0].item_id))
    assert.equal((await restoreAtomic(db,a)).settings,0)
    assert.equal(trash(db).length,1)
    // A separately deleted record with the same source ID is NOT lost.
    assert.equal((await restoreAtomic(db,archive([archived(1,'deleted source B','deleted_source_2')]))).settings,1)
    assert.equal(trash(db).length,2)
    assert.deepEqual(trash(db).map(x=>JSON.parse(x.payload_json).entry.merchant),
      ['deleted source A','deleted source B'])
  }finally{db.close()}
})

test('portable trash identity stays stable through multiple backup generations',async()=>{
  const a=new D1(),b=new D1()
  try{
    a.sqlite.prepare("INSERT INTO entries(id,date,amount,type) VALUES(1,'2026-10-02',100,'expense')").run()
    b.sqlite.prepare("INSERT INTO entries(id,date,amount,type) VALUES(1,'2026-10-02',100,'expense')").run()
    const source=archive([archived(1,'archived memory','memory_import_0001')])
    await restoreAtomic(a,source)
    const copied=trash(a)[0]
    await restoreAtomic(b,archive([{...copied,deleted_at:source.trashedEntries[0].deleted_at}]))
    assert.equal(trash(b).length,1)
    assert.equal((await restoreAtomic(b,source)).settings,0)
    assert.equal(trash(b).length,1)
  }finally{a.close();b.close()}
})

test('server rejects over-limit recurring day exclusions before any writes',async()=>{
  const db=new D1()
  try{
    const exclusions=Array.from({length:501},(_,i)=>({
      planId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      date:'2026-01-'+String(i%28+1).padStart(2,'0')
    }))
    await assert.rejects(()=>restoreAtomic(db,archive([],{recurringDateExclusions:exclusions})),/atomic_restore_too_large/)
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM trash_items').get().n,0)
  }finally{db.close()}
})

test('restoring re-IDed point reward restores its paired charge together',async()=>{
  const db=new D1()
  try{
    // Both source IDs collide with live records in the target database.
    db.sqlite.prepare("INSERT INTO entries(id,date,amount,type) VALUES(1,'2026-10-02',100,'expense')").run()
    db.sqlite.prepare("INSERT INTO entries(id,date,amount,type) VALUES(2,'2026-10-02',200,'expense')").run()
    const income=archived(1,'ポイント', 'reward_link_0001',{
      type:'income',category:'ポイント還元',payment_source:'ポイント還元',
      transfer_target:'prepaid:Suica'
    })
    const charge=archived(2,'Suicaチャージ','point_charge_reward_link_0001',{
      type:'transfer',category:'投資・資産移動',payment_source:'ポイント還元',
      transfer_target:'prepaid:Suica',transfer_date:'2026-10-02'
    })
    const saved=JSON.parse(income.payload_json)
    saved.pairedEntryId=2
    income.payload_json=JSON.stringify(saved)
    assert.equal((await restoreAtomic(db,archive([income,charge]))).settings,2)
    const rows=trash(db)
    const parent=rows.map(x=>JSON.parse(x.payload_json).entry).find(x=>x.type==='income')
    const child=rows.map(x=>JSON.parse(x.payload_json).entry).find(x=>x.type==='transfer')
    assert.ok(parent.id>2 && child.id>2 && parent.id!==child.id)
    const session='a'.repeat(64),tokenHash=createHash('sha256').update(session).digest('hex')
    db.sqlite.prepare('INSERT INTO device_sessions(token_hash,expires_at) VALUES(?,?)')
      .run(tokenHash,Date.now()+3600000)
    const response=await onRequest({
      request:new Request('https://kakeibo-f17.pages.dev/api/trash-items/'+parent.id+'/restore',{
        method:'POST',headers:{'x-session':session}
      }),env:{DB:db,AUTH_TOKEN:'test'},params:{path:['trash-items',String(parent.id),'restore']}
    })
    assert.equal(response.status,200,await response.text())
    assert.equal(trash(db).length,0)
    const restoredParent=db.sqlite.prepare('SELECT id FROM entries WHERE id=?').get(parent.id)
    assert.ok(restoredParent)
    const restoredChild=db.sqlite.prepare('SELECT id,client_request_id FROM entries WHERE id=?').get(child.id)
    assert.equal(restoredChild.client_request_id,'point_charge_reward_link_0001')
  }finally{db.close()}
})
