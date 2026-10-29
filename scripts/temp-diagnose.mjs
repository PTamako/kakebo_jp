// TEMPORARY PR-only CI diagnostic. Remove before merging.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const run = spawnSync('node',['--test','scripts/api-integrity.test.js'],{encoding:'utf8',maxBuffer:16*1024*1024})
const output=String(run.stdout||'')+'\n'+String(run.stderr||'')
const lines=output.split(/\r?\n/)
const filtered=[]
let collect=0
for (const line of lines) {
  if (/^(?:not ok\s+\d+|\s*✖|\s*# fail|\s*# tests|\s*# pass|\s*error:|\s*failureType:|\s*location:|\s*operator:|\s*expected:|\s*actual:)/.test(line)) collect=12
  if(collect>0){ filtered.push(line); collect-- }
}
writeFileSync('public/__pr113_diagnostics.txt',filtered.join('\n').slice(0,45000)||'NO TEST FAILURES\n')
console.log('Temporary test diagnostics written to preview artifact; result:',run.status)

if (run.status !== 0) process.exit(1)
