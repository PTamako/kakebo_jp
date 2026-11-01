// Select the same maximum ratio that is plotted in the annual trend.
// Months without income have a null ratio and must not appear as a maximum.
// A valid 0% month is still a recorded ratio, not "no data".
export function highestSpendingRatioMonth(points) {
  let highest = null
  for (const point of points || []) {
    if (typeof point?.ratio !== 'number' || !Number.isFinite(point.ratio) || point.ratio < 0) continue
    if (highest === null || point.ratio > highest.ratio) highest = point
  }
  return highest
}
