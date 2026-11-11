import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

test('NAV Worker preview URLs and retired D1 are disabled without touching production',()=>{
  const config=readFileSync(new URL('../wrangler.nav.toml',import.meta.url),'utf8')
  const production=config.match(/\[\[d1_databases\]\][\s\S]*?database_id\s*=\s*"([^"]+)"/)?.[1]
  assert.equal(production,'4d790915-fc06-4073-b660-bbb51dc74463','production D1 remains unchanged')
  assert.match(config,/preview_urls\s*=\s*false/)
  assert.doesNotMatch(config,/kakebo_preview|b1c73b65-9530-468a-b9a3-49554f8a9264/)
  assert.doesNotMatch(config,/\[\[previews\.d1_databases\]\]/)
  assert.match(config,/\[previews\.vars\][\s\S]*?HEARTBEAT_ENABLED\s*=\s*"false"/)
  assert.doesNotMatch(config,/\[previews\.triggers\]/)
})
