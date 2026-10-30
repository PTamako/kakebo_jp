import { parseSbiHoldingsText } from './sbi-holdings-import.js'

// SBI's fund detail page contains one fund with one or two NISA account cards.
// Treat OCR as a proposal: an incomplete or ambiguous image must never update D1.
export function parseSbiFundDetailText(text, holdings) {
  const all = Array.isArray(holdings) ? holdings : []
  const lines = String(text || '').normalize('NFKC').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  if (!lines.length || !all.length) return { updates: [], error: '保有情報を読み取れませんでした' }
  if (lines.length > 200 || String(text).length > 12000) return { updates: [], error: '画像の内容が多すぎます。銘柄詳細を1枚ずつ選んでください' }

  const pipeRows = lines.filter(line => line.includes('|'))
  let updates = []
  if (pipeRows.length) {
    // If the AI returns an unexpected row, fail closed instead of accepting
    // only some entries or the wrong fund from the rest of its response.
    if (pipeRows.length !== lines.length || pipeRows.some(row => row.split('|').length !== 4))
      return { updates: [], error: '銘柄コード・口座区分・保有口数・取得金額を確認してください' }
    const normalizedRows = lines.map(line => {
      const columns = line.split('|').map(value => value.trim())
      const account = {growth:'成長',tsumitate:'つみたて',combined:'合算'}[columns[1].toLowerCase()] || columns[1]
      return [columns[0],account,columns[2],columns[3]].join('|')
    })
    const parsed = parseSbiHoldingsText(normalizedRows.join('\n'), all)
    if (parsed.warnings.length || parsed.updates.length !== pipeRows.length)
      return { updates: [], error: parsed.warnings[0] || '登録済み銘柄と口座を照合できませんでした' }
    updates = parsed.updates
  } else {
    // On-device OCR may emit headings and values on separate lines. Only
    // capture explicitly labeled units and acquisition amount inside a
    // correctly identified account card. Never use market value or unit price.
    const codeCandidates = [...new Set(lines.flatMap(line => (line.match(/\b[A-Z0-9]{8}\b/g) || []))
      .filter(code => all.some(h => h.fund_code === code)))]
    if (codeCandidates.length !== 1) return { updates: [], error: '銘柄コードを1つ確認できる画像を選んでください' }
    const code = codeCandidates[0]
    const blocks = []
    let active = null
    for (const line of lines) {
      const compact = line.replace(/\s/g, '')
      const hasGrowth = /(?:NISA[（(]?成長|成長投資枠)/i.test(compact)
      const hasTsumitate = /(?:NISA[（(]?つみたて|つみたて投資枠)/i.test(compact)
      if (hasGrowth && !hasTsumitate || hasTsumitate && !hasGrowth) {
        if (active) blocks.push(active)
        active = { accountType: hasGrowth ? 'growth' : 'tsumitate', lines: [] }
      }
      if (active) active.lines.push(line)
    }
    if (active) blocks.push(active)
    const valid = textValue => {
      const m = String(textValue).replace(/[,，\s]/g, '').match(/^(\d{1,13})(?:口|円)?$/)
      return m ? Number(m[1]) : null
    }
    const readLabel = (block, word) => {
      for (let i = 0; i < block.length; i++) {
        const compact = block[i].normalize('NFKC')
        const match = compact.match(new RegExp(word + '\\s*[:：]?\\s*[¥￥]?\\s*([\\d,，]+)\\s*(?:円|口)?'))
        if (match) return valid(match[1])
        if (new RegExp('^' + word + '\\s*[:：]?$').test(compact.trim()) && i + 1 < block.length) {
          const num = valid(block[i + 1].replace(/^[¥￥]/, ''))
          if (num !== null) return num
        }
      }
      return null
    }
    for (const block of blocks) {
      const units = readLabel(block.lines, '(?:保有数量|保有口数)')
      const acquisitionCost = readLabel(block.lines, '(?:取得金額|取得額|取得総額)')
      if (units === null || acquisitionCost === null) return { updates: [], error: '保有数量と取得金額の両方が読めませんでした。AIまたは手入力で確認してください' }
      updates.push({ fundCode: code, accountType: block.accountType, units, acquisitionCost })
    }
  }
  const ids = updates.map(row => row.fundCode + ':' + row.accountType)
  if (!updates.length || new Set(ids).size !== ids.length)
    return { updates: [], error: '口座区分が不明、または重複しています' }
  const fundCodes = [...new Set(updates.map(row => row.fundCode))]
  if (fundCodes.length !== 1) return { updates: [], error: '1枚には1銘柄の詳細だけを含めてください' }
  const fundCode = fundCodes[0]
  const registered = all.filter(h => h.fund_code === fundCode)
  const registeredIds = new Set(registered.map(h => h.account_type))
  if (updates.some(row => !registeredIds.has(row.accountType)
    || ![row.units, row.acquisitionCost].every(x => Number.isSafeInteger(x) && x >= 0 && x <= 1000000000000)))
    return { updates: [], error: '登録済みの口座区分と数値を確認してください' }
  if (updates.length !== registered.length)
    return { updates: [], error: 'この銘柄のすべての口座が読めませんでした。成長・つみたての両方を写してください' }
  return { updates, error: '', fundCode }
}

// Import one fund at a time. If another screenshot tries to replace the
// same account during a session, require the user to clear and rescan.
export function applySbiFundDetailUpdates(rows, updates, importedKeys = []) {
  const seen = new Set(importedKeys)
  if (updates.some(row => seen.has(row.fundCode + ':' + row.accountType)))
    return { rows, importedKeys, error: 'この銘柄は読み取り済みです。やり直す場合はクリアしてください' }
  const incoming = new Map(updates.map(row => [row.fundCode + ':' + row.accountType, row]))
  if (updates.some(row => !rows.some(h => h.fundCode === row.fundCode && h.accountType === row.accountType)))
    return { rows, importedKeys, error: '登録されていない保有口座は追加できません' }
  const next = rows.map(row => {
    const updated = incoming.get(row.fundCode + ':' + row.accountType)
    return updated ? { ...row, units: updated.units, acquisitionCost: updated.acquisitionCost } : row
  })
  return { rows: next, importedKeys: [...seen, ...incoming.keys()], error: '' }
}
