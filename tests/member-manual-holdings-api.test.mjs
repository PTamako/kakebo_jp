import test from 'node:test'
import assert from 'node:assert/strict'
import {familyManualHoldings} from '../functions/api/family-finance/manual-holdings.js'
const member={user_id:'member-123',household_id:'home-123'}
const other={user_id:'different-person',household_id:'home-123'}
const fund='0331418A'
function harness(){
 const rows=new Map(),calls=[]
 const key=(hh,u,c,t)=>[hh,u,c,t].join(':')
 const db={
  prepare(sql){
   const ref={args:[],bind(...a){this.args=a;return this},
    async all(){
     const [hh,u]=this.args
     assert.match(sql,/owner_user_id=\?/)
     return {results:[...rows.values()].filter(x=>x.household_id===hh&&x.owner_user_id===u)}
    },
    async first(){
     const [hh,u,c,t]=this.args
     assert.match(sql,/owner_user_id=\?/)
     return rows.get(key(hh,u,c,t))||null
    },
    async run(){
     calls.push(sql)
     if(sql.startsWith('INSERT INTO family_member_manual_holdings')){
      const [hh,u,c,t,n,units,cost,created,updated]=this.args
      const k=key(hh,u,c,t)
      if(rows.has(k))throw Error('duplicate')
      rows.set(k,{household_id:hh,owner_user_id:u,fund_code:c,account_type:t,
       fund_name:n,units,acquisition_cost:cost,nav_per_10000:null,price_date:null,
       version:1,created_at:created,updated_at:updated})
      return {meta:{changes:1}}
     }
     if(sql.startsWith('UPDATE family_member_manual_holdings SET fund_name')){
      const [n,units,cost,updated,hh,u,c,t,ver]=this.args
      const k=key(hh,u,c,t),old=rows.get(k)
      if(!old||old.version!==ver)return {meta:{changes:0}}
      rows.set(k,{...old,fund_name:n,units,acquisition_cost:cost,version:ver+1,updated_at:updated})
      return {meta:{changes:1}}
     }
     if(sql.startsWith('UPDATE family_member_manual_holdings SET nav_per_10000')){
      const [nav,date,now,hh,u,c]=this.args
      let count=0
      for(const [k,row] of rows){
       if(row.household_id===hh&&row.owner_user_id===u&&row.fund_code===c){
        rows.set(k,{...row,nav_per_10000:nav,price_date:date,version:row.version+1,updated_at:now});count++
       }
      }
      return {meta:{changes:count}}
     }
     throw Error('Unexpected SQL')
    }}
   return ref
  }
 }
 return {db,rows,calls}
}
const uri='https://kakeibo.example/api/family-finance/manual-holdings'
async function call(method,sub,body,user,db){
 const url=new URL(uri+(sub?'/'+sub:''))
 const req=new Request(url,{method,headers:{
  origin:url.origin,...(body?{'content-type':'application/json'}:{})},
  body:body?JSON.stringify(body):undefined})
 return familyManualHoldings(req,{DB:db},url,user,['manual-holdings',...(sub?[sub]:[])])
}
const payload=(owner)=>({expected_user_id:owner.user_id,fundCode:fund,
 fundName:'オールカントリー',accountType:'tsumitate',units:10000,
 acquisitionCost:10000,expectedVersion:0})
test('member can add and read only her own holdings without ledger write',async()=>{
 const {db,rows,calls}=harness()
 let result=await call('PUT','holding',payload(member),member,db)
 assert.equal(result.status,200)
 let v=await result.json()
 assert.equal(v.ledger_changed,false)
 assert.equal(v.broker_ordered,false)
 assert.equal(rows.size,1)
 result=await call('GET','',null,member,db)
 v=await result.json()
 assert.equal(v.holdings.length,1)
 assert.equal(v.holdings[0].fund_name,'オールカントリー')
 assert.equal(v.holdings[0].market_value,null)
 result=await call('GET','',null,other,db)
 assert.equal((await result.json()).holdings.length,0)
 assert.equal(calls.some(sql=>/investment_holdings|INSERT INTO entries|UPDATE entries/.test(sql)),false)
})
test('bad actor and stale version cannot modify personal holdings',async()=>{
 const {db}=harness()
 let result=await call('PUT','holding',payload(other),member,db)
 assert.equal(result.status,403)
 assert.equal((await call('PUT','holding',payload(member),member,db)).status,200)
 result=await call('PUT','holding',payload(member),member,db)
 assert.equal(result.status,409)
 result=await call('PUT','holding',{...payload(member),expectedVersion:1,units:20000,acquisitionCost:20000},member,db)
 assert.equal(result.status,200)
 result=await call('PUT','holding',{...payload(other),expectedVersion:2},other,db)
 assert.equal(result.status,409)
})
