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
