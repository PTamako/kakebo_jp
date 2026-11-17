// A transfer within the household is recorded by its recipient as income.
// No other person's bank account details or real bank balances are involved.
export const SPOUSE_INCOME_CATEGORY='配偶からの収入'
export const SPOUSE_INCOME_SOURCE='配偶'

// Both users reuse the exact same entry form; the recipient never needs an
// account ID or a fabricated bank-to-bank transfer to record spouse income.
export function markSpouseIncome(draft){
 if(!draft||typeof draft!=='object')throw new TypeError('spouse income draft required')
 draft.type='income'
 draft.category=SPOUSE_INCOME_CATEGORY
 draft.merchant=SPOUSE_INCOME_SOURCE
 draft.paymentSource=''
 draft.transferTarget=''
 draft.transferDate=''
 draft.rewardDestination=''
 return draft
}
