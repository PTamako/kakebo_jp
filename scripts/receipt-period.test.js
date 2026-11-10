import test from 'node:test'
import assert from 'node:assert/strict'
import { planReceiptPeriodDeletion } from '../src/receipt-period.js'

const photo = (id, size = 1200) => ({entryId:id,blob:{size}})
const ledger = [
  {id:1,date:'2025-01-16'},
  {id:2,date:'2025-02-10'},
  {id:3,date:'2026-01-03'},
  {id:4,date:'2025-01-07'}
]
const trash = [
  {item_id:'5',payload_json:JSON.stringify({entry:{id:5,date:'2025-01-30'}})},
  {item_id:'6',payload_json:JSON.stringify({entry:{id:6,date:'2026-04-19'}})}
]
test('month deletes only dated receipts in that month, including linked trash records', () => {
  assert.deepEqual(planReceiptPeriodDeletion([photo(1),photo(2),photo(3),photo(5),photo(99)],ledger,trash,'2025','01'),
    {ids:[1,5],bytes:2400,unmatched:1,total:5})
})
test('year deletes all months for that year, preserving other years and unknown records', () => {
  assert.deepEqual(planReceiptPeriodDeletion([photo(2),photo(1),photo(5),photo(6)],ledger,trash,'2025'),
    {ids:[1,2,5],bytes:3600,unmatched:0,total:4})
})
test('an ID collision between two dates is excluded regardless of period', () => {
  const collision=[{item_id:'4',payload_json:JSON.stringify({entry:{id:4,date:'2026-01-07'}})}]
  assert.deepEqual(planReceiptPeriodDeletion([photo(4)],ledger,collision,'2025','01').ids,[])
  assert.deepEqual(planReceiptPeriodDeletion([photo(4)],ledger,collision,'2026','01').unmatched,1)
})
test('malformed or mismatched trash records do not authorize deletion', () => {
  const corrupt=[
    {item_id:'8',payload_json:'not-json'},
    {item_id:'9',payload_json:JSON.stringify({entry:{id:8,date:'2024-02-15'}})},
    {item_id:'10',payload_json:JSON.stringify({entry:{id:10,date:'unknown'}})}
  ]
  assert.deepEqual(planReceiptPeriodDeletion([photo(8),photo(10)],[],corrupt,'2024','02'),
    {ids:[],bytes:0,unmatched:2,total:2})
})
test('reject invalid year or month before any deletion is permitted', () => {
  assert.throws(() => planReceiptPeriodDeletion([],[],[],'2026','13'))
  assert.throws(() => planReceiptPeriodDeletion([],[],[],'2026-01',''))
  assert.throws(() => planReceiptPeriodDeletion([],[],[],'2026','1'))
})
test('does not mutate any provided ledger or receipt snapshot', () => {
  const images=[photo(5),photo(1)]
  planReceiptPeriodDeletion(images,ledger,trash,'2025')
  assert.deepEqual(images.map(x=>x.entryId),[5,1])
})
