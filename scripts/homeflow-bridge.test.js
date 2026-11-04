import assert from 'node:assert/strict'
import test from 'node:test'
import {DatabaseSync} from 'node:sqlite'
import {onRequestGet} from '../functions/api/homeflow-bridge.js'
const token='local-test-token-not-for-production-very-long'
const base='https://kakeibo-f17.pages.dev/api/homeflow-bridge'
function db(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec(`CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT NOT NULL,amount INTEGER NOT NULL,
  category TEXT,merchant TEXT,type TEXT);CREATE INDEX idx_entries_date ON entries(date);
  INSERT INTO entries VALUES(1,'2026-11-01',2000,'交通費','JR','expense');
  INSERT INTO entries VALUES(2,'2026-11-02',1500,'食費','スーパー','expense');
  INSERT INTO entries VALUES(3,'2026-11-02',3000,'資産移動','SBI','transfer');
  INSERT INTO entries VALUES(4,'2026-12-01',10000,'娯楽','旅行','expense');`)
 return {prepare(sql){const stmt=sqlite.prepare(sql);let args=[];return {bind(...a){args=a;return this},
  async all(){return {results:stmt.all(...args)}}}},close(){sqlite.close()},explain:()=>sqlite.prepare(
    "EXPLAIN QUERY PLAN SELECT id FROM entries WHERE date>=? AND date<=? AND type='expense' LIMIT 200").all('2026-11-01','2026-11-03')}
}
function request(url=base+'?from=2026-11-01&to=2026-11-03',sent=token){
 const headers=sent?{'x-homeflow-bridge-token':sent}:{}
 return new Request(url,{headers})
}
test('fails closed if no token, wrong token or Pages preview',async()=>{
 const a=await onRequestGet({request:request(),env:{}})
 assert.equal(a.status,503)
 const b=await onRequestGet({request:request(undefined,'wrong'),env:{HOMEFLOW_BRIDGE_TOKEN:token}})
 assert.equal(b.status,401)
 const custom=await onRequestGet({request:request('https://custom.example/api/homeflow-bridge?from=2026-11-01&to=2026-11-03'),env:{HOMEFLOW_BRIDGE_TOKEN:token}})
 assert.equal(custom.status,403)
 const c=await onRequestGet({request:request('https://preview.kakeibo-f17.pages.dev/api/homeflow-bridge?from=2026-11-01&to=2026-11-03'),env:{HOMEFLOW_BRIDGE_TOKEN:token}})
 assert.equal(c.status,403)
})
test('read only date range excludes transfers, income and other periods',async()=>{
 const d=db()
 const r=await onRequestGet({request:request(),env:{DB:d,HOMEFLOW_BRIDGE_TOKEN:token}})
 assert.equal(r.status,200)
 const x=await r.json()
 assert.deepEqual(x.items.map(y=>y.id),[1,2])
 assert.equal(x.items[0].raw,undefined)
 assert.equal(x.items[0].note,undefined)
 const explain=d.explain()
 assert.ok(explain.some(y=>String(y.detail).includes('idx_entries_date')))
 d.close()
})
test('invalid dates and >31 day windows are rejected',async()=>{
 const env={HOMEFLOW_BRIDGE_TOKEN:token}
 for(const path of ['?from=2026-02-30&to=2026-03-02','?from=2026-01-01&to=2026-03-01']){
  const r=await onRequestGet({request:request(base+path),env})
  assert.equal(r.status,400)
 }
})
