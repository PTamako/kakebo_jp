import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const image=readFileSync(new URL('../public/IMG_0986.gif',import.meta.url))

test('the default balance image is the user-provided bundled GIF, not an external URL',()=>{
  assert.match(image.subarray(0,6).toString('ascii'),/^GIF8[79]a$/)
  assert.equal((app.match(/class="puppy-default-gif" src="\/IMG_0986\.gif"/g)||[]).length,2,
    'monthly and annual balances use the same default image')
  assert.doesNotMatch(app,/<template v-else><img class="puppy-white"/)
  assert.match(app,/main \.puppy-pair img\.puppy-default-gif\{[^}]*object-fit:contain/)
})

test('both the 80% and 100% threshold image branches retain their original files',()=>{
  assert.match(app,/import puppyWorried from '\.\/assets\/puppy-worried\.gif'/)
  assert.match(app,/import puppyCrying from '\.\/assets\/puppy-crying\.jpg'/)
  assert.match(app,/const puppyExpression = ratio => ratio >= 1 \? puppyCrying : puppyWorried/)
  assert.equal((app.match(/v-if="(?:monthlyRatio|annualRatio) !== null && (?:monthlyRatio|annualRatio) >= \.8"/g)||[]).length,2)
  assert.equal((app.match(/:src="puppyExpression\((?:monthlyRatio|annualRatio)\)"/g)||[]).length,2)
  assert.match(app,/const pigState = ratio => ratio === null \? 'empty' : ratio >= 1 \? 'broken' : ratio >= \.8 \? 'sweating' : 'happy'/)
})

test('status messages remain truthful but have personality',()=>{
  assert.match(app,/お財布、収入の登場を待機中/)
  assert.match(app,/お財布が大泣き！収入より使ってるよ/)
  assert.match(app,/ちょっと使いすぎ？お財布に汗が/)
  assert.match(app,/お財布、ごきげん♪ この調子/)
  assert.match(app,/const ratioLabel = ratio => ratio === null \? '収入データなし' : Math\.round\(ratio \* 100\) \+ '%'/)
})
