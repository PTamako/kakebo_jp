<script setup>
import { ref, computed, onMounted } from 'vue'
import { validateBackup, transactionKey, nextScheduledDate } from './finance-tools.js'
const props = defineProps({ api: { type: Function, required: true }, categories: { type: Array, default: () => [] }, paymentSources: { type: Array, default: () => [] } })
const emit = defineEmits(['ledger-updated', 'update-payment-sources', 'open-duplicate'])

const cardMode = ref('')
const selectedCard = ref('')
const editedCardName = ref('')
const closingDays = ref((() => { try { return JSON.parse(localStorage.getItem('kakeibo-card-closing-days') || '{}') || {} } catch { return {} } })())
const defaultClosingDay = name => {
  const normalized = String(name || '').normalize('NFKC').toLowerCase().replace(/[\\s　・（）()_-]/g, '')
  if (/セゾン|saison/.test(normalized)) return '10'
  if (/セブンカード|7card/.test(normalized)) return '15'
  return '末日'
}
const closingDayFor = name => closingDays.value[name] || defaultClosingDay(name)
function selectCardForEdit() {
  if (!selectedCard.value) return
  editedCardName.value = selectedCard.value
  cardMode.value = 'edit'
}
function saveClosingDay(name, day) {
  if (!name || (day !== '' && day !== '末日' && !(Number.isInteger(Number(day)) && Number(day) >= 1 && Number(day) <= 31))) return
  closingDays.value = {...closingDays.value, [name]: day}
  localStorage.setItem('kakeibo-card-closing-days', JSON.stringify(closingDays.value))
  cardMessage.value = '締め日を更新しました。利用額は新しい締め期間で再計算されます'
}
async function renameCard() {
  const name = editedCardName.value.trim(), old = selectedCard.value
  if (!old || old === '現金' || !name || name.length > 80 || (name !== old && props.paymentSources.includes(name))) {
    cardMessage.value = '名称を確認してください（重複・現金の変更不可）'
    return
  }
  if (name !== old) {
    if (busy.value) return
    busy.value = true
    try {
      // Commit the ledger rename on D1 before updating local display names.
      const result = await props.api('payment-sources/rename', {method:'POST',body:JSON.stringify({oldName:old,newName:name})})
      rows.value = rows.value.map(e => e.payment_source === old ? {...e,payment_source:name} : e)
      plans.value = plans.value.map(p => p.paymentSource === old ? {...p,paymentSource:name} : p)
      localStorage.setItem('kakeibo-plans',JSON.stringify(plans.value))
      const updated = {...closingDays.value,[name]:closingDays.value[old] || ''}
      delete updated[old]
      closingDays.value = updated
      localStorage.setItem('kakeibo-card-closing-days',JSON.stringify(updated))
      emit('update-payment-sources',props.paymentSources.map(x => x === old ? name : x))
      if (bill.value.name === old) bill.value.name = name
      selectedCard.value = name
      cardMessage.value = '名称を変更し、過去の明細 '+(result?.changes ?? 0)+'件と固定支出の設定を引き継ぎました'
      emit('ledger-updated')
    } catch(e) {
      cardMessage.value = '名称変更に失敗しました：'+e.message
      return
    } finally { busy.value = false }
  }
  cardMode.value = ''
}
const cardPeriod = computed(() => {
  const match = /^(\d{4})-(\d{2})$/.exec(bill.value.month)
  const day = closingDayFor(bill.value.name)
  if (!match || !day) return null
  const year = Number(match[1]), month = Number(match[2])
  if (month < 1 || month > 12) return null
  const last = (y,m) => new Date(Date.UTC(y,m,0)).getUTCDate()
  const cutoff = (y,m) => day === '末日' ? last(y,m) : Math.min(Number(day),last(y,m))
  const previous = new Date(Date.UTC(year,month-2,1))
  const py = previous.getUTCFullYear(), pm = previous.getUTCMonth()+1
  const start = new Date(Date.UTC(py,pm-1,cutoff(py,pm)+1)).toISOString().slice(0,10)
  const end = [year,String(month).padStart(2,'0'),String(cutoff(year,month)).padStart(2,'0')].join('-')
  return {start,end}
})
const newPaymentSource = ref('')
const cardMessage = ref('')
function addPaymentSource() {
  const name = newPaymentSource.value.trim()
  if (!name || name.length > 80) { cardMessage.value = '名称は1～80文字で入力してください'; return }
  if (props.paymentSources.includes(name)) { cardMessage.value = '同じ名前が登録されています'; return }
  emit('update-payment-sources', [...props.paymentSources, name])
  newPaymentSource.value = ''
  cardMode.value = ''
  cardMessage.value = name + 'を追加しました'
}
function removePaymentSource(name) {
  if (name === '現金') return
  if (!confirm(name + 'を選択肢から削除しますか？過去の明細や固定支出、請求データは削除されません。')) return
  emit('update-payment-sources', props.paymentSources.filter(x => x !== name))
  selectedCard.value = ''
  cardMode.value = ''
  cardMessage.value = name + 'を選択肢から削除しました。過去の記録は保持されます'
}

const rows = ref([])
const loaded = ref(false)
const lastLoadedAt = ref(null)
const lastLoadedLabel = computed(() => lastLoadedAt.value ? new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(lastLoadedAt.value) : '')
const busy = ref(false)
const message = ref('')
const restoreRows = ref([])
const plans = ref(JSON.parse(localStorage.getItem('kakeibo-plans') || '[]'))
const bills = ref(JSON.parse(localStorage.getItem('kakeibo-bills') || '[]'))
const categoryJapaneseLabels = {'餐饮':'外食','饮食料品':'飲食料品','购物':'買い物','居住':'住居費','医疗':'医療費','娱乐':'娯楽','宠物':'ペット','其他':'その他','日用品':'日用品','交通':'交通費'}
const categoryLabel = category => categoryJapaneseLabels[category] || category
const plan = ref({name:'',amount:'',day:1,category:'',paymentSource:'現金'})
const bill = ref({name:'',month:new Date().toLocaleDateString('sv-SE').slice(0,7)})
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
    rows.value=all;loaded.value=true;lastLoadedAt.value=new Date();message.value=all.length+'件の明細を読み込みました'
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
  if(!plan.value.name.trim()||!(Number(plan.value.amount)>0)||!Number.isInteger(Number(plan.value.day))||Number(plan.value.day)<1||Number(plan.value.day)>31||!props.categories.includes(plan.value.category)||!props.paymentSources.includes(plan.value.paymentSource)){message.value='名称・金額・登録日・カテゴリー・支払方法を選択してください';return}
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
const monthExpenses=(period,source)=>period ? rows.value.filter(e=>e.date>=period.start&&e.date<=period.end&&e.type==='expense'&&e.payment_source===source) : []
const cardTransactions=computed(()=>monthExpenses(cardPeriod.value,bill.value.name))
const cardTotal=computed(()=>cardTransactions.value.reduce((sum,e)=>sum+Number(e.amount||0),0))
</script>
<template>
<section class="finance-tools">
  <div class="finance-page-heading"><h1 class="finance-heading">管理・照合</h1><button type="button" class="finance-global-load" :disabled="busy" @click="loadAll"><span aria-hidden="true" class="finance-refresh-icon">↻</span>{{busy ? "読み込み中…" : "全明細を更新"}}</button></div>
  <p class="finance-last-loaded" role="status">{{loaded ? "最終更新："+lastLoadedLabel+" · "+rows.length+"件読み込み済み" : "全明細は未読み込みです"}}</p>
  <article class="finance-panel">
    <h2>支払方法・カード管理</h2>
    <div class="finance-inputs card-controls">
      <select v-model="selectedCard" aria-label="管理するカード"><option value="" disabled>支払方法・カードを選択</option><option v-for="source in props.paymentSources" :key="source" :value="source">{{source}}</option></select>
      <button type="button" :disabled="!selectedCard" @click="selectCardForEdit">編集</button>
      <button type="button" @click="cardMode = 'add'">追加</button>
    </div>
    <div v-if="cardMode === 'add'" class="finance-inputs card-controls">
      <input v-model="newPaymentSource" maxlength="80" placeholder="新しいカード名・支払方法" aria-label="新しい支払方法">
      <button type="button" @click="addPaymentSource">保存</button>
      <button type="button" @click="cardMode = ''">キャンセル</button>
    </div>
    <div v-if="cardMode === 'edit' && selectedCard" class="card-editor">
      <label>名称<input v-model="editedCardName" maxlength="80" :disabled="selectedCard === '現金'" aria-label="カード名を編集"></label>
      <label v-if="!['現金','その他','Suica'].includes(selectedCard)">締め日
        <select :value="closingDayFor(selectedCard)" @change="saveClosingDay(selectedCard,$event.target.value)">
          <option v-for="day in 31" :key="day" :value="String(day)">{{day}}日</option><option value="末日">月末</option>
        </select>
      </label>
      <div class="finance-inputs card-edit-actions">
        <button type="button" @click="renameCard">保存</button>
        <button type="button" @click="cardMode = ''">閉じる</button>
        <button v-if="selectedCard !== '現金'" type="button" @click="removePaymentSource(selectedCard)">削除</button>
      </div>
    </div>
    <p v-if="cardMessage" role="status">{{cardMessage}}</p>
  </article>
  <article class="finance-panel">
    <h2>バックアップ・復元</h2>
    <div class="finance-actions backup-actions"><button type="button" :disabled="busy||!loaded" @click="downloadBackup">JSON を保存</button><label class="backup-upload" :class="{ 'is-disabled': busy||!loaded }">バックアップを選択<input type="file" accept=".json,application/json" :disabled="busy||!loaded" @change="preview"></label></div>
    <button v-if="restoreRows.length" :disabled="busy" @click="restore">追加候補 {{restoreRows.length}} 件を確認して復元</button>
    <p v-if="message" role="status">{{message}}</p>
  </article>
  <article class="finance-panel">
    <h2>重複の可能性</h2>
    <p v-if="!loaded">上部の「全明細を更新」で表示します。</p>
    <p v-else-if="!duplicates.length">重複候補はありません。</p>
    <button v-for="(group,i) in duplicates.slice(0,30)" :key="i" type="button" class="finance-row duplicate-link" @click="emit('open-duplicate', group[0].date)">{{group[0].date}} {{group[0].merchant}} {{yen(group[0].amount)}} · {{group.length}}件 <span>明細を見る ›</span></button>
  </article>
  <article class="finance-panel">
    <h2>毎月の固定支出</h2>
    <div class="finance-inputs recurring-name-amount"><input v-model="plan.name" placeholder="名称" aria-label="固定支出名"><input v-model="plan.amount" type="number" min="1" placeholder="金額" aria-label="固定支出額"></div>
    <div class="finance-inputs recurring-details"><label>毎月の登録日<select v-model.number="plan.day" aria-label="毎月の登録日"><option v-for="day in 31" :key="day" :value="day">{{day}}日</option></select></label><label>カテゴリー<select v-model="plan.category" aria-label="固定支出カテゴリ"><option value="" disabled>選択してください</option><option v-for="category in props.categories" :key="category" :value="category">{{categoryLabel(category)}}</option></select></label><label>支払方法・カード<select v-model="plan.paymentSource" aria-label="固定支出支払方法"><option v-for="source in props.paymentSources" :key="source" :value="source">{{source}}</option><option v-if="plan.paymentSource && !props.paymentSources.includes(plan.paymentSource)" :value="plan.paymentSource">{{plan.paymentSource}}（既存の設定）</option></select></label></div>
    <div class="finance-actions"><button @click="addPlan(); applyRecurring()">自動記録を登録</button>
    <button :disabled="recurringBusy" @click="applyRecurring">{{recurringBusy ? "確認中…" : "未記録分を確認"}}</button></div>
    <p v-if="recurringMessage" role="status">{{recurringMessage}}</p>
    <div v-for="p in plans" :key="p.id" class="finance-row">{{p.name}} {{yen(p.amount)}} · 毎月{{p.day}}日 · {{p.paymentSource || "未設定"}} · 次回 {{nextScheduledDate(p.day)}} <button @click="removePlan(p.id)">削除</button></div>
  </article>
  <article class="finance-panel">
    <h2>カード別利用額</h2>
    <div class="finance-inputs card-billing-fields">
      <label>カード<select v-model="bill.name" aria-label="カード名"><option value="" disabled>カードを選択</option><option v-for="source in props.paymentSources.filter(x => !['現金','その他','Suica'].includes(x))" :key="source" :value="source">{{source}}</option><option v-if="bill.name && !props.paymentSources.includes(bill.name)" :value="bill.name">{{bill.name}}（既存の設定）</option></select></label>
      <label>締め月<input class="card-closing-month" v-model="bill.month" type="month" aria-label="締め月"></label>
      <label>利用額<output class="card-usage-total" aria-live="polite">{{loaded && bill.name && cardPeriod ? yen(cardTotal) : "—"}}</output></label>
    </div>
    <p v-if="!loaded">集計するには「全明細を更新」を押してください。</p>
    <div v-else-if="bill.name && cardPeriod" class="finance-row">
      <strong>{{bill.name}} · {{bill.month}}締め</strong><span>{{cardPeriod.start}} ～ {{cardPeriod.end}}</span>
      <strong>{{yen(cardTotal)}}</strong>
      <span>{{cardTransactions.length}}件の支出</span>
    </div>
    <p v-else>カードと締め月を選択し、カード管理で締め日を設定してください。</p>
  </article>
</section>
</template>
<style scoped>
.finance-tools{display:grid;gap:10px}.finance-heading{margin:0 0 2px;font-size:21px;line-height:1.3}.finance-panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px;display:grid;gap:8px}.finance-panel h2{font-size:17px;margin:0}.finance-panel p{font-size:13px;color:var(--muted);margin:0}.finance-panel button{border:1px solid var(--line);border-radius:10px;background:var(--tint);color:var(--ink);padding:9px}.finance-panel label{font-size:13px}.finance-panel input[type=file]{display:block;max-width:100%}.finance-inputs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.finance-inputs input,.finance-inputs select{width:100%;min-width:0;height:44px;min-height:44px;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:9px 5px;background:var(--card);color:var(--ink)}.finance-inputs label{min-width:0;font-size:12px;color:var(--muted)}.finance-inputs label select{display:block;color:var(--ink)}.finance-row{font-size:13px;padding:8px 0;border-bottom:1px solid var(--line)}.finance-row button{margin-left:6px}
.duplicate-link{width:100%;display:flex;justify-content:space-between;align-items:center;text-align:left;cursor:pointer;border:1px solid var(--line);background:var(--card);color:inherit;border-radius:10px;padding:10px}.duplicate-link span{white-space:nowrap;color:var(--blue-dark);font-weight:700;margin-left:8px}.card-controls{grid-template-columns:minmax(0,1fr) auto auto}.card-editor{display:grid;gap:10px}.card-editor label{display:grid;gap:4px}.card-editor input,.card-editor select{width:100%;min-width:0;height:44px;min-height:44px;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:9px;background:var(--card);color:var(--ink)}.recurring-name-amount{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.recurring-details{grid-template-columns:repeat(3,minmax(0,1fr))}.recurring-name-amount input,.recurring-details select{height:44px;box-sizing:border-box;font:inherit}.recurring-details label{max-width:100%;min-width:0}.card-usage-total{display:flex;align-items:center;height:44px;min-height:44px;box-sizing:border-box;padding:9px 7px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}.card-billing-fields{align-items:end}.card-billing-fields>label{display:flex;flex-direction:column;min-width:0;gap:4px}.card-billing-fields select,.card-billing-fields input.card-closing-month,.card-billing-fields .card-usage-total{display:flex;width:100%;height:44px!important;min-height:44px!important;max-height:44px!important;box-sizing:border-box;margin:0;line-height:normal;align-items:center}.card-billing-fields input.card-closing-month{-webkit-appearance:none;appearance:none;display:block;padding:0 4px;font-size:13px;min-width:0}.card-billing-fields input.card-closing-month::-webkit-date-and-time-value{min-height:0;text-align:left}.card-billing-fields input.card-closing-month::-webkit-datetime-edit{padding:0;line-height:42px}.card-billing-fields input.card-closing-month::-webkit-calendar-picker-indicator{margin:0;padding:0;max-width:16px}.finance-tools{min-width:0}.finance-panel{min-width:0}.finance-panel button,.finance-panel input,.finance-panel select,.finance-panel output{font-family:inherit}.finance-panel button{min-height:44px;box-sizing:border-box;font-size:13px;font-weight:650;line-height:1.25;cursor:pointer}.finance-panel button:disabled{opacity:.5;cursor:not-allowed}.finance-panel label{min-width:0;display:flex;flex-direction:column;gap:4px;line-height:1.3}.finance-panel input:not([type=file]),.finance-panel select{height:44px!important;min-height:44px!important;max-height:44px!important;box-sizing:border-box;margin:0;line-height:normal}.finance-panel .card-usage-total{height:44px;min-height:44px;max-height:44px;box-sizing:border-box}.finance-panel input[type=file]{width:100%;box-sizing:border-box;font-size:12px}.finance-panel input[type=file]::file-selector-button{min-height:40px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--tint);color:var(--ink)}.finance-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.finance-actions button{width:100%;min-width:0}.finance-inputs{align-items:end;gap:8px}.card-controls{grid-template-columns:minmax(0,1fr) auto auto}.card-controls button{padding-inline:12px}.card-edit-actions{grid-template-columns:repeat(3,minmax(0,1fr))}.card-editor{gap:8px}.recurring-name-amount,.recurring-details{align-items:end}.finance-row{min-width:0;overflow-wrap:anywhere}.card-billing-fields{grid-template-columns:repeat(3,minmax(0,1fr))}.card-billing-fields>label{min-width:0;justify-content:flex-end}.card-billing-fields .card-closing-month{width:100%;font-size:13px!important;padding:0 4px!important}.card-billing-fields .card-usage-total{min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:13px;padding:0 5px}.finance-panel :focus-visible{outline:2px solid var(--blue);outline-offset:2px}@media(max-width:360px){.finance-panel{padding:10px}.finance-inputs{gap:5px}.card-controls button{padding-inline:8px}.card-billing-fields .card-closing-month{font-size:12px!important}}.finance-section-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}.finance-section-heading h2{margin:0}.finance-page-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.finance-page-heading .finance-heading{margin:0;min-width:0}.finance-global-load{flex:none;max-width:64%;min-height:40px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--tint);color:var(--ink);font-size:12px;font-weight:600;white-space:normal;text-align:center}.finance-global-load:disabled{opacity:.6}.finance-global-load{display:inline-flex;align-items:center;justify-content:center;gap:5px}.finance-refresh-icon{font-size:19px;line-height:1}.finance-last-loaded{margin:-5px 0 12px;color:var(--muted);font-size:12px}@media(max-width:360px){.finance-global-load{font-size:11px;padding:6px 8px}}.backup-actions{grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch}.backup-upload{position:relative;display:flex;align-items:center;justify-content:center;min-width:0;min-height:44px;padding:8px 6px;border:1px solid var(--line);border-radius:9px;background:var(--tint);color:var(--ink);font-size:12px;font-weight:600;text-align:center;cursor:pointer;box-sizing:border-box}.backup-upload input[type=file]{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none}.backup-upload.is-disabled{opacity:.55;cursor:not-allowed}.backup-upload:focus-within{outline:2px solid var(--blue);outline-offset:2px}.backup-actions button{min-width:0;min-height:44px;font-size:12px;white-space:normal}</style>
