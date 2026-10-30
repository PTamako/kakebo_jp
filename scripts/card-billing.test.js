import test from 'node:test'
import assert from 'node:assert/strict'
import { isCardBilledEntry } from '../src/card-billing.js'

const period = {start:'2026-10-01',end:'2026-10-31'}
const bill = (type,source,target='',date='2026-10-30') =>
  ({type,date,payment_source:source,transfer_target:target,amount:1000})

test('credit card utilization counts purchase, SBI investment funding and prepaid recharge',()=>{
  assert.equal(isCardBilledEntry(bill('expense','楽天カード'),period,'楽天カード'),true)
  assert.equal(isCardBilledEntry(bill('transfer','楽天カード','sbi'),period,'楽天カード'),true)
  assert.equal(isCardBilledEntry(bill('transfer','楽天カード','prepaid:Suica'),period,'楽天カード'),true)
  assert.equal(isCardBilledEntry(bill('transfer','楽天カード','prepaid:PASMO'),period,'楽天カード'),true)
})

test('credit card utilization excludes income, transfers without recognized target and other cards',()=>{
  assert.equal(isCardBilledEntry(bill('income','楽天カード'),period,'楽天カード'),false)
  assert.equal(isCardBilledEntry(bill('transfer','楽天カード'),period,'楽天カード'),false)
  assert.equal(isCardBilledEntry(bill('transfer','楽天カード','prepaid:'),period,'楽天カード'),false)
  assert.equal(isCardBilledEntry(bill('transfer','現金','sbi'),period,'楽天カード'),false)
  assert.equal(isCardBilledEntry(bill('transfer','','prepaid:Suica'),period,'楽天カード'),false)
})

test('credit card billing uses transaction date, not later investment reflection date',()=>{
  const transfer={...bill('transfer','楽天カード','sbi','2026-10-14'),transfer_date:'2026-11-16'}
  assert.equal(isCardBilledEntry(transfer,period,'楽天カード'),true)
  assert.equal(isCardBilledEntry(transfer,{start:'2026-11-01',end:'2026-11-30'},'楽天カード'),false)
  assert.equal(isCardBilledEntry(bill('transfer','楽天カード','prepaid:Suica','2026-11-01'),period,'楽天カード'),false)
})
