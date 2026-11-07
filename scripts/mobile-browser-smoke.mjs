// Browser smoke for installed-PWA-sized displays. Requires playwright locally.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {webkit,devices} from 'playwright'
const host='http://127.0.0.1:5173'
const server=spawn('npm',['run','dev','--','--host','127.0.0.1','--port','5173'],{stdio:['ignore','pipe','pipe']})
let logs=''
server.stdout.on('data',x=>{logs+=String(x)})
server.stderr.on('data',x=>{logs+=String(x)})
let browser
try{
  let ready=false
  for(let i=0;i<50;i++){
    try{const result=await fetch(host);if(result.ok){ready=true;break}}catch{}
    await new Promise(r=>setTimeout(r,300))
  }
  assert.equal(ready,true,'Vite server failed: '+logs.slice(-1500))
  browser=await webkit.launch()
  for(const width of [320,375,390,430]){
    const context=await browser.newContext({...devices['iPhone 13'],viewport:{width,height:780}})
    const page=await context.newPage()
    // Disable native blocking dialogs in the unauthenticated smoke scenario.
    // Playwright WebKit may otherwise close a pending dialog with its page.
    await page.addInitScript(() => {
      window.alert=()=>{}
      window.confirm=()=>false
      window.prompt=()=>null
    })
    page.on('dialog',dialog=>{void dialog.dismiss().catch(()=>{})})
    const errors=[]
    page.on('pageerror',error=>errors.push(String(error)))
    await page.route('**/api/**',route=>route.fulfill({status:401,contentType:'application/json',body:'{"error":"authentication required"}'}))
    await page.goto(host,{waitUntil:'domcontentloaded'})
    await page.locator('#app').waitFor()
    await page.waitForTimeout(500)
    const result=await page.evaluate(()=>({
      hasApp:document.querySelector('#app')?.childElementCount>0,
      startupError:!!document.querySelector('[data-startup-error]'),
      overflow:document.documentElement.scrollWidth-innerWidth
    }))
    assert.equal(result.hasApp,true,'No application root at '+width)
    assert.equal(result.startupError,false,'Startup failure at '+width)
    assert.ok(result.overflow<=2,'Horizontal page overflow '+result.overflow+'px at '+width)
    assert.deepEqual(errors,[],'Browser JS error at '+width)
    await page.reload({waitUntil:'domcontentloaded'})
    assert.equal(await page.locator('#app').evaluate(el=>el.childElementCount>0),true)
    await context.close()
  }
  console.log('iPhone-size WebKit smoke passed (320/375/390/430px)')
}finally{await browser?.close();server.kill('SIGTERM')}
