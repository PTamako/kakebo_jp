// Keep the newest unconfirmed bill visible, including previous service months.
// Confirmed history remains in the ledger; without drafts, show the current cycle.
export function selectPendingBill(plan,bills){
 if(!plan||!Array.isArray(bills))return null
 return bills.reduce((latest,bill)=>{
  if(bill.planId!==plan.id||bill.status!=='draft')return latest
  return !latest||bill.periodMonth>latest.periodMonth?bill:latest
 },null)
}
