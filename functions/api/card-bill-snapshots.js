// The saved credit-card statement is a historical snapshot. Compute freshness
// at read time without rewriting the user's saved bill or the ledger.
export async function getCardBillSnapshots(db) {
  const {results=[]}=await db.prepare(`
    SELECT b.payment_source,b.bill_month,b.period_start,b.period_end,
      b.total_amount,b.transaction_count,
      MAX(0,COALESCE(SUM(CASE WHEN e.type='income' THEN -e.amount ELSE e.amount END),0)) AS current_amount,
      COUNT(e.id) AS current_count
    FROM card_bills b
    LEFT JOIN entries e ON e.date>=b.period_start AND e.date<=b.period_end
      AND ((e.payment_source=b.payment_source AND
        (e.type='expense' OR (e.type='transfer' AND
          (e.transfer_target='sbi' OR
           (e.transfer_target LIKE 'prepaid:%' AND LENGTH(e.transfer_target)>8)))))
        OR (e.type='income' AND e.category='ポイント還元'
            AND e.transfer_target='credit:'||b.payment_source))
    GROUP BY b.payment_source,b.bill_month
    ORDER BY b.bill_month DESC,b.payment_source
  `).all()
  return results.map(x=>({
    name:x.payment_source,month:x.bill_month,start:x.period_start,end:x.period_end,
    total:Number(x.total_amount),count:Number(x.transaction_count),
    currentTotal:Number(x.current_amount),currentCount:Number(x.current_count),
    stale:Number(x.total_amount)!==Number(x.current_amount) ||
      Number(x.transaction_count)!==Number(x.current_count)
  }))
}
