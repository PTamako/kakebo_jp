// Presentation only: D1 and portfolio API keep individual NISA account rows.
// Sum the already truncated per-account market values; never recompute from
// combined units, which may differ from SBI's per-account yen calculation.
export function groupFundHoldings(holdings = []) {
  const groups = new Map()
  for (const holding of holdings) {
    const code = holding.fund_code
    let fund = groups.get(code)
    if (!fund) {
      fund = {
        fund_code: code,
        fund_name: holding.fund_name,
        accounts: [],
        units: 0,
        acquisition_cost: 0,
        market_value: 0,
        pnl: 0,
        nav_per_10000: holding.nav_per_10000,
        price_date: holding.price_date,
        source: holding.source
      }
      groups.set(code, fund)
    }
    fund.accounts.push(holding)
    fund.units += Number(holding.units || 0)
    fund.acquisition_cost += Number(holding.acquisition_cost || 0)
    // If any account has no price, never show a misleading partial total.
    if (holding.market_value == null || !Number.isFinite(Number(holding.market_value))) {
      fund.market_value = null
    } else if (fund.market_value !== null) {
      fund.market_value += Number(holding.market_value)
    }
    if (holding.pnl == null || !Number.isFinite(Number(holding.pnl))) {
      fund.pnl = null
    } else if (fund.pnl !== null) {
      fund.pnl += Number(holding.pnl)
    }
  }
  return [...groups.values()]
}
