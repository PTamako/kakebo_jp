import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../migrations/0060_legacy_owner_claims.sql',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8');
const identity=readFileSync(new URL('../src/FamilyFinanceAccess.vue',import.meta.url),'utf8');

test('existing personal legacy data owner is explicitly verified, not guessed from display name',()=>{
 assert.match(sql,/CREATE TABLE IF NOT EXISTS family_legacy_owner_claims/);
 assert.match(sql,/REFERENCES homeflow_identity_links\(user_id\)/);
 assert.match(sql,/l\.role='owner' AND l\.state='active'/);
 assert.match(sql,/COUNT\(\*\) FROM homeflow_identity_links/);
 assert.match(sql,/confirmation_source TEXT NOT NULL DEFAULT 'explicit_original_owner_instruction'/);
 for (const scope of ['ledger','trash_entry','payment_source']) {
  assert.match(sql,new RegExp("'"+scope+"'"));
 }
 assert.match(sql,/source_stamp TEXT NOT NULL/);
 assert.match(sql,/trg_family_legacy_owner_claims_immutable_update/);
 assert.match(sql,/trg_family_legacy_owner_claims_immutable_delete/);
 assert.doesNotMatch(sql,/\b(?:UPDATE|DELETE FROM|ALTER TABLE)\s+(?:entries|payment_sources|card_bills|investment_holdings|investment_plans|recurring_plans)\b/i);
});

test('management renders only HomeFlow identity; old card settings and one statistics page remain',()=>{
 assert.match(app,/<FamilyFinanceAccess v-if="tab === 'finance'" identity-only \/>/);
 assert.match(identity,/v-if="person&&!props.identityOnly"/);
 assert.match(app,/<ManagementPage :card-settings-request=/);
 assert.match(app,/<StatisticsPage v-else-if="tab === 'stat'" \/>/);
});
