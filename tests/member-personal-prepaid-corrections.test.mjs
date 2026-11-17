import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {familyMemberPrepaidTopupCorrections} from '../functions/api/family-finance/member-prepaid-topup-corrections.js';
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const uid='member',household='household',a='a'.repeat(32),b='b'.repeat(32),topupId='c'.repeat(32);
const user={user_id:uid,household_id:household,role:'member'};
const env={APP_ENV:'production',KAKEIBO_PERSONAL_PREPAID_TOPUPS_ENABLED:'true',
 KAKEIBO_PERSONAL_PREPAID_TOPUP_CORRECTIONS_ENABLED:'true'};
const original={request_id:topupId,household_id:household,owner_user_id:uid,
 prepaid_account_id:a,amount_jpy:5000,effective_date:'2026-10-10',created_at:1};
function fixture(){
 const corrections=[];
 const queries=[];
 const db={prepare(sql){
  return {bind(...args){queries.push({sql,args});
   return {
    first:async()=>{
     if(sql.includes('SELECT 1 AS yes FROM homeflow_identity_links'))return {yes:1};
     if(sql.includes('FROM family_member_prepaid_topup_corrections WHERE idempotency_hash=?'))
      return corrections.find(x=>x.idempotency_hash===args[0])||null;
     if(sql.includes('SELECT t.*,c.revision')) {
      if(args[0]!==topupId||args[1]!==household||args[2]!==uid)return null;
      const c=corrections.at(-1);
      return {...original,...(c?{revision:c.revision,after_account_id:c.after_account_id,
       after_amount_jpy:c.after_amount_jpy,after_effective_date:c.after_effective_date}:{})};
     }
     if(sql.includes('SELECT account_id FROM family_financial_accounts'))
      return args[0]===b&&args[1]===household&&args[2]===uid&&args[3]===1?{account_id:b}:null;
     if(sql.includes('SELECT MAX(revision)'))return {revision:corrections.at(-1)?.revision||0};
     throw Error('Unexpected query '+sql);
    },
    all:async()=>{
     if(sql.includes('FROM family_member_prepaid_topups t LEFT JOIN'))
      return {results:[{...original}]};
     throw Error('Unexpected query '+sql);
    },
    run:async()=>{
     if(!sql.includes('INSERT INTO family_member_prepaid_topup_corrections'))
      throw Error('Unexpected mutation '+sql);
     if(corrections.length)return {meta:{changes:0}};
     const [correction_id,topup_request_id,household_id,owner_user_id,revision,
      before_account_id,after_account_id,after_account_version,before_amount_jpy,
      after_amount_jpy,before_effective_date,after_effective_date,reason,idempotency_hash,
      created_at]=args;
     corrections.push({correction_id,topup_request_id,household_id,owner_user_id,revision,
      before_account_id,after_account_id,after_account_version,before_amount_jpy,
      after_amount_jpy,before_effective_date,after_effective_date,reason,idempotency_hash,created_at});
     return {meta:{changes:1}};
    }
   };
  }};
 }};
 return {db,queries,corrections};
}
function mutation(idempotency_key='correction:request-00001'){
 const payload={expected_user_id:uid,expected_revision:0,idempotency_key,
  prepaid_account_id:b,prepaid_version:1,amount_jpy:3000,effective_date:'2026-10-11',
  reason:'実際のチャージ額を訂正',confirmed:true};
 return new Request('https://example.com/api/family-finance/member-prepaid-topup-corrections/'+topupId,{
  method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},
  body:JSON.stringify(payload)});
}
test('posted personal topup correction preserves source, posts exactly one two-sided immutable event and is replayable',async()=>{
 const {db,queries,corrections}=fixture(),url=new URL(mutation().url);
 const first=await familyMemberPrepaidTopupCorrections(mutation(),{...env,DB:db},url,user,['member-prepaid-topup-corrections',topupId]);
 assert.equal(first.status,200);
 const r=await first.json();
 assert.equal(r.scope,'personal');
 assert.equal(r.correction.amount_jpy,3000);
 assert.equal(r.correction.prepaid_account_id,b);
 assert.equal(r.correction.correction_revision,1);
 assert.equal(r.ledger_changed,false);
 assert.equal(corrections.length,1);
 assert.deepEqual(corrections.map(c=>[c.before_account_id,c.before_amount_jpy,c.after_account_id,c.after_amount_jpy]),[[a,5000,b,3000]]);
 const again=await familyMemberPrepaidTopupCorrections(mutation(),{...env,DB:db},url,user,['member-prepaid-topup-corrections',topupId]);
 assert.equal((await again.json()).replayed,true);
 assert.equal(corrections.length,1);
 assert.ok(queries.every(x=>!x.sql.includes('UPDATE family_member_prepaid_topups')));
 assert.ok(queries.every(x=>!x.sql.includes('INSERT INTO entries')));
});
test('correction endpoint blocks foreign accounts and preserves independent owner scope',async()=>{
 const {db,corrections}=fixture(),req=mutation();
 const foreign=JSON.parse(await req.clone().text());foreign.prepaid_version=2;
 const r=new Request(req.url,{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},
  body:JSON.stringify(foreign)});
 const response=await familyMemberPrepaidTopupCorrections(r,{...env,DB:db},new URL(r.url),user,
  ['member-prepaid-topup-corrections',topupId]);
 assert.equal(response.status,409);
 assert.equal((await response.json()).code,'CORRECTION_TARGET_NOT_OWNED');
 assert.equal(corrections.length,0);
});
test('all prepaid projections and original form include owner-correction accounting',()=>{
 for(const file of ['functions/api/family-finance/prepaid-balance-projection.js',
  'functions/api/family-finance/prepaid-actions.js','functions/api/family-finance/prepaid-report.js']){
  assert.match(source(file),/family_member_prepaid_topup_corrections/);
 }
 const migration=source('migrations/0075_member_prepaid_topup_corrections.sql');
 assert.match(migration,/UNIQUE\(topup_request_id,revision\)/);
 assert.match(migration,/trg_member_topup_correction_guard/);
 assert.match(migration,/PERSONAL_TOPUP_CORRECTION_STALE_OR_OVERDRAW/);
 assert.match(migration,/TRIGGER trg_family_prepaid_balance_atomic/);
 const input=source('src/EntryInputPage.vue'),member=source('src/FamilyMemberWorkspace.vue');
 assert.match(input,/personalAssetActionsEnabled/);
 assert.match(input,/<slot name="personal-transfer"\/>/);
 assert.match(member,/<template #personal-transfer>/);
 assert.match(member,/<MemberPointAssetActions/);
 assert.match(member,/<MemberPrepaidTopups/);
 assert.match(member,/personalAssetActionsEnabled:computed\(\(\)=>true\)/);
 const page=member.split('<template #member-cards>')[1]?.split('<template #member-plans>')[0]||'';
 assert.doesNotMatch(page,/<MemberPrepaidTopups|<MemberPointAssetActions/);
});

test('real SQLite trigger atomically reverses old prepaid account and recredits new one',async()=>{
 const sql=new DatabaseSync(':memory:');
 try{
  sql.exec('PRAGMA foreign_keys=ON');
  for(const name of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
    '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql'])
    sql.exec(source('migrations/'+name));
  sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,'+
    'category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,transfer_target TEXT,'+
    'transfer_applied INTEGER,transfer_date TEXT,client_request_id TEXT UNIQUE,'+
    'payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT)');
  for(const name of ['0031_family_card_purchase_execution.sql',
    '0032_family_card_settlement_foundation.sql','0033_member_prepaid_actions.sql',
    '0034_family_points_foundation.sql','0035_points_prepaid_atomic.sql',
    '0036_points_card_offset.sql','0037_points_transfer_exchange.sql',
    '0038_points_earn_expiry_reversals.sql','0040_points_sbi_lots.sql',
    '0041_points_transfer_atomic_refund.sql','0042_points_prepaid_refund.sql',
    '0072_member_personal_prepaid_topups.sql','0075_member_prepaid_topup_corrections.sql'])
   sql.exec(source('migrations/'+name));
  const actor='22222222-2222-4222-8222-222222222222',house='primary',
    first='a'.repeat(32),second='b'.repeat(32),tid='c'.repeat(32);
  sql.prepare('INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)')
   .run(actor,house,'member','member','active',Date.now());
  for(const accountId of [first,second]){
   sql.prepare('INSERT INTO family_financial_accounts '+
    '(account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) '+
    "VALUES (?,?,?,?,?,'member_created',?,?)")
    .run(accountId,house,actor,accountId,'prepaid',actor,actor);
  }
  sql.prepare('INSERT INTO family_member_prepaid_topups '+
   '(request_id,household_id,owner_user_id,prepaid_account_id,prepaid_version,'+
   'idempotency_hash,amount_jpy,effective_date,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(tid,house,actor,first,1,'e'.repeat(64),5000,'2026-11-14',Date.now());
  const database={prepare(query){return {bind(...params){return {
   first:async()=>sql.prepare(query).get(...params)||null,
   all:async()=>({results:sql.prepare(query).all(...params)}),
   run:async()=>({meta:{changes:sql.prepare(query).run(...params).changes}})
  }}}}};
  const {memberPrepaidBalances}=await import('../functions/api/family-finance/prepaid-balance-projection.js');
  const balances=async()=>memberPrepaidBalances(database,house);
  const originalBalances=await balances();
  assert.equal(originalBalances.total_jpy,5000);
  assert.deepEqual(originalBalances.accounts.map(x=>[x.account_id,x.balance_jpy]),[[first,5000],[second,0]]);
  const requestUrl=new URL('https://example.com/api/family-finance/member-prepaid-topup-corrections/'+tid);
  const wire={expected_user_id:actor,expected_revision:0,
   idempotency_key:'prepaid-correction:sqlite-00001',
   prepaid_account_id:second,prepaid_version:1,amount_jpy:3000,
   effective_date:'2026-11-15',reason:'原金額とカードを訂正',confirmed:true};
  const req=()=>new Request(requestUrl,{method:'POST',
   headers:{origin:requestUrl.origin,'content-type':'application/json'},
   body:JSON.stringify(wire)});
  const e={...env,DB:database},u={user_id:actor,household_id:house,role:'member'};
  const result=await familyMemberPrepaidTopupCorrections(req(),e,requestUrl,u,
   ['member-prepaid-topup-corrections',tid]);
  assert.equal(result.status,200,await result.clone().text());
  assert.equal((await result.json()).correction.correction_revision,1);
  const after=await balances();
  assert.equal(after.total_jpy,3000);
  assert.deepEqual(after.accounts.map(x=>[x.account_id,x.balance_jpy]),[[first,0],[second,3000]]);
  assert.equal(sql.prepare('SELECT amount_jpy FROM family_member_prepaid_topups WHERE request_id=?').get(tid).amount_jpy,5000);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM family_member_prepaid_topup_corrections').get().n,1);
  const repeated=await familyMemberPrepaidTopupCorrections(req(),e,requestUrl,u,
   ['member-prepaid-topup-corrections',tid]);
  assert.equal((await repeated.json()).replayed,true);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM family_member_prepaid_topup_corrections').get().n,1);
  const rewrite=sql.prepare('UPDATE family_member_prepaid_topup_corrections SET after_amount_jpy=1 WHERE topup_request_id=?');
  assert.throws(()=>rewrite.run(tid),/IMMUTABLE/);
 }finally{sql.close()}
});
