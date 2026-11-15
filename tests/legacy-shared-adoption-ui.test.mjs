import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const component=readFileSync(new URL('../src/FamilyFinanceLegacySharedAdoption.vue',import.meta.url),'utf8');
const parent=readFileSync(new URL('../src/FamilyFinanceAccess.vue',import.meta.url),'utf8');
test('historical owner confirmation UI never auto-adopts, requires exact digest and actor and remains private across switch',()=>{
 assert.match(parent,/FamilyFinanceLegacySharedAdoption v-if="person\.role==='owner'"/);
 assert.match(parent,/:key="'legacy-shared-adopt:'\+person\.user_id"/);
 assert.match(component,/shared-adoption-preflight\?after_id=/);
 assert.match(component,/source_snapshot_sha256:digest,confirm:true/);
 assert.match(component,/expected_user_id:who/);
 assert.match(component,/window\.confirm/);
 assert.match(component,/row\.blockers\?\.length/);
 assert.match(component,/onBeforeUnmount\(\(\)=>\{disposed=true/);
 assert.match(component,/controller\?\.abort\(\)/);
 assert.match(component,/result\.ledger_changed!==false/);
 assert.doesNotMatch(component,/onMounted\(/);
 assert.doesNotMatch(component,/localStorage|sessionStorage/);
});


test('legacy receipt UI is three independent owner confirmations: read-only R2 byte check, manual copy, then adopt',()=>{
 assert.match(component,/needsReceipt\(row\)/);
 assert.match(component,/requires_original_r2_object_and_tombstone_review/);
 assert.match(component,/shared-receipt-review\?entry_id=/);
 assert.match(component,/shared-receipt-copy/);
 assert.match(component,/window\.confirm\('确认只为历史账目/);
 assert.match(component,/copied\.value\[row\.entry_id\]===row\.source_snapshot_sha256/);
 assert.match(component,/data\.legacy_object_deleted!==false/);
 assert.match(component,/reviewed\.value=\{\};copied\.value=\{\}/);
 assert.match(component,/reviewed\.value=\{\},copied\.value=\{\}/);
 assert.doesNotMatch(component,/onMounted\(/);
 assert.doesNotMatch(component,/localStorage/);
});
