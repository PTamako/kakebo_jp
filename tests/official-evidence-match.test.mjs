import test from 'node:test';
import assert from 'node:assert/strict';
import {compareInstitutionEvidence} from '../scripts/official-evidence-match.mjs';
const base={provider:'bank',account_token:'internal-account-alias',reference:'bank-ref-1',
 occurred_on:'2026-11-14',posted_on:'2026-11-15',currency:'JPY',amount_minor:-1500};
const match=(external_rows,internal_rows,provider='bank')=>compareInstitutionEvidence({
 provider,source_bytes:new TextEncoder().encode('synthetic statement, NOT AUTHENTIC'),
 external_rows,internal_rows});
test('matched bank reference cannot promote source to institution verification',()=>{
 const r=match([base],[{...base}]);
 assert.equal(r.counts.matched,1);
 assert.equal(r.institution_reconciled,false);
 assert.equal(r.origin_authentication,'NOT_VERIFIED_BY_COMPARATOR');
 assert.equal(JSON.stringify(r).includes(base.reference),false);
 assert.equal(JSON.stringify(r).includes(base.account_token),false);
});
test('bank different amount, missing reference, duplicates are independently reported',()=>{
 assert.equal(match([base],[{...base,amount_minor:-1499}]).counts.amount_or_date_conflict,1);
 assert.equal(match([base],[]).counts.unmatched,1);
 assert.equal(match([base,base],[base]).counts.duplicate_reference,1);
});
test('SBI units and basis cost must agree, never infer from gross amount',()=>{
 const sbi={...base,provider:'sbi',asset_code:'FUND-A',
  units_micros:123450000,cost_minor:15000,amount_minor:-15000};
 assert.equal(match([sbi],[sbi],'sbi').counts.matched,1);
 assert.equal(match([sbi],[{...sbi,units_micros:123450001}],'sbi').counts.amount_or_date_conflict,1);
 assert.equal(match([sbi],[{...sbi,cost_minor:15001}],'sbi').counts.amount_or_date_conflict,1);
});
test('points reversal is not accepted absent corresponding immutable journal reference',()=>{
 const point={...base,provider:'points',currency:'POINTS',
  amount_minor:-300,reversal_of:'old-ref'};
 assert.equal(match([point],[{...point,reversal_of:null}],'points').counts.reversal_required,1);
});
test('invalid dates, invalid account identity and missing original evidence fail closed',()=>{
 assert.throws(()=>match([{...base,posted_on:'2026-02-30'}],[base]),/INVALID_NORMALIZED/);
 assert.throws(()=>match([{...base,account_token:''}],[base]),/INVALID_NORMALIZED/);
 assert.throws(()=>compareInstitutionEvidence({provider:'bank',
  source_bytes:new Uint8Array(),external_rows:[],internal_rows:[]}),
  /ORIGINAL_SOURCE_BYTES_REQUIRED/);
});
