import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { peakTransferDates } from '../src/calendar-transfer-peaks.js'

test('largest total on a calendar date wins, not the single largest transfer', () => {
  const peaks = peakTransferDates([
    { type: 'transfer', date: '2026-11-02', amount: 1000 },
    { type: 'transfer', date: '2026-11-02', amount: 2500 },
    { type: 'transfer', date: '2026-11-03', amount: 3000 },
    { type: 'expense', date: '2026-11-03', amount: 9000 },
    { type: 'income', date: '2026-11-03', amount: 5000 },
  ])
  assert.deepEqual([...peaks], ['2026-11-02'])
})

test('equal maximum days both get a transfer marker', () => {
  const peaks = peakTransferDates([
    { type:'transfer', date:'2026-11-01', amount:'2000' },
    { type:'transfer', date:'2026-11-04', amount:2000 },
    { type:'transfer', date:'2026-11-10', amount:500 },
  ])
  assert.deepEqual([...peaks], ['2026-11-01','2026-11-04'])
})

test('no transfers means no marker, including on income and expense only dates', () => {
  assert.equal(peakTransferDates([]).size, 0)
  assert.equal(peakTransferDates([
    { type:'expense', date:'2026-11-02', amount:10000 },
    { type:'income', date:'2026-11-03', amount:20000 },
  ]).size, 0)
})

test('zero, negative and invalid transfer amounts do not become maxima', () => {
  assert.equal(peakTransferDates([
    { type:'transfer', date:'2026-11-01', amount:0 },
    { type:'transfer', date:'2026-11-02', amount:-300 },
    { type:'transfer', date:'2026-11-03', amount:'invalid' },
    { type:'transfer', date:'nonsense', amount:7000 },
  ]).size, 0)
})

test('transfer dates match YYYY-MM-DD from an ISO date/time', () => {
  assert.deepEqual([...peakTransferDates([
    { type:'transfer', date:'2026-11-01T17:49:00', amount:1000 },
    { type:'transfer', date:'2026-11-01', amount:1000 },
  ])], ['2026-11-01'])
})

test('calendar and legend show the same transfer peak badge and accessible label', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../src/pages/LedgerPage.vue', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/mobile-ui.css', import.meta.url), 'utf8')
  assert.match(app, /peakTransferDates\(calendarEntries\.value\)/)
  assert.match(app, /topTransfer:topTransferDates\.has\(date\)/)
  assert.match(page, /<i class="calendar-peak-transfer">移<\/i>資産移動最多/)
  assert.match(page, /v-if="day\.topTransfer"/)
  assert.match(page, /day\.topTransfer\?' 資産移動額が最も多い日'/)
  assert.match(css, /main \.calendar-peak-transfer\{background:/)
  assert.match(css, /main \.month-calendar \.calendar-peak-transfer/)
  assert.match(page, /calendar-peak-expense/)
  assert.match(page, /calendar-peak-income/)
  assert.match(page, /legend-today/)
})
