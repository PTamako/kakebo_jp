import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const code=readFileSync(new URL('../public/startup.js',import.meta.url),'utf8')

function startupFixture(rendered) {
  const root={childElementCount:rendered ? 1 : 0}
  const panels=[]
  const events=new Map()
  let healthCheck=()=>{}
  const document={
    getElementById:()=>root,
    createElement:()=>({
      style:{},setAttribute(){},textContent:''
    }),
    body:{appendChild(panel){panels.push(panel)}}
  }
  const window={
    addEventListener:(name,callback)=>events.set(name,callback),
    setTimeout:callback=>{healthCheck=callback}
  }
  runInNewContext(code,{document,window})
  return {root,panels,events,runHealthCheck:()=>healthCheck()}
}

test('startup guard ignores resource errors and rejections after Vue renders',()=>{
  const fixture=startupFixture(true)
  fixture.events.get('error')({message:'optional image failed'})
  fixture.events.get('unhandledrejection')({reason:new Error('recoverable refresh failed')})
  fixture.runHealthCheck()
  assert.equal(fixture.panels.length,0,'running app must not display startup-failed panel')
})

test('startup guard still reports fatal initialization failures once',()=>{
  const fixture=startupFixture(false)
  fixture.events.get('error')({message:'app module did not load'})
  fixture.events.get('unhandledrejection')({reason:'another error'})
  fixture.runHealthCheck()
  assert.equal(fixture.panels.length,1)
  assert.match(fixture.panels[0].textContent,/app module did not load/)
})

test('startup guard detects an empty app after the initialization timeout',()=>{
  const fixture=startupFixture(false)
  fixture.runHealthCheck()
  assert.equal(fixture.panels.length,1)
  assert.match(fixture.panels[0].textContent,/アプリの画面が描画されませんでした/)
})
