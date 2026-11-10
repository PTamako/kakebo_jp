import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

test('NAV Worker Preview never binds the production finance D1 or schedules cron writes',()=>{
  const config=readFileSync(new URL('../wrangler.nav.toml',import.meta.url),'utf8')
  const production=config.match(/\[\[d1_databases\]\][\s\S]*?database_id\s*=\s*"([^"]+)"/)?.[1]
  const preview=config.match(/\[\[previews\.d1_databases\]\][\s\S]*?database_id\s*=\s*"([^"]+)"/)?.[1]
  assert.ok(production && preview,'both D1 bindings must be configured')
  assert.notEqual(production,preview,'preview must never access production ledger D1')
  assert.match(config,/\[previews\.vars\][\s\S]*?HEARTBEAT_ENABLED\s*=\s*"false"/)
  assert.doesNotMatch(config,/\[previews\.triggers\]/)
})
