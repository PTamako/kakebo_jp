import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { aiDailyLimit, tokyoAiDay, aiQuotaState, reserveAiAttempt } from '../functions/api/ai-quota.js'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

function mockQuotaD1() {
  const attempts = new Map()
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            sql, params,
            async first() {
              if(!sql.startsWith('SELECT attempts FROM ai_ocr_daily_usage')) throw Error('unexpected SELECT')
              return attempts.has(params[0]) ? {attempts:attempts.get(params[0])} : null
            }
          }
        }
      }
    },
    async batch(statements) {
      const out=[]
      for(const {sql,params} of statements) {
        if(sql.startsWith('INSERT OR IGNORE INTO ai_ocr_daily_usage')){
          if(!attempts.has(params[0])) attempts.set(params[0],0)
          out.push({meta:{changes:0}})
        }else if(sql.startsWith('UPDATE ai_ocr_daily_usage SET attempts=attempts+1')){
          const [day,limit]=params
          if(attempts.get(day)<limit) {
            attempts.set(day,attempts.get(day)+1)
            out.push({meta:{changes:1}})
          }else out.push({meta:{changes:0}})
        }else throw Error('unexpected SQL: '+sql)
      }
      return out
    }
  }
}

test('AI limit is one Japan-time D1 daily bucket capped at 20, not 20 per OCR feature',async()=>{
  const env={}
  const db=mockQuotaD1()
  assert.equal(aiDailyLimit(env),20)
  assert.equal(aiDailyLimit({AI_OCR_DAILY_LIMIT:'500'}),20)
  assert.equal(aiDailyLimit({AI_OCR_DAILY_LIMIT:'12'}),12)
  assert.equal(tokyoAiDay(Date.parse('2026-10-29T15:01:00Z')),'2026-10-30')
  const modes=['receipt','statement','portfolio','portfolio-detail','portfolio-profit','portfolio-positions']
  for(let i=0;i<20;i++){
    // All routes call the SAME reserve function; mode never enters its key.
    assert.equal((await reserveAiAttempt(db,env)).allowed,true,'request '+modes[i % modes.length]+' #'+(i+1))
  }
  assert.deepEqual(await aiQuotaState(db,env),{day:tokyoAiDay(),limit:20,remaining:0})
  assert.equal((await reserveAiAttempt(db,env)).allowed,false,'the 21st attempt must be denied')
})

test('SBI dual and single-image modes expose a visible shared AI switch before optional details',()=>{
  const ui=read('src/SbiPortfolio.vue')
  const app=read('src/App.vue')
  const api=read('functions/api/[[path]].js')
  const quota=read('functions/api/ai-quota.js')
  const beforeDetails=ui.indexOf('<details class="sbi-single-import">')
  const picker=ui.indexOf('class="sbi-ai-picker"')
  assert.ok(picker>=0&&picker<beforeDetails,'shared AI selector must never be collapsed')
  assert.match(ui,/>端末内<\/button>/)
  assert.match(ui,/>AI<\/button>/)
  assert.match(ui,/aiContext\?\.aiOcrEnabled\?\.value/)
  assert.match(ui,/aiContext\?\.setAiOcrEnabled\?\.\(enabled\)/)
  assert.match(ui,/共通残り/)
  assert.match(ui,/await refreshSharedQuota\(\)/)
  assert.match(ui,/mode',kind==='profit'\?'portfolio-profit':'portfolio-positions'/)
  assert.match(ui,/data\.append\('mode','portfolio'\)/)
  assert.match(ui,/if\(useAi\.value\)/)
  assert.match(ui,/if\(!useAi\.value\)/)
  assert.doesNotMatch(ui,/bulkAi = ref|v-model="bulkAi"/)
  assert.match(app,/aiOcrEnabled, aiQuota, refreshAiQuota, setAiOcrEnabled/)
  assert.match(app,/本日の共通AI残り/)
  assert.match(app,/finally \{\s*\/\/ An attempt is reserved/)
  assert.match(api,/const quota=await reserveAiAttempt\(db,env\)/)
  assert.match(api,/const mode = \['receipt','statement','portfolio','portfolio-detail','portfolio-profit','portfolio-positions'\]/)
  assert.match(quota,/Math\.min\(20,value\) : 20/)
})
