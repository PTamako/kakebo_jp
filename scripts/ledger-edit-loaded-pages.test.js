import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const helper = app.match(/function editedListContextMatches\(\) \{[\s\S]*?\n\}\nfunction restoreEditedListPagination\(\) \{[\s\S]*?\n\}/)?.[0]
const watchBody = app.match(/watch\(\[displayEntries, detailFilter, selectedDay\], \(\) => \{([\s\S]*?)\}, \{ deep: true \}\)/)?.[1]

function makeList({ month = '2026-09', day = '2026-09-02', loaded = 40, rowCount = 55 } = {}) {
  assert.ok(helper, 'pagination restoration helpers exist')
  assert.ok(watchBody, 'live list watcher exists')
  const entries = Array.from({ length: rowCount }, (_, id) => ({ id: id + 1, date: day }))
  const state = {
    month: { value: month },
    selectedDay: { value: day },
    entryTypeFilter: { value: 'all' },
    detailFilter: { value: null },
    prepaidHistoryFilter: { value: null },
    editListReturn: { value: {
      visibleCount: loaded, annualCounts: { [month]: loaded }, month, selectedDay: day,
      type: 'all', detail: 'null', prepaid: 'null'
    } },
    annualVisibleCounts: { value: {} },
    visibleEntryCount: { value: 20 },
    displayEntries: { value: entries },
    preserveOperatedDay: { value: day },
    expandedEntryDays: { value: new Set() },
    sortedDisplayEntries: { value: entries }
  }
  const driver = new Function(...Object.keys(state),
    helper + '\nconst refresh = () => {' + watchBody +
    '}; return { refresh, editedListContextMatches, restoreEditedListPagination }'
  )(...Object.values(state))
  return { state, ...driver }
}

test('after edit, keep all previously loaded rows instead of collapsing to first page', () => {
  const { state, refresh } = makeList()
  refresh()
  assert.equal(state.visibleEntryCount.value, 40, 'previously loaded 40 of 55 entries remain visible')
  assert.deepEqual([...state.expandedEntryDays.value], ['2026-09-02'])
  assert.deepEqual(state.annualVisibleCounts.value, { '2026-09': 40 })
  state.preserveOperatedDay.value = ''
  refresh()
  assert.equal(state.visibleEntryCount.value, 40, 'subsequent fetch must not reset to 20')
})

test('preserve all loaded rows when user had already loaded every page', () => {
  const { state, refresh } = makeList({ loaded: 55 })
  refresh()
  assert.equal(state.visibleEntryCount.value, 55)
})

test('month change restores previously loaded rows only on the edited destination date', () => {
  const { state, refresh } = makeList()
  state.month.value = '2026-10'
  state.selectedDay.value = ''
  refresh()
  assert.equal(state.visibleEntryCount.value, 20, 'month switch temporarily resets while loading')
  state.editListReturn.value = {
    ...state.editListReturn.value, month: '2026-10', selectedDay: '2026-10-10'
  }
  state.selectedDay.value = '2026-10-10'
  state.displayEntries.value = Array.from({ length: 48 }, (_, i) => ({ date: '2026-10-10', id: i + 1 }))
  state.sortedDisplayEntries.value = state.displayEntries.value
  refresh()
  assert.equal(state.visibleEntryCount.value, 40, 'destination day reopens 40 rows')
})

test('changing day or filtering does not reuse unrelated edit pagination', () => {
  const { state, refresh } = makeList()
  state.selectedDay.value = '2026-09-03'
  refresh()
  assert.equal(state.visibleEntryCount.value, 20)
  state.selectedDay.value = '2026-09-02'
  state.entryTypeFilter.value = 'expense'
  refresh()
  assert.equal(state.visibleEntryCount.value, 20)
})

test('save snapshots loaded rows before async PUT and restores only after success', () => {
  const saveEdit = app.match(/async function saveEdit\(\) \{([\s\S]*?)\n\}\n\nconst pendingTransfers/)?.[1] || ''
  const snapshot = saveEdit.indexOf('const beforeEditList = { visibleCount: visibleEntryCount.value')
  const put = saveEdit.indexOf("await api('entries/' + e.id")
  const restore = saveEdit.indexOf('editListReturn.value = {')
  assert.ok(snapshot >= 0 && snapshot < put && put < restore)
  assert.match(saveEdit, /await nextTick\(\)\s*\/\/ A later fetch/)
  assert.match(saveEdit, /restoreEditedListPagination\(\)/)
  assert.match(app, /visibleEntryCount\.value = Math\.max\(visibleEntryCount\.value, 20, index \+ 1\)/)
})

test('explicit navigation clears edit restore and load-more updates the saved cursor', () => {
  assert.match(app, /function toggleDay\(date\) \{\s*editListReturn\.value = null/)
  assert.match(app, /function setEntryTypeFilter\(value\) \{\s*editListReturn\.value = null/)
  assert.match(app, /if \(!returning\) editListReturn\.value = null/)
  assert.match(app, /if \(!preserveEditContext\) editListReturn\.value = null/)
  assert.match(app, /editListReturn\.value\.visibleCount = visibleEntryCount\.value/)
  assert.match(app, /editListReturn\.value\.annualCounts = \{ \.\.\.annualVisibleCounts\.value \}/)
})
