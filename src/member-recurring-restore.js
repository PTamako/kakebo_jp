// Restore ONLY future member-owned, already-defined recurring plan settings.
// Do not replay historical installments, broker trades or owner approvals.
const id=/^[a-f0-9]{32}$/i,month=/^20\d{2}-(0[1-9]|1[0-2])$/;
const months=(a,b)=>{const [y,m]=a.split('-').map(Number),[z,n]=b.split('-').map(Number);return (z-y)*12+n-m};
const terms=p=>[
 p.plan_type,p.source_bank_account_id,p.securities_account_id||'',
 p.amount_jpy,p.due_day,p.start_month,p.end_month,p.category,p.merchant,
 p.fund_code||'',p.fund_name||'',p.account_type||''
].join('\u0000');
export function prepareMemberRecurringRestores({ownerUserId,oldPlans,existingPlans,
 accounts,accountMap,nowMonth}){
 if(typeof ownerUserId!=='string'||!ownerUserId||!Array.isArray(oldPlans)||
  !Array.isArray(existingPlans)||!Array.isArray(accounts)||!(accountMap instanceof Map)||
  !month.test(nowMonth)||oldPlans.length>60)
  throw Error('本人の積立設定を検証できません');
 if(oldPlans.some(p=>p?.owner_user_id!==ownerUserId)||
  existingPlans.some(p=>p?.owner_user_id!==ownerUserId)||
  accounts.some(p=>p?.owner_user_id!==ownerUserId))
  throw Error('本人以外の計画または口座が含まれています');
 const known=new Set(existingPlans.map(terms));
 const active=new Map(accounts.filter(a=>a.origin==='member_created'&&
  !a.is_archived&&Number.isSafeInteger(a.version)&&a.version>=1)
  .map(a=>[a.account_id,a]));
 const restore=[],skipped=[];
 for(const p of oldPlans){
  const skip=reason=>skipped.push({plan_resource_id:p?.plan_resource_id||null,reason});
  if(p.state!=='active'||!id.test(p.plan_resource_id||'')){
   skip('inactive_or_invalid');continue
  }
  if(!month.test(p.start_month)||!month.test(p.end_month)||
   months(nowMonth,p.start_month)<0||months(nowMonth,p.start_month)>24||
   months(p.start_month,p.end_month)<0||months(p.start_month,p.end_month)>24){
   skip('historical_or_expired');continue
  }
  const bankId=accountMap.get(p.source_bank_account_id)||p.source_bank_account_id;
  const securitiesId=p.securities_account_id?
   (accountMap.get(p.securities_account_id)||p.securities_account_id):null;
  const bank=active.get(bankId),securities=securitiesId?active.get(securitiesId):null;
  if(bank?.account_kind!=='bank'||(p.plan_type==='sbi_tsumitate'&&
   (securities?.account_kind!=='securities'||securitiesId===bankId))){
   skip('account_unavailable');continue
  }
  if(!Number.isSafeInteger(p.amount_jpy)||p.amount_jpy<1||p.amount_jpy>10000000||
   !Number.isSafeInteger(p.due_day)||p.due_day<1||p.due_day>28||
   typeof p.category!=='string'||!p.category.trim()||p.category.length>100||
   typeof p.merchant!=='string'||!p.merchant.trim()||p.merchant.length>120||
   !['fixed_cost','sbi_tsumitate'].includes(p.plan_type)){
   skip('invalid_terms');continue
  }
  if(p.plan_type==='sbi_tsumitate'&&(!/^[A-Z0-9]{8}$/.test(p.fund_code||'')||
   typeof p.fund_name!=='string'||!p.fund_name.trim()||
   p.fund_name.length>120||p.account_type!=='tsumitate')){
   skip('invalid_fund');continue
  }
  const payload={expected_user_id:ownerUserId,
   idempotency_key:'restore-member-plan:'+p.plan_resource_id,
   plan_type:p.plan_type,source_bank_account_id:bankId,
   source_account_version:bank.version,
   securities_account_id:p.plan_type==='sbi_tsumitate'?securitiesId:null,
   securities_version:p.plan_type==='sbi_tsumitate'?securities.version:null,
   amount_jpy:p.amount_jpy,due_day:p.due_day,start_month:p.start_month,
   end_month:p.end_month,category:p.category,merchant:p.merchant,
   fund_code:p.plan_type==='sbi_tsumitate'?p.fund_code:null,
   fund_name:p.plan_type==='sbi_tsumitate'?p.fund_name:null,
   account_type:p.plan_type==='sbi_tsumitate'?'tsumitate':null};
  const key=terms(payload);
  if(known.has(key)){skip('already_present');continue}
  known.add(key);restore.push(payload);
 }
 return {restore,skipped};
}
