// Reuse the authenticated manual-confirm posting implementation directly from
// the existing production Cron Worker. This creates a ledger entry only; it
// never initiates a payment or assumes a card charge is settled.
// The entry request ID is deterministic, so manual/cron races remain safe.
import {handleVariableRecurring} from './variable-recurring.js'

const civilDate=/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
export async function postDueVariableRecurring(db,{today}={}){
 if(!civilDate.test(today||''))throw Error('invalid_variable_bill_post_date')
 // No scheduling table, new Worker or extra Cron invocation. Fetch only due,
 // enabled, unposted bills with a real positive amount and chosen posting date.
 const {results=[]}=await db.prepare(`SELECT b.plan_id,b.period_month
   FROM variable_recurring_bills b
   JOIN variable_recurring_plans p ON p.id=b.plan_id
   WHERE b.status='draft' AND p.enabled=1
     AND b.amount_jpy BETWEEN 1 AND 10000000
     AND b.expense_date IS NOT NULL AND b.expense_date<=?
   ORDER BY b.expense_date,b.plan_id,b.period_month LIMIT 40`).bind(today).all()
 const result={checked:0,created:0,skipped:0,failed:0}
 for(const bill of results){
  result.checked++
  try{
   // Posting amount and posting date are re-read from D1 at confirmation time:
   // edits made before 19:30 apply, and date changes to the future postpone it.
   const request=new Request('https://internal.invalid/api/variable-recurring/'+bill.plan_id+'/confirm',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({periodMonth:bill.period_month})
   })
   const response=await handleVariableRecurring(request,db,
    ['variable-recurring',bill.plan_id,'confirm'],{scheduledToday:today})
   const data=await response.json()
   if(response.ok&&data.posted){
    if(data.alreadyPosted)result.skipped++
    else result.created++
   }else if(response.status===409){
    // Duplicate, edited/invalid date, or another confirmation won the race.
    result.skipped++
   }else result.failed++
  }catch{
   // Do not log bill amounts, dates, source document IDs or personal metadata.
   result.failed++
  }
 }
 return result
}
