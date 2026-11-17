// One original transfer selector for every household identity.
// A member sees only personal asset routes backed by an existing safe executor.
// Shared spouse cards never become personal transfer targets.
export const POINT_TRANSFER_OPERATIONS=Object.freeze({
 'points:prepaid':'transfer_prepaid',
 'points:card':'offset_card',
 'points:sbi':'redeem_asset',
 'points:move':'transfer_out',
 'points:exchange':'exchange_out',
})
export function memberOwnActiveAssets(accounts,userId){
 return (Array.isArray(accounts)?accounts:[]).filter(a=>
  a&&a.owner_user_id===userId&&a.origin==='member_created'&&
  !a.is_archived&&typeof a.account_id==='string'&&a.account_id)
}
export function memberTransferChoices(accounts,userId){
 const own=memberOwnActiveAssets(accounts,userId)
 const prepaid=own.filter(a=>a.account_kind==='prepaid')
 const points=own.filter(a=>a.account_kind==='points')
 const cards=own.filter(a=>a.account_kind==='credit_card')
 const securities=own.filter(a=>a.account_kind==='securities')
 const choices=[{value:'spouse',name:'配偶'}]
 // Prepaid topup is available without a bank or cash-account registration.
 for(const a of prepaid)choices.push({value:'prepaid:'+a.account_id,
  name:a.label+'（チャージ）',label:a.label+'（チャージ）'})
 if(points.length&&prepaid.length)choices.push({value:'points:prepaid',
  name:'ポイント → プリペイド',label:'ポイント → プリペイド'})
 if(points.length&&cards.length)choices.push({value:'points:card',
  name:'ポイント → 本人のカード請求',label:'ポイント → 本人のカード請求'})
 if(points.length&&securities.length)choices.push({value:'points:sbi',
  name:'ポイント → 本人のSBI確認済み買付',label:'ポイント → 本人のSBI確認済み買付'})
 if(points.length>=2){
  choices.push({value:'points:move',name:'本人のポイント口座へ移動',label:'本人のポイント口座へ移動'})
  choices.push({value:'points:exchange',name:'本人のポイント同士を交換',label:'本人のポイント同士を交換'})
 }
 return choices
}
export function memberTransferOperation(target){
 if(target==='spouse')return 'spouse'
 if(typeof target==='string'&&target.startsWith('prepaid:')&&target.length>8)
  return 'prepaid'
 return POINT_TRANSFER_OPERATIONS[target]||null
}
