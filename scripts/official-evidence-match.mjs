// Private, read-only G7 evidence comparison for bank, SBI and points exports.
// This does NOT authenticate the issuing institution and never changes D1.
// The original signed/downloaded source must be independently verified.
import {createHash} from 'node:crypto';

const SHA=v=>createHash('sha256').update(v).digest('hex');
const PROVIDERS=new Set(['bank','sbi','points']);
const CURRENCIES=new Set(['JPY','POINTS']);
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS=10000;
const signed=n=>Number.isSafeInteger(n)&&Math.abs(n)<=999999999999;
function date(value){
 if(typeof value!=='string'||!DAY.test(value))return false;
 const d=new Date(value+'T00:00:00Z');
 return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===value;
}
function validRow(row,provider){
 if(!row||typeof row!=='object'||Array.isArray(row))return false;
 const expected=['provider','account_token','reference','occurred_on','posted_on','currency','amount_minor','asset_code','units_micros','cost_minor','reversal_of'];
 if(Object.keys(row).some(k=>!expected.includes(k)))return false;
 const small=v=>typeof v==='string'&&v.length>0&&v.length<=100;
 if(row.provider!==provider||!small(row.account_token)||!small(row.reference)||
  !date(row.occurred_on)||!date(row.posted_on)||!CURRENCIES.has(row.currency)||
  !signed(row.amount_minor))return false;
 if(row.asset_code!==undefined&&row.asset_code!==null&&!small(row.asset_code))return false;
 if(row.units_micros!==undefined&&row.units_micros!==null&&!signed(row.units_micros))return false;
 if(row.cost_minor!==undefined&&row.cost_minor!==null&&!signed(row.cost_minor))return false;
 if(row.reversal_of!==undefined&&row.reversal_of!==null&&!small(row.reversal_of))return false;
 return provider==='sbi' ? (small(row.asset_code)&&signed(row.units_micros)&&signed(row.cost_minor)) :
  row.units_micros==null&&row.cost_minor==null;
}
const identity=r=>[r.provider,r.account_token,r.reference].join('\u0000');
const publicKey=r=>SHA(identity(r));
const compareFields=['occurred_on','posted_on','currency','amount_minor','asset_code','units_micros','cost_minor','reversal_of'];
const matchFields=(x,y)=>compareFields.every(key=>(x[key]??null)===(y[key]??null));
function group(items){
 const result=new Map();
 for(const item of items){const key=identity(item),arr=result.get(key)||[];arr.push(item);result.set(key,arr)}
 return result;
}
export function compareInstitutionEvidence({provider,source_bytes,external_rows,internal_rows}){
 if(!PROVIDERS.has(provider))throw Error('UNSUPPORTED_PROVIDER');
 if(!ArrayBuffer.isView(source_bytes)||!source_bytes.byteLength||source_bytes.byteLength>20*1024*1024)
  throw Error('ORIGINAL_SOURCE_BYTES_REQUIRED');
 if(!Array.isArray(external_rows)||!Array.isArray(internal_rows)||
  external_rows.length>MAX_ROWS||internal_rows.length>MAX_ROWS)
  throw Error('INVALID_EVIDENCE_ROW_COUNT');
 if(!external_rows.every(r=>validRow(r,provider))||!internal_rows.every(r=>validRow(r,provider)))
  throw Error('INVALID_NORMALIZED_EVIDENCE_ROW');
 const source_sha256=SHA(source_bytes);
 const official=group(external_rows),internal=group(internal_rows);
 const entries=[];
 for(const key of [...new Set([...official.keys(),...internal.keys()])].sort()){
  const ext=official.get(key)||[],int=internal.get(key)||[];
  const r=ext[0]||int[0];
  let status;
  if(ext.length>1||int.length>1)status='duplicate_reference';
  else if(!ext.length||!int.length)status='unmatched';
  else if(ext[0].reversal_of&&!int[0].reversal_of)status='reversal_required';
  else if(!matchFields(ext[0],int[0]))status='amount_or_date_conflict';
  else status='matched';
  entries.push({reference_sha256:publicKey(r),status,external_count:ext.length,
   internal_count:int.length});
 }
 const counts=Object.fromEntries(['matched','unmatched','amount_or_date_conflict',
  'duplicate_reference','reversal_required'].map(s=>[s,entries.filter(x=>x.status===s).length]));
 // A raw binary statement and matching journal alone DO NOT verify issuer origin.
 // No API in this module can set the G7 institution-reconciled flag.
 return {provider,source_sha256,external_rows:external_rows.length,
  internal_rows:internal_rows.length,counts,entries,
  origin_authentication:'NOT_VERIFIED_BY_COMPARATOR',institution_reconciled:false,
  requires:['independent_official_issuer_origin_proof','private_source_retention',
   'human_review_of_all_exceptions','journal_readback_and_audit']};
}
