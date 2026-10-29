// 日本の一般的な日曜始まりのカレンダーで使用する週計算。
export const sundayFirstOffset = (year, monthIndex) =>
  new Date(year, monthIndex, 1).getDay()

// Return a copy: callers must never mutate their original dates.
export function startOfSundayWeek(date) {
  const start = new Date(date)
  start.setDate(start.getDate() - start.getDay())
  return start
}
