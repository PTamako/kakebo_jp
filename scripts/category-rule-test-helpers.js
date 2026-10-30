// Integration-test adapter: the app receives these defaults from D1 /api/rules.
// Parser runtime intentionally has no hardcoded merchant/category dictionaries.
import { DEFAULT_RULE_ROWS } from './fixtures/default-rule-rows.js'
import { classify as classifyRaw, parseEntries as parseEntriesRaw, parseReceipt as parseReceiptRaw, parseEntry as parseEntryRaw } from '../src/parse.js'
export * from '../src/parse.js'
export const databaseRules = DEFAULT_RULE_ROWS.map(([keyword, category]) => ({ keyword, category, is_custom: false }))
const effective = rules => [
  ...(rules || []).map(rule => ({ ...rule, is_custom: true })),
  ...databaseRules
]
export const classify = (text, rules) => classifyRaw(text, effective(rules))
export const parseEntries = (text, rules) => parseEntriesRaw(text, effective(rules))
export const parseReceipt = (text, rules) => parseReceiptRaw(text, effective(rules))
export const parseEntry = (text, rules) => parseEntryRaw(text, effective(rules))
