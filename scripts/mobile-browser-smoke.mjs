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
    const cardEdits=[],cardAdds=[]
    const cards=[
      {name:'現金',is_default:1,is_archived:0,source_type:'standard',stat_group:'card',closing_day:null},
      {name:'テストカード',is_default:0,is_archived:0,source_type:'standard',stat_group:'card',closing_day:10},
      ...Array.from({length:12},(_,i)=>({name:'サンプルカード'+(i+1),is_default:0,is_archived:0,source_type:'standard',stat_group:'card',closing_day:10}))
    ]
    page.on('pageerror',error=>errors.push(String(error)))
    await page.route('**/api/**',async route=>{
      const u=new URL(route.request().url())
      const p=u.pathname.replace(/^\/api\//,'')
      let data=[]
      if(p==='app-state')data={}
      else if(p==='receipts'&&route.request().method()==='GET')data={ok:true,items:[]}
      else if(p==='payment-sources'&&route.request().method()==='GET')data=cards
      else if(p==='payment-sources'&&route.request().method()==='POST'){
        const body=route.request().postDataJSON()
        cardAdds.push(body)
        cards.push({name:body.name,is_default:0,is_archived:0,source_type:body.sourceType,stat_group:body.statGroup,closing_day:null})
        data={ok:true}
      }
      else if(p==='payment-sources/update'&&route.request().method()==='POST'){
        const body=route.request().postDataJSON()
        cardEdits.push(body)
        const card=cards.find(c=>c.name===body.oldName)
        if(card){
          card.name=body.name
          card.source_type=body.sourceType
          card.stat_group=body.statGroup
          if(body.closingDay!==undefined)card.closing_day=body.closingDay
        }
        data={ok:true,changed:true,name:body.name}
      }
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
      else if(p==='custom-rules')data=[{keyword:'テスト商店',category:'日用品'}]
      else if(p==='merchant-payment-rules')data=[{keyword:'テスト商店',payment_source:'テストカード'}]
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
    // A long card list opens upward from the iPhone bottom edge and filters
    // Japanese half-width katakana against the full-width displayed label.
    const cardPicker=page.locator('.card-main-controls .mobile-choice-trigger')
    await cardPicker.click()
    const choiceSheet=page.getByRole('dialog',{name:'管理するカード'})
    await choiceSheet.waitFor()
    await choiceSheet.getByRole('searchbox',{name:'管理するカードを日本語で検索'}).fill('ﾃｽﾄ')
    assert.equal(await choiceSheet.getByRole('option').count(),1,'Japanese search must filter card names')
    await choiceSheet.getByRole('option',{name:'テストカード'}).click()
    assert.ok((await cardPicker.innerText()).includes('テストカード'))
    assert.equal(await page.evaluate(()=>document.body.style.overflow),'','Closing sheet must unlock page scroll')
    // Adding/editing is a true bottom sheet, never an expanding inline form.
    const panel=page.locator('.finance-panel').filter({hasText:'支払方法・カード管理'}).first()
    const heightBefore=await panel.evaluate(el=>el.getBoundingClientRect().height)
    await page.getByRole('button',{name:'カードを編集'}).click()
    const cardEditor=page.getByRole('dialog',{name:'カードを編集',exact:true})
    await cardEditor.waitFor()
    assert.equal(await page.locator('.card-add-editor').count(),0,'legacy inline add form must be removed')
    assert.ok(Math.abs((await panel.evaluate(el=>el.getBoundingClientRect().height))-heightBefore)<2,
      'opening card sheet must not expand the management page')
    assert.equal(await cardEditor.getByRole('textbox',{name:'カード名'}).inputValue(),'テストカード')
    assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden')

    // An unsaved edit cannot disappear from a backdrop/close press.
    await cardEditor.getByRole('textbox',{name:'カード名'}).fill('一時的な名前')
    await cardEditor.getByRole('button',{name:'閉じる'}).click()
    assert.equal(await cardEditor.isVisible(),true,'dirty editor should ask before discarding')
    await page.evaluate(()=>{window.confirm=()=>true})
    await cardEditor.getByRole('button',{name:'閉じる'}).click()
    await cardEditor.waitFor({state:'hidden'})
    assert.equal(await cardPicker.innerText().then(x=>x.includes('テストカード')),true)

    // One explicit edit Save changes all draft fields in a single request.
    await page.getByRole('button',{name:'カードを編集'}).click()
    await cardEditor.getByRole('textbox',{name:'カード名'}).fill('テストカード修正')
    await cardEditor.getByRole('button',{name:'ポイント払い'}).click()
    await cardEditor.getByRole('button',{name:/カードの締め日/}).click()
    const closingChoices=page.getByRole('dialog',{name:'カードの締め日'})
    await closingChoices.getByRole('option',{name:'15日'}).click()
    await cardEditor.getByRole('button',{name:'保存',exact:true}).click()
    await cardEditor.waitFor({state:'hidden'})
    assert.equal(cardEdits.length,1,'one Save must issue only one atomic card edit')
    assert.equal(cardEdits[0].name,'テストカード修正')
    assert.equal(cardEdits[0].statGroup,'points')
    assert.equal(cardEdits[0].closingDay,15)
    assert.deepEqual(cardEdits[0].expected,{sourceType:'standard',statGroup:'card',closingDay:10,isArchived:0})
    await page.getByRole('button',{name:'カードを追加'}).click()
    const addEditor=page.getByRole('dialog',{name:'カードを追加',exact:true})
    await addEditor.waitFor()
    await addEditor.getByRole('textbox',{name:'カード名'}).fill('新しいカード')
    await addEditor.getByRole('button',{name:'プリペイドカード'}).click()
    await addEditor.getByRole('button',{name:'保存',exact:true}).click()
    await addEditor.waitFor({state:'hidden'})
    assert.equal(cardAdds.length,1)
    assert.equal(cardAdds[0].name,'新しいカード')
    assert.equal(cardAdds[0].sourceType,'prepaid')
    assert.equal(await page.evaluate(()=>document.body.style.overflow),'','Card sheets must unlock scroll after save')
    assert.ok(Math.abs((await panel.evaluate(el=>el.getBoundingClientRect().height))-heightBefore)<2)

    // Fixed-expense search spans the panel width and all three statuses stay on one row.
    await page.locator('.finance-section-tabs').getByRole('button',{name:'固定費'}).click()
    const recurringPanel=page.locator('.recurring-plans-panel')
    await recurringPanel.locator('.recurring-list-summary').click()
    const recurringFilters=recurringPanel.locator('.recurring-list-filters')
    await recurringFilters.locator('input[type=search]').waitFor({state:'visible'})
    const filterLayout=await recurringFilters.evaluate(node=>{
      const search=node.querySelector('input[type=search]').getBoundingClientRect()
      const buttons=[...node.querySelectorAll('.mobile-choice-segments > button')]
        .map(el=>el.getBoundingClientRect())
      return {search:{x:search.x,y:search.y,width:search.width,bottom:search.bottom},
        buttons:buttons.map(b=>({x:b.x,y:b.y,width:b.width,height:b.height,right:b.right})),
        panelWidth:node.getBoundingClientRect().width}
    })
    assert.equal(filterLayout.buttons.length,3)
    assert.ok(filterLayout.search.width>=filterLayout.panelWidth-2,
      'Fixed-expense search must fill the width at '+width+'px')
    assert.ok(filterLayout.buttons.every(b=>Math.abs(b.y-filterLayout.buttons[0].y)<2),
      'Fixed-expense statuses must stay on one line at '+width+'px')
    assert.ok(filterLayout.buttons.every(b=>b.y>=filterLayout.search.bottom-1&&b.height>=44),
      'Status buttons must sit below search and be touch safe at '+width+'px')
    assert.ok(filterLayout.buttons[2].right<=filterLayout.search.x+filterLayout.search.width+2,
      'Status filters must fit without horizontal overflow at '+width+'px')

    // Management opens a full bottom panel, not a long inline accordion.
    await page.locator('.finance-section-tabs').getByRole('button',{name:'その他'}).click()
    const appearance=await page.evaluate(()=>{
      const entry=document.querySelector('.merchant-sheet-launch')
      const peer=document.querySelector('.finance-tools details.finance-disclosure')
      const card=getComputedStyle(entry), reference=getComputedStyle(peer)
      return {border:card.borderTopWidth, peerBorder:reference.borderTopWidth,
        background:card.backgroundColor, peerBackground:reference.backgroundColor,
        radius:card.borderTopLeftRadius, peerRadius:reference.borderTopLeftRadius,
        height:entry.getBoundingClientRect().height}
    })
    assert.equal(appearance.border,appearance.peerBorder,'merchant entry must have the same card border')
    assert.equal(appearance.background,appearance.peerBackground,'merchant entry must use the same white card surface')
    assert.equal(appearance.radius,appearance.peerRadius,'merchant entry must use matching rounded corners')
    assert.ok(appearance.height>=64,'merchant entry must remain thumb-friendly')
    await page.locator('.merchant-sheet-launch-button').click()
    const merchantSheet=page.getByRole('dialog',{name:'店舗ルール管理'})
    await merchantSheet.waitFor()
    await merchantSheet.getByRole('searchbox',{name:'店舗ルールを日本語で検索'}).fill('ﾃｽﾄ')
    await merchantSheet.getByRole('button',{name:'テスト商店のルールを編集'}).click()
    const payPicker=merchantSheet.getByRole('button',{name:/支払方法：/})
    await payPicker.click()
    const payChoices=page.getByRole('dialog',{name:'支払方法',exact:true})
    await payChoices.getByRole('option',{name:'現金'}).click()
    await merchantSheet.getByRole('button',{name:'変更を保存'}).click()
    await merchantSheet.getByRole('button',{name:'閉じる'}).click()
    assert.equal(await page.evaluate(()=>document.body.style.overflow),'','Merchant sheet must unlock page scroll')
    const merchantOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)
    assert.ok(merchantOverflow<=2,'Merchant panel overflow at '+width)

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
