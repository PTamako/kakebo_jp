import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { countThroughEditedDay } from '../src/ledger-day-focus.js'

const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const ledger = readFileSync(new URL('../src/pages/LedgerPage.vue', import.meta.url), 'utf8')
const focusSource = app.match(/async function focusLastEditedDayInAll\(\) \{[\s\S]*?\n\}\nfunction setEntryTypeFilter/)?.[0]
  ?.replace(/\nfunction setEntryTypeFilter$/, '') || ''

function focusFixture({ date = '2026-09-02', entryId = 48, all = true } = {}) {
  assert.ok(focusSource, 'focus function exists')
  const records = [
    ...Array.from({length:20},(_,i)=>({id:i+1,date:'2026-09-20'})),
    ...Array.from({length:20},(_,i)=>({id:21+i,date:'2026-09-10'})),
    ...Array.from({length:15},(_,i)=>({id:41+i,date:'2026-09-02'})),
    ...Array.from({length:9},(_,i)=>({id:56+i,date:'2026-09-01'}))
  ]
  const refs = {
    tab:{value:'list'},entryTypeFilter:{value:all?'all':'expense'},
    selectedDay:{value:''},detailFilter:{value:null},prepaidHistoryFilter:{value:null},
    month:{value:'2026-09'},lastEditedDay:{value:date},lastEditedEntryId:{value:entryId},
    sortedDisplayEntries:{value:records},visibleEntryCount:{value:20},
    expandedEntryDays:{value:new Set()}
  }
  const events = []
  const api = {
    nextTick:async()=>events.push('tick'),
    countThroughEditedDay,
    listPageSize:20,
    document:{querySelector(selector){
      events.push(selector)
      if (selector === '.day-group-list [data-ledger-entry-id="48"]') {
        return {scrollIntoView(options){events.push({kind:'entry',options})}}
      }
      if (selector === '.day-group-list [data-ledger-day="2026-09-02"]') {
        return {scrollIntoView(options){events.push({kind:'day',options})}}
      }
      return null
    }}
  }
  const dependencies = {...refs,...api}
  const focus = new Function(...Object.keys(dependencies),
    focusSource+'\nreturn focusLastEditedDayInAll')(...Object.values(dependencies))
  return {focus,refs,events}
}

test('all ledger loads every row through the edited day and expands it automatically',async()=>{
  const example = [
    ...Array.from({length:25},(_,i)=>({date:'2026-09-10',id:i+1})),
    ...Array.from({length:38},(_,i)=>({date:'2026-09-02',id:i+26}))
  ]
  assert.equal(countThroughEditedDay(example,'2026-09-02'),63)
  assert.equal(countThroughEditedDay(example,'2026-09-10'),25)
  assert.equal(countThroughEditedDay(example,'2026-09-01'),0)
  const {focus,refs,events}=focusFixture()
  await focus()
  assert.equal(refs.selectedDay.value,'', 'all ledger must not become a day-only filter')
  assert.equal(refs.visibleEntryCount.value,55,'all fifteen entries of edited day must appear, not only first page')
  assert.deepEqual([...refs.expandedEntryDays.value],['2026-09-02'])
  assert.equal(events.at(-1).kind,'entry')
  assert.equal(events.at(-1).options.block,'center')
})

test('edited day fallback is used when a row scroll target is unavailable',async()=>{
  const {focus,refs,events}=focusFixture({entryId:999})
  await focus()
  assert.equal(refs.visibleEntryCount.value,55)
  assert.equal(events.at(-1).kind,'day')
})

test('other filter and nonexistent date do not force full-list navigation',async()=>{
  const filtered=focusFixture({all:false})
  await filtered.focus()
  assert.equal(filtered.refs.visibleEntryCount.value,20)
  assert.equal(filtered.events.length,0)
  const missing=focusFixture({date:'2026-09-03'})
  await missing.focus()
  assert.equal(missing.refs.visibleEntryCount.value,20)
  assert.ok(!missing.events.some(item=>typeof item==='object'&&item.kind))
})

test('save from all as well as tapping all invoke same location/expansion flow',()=>{
  const save=app.match(/async function saveEdit\(\) \{[\s\S]*?\n\}\n\nconst pendingTransfers/)?.[0]||''
  const filter=app.match(/function setEntryTypeFilter\(value\) \{[\s\S]*?\n\}/)?.[0]||''
  assert.match(save,/lastEditedDay\.value = editedDay/)
  assert.match(save,/lastEditedEntryId\.value = e\.id/)
  assert.match(save,/if \(!returnDay && entryTypeFilter\.value === 'all'\) await focusLastEditedDayInAll\(\)/)
  assert.match(filter,/if \(value === 'all'\) void focusLastEditedDayInAll\(\)/)
  assert.match(ledger,/:data-ledger-day="group\.date"/)
  assert.match(ledger,/:data-ledger-entry-id="e\.id"/)
})
