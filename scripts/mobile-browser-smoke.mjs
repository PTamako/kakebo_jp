// Browser smoke for installed-PWA-sized displays. Requires playwright locally.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {webkit,devices} from 'playwright'
const host='http://127.0.0.1:5173'
const server=spawn('npm',['run','dev','--','--host','127.0.0.1','--port','5173'],{stdio:['ignore','pipe','pipe'],detached:true})
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
    page.setDefaultTimeout(10000)
    page.setDefaultNavigationTimeout(10000)
    console.log('WebKit viewport',width)
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
    await page.goto(host,{waitUntil:'domcontentloaded',timeout:10000})
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
    await context.close()
  }
  // Exercise the actual logged-in page tree with synthetic, non-sensitive
  // financial data. The original unauthenticated test cannot catch management
  // form overflow or tab navigation regressions.
  for(const width of [320,390]){
    const context=await browser.newContext({...devices['iPhone 13'],viewport:{width,height:780}})
    await context.addInitScript(() => {
      sessionStorage.setItem('kakeibo-device-session','f'.repeat(64))
      window.alert=()=>{};window.confirm=()=>false;window.prompt=()=>null
    })
    const page=await context.newPage()
    page.setDefaultTimeout(10000)
    const errors=[]
    page.on('pageerror',error=>errors.push(String(error)))
    await page.route('**/api/**',async route=>{
      const u=new URL(route.request().url())
      const p=u.pathname.replace(/^\/api\//,'')
      let data=[]
      if(p==='app-state')data={}
      else if(p==='payment-sources')data=[
        {name:'現金',is_default:1,is_archived:0,source_type:'standard',closing_day:null},
        {name:'テストカード',is_default:0,is_archived:0,source_type:'standard',closing_day:10}
      ]
      else if(p==='category-source')data=[
        {category:'日用品',display_name:'日用品',entry_type:'expense',is_default:1,icon:'daily',sort_order:1},
        {category:'工资',display_name:'給与',entry_type:'income',is_default:1,icon:'work',sort_order:2},
        {category:'投資・資産移動',display_name:'資産移動',entry_type:'transfer',is_default:1,icon:'savings',sort_order:3}
      ]
      else if(p==='entries')data=[{id:1,date:new Date().toLocaleDateString('sv-SE'),
        time:'12:00',type:'expense',amount:1234,category:'日用品',
        merchant:'テスト商店',payment_source:'テストカード',note:'',raw:''}]
      else if(p==='stats')data={total:1234,count:1,income:0,transferTotal:0,transferCount:0,recordCount:1,
        byDay:[{date:new Date().toLocaleDateString('sv-SE'),amount:1234}],
        byCategory:[{category:'日用品',amount:1234}],byMonth:[],incomeByMonth:[],incomeByCategory:[],
        incomeByMonthCategory:[],paymentMethods:[],periodComparison:null}
      else if(p==='entry-years')data=[{year:String(new Date().getFullYear()),count:1}]
      else if(p==='job-health')data=[]
      else if(p==='prepaid-assets')data={cards:[],latestUsage:null,latestCharge:null}
      else if(p==='investment-portfolio')data={holdings:[],plans:[],prices:[]}
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)})
    })
    await page.goto(host,{waitUntil:'domcontentloaded'})
    await page.locator('.bottom-nav').waitFor()
    await page.getByRole('navigation',{name:'メインメニュー'}).getByRole('button',{name:'明細'}).click()
    await page.locator('.ledger').first().waitFor()
    await page.getByRole('navigation',{name:'メインメニュー'}).getByRole('button',{name:'統計'}).click()
    await page.locator('.stats-page').waitFor()
    await page.getByRole('navigation',{name:'メインメニュー'}).getByRole('button',{name:'管理'}).click()
    await page.locator('.finance-tools').waitFor()
    await page.getByRole('button',{name:'カードを追加'}).click()
    await page.locator('.card-add-editor').waitFor()
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)
    assert.ok(overflow<=2,'Authenticated '+width+'px layout overflows by '+overflow+'px')
    assert.deepEqual(errors,[],'Authenticated WebKit JS errors at '+width)
    await context.close()
  }
  console.log('Authenticated iPhone-size WebKit synthetic ledger/statistics smoke passed')
  console.log('iPhone-size WebKit smoke passed (320/375/390/430px)')
}finally{
  await browser?.close()
  try{process.kill(-server.pid,'SIGTERM')}catch{}
  server.stdout.destroy()
  server.stderr.destroy()
  server.unref()
}
