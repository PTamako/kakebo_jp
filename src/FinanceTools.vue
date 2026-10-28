<script setup>
import { ref, computed, onMounted } from 'vue'
import { validateBackup, transactionKey, reconcileStatement, nextScheduledDate } from './finance-tools.js'
const props = defineProps({ api: { type: Function, required: true }, categories: { type: Array, default: () => [] }, paymentSources: { type: Array, default: () => [] } })
const emit = defineEmits(['ledger-updated'])
const rows = ref([])
const loaded = ref(false)
const busy = ref(false)
const message = ref('')
const restoreRows = ref([])
const plans = ref(JSON.parse(localStorage.getItem('kakeibo-plans') || '[]'))
const bills = ref(JSON.parse(localStorage.getItem('kakeibo-bills') || '[]'))
const plan = ref({name:'',amount:'',day:1,category:'',paymentSource:'現金'})
const bill = ref({name:'',month:new Date().toISOString().slice(0,7),amount:''})
const yen = n => '¥' + Number(n || 0).toLocaleString('ja-JP')
async function loadAll() {
  busy.value=true; message.value=''
  try {
    const all=[]
    for(let year=2018;year<=new Date().getFullYear();year++){
      for(let offset=0;;offset+=500){
        const page=await props.api('entries?year='+year+'&offset='+offset)
        if(!Array.isArray(page))throw Error('読み込み形式が不正です')
        all.push(...page)
        if(page.length<500)break
      }
    }
    rows.value=all;loaded.value=true;message.value=all.length+'件の明細を読み込みました'
  }catch(e){message.value='読み込み失敗：'+e.message}
  finally{busy.value=false}
}
function downloadBackup(){
  if(!loaded.value)return
  const data={format:'kakeibo-ledger-backup',version:1,exportedAt:new Date().toISOString(),entries:rows.value,plans:plans.value,bills:bills.value}
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}))
  const a=document.createElement('a');a.href=url;a.download='kakeibo-ledger-'+new Date().toISOString().slice(0,10)+'.json';a.click()
  setTimeout(()=>URL.revokeObjectURL(url),30000)
}
async function preview(event){
  const file=event.target.files?.[0];event.target.value='';restoreRows.value=[]
  if(!file)return
  try{
    if(!loaded.value)throw Error('先に全明細を読み込んでください')
    if(file.size>25*1024*1024)throw Error('ファイルが大きすぎます')
    const backup=validateBackup(JSON.parse(await file.text()))
    const known=new Set(rows.value.map(transactionKey)),seen=new Set()
    restoreRows.value=backup.entries.filter(e=>{
      const key=transactionKey(e)
      if(known.has(key)||seen.has(key))return false
      seen.add(key);return true
    })
    message.value=backup.entries.length+'件中、追加候補 '+restoreRows.value.length+'件。既存の取引は変更しません'
  }catch(e){message.value='確認失敗：'+e.message}
}
async function restore(){
  if(!restoreRows.value.length||busy.value||!confirm(restoreRows.value.length+'件を追加します。既存データは変更しません。よろしいですか？'))return
  busy.value=true;let count=0
  try{
    while(restoreRows.value.length){
      const e=restoreRows.value[0]
      const payload=JSON.stringify([e.id,e.date,e.time,e.amount,e.merchant,e.type,e.category,e.note])
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))
      const key='restore_'+Array.from(new Uint8Array(hash)).slice(0,16).map(x=>x.toString(16).padStart(2,'0')).join('')
      await props.api('entries',{method:'POST',body:JSON.stringify({...e,clientRequestId:key,transferTarget:e.transfer_target||'',transferDate:e.transfer_date||e.date,paymentSource:e.payment_source||''})})
      restoreRows.value.shift();count++
    }
    loaded.value=false;message.value=count+'件追加しました。全明細を再読み込みしてください'
  }catch(e){message.value=count+'件追加済み。残りは再試行できます：'+e.message}
  finally{busy.value=false}
}
const duplicates=computed(()=>{
  const groups=new Map()
  for(const e of rows.value){const key=transactionKey(e);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e)}
  return [...groups.values()].filter(g=>g.length>1)
})
function addPlan(){
  if(!plan.value.name.trim()||!(Number(plan.value.amount)>0)||!Number.isInteger(Number(plan.value.day))||Number(plan.value.day)<1||Number(plan.value.day)>31||!props.categories.includes(plan.value.category)||!props.paymentSources.includes(plan.value.paymentSource)){message.value='名称・金額・登録日・分類・支払方法を選択してください';return}
  plans.value.push({...plan.value,id:crypto.randomUUID(),amount:Number(plan.value.amount),startMonth:new Date().toLocaleDateString('sv-SE').slice(0,7),enabled:true})
  localStorage.setItem('kakeibo-plans',JSON.stringify(plans.value));plan.value={name:'',amount:'',day:1,category:'',paymentSource:'現金'}
}
const recurringBusy = ref(false)
const recurringMessage = ref('')
const localToday = () => new Date().toLocaleDateString('sv-SE')
function scheduledDate(year,month,day){
  const last=new Date(year,month,0).getDate()
  return [year,String(month).padStart(2,'0'),String(Math.min(Number(day),last)).padStart(2,'0')].join('-')
}
async function applyRecurring(){
  if(recurringBusy.value)return
  recurringBusy.value=true
  let created=0
  try{
    const today=localToday()
    for(const p of plans.value){
      if(!p.enabled||!p.startMonth)continue
      const [startYear,startMonth]=p.startMonth.split('-').map(Number)
      let y=startYear,m=startMonth
      let count=0
      while(y<Number(today.slice(0,4))||(y===Number(today.slice(0,4))&&m<=Number(today.slice(5,7)))){
        if(++count>120)throw Error('自動記録の対象期間が長すぎます')
        const date=scheduledDate(y,m,p.day)
        if(date<=today){
          // Stable idempotency key prevents duplicates on retries, devices and reloads.
          const clientRequestId='recurring_'+p.id.replace(/-/g,'')+'_'+String(y)+String(m).padStart(2,'0')
          await props.api('entries',{method:'POST',body:JSON.stringify({
            date,time:'',amount:Number(p.amount),type:'expense',category:p.category||'その他',
            merchant:p.name,note:'毎月の固定支出（自動記録）',paymentSource:p.paymentSource||'',
            clientRequestId
          })})
          created++
        }
        m++;if(m===13){m=1;y++}
      }
    }
    if(created)emit('ledger-updated')
    recurringMessage.value=created?'固定支出の対象月を確認しました（'+created+'件処理）。':'追加対象の固定支出はありません'
  }catch(e){recurringMessage.value='自動記録の確認に失敗しました：'+e.message}
  finally{recurringBusy.value=false}
}
onMounted(()=>{applyRecurring()})
function removePlan(id){plans.value=plans.value.filter(x=>x.id!==id);localStorage.setItem('kakeibo-plans',JSON.stringify(plans.value))}
function addBill(){
  if(!bill.value.name.trim()||!/^\d{4}-\d{2}$/.test(bill.value.month)||!(Number(bill.value.amount)>0))return
  bills.value.push({...bill.value,id:crypto.randomUUID(),amount:Number(bill.value.amount)})
  localStorage.setItem('kakeibo-bills',JSON.stringify(bills.value));bill.value={name:'',month:new Date().toISOString().slice(0,7),amount:''}
}
function removeBill(id){bills.value=bills.value.filter(x=>x.id!==id);localStorage.setItem('kakeibo-bills',JSON.stringify(bills.value))}
const monthExpenses=(m,source)=>rows.value.filter(e=>e.date?.startsWith(m)&&e.type==='expense'&&e.payment_source===source)
</script>
<template>
<section class="finance-tools">
  <h1>管理・照合</h1>
  <article class="finance-panel">
    <h2>バックアップ・復元</h2>
    <p>明細の JSON バックアップです。レシート画像・SBI 評価額・カテゴリ設定は対象外です。復元は追加のみで、既存の記録を変更しません。</p>
    <button :disabled="busy" @click="loadAll">{{busy?'読み込み中…':'全期間の明細を読み込む'}}</button>
    <button :disabled="busy||!loaded" @click="downloadBackup">JSON を保存</button>
    <label>バックアップを選択<input type="file" accept=".json,application/json" :disabled="busy||!loaded" @change="preview"></label>
    <button v-if="restoreRows.length" :disabled="busy" @click="restore">追加候補 {{restoreRows.length}} 件を確認して復元</button>
    <p role="status">{{message}}</p>
  </article>
  <article class="finance-panel">
    <h2>重複の可能性</h2>
    <p>同じ日時・店名・金額・カテゴリの候補です。自動削除はしません。</p>
    <p v-if="!loaded">全明細を読み込むと表示します。</p>
    <p v-else-if="!duplicates.length">重複候補はありません。</p>
    <div v-for="(group,i) in duplicates.slice(0,30)" :key="i" class="finance-row">{{group[0].date}} {{group[0].merchant}} {{yen(group[0].amount)}} · {{group.length}}件</div>
  </article>
  <article class="finance-panel">
    <h2>毎月の固定支出</h2>
    <p>毎月の指定日に支出明細へ自動追加します。アプリを開いた際に未処理月を確認します。閉じている間は実行されません。過去の予定にはさかのぼりません。</p>
    <div class="finance-inputs"><input v-model="plan.name" placeholder="名称" aria-label="固定支出名"><input v-model="plan.amount" type="number" min="1" placeholder="金額" aria-label="固定支出額"><label>毎月の登録日<select v-model.number="plan.day" aria-label="毎月の登録日"><option v-for="day in 31" :key="day" :value="day">{{day}}日</option></select></label></div>
    <div class="finance-inputs"><label>分類<select v-model="plan.category" aria-label="固定支出カテゴリ"><option value="" disabled>選択してください</option><option v-for="category in props.categories" :key="category" :value="category">{{category}}</option></select></label><label>支払方法・カード<select v-model="plan.paymentSource" aria-label="固定支出支払方法"><option v-for="source in props.paymentSources" :key="source" :value="source">{{source}}</option></select></label></div>
    <button @click="addPlan(); applyRecurring()">自動記録を登録</button>
    <button :disabled="recurringBusy" @click="applyRecurring">{{recurringBusy ? "確認中…" : "未記録分を確認"}}</button>
    <p role="status">{{recurringMessage}}</p>
    <div v-for="p in plans" :key="p.id" class="finance-row">{{p.name}} {{yen(p.amount)}} · 毎月{{p.day}}日 · {{p.paymentSource || "未設定"}} · 次回 {{nextScheduledDate(p.day)}} <button @click="removePlan(p.id)">削除</button></div>
  </article>
  <article class="finance-panel">
    <h2>カード請求額の参考比較</h2>
    <p>明細に設定した支払方法・カード名と一致する支出だけを集計します。未設定の取引は含まれません。請求月と利用月の違いにご注意ください。</p>
    <div class="finance-inputs"><input v-model="bill.name" placeholder="カード名" aria-label="カード名"><input v-model="bill.month" type="month" aria-label="対象月"><input v-model="bill.amount" type="number" min="1" placeholder="請求額" aria-label="請求額"></div>
    <button @click="addBill">請求額を追加</button>
    <div v-for="b in bills" :key="b.id" class="finance-row">{{b.name}} {{b.month}} 請求 {{yen(b.amount)}} <template v-if="loaded">／カード別支出 {{yen(reconcileStatement(monthExpenses(b.month,b.name),b.amount).sum)}}／差 {{yen(reconcileStatement(monthExpenses(b.month,b.name),b.amount).difference)}}</template> <button @click="removeBill(b.id)">削除</button></div>
  </article>
</section>
</template>
<style scoped>
.finance-tools{display:grid;gap:14px}.finance-panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:15px;display:grid;gap:10px}.finance-panel h2{font-size:17px;margin:0}.finance-panel p{font-size:13px;color:var(--muted);margin:0}.finance-panel button{border:1px solid var(--line);border-radius:10px;background:var(--tint);color:var(--ink);padding:9px}.finance-panel label{font-size:13px}.finance-panel input[type=file]{display:block;max-width:100%}.finance-inputs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.finance-inputs input,.finance-inputs select{width:100%;min-width:0;border:1px solid var(--line);border-radius:8px;padding:9px 5px;background:var(--card);color:var(--ink)}.finance-inputs label{min-width:0;font-size:12px;color:var(--muted)}.finance-inputs label select{display:block;color:var(--ink)}.finance-row{font-size:13px;padding:8px 0;border-bottom:1px solid var(--line)}.finance-row button{margin-left:6px}
</style>
