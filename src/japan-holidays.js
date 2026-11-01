// Japan's national holidays, substitute holidays and citizens' holidays.
// Calendar rules apply to historical dates; equinox dates outside the Cabinet
// Office's published calendar are astronomical estimates, not future announcements.
const holidayCache = new Map()
const pad = value => String(value).padStart(2, '0')
const key = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`
const weekday = (year, month, day) => new Date(Date.UTC(year, month - 1, day)).getUTCDay()
const nthMonday = (year, month, ordinal) => 1 + ((8 - weekday(year, month, 1)) % 7) + (ordinal - 1) * 7
const equinox = (year, season) => {
  // Official dates are published annually by the National Astronomical Observatory.
  if (season === 'spring') {
    return Math.floor((year < 1980 ? 20.8357 : year < 2100 ? 20.8431 : 21.8510) +
      0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
  }
  return Math.floor((year < 1980 ? 23.2588 : year < 2100 ? 23.2488 : 24.2488) +
    0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
}

function nationalHolidays(year) {
  const days = new Set()
  if (!Number.isInteger(year) || year < 1948 || year > 9999) return days
  const add = (month, day) => {
    const iso = key(year, month, day)
    if (iso >= '1948-07-20') days.add(iso)
  }
  add(1, 1)
  if (year >= 2000) add(1, nthMonday(year, 1, 2))
  else if (year >= 1949) add(1, 15)
  if (year >= 1967) add(2, 11)
  if (year >= 2020) add(2, 23)
  if (year >= 1989 && year <= 2018) add(12, 23)
  add(3, equinox(year, 'spring'))
  if (year >= 2007) add(4, 29) // Showa Day
  else if (year >= 1949) add(4, 29) // Emperor's Birthday / Greenery Day
  add(5, 3)
  if (year >= 2007) add(5, 4)
  add(5, 5)

  if (year === 2020) {
    add(7, 23); add(7, 24); add(8, 10)
  } else if (year === 2021) {
    add(7, 22); add(7, 23); add(8, 8)
  } else {
    if (year >= 2003) add(7, nthMonday(year, 7, 3))
    else if (year >= 1996) add(7, 20)
    if (year >= 2016) add(8, 11)
    if (year >= 2000) add(10, nthMonday(year, 10, 2))
    else if (year >= 1966) add(10, 10)
  }
  if (year >= 2003) add(9, nthMonday(year, 9, 3))
  else if (year >= 1966) add(9, 15)
  add(9, equinox(year, 'autumn'))
  add(11, 3)
  add(11, 23)

  // One-off holidays established by special legislation.
  const special = {
    1959: [[4, 10]],
    1989: [[2, 24]],
    1990: [[11, 12]],
    1993: [[6, 9]],
    2019: [[5, 1], [10, 22]],
  }
  for (const [month, day] of special[year] || []) add(month, day)
  return days
}

function holidaysForYear(year) {
  if (holidayCache.has(year)) return holidayCache.get(year)
  const nationals = nationalHolidays(year)
  const holidays = new Set(nationals)
  // Citizens' holidays (1986+): a non-national day between two national holidays.
  if (year >= 1986) {
    for (let timestamp = Date.UTC(year, 0, 2); timestamp < Date.UTC(year, 11, 31); timestamp += 86400000) {
      const previous = new Date(timestamp - 86400000).toISOString().slice(0, 10)
      const current = new Date(timestamp).toISOString().slice(0, 10)
      const next = new Date(timestamp + 86400000).toISOString().slice(0, 10)
      if (!nationals.has(current) && nationals.has(previous) && nationals.has(next)) holidays.add(current)
    }
  }
  // A holiday falling on Sunday has a substitute day (rule introduced in 1973).
  // Since 2007, consecutive national holidays can move it beyond Monday.
  for (const iso of nationals) {
    if (iso < '1973-04-12' || weekday(year, Number(iso.slice(5, 7)), Number(iso.slice(8, 10))) !== 0) continue
    let timestamp = Date.parse(iso + 'T00:00:00Z') + 86400000
    let next = new Date(timestamp).toISOString().slice(0, 10)
    if (year >= 2007) {
      while (nationals.has(next)) {
        timestamp += 86400000
        next = new Date(timestamp).toISOString().slice(0, 10)
      }
    }
    if (!nationals.has(next)) holidays.add(next)
  }
  holidayCache.set(year, holidays)
  return holidays
}

export function isJapanHoliday(date) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) return false
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return false
  const dayOfWeek = parsed.getUTCDay()
  return dayOfWeek === 0 || dayOfWeek === 6 || holidaysForYear(year).has(date)
}
