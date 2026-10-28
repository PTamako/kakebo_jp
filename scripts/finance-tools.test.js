import test from 'node:test'
import assert from 'node:assert/strict'
import {validateBackup,transactionKey,duplicateCandidates,reconcileStatement,nextScheduledDate} from '../src/finance-tools.js'
const row={date:'2026-10-28',time:'10:00',amount:1000,type:'expense',merchant:'スーパー',category:'飲食料品'}
test('backup accepts valid ledger without changing original',()=>{
  const data={format:'kakeibo-ledger-backup',version:1,entries:[row]}
  assert.equal(validateBackup(data),data)
  assert.equal(row.amount,1000)
})
test('backup rejects invalid or destructive values',()=>{
  for(const bad of [{...row,amount:-1},{...row,date:'invalid'},{...row,type:'unknown'}]){
    assert.throws(()=>validateBackup({format:'kakeibo-ledger-backup',version:1,entries:[bad]}))
  }
  assert.throws(()=>validateBackup({format:'unknown',version:1,entries:[]}))
})
test('duplicate detection preserves separate legitimate purchases',()=>{
  const two=[{...row,id:1},{...row,id:2}]
  assert.equal(duplicateCandidates(two,row).length,2)
  assert.equal(transactionKey(two[0]),transactionKey(two[1]))
})
test('reconciliation counts only expenses and does not modify investments',()=>{
  assert.deepEqual(reconcileStatement([row,{...row,type:'transfer',amount:15000}],2000),{sum:1000,difference:1000})
})
test('monthly schedule clamps end-of-month days',()=>{
  assert.equal(nextScheduledDate(31,new Date(2026,1,1)),'2026-02-28')
})
