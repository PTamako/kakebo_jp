import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sundayFirstOffset, startOfSundayWeek } from '../src/calendar-week.js'

const src = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('Japanese calendar starts on Sunday and has Sunday through Saturday header', () => {
  const ledger = src('src/pages/LedgerPage.vue')
  assert.match(ledger, /\['日', '月', '火', '水', '木', '金', '土'\]/)
  assert.doesNotMatch(ledger, /\['月', '火', '水', '木', '金', '土', '日'\]/)
  assert.match(ledger, /weekday \+ '曜日'/)
})

test('month starts are aligned with Sunday-first calendar columns', () => {
  assert.equal(sundayFirstOffset(2026, 9), 4) // 2026-10-01 Thursday
  assert.equal(sundayFirstOffset(2026, 10), 0) // 2026-11-01 Sunday
  assert.equal(sundayFirstOffset(2026, 7), 6) // 2026-08-01 Saturday
  const app = src('src/App.vue')
  assert.match(app, /const firstDayOffset = sundayFirstOffset\(year, monthNumber - 1\)/)
})

test('collapsed calendar weeks and weekly statistics share Sunday-Saturday boundaries', () => {
  const date = new Date(2026, 9, 29, 12)
  const original = date.getTime()
  assert.equal(startOfSundayWeek(date).toLocaleDateString('sv-SE'), '2026-10-25')
  assert.equal(date.getTime(), original, 'input dates are not mutated')
  assert.equal(startOfSundayWeek(new Date(2026, 10, 1, 12)).toLocaleDateString('sv-SE'), '2026-11-01')
  const app = src('src/App.vue')
  assert.match(app, /const sunday = startOfSundayWeek\(date\)/)
  assert.match(app, /const cursor = startOfSundayWeek\(monthStart\)/)
  assert.match(app, /saturday\.setDate\(saturday\.getDate\(\) \+ 6\)/)
  assert.match(app, /Math\.floor\(Math\.max\(0, index\) \/ 7\) \* 7/)
  assert.doesNotMatch(app, /\(\w+\.getDay\(\) \+ 6\) % 7/)
})

test('weekday accent colors distinguish Sunday and Saturday', () => {
  const styles = src('src/mobile-ui.css')
  assert.match(styles, /calendar-weekdays span:first-child\{color:#bc4356\}/)
  assert.match(styles, /calendar-weekdays span:last-child\{color:#3567ae\}/)
})
