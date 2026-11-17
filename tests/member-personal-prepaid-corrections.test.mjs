import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
 const migration=source('migrations/0074_member_prepaid_topup_corrections.sql');
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
