// UI-only stable sorting for selectors, including payment methods.
// Category IDs, Japanese display names and persisted ranks live on D1 category_source.
export const OTHER_SORT_ORDER = 99999
export const isOtherOption = name => ['其他','その他','其他收入','その他の収入'].includes(String(name || '').trim())
export const sortOtherLast = values => [...values].sort((a,b) =>
  (isOtherOption(a) ? OTHER_SORT_ORDER : 0) - (isOtherOption(b) ? OTHER_SORT_ORDER : 0)
)
