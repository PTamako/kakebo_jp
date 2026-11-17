import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {ledgerRecorderColumns,ledgerRecorderJoins} from '../functions/api/ledger-recorder.js'

const view=readFileSync(new URL('../src/LedgerEntryContent.vue',import.meta.url),'utf8')
const legacyApi=readFileSync(new URL('../functions/api/[[path]].js',import.meta.url),'utf8')
const householdApi=readFileSync(new URL('../functions/api/family-finance/[[path]].js',import.meta.url),'utf8')

function fixture(){
 const db=new DatabaseSync(':memory:')
 db.exec(`
 CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,merchant TEXT);
 CREATE TABLE homeflow_identity_links(user_id TEXT PRIMARY KEY,household_id TEXT,display_name TEXT,role TEXT,state TEXT);
 CREATE TABLE family_legacy_owner_claims(record_scope TEXT,record_key TEXT,household_id TEXT,owner_user_id TEXT,PRIMARY KEY(record_scope,record_key));
 CREATE TABLE family_shared_entry_registry(resource_id TEXT PRIMARY KEY,household_id TEXT,entry_id INTEGER,creator_user_id TEXT,state TEXT);
 CREATE TABLE family_legacy_card_spends(entry_id INTEGER PRIMARY KEY,household_id TEXT,actor_user_id TEXT);
 CREATE TABLE family_shared_mutation_applied(entry_id INTEGER,household_id TEXT,requester_user_id TEXT,action TEXT);
 INSERT INTO homeflow_identity_links VALUES ('owner','family','白ちゃん','owner','active'),('spouse','family','鸡毛大王','member','active'),('stranger','else','外部者','owner','active');
 INSERT INTO entries VALUES (12,'2026-11-15','旧交通费'),(13,'2026-11-16','家庭记账'),(14,'2026-11-17','来源未保存'),(15,'2026-11-18','夫妻共用卡支出'),(16,'2026-11-19','承認された共用カード');
 INSERT INTO family_legacy_owner_claims VALUES ('ledger','12','family','owner'),('ledger','13','family','owner');
 INSERT INTO family_shared_entry_registry VALUES ('shared-13','family',13,'spouse','active');
 INSERT INTO family_legacy_card_spends VALUES (15,'family','spouse');
 INSERT INTO family_shared_entry_registry VALUES ('approved-16','family',16,'owner','active');
 INSERT INTO family_shared_mutation_applied VALUES (16,'family','spouse','create');
 `)
 return db
}

test('verified shared creator wins over legacy owner, legacy rows never claim to know original author',()=>{
 const db=fixture()
 try{
  const rows=db.prepare('SELECT e.id,'+ledgerRecorderColumns+' FROM entries e '+ledgerRecorderJoins+' ORDER BY e.id').all()
  assert.equal(rows.length,5)
  assert.deepEqual(rows.map(r=>({id:r.id,name:r.recorded_by,basis:r.recorder_basis})),[
   {id:12,name:'白ちゃん',basis:'legacy_assigned'},
   {id:13,name:'鸡毛大王',basis:'creator'},
   {id:14,name:null,basis:null},
   {id:15,name:'鸡毛大王',basis:'shared_card_spender'},
   {id:16,name:'鸡毛大王',basis:'member_requester'}
  ])
 }finally{db.close()}
})
test('ledger queries use the same attribution source in original and spouse pages',()=>{
 assert.match(legacyApi,/recorderSelect='SELECT e\.\*,'\+ledgerRecorderColumns/)
 assert.match(legacyApi,/recorderSelect\+'WHERE e\.date/)
 assert.match(householdApi,/ledgerRecorderJoins\+' '/)
 assert.match(householdApi,/ledgerRecorderColumns\+',ls\.actor_user_id AS shared_card_actor_user_id '/)
 assert.doesNotMatch(householdApi,/recorded_by:user\.display_name/)
})
test('ledger row shows only the nickname while preserving backend provenance',()=>{
 assert.match(view,/v-if="entry\.recorded_by"/)
 assert.match(view,/· \{\{entry\.recorded_by\}\}/)
 assert.match(view,/class="ledger-recorder"/)
 assert.doesNotMatch(view,/記帳：|旧記録：|记账：管理员|记账：owner/)
 assert.match(view,/recorder_basis==='legacy_assigned'/)
})
