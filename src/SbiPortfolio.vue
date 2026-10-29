<script setup>
import { computed, onMounted, ref, watch } from 'vue'

const emit = defineEmits(['migration-status'])
const props = defineProps({
  api: { type: Function, required: true },
  transferLoading: { type: Boolean, default: false }
})
const today = () => new Date().toLocaleDateString('sv-SE')
const month = ref(today().slice(0, 7))
const data = ref(null)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const editing = ref('')
const existingIdentity = ref(false)
const knownFunds = [
  { code:'0331418A', name:'eMAXIS Slim 全世界株式（オール・カントリー）', account:'tsumitate' },
  { code:'03311187', name:'eMAXIS Slim 米国株式（S&P500）', account:'tsumitate' },
  { code:'0331A172', name:'eMAXIS Slim 先進国債券インデックス（除く日本）', account:'growth' },
  { code:'04317188', name:'iFreeNEXT NASDAQ100インデックス', account:'tsumitate' }
]
const nextMonth = value => {
  const [year,month] = value.split('-').map(Number)
  return new Date(Date.UTC(year,month,1)).toISOString().slice(0,7)
}
const emptyPlan = () => ({fundCode:'',fundName:'',accountType:'tsumitate',monthlyAmount:0,orderDay:9,enabled:true,effectiveMonth:month.value})
const emptyHolding = () => ({fundCode:'',fundName:'',accountType:'tsumitate',units:0,acquisitionCost:0})
const emptyPrice = () => ({fundCode:'',navPer10000:0,priceDate:today()})
const plan = ref(emptyPlan())
const holding = ref(emptyHolding())
const price = ref(emptyPrice())
const editingTransfer = ref(null)
const newPurchaseMonth = ref('')
const yen = value => '¥' + Number(value || 0).toLocaleString('ja-JP')
const signYen = value => (value > 0 ? '+' : '') + yen(value)
const accountLabel = code => code === 'growth' ? '成長投資枠' : code === 'combined' ? '成長＋つみたて（合算）' : 'つみたて投資枠'
const availableFunds = computed(() => {
  const items = new Map(knownFunds.map(item => [item.code,item]))
  for(const p of [...(data.value?.plans || []),...(data.value?.holdings || [])]){
    items.set(p.fund_code,{code:p.fund_code,name:p.fund_name,account:p.account_type})
  }
  return [...items.values()]
})
function fillFund(target) {
  const match = availableFunds.value.find(item=>item.code===target.fundCode)
  if(match){target.fundName=match.name; if(editing.value==='plan')target.accountType=match.account}
}
let loadSequence = 0
async function load() {
  const sequence = ++loadSequence
  const targetMonth = month.value
  loading.value = true
  error.value = ''
  try {
    const response = await props.api('investment-portfolio?month=' + targetMonth)
    if (sequence !== loadSequence || targetMonth !== month.value) return
    data.value = response
    emit('migration-status', false)
  } catch(e) {
    if (sequence !== loadSequence || targetMonth !== month.value) return
    error.value = e.message
    data.value = null
    emit('migration-status', /投資テーブルの移行が未実施/.test(e.message))
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}
function editPlan(p) {
  existingIdentity.value = !!p
  editing.value = 'plan'
  plan.value = p ? {
    fundCode:p.fund_code,fundName:p.fund_name,accountType:p.account_type,
    monthlyAmount:Number(p.monthly_amount),orderDay:Number(p.order_day),
    enabled:!!p.enabled,effectiveMonth:nextMonth(month.value)
  } : emptyPlan()
}
function editHolding(h) {
  existingIdentity.value = !!h
  editing.value = 'holding'
  holding.value = h ? {
    fundCode:h.fund_code,fundName:h.fund_name,accountType:h.account_type,
    units:Number(h.units),acquisitionCost:Number(h.acquisition_cost)
  } : emptyHolding()
}
function editPrice(h) {
  editing.value = 'price'
  price.value = {
    fundCode:h.fund_code,
    navPer10000:Number(h.nav_per_10000||0),
    priceDate:h.price_date||today()
  }
}
async function submit(path, body, message) {
  saving.value = true
  notice.value = ''
  try{
    await props.api('investment-portfolio/' + path,{method:'PUT',body:JSON.stringify(body)})
    editing.value=''
    editingTransfer.value=null
    await load()
    notice.value=message
  }catch(e){ error.value = e.message }
  finally{ saving.value=false }
}
async function initialize() {
  saving.value=true
  try{
    await props.api('investment-portfolio/initialize',{method:'POST'})
    await load()
    notice.value='積立設定を登録しました'
  }catch(e){error.value=e.message}
  finally{saving.value=false}
}
async function submitTransfer() {
  await submit('transfer-month',{entryId:Number(editingTransfer.value),purchaseMonth:newPurchaseMonth.value},'買付月を更新しました')
}
// Refresh after existing due-transfer processing completes, so the asset
// reconciliation cannot be stale if it raced the automatic due-date update.
watch(() => props.transferLoading, (busy, previous) => { if (previous && !busy) void load() })
onMounted(load)
</script>

<template>
  <div class="sbi-portfolio">
    <div class="sbi-section-title">
      <div><h2>SBI証券・積立管理</h2><p>資産移動と積立予定を照合</p></div>
      <button type="button" class="sbi-plain-button" @click="load" :disabled="loading">↻ 更新</button>
    </div>
    <div class="sbi-period">
      <label>対象月 <input v-model="month" type="month" @change="load" /></label>
      <span v-if="loading">読込中…</span>
    </div>
    <p v-if="error" class="sbi-error" role="alert">{{error}}</p>
    <p v-if="error && /投資テーブルの移行が未実施/.test(error)" class="sbi-hint">既存の家計簿・評価額はそのまま使えます。D1の追加テーブル適用後に更新してください。</p>
    <p v-if="notice" class="sbi-success" role="status">{{notice}}</p>
    <template v-if="data">
      <article class="panel sbi-reconcile">
        <span class="sbi-overline">積立予定 / 資産移動</span>
        <div class="sbi-money">
          <strong>{{yen(data.reconciliation.monthly_amount)}}</strong>
          <span>明細から自動集計：振替済 {{yen(data.reconciliation.funded)}}</span>
        </div>
        <div class="sbi-progress" role="progressbar" :aria-valuemax="Math.max(1,data.reconciliation.monthly_amount)" :aria-valuenow="Math.min(data.reconciliation.monthly_amount,data.reconciliation.funded)">
          <span :style="{width:Math.min(100,100*data.reconciliation.funded/Math.max(1,data.reconciliation.monthly_amount))+'%'}"></span>
        </div>
        <p v-if="data.reconciliation.pending">反映待ち：{{yen(data.reconciliation.pending)}}</p>
        <p v-if="data.reconciliation.funded && data.reconciliation.difference===0" class="sbi-success">予定額と振替実績が一致しています</p>
        <p v-if="data.reconciliation.difference!==0" class="sbi-hint">
          {{data.reconciliation.difference>0?'振替超過':'振替不足'}}：{{yen(Math.abs(data.reconciliation.difference))}}
        </p>
        <p class="sbi-hint">期日反映は家計簿上の処理です。証券口座への着金・買付成立を意味しません。</p>
      </article>

      <article class="panel sbi-card">
        <div class="sbi-line-heading"><h3>毎月の積立設定</h3><button class="sbi-plain-button" type="button" @click="editPlan(null)">＋ 銘柄を追加</button></div>
        <div v-if="!data.plans.length" class="sbi-empty">
          <p>まだ積立設定がありません</p>
          <button type="button" class="button-secondary" :disabled="saving" @click="initialize">4銘柄・月15,000円の設定を登録</button>
        </div>
        <div v-for="p in data.plans" :key="p.fund_code+p.account_type" class="sbi-fund-row">
          <div class="sbi-fund-info"><strong>{{p.fund_name}}</strong>
            <small>{{p.fund_code}} · {{accountLabel(p.account_type)}} · 毎月{{p.order_day}}日</small>
            <small v-if="!p.enabled">積立停止中（保有分は継続）</small>
          </div>
          <div class="sbi-fund-numbers"><strong>{{p.enabled ? yen(p.monthly_amount) : '停止中'}}</strong>
            <button type="button" class="sbi-plain-button" @click="editPlan(p)">変更</button></div>
        </div>
      </article>

      <article class="panel sbi-card">
        <div class="sbi-line-heading"><h3>振替と買付月</h3><span>{{data.transfers.length}}件</span></div>
        <p class="sbi-hint">振替日からの買付月は推定です。翌月買付分などは「変更」で修正できます。</p>
        <p v-if="!data.transfers.length" class="sbi-empty">対象月の振替はありません</p>
        <div v-for="t in data.transfers" :key="t.id" class="sbi-transfer-row">
          <div><strong>{{yen(t.amount)}}</strong>
            <small>{{t.transfer_date||t.date}} · {{Number(t.transfer_applied)===1?'記帳上反映済':'反映待ち'}}</small>
          </div>
          <div class="sbi-fund-numbers"><small>{{t.effective_month}} {{t.inferred?'（推定）':''}}</small>
            <button class="sbi-plain-button" type="button" @click="editingTransfer=t.id;newPurchaseMonth=t.effective_month">買付月を変更</button></div>
        </div>
      </article>

      <article class="panel sbi-card">
        <div class="sbi-line-heading"><h3>投資信託の保有</h3><button class="sbi-plain-button" type="button" @click="editHolding(null)">＋ 保有を追加</button></div>
        <p v-if="data.valuation.value!==null" class="sbi-value">{{yen(data.valuation.value)}} <small :class="data.valuation.pnl>=0?'sbi-positive':'sbi-negative'">損益 {{signYen(data.valuation.pnl)}}</small></p>
        <p v-else class="sbi-hint">保有口数・取得金額・基準価額の登録後に評価額を計算します。</p>
        <p v-if="data.holdings.some(h=>h.valuation_source==='sbi_screenshot')" class="sbi-hint">初期の評価額は2026/10/30のSBI画面から登録した値です。基準価額・口数の更新後は自動計算に切り替わります。</p>
        <p v-if="!data.holdings.length" class="sbi-empty">保有情報は未登録です（以前の手入力評価額は保存されています）</p>
        <div v-for="h in data.holdings" :key="h.fund_code+h.account_type" class="sbi-fund-row">
          <div class="sbi-fund-info">
            <strong>{{h.fund_name}}</strong>
            <small>{{h.fund_code}} · {{accountLabel(h.account_type)}}</small>
            <small>保有 {{Number(h.units).toLocaleString('ja-JP')}}口 · 取得 {{yen(h.acquisition_cost)}}</small>
            <small>基準価額：{{h.nav_per_10000 ? yen(h.nav_per_10000) : '未設定'}} {{h.price_date ? '('+(h.source==='sbi_screenshot'?'画面確認日 ':'基準日 ')+h.price_date+')' : ''}}</small>
          </div>
          <div class="sbi-fund-numbers"><strong>{{h.market_value===null?'—':yen(h.market_value)}}</strong>
            <small v-if="h.pnl!==null" :class="h.pnl>=0?'sbi-positive':'sbi-negative'">{{signYen(h.pnl)}}</small>
            <button type="button" class="sbi-plain-button" @click="editHolding(h)">口数・取得額</button>
            <button type="button" class="sbi-plain-button" @click="editPrice(h)">基準価額</button>
          </div>
        </div>
        <p class="sbi-hint">現在、基準価額は手動登録です。自動取得は利用条件を確認後に追加します。毎月の振替は買付予定と照合しますが、実際の約定口数・取得金額はSBIで確認して更新してください。</p>
      </article>
    </template>

    <div v-if="editing || editingTransfer!==null" class="sbi-overlay" @click.self="!saving&&(editing='',editingTransfer=null)">
      <form v-if="editing==='plan'" class="sbi-dialog" @submit.prevent="submit('plan',{...plan,monthlyAmount:Number(plan.monthlyAmount),orderDay:Number(plan.orderDay)},'積立設定を保存しました')">
        <div class="sbi-line-heading"><h3>積立設定</h3><button type="button" class="sbi-close" @click="editing=''">×</button></div>
        <label>銘柄コード<input v-model.trim="plan.fundCode" maxlength="8" required :disabled="existingIdentity" placeholder="03311187" @input="plan.fundCode=plan.fundCode.toUpperCase();fillFund(plan)"/></label>
        <label>銘柄名<input v-model.trim="plan.fundName" maxlength="120" required /></label>
        <label>口座区分<select v-model="plan.accountType" :disabled="existingIdentity"><option value="tsumitate">NISA（つみたて）</option><option value="growth">NISA（成長）</option></select></label>
        <label>毎月の積立額（円）<input v-model.number="plan.monthlyAmount" type="number" min="0" step="1" required /></label>
        <label>注文希望日<input v-model.number="plan.orderDay" type="number" min="1" max="28" required /></label>
        <label>適用開始月<input v-model="plan.effectiveMonth" type="month" required /></label><p class="sbi-hint">変更は指定した月以降に適用され、以前の月は変更されません。</p>
        <label class="sbi-checkbox"><input v-model="plan.enabled" type="checkbox"/>積立中</label>
        <div class="sbi-actions"><button type="button" class="button-secondary" @click="editing=''">キャンセル</button><button class="button-primary" type="submit" :disabled="saving">保存</button></div>
      </form>
      <form v-else-if="editing==='holding'" class="sbi-dialog" @submit.prevent="submit('holding',{...holding,units:Number(holding.units),acquisitionCost:Number(holding.acquisitionCost)},'保有情報を更新しました')">
        <div class="sbi-line-heading"><h3>保有口数・取得金額</h3><button type="button" class="sbi-close" @click="editing=''">×</button></div>
        <label>銘柄コード<input v-model.trim="holding.fundCode" maxlength="8" required :disabled="existingIdentity" @input="holding.fundCode=holding.fundCode.toUpperCase();fillFund(holding)" /></label>
        <label>銘柄名<input v-model.trim="holding.fundName" maxlength="120" required /></label>
        <label>口座区分<select v-model="holding.accountType" :disabled="existingIdentity"><option value="tsumitate">NISA（つみたて）</option><option value="growth">NISA（成長）</option><option value="combined">NISA（成長＋つみたて 合算）</option></select></label>
        <label>保有口数<input v-model.number="holding.units" type="number" min="0" step="1" required /></label>
        <label>取得金額（円）<input v-model.number="holding.acquisitionCost" type="number" min="0" step="1" required /></label>
        <div class="sbi-actions"><button type="button" class="button-secondary" @click="editing=''">キャンセル</button><button class="button-primary" type="submit" :disabled="saving">保存</button></div>
      </form>
      <form v-else-if="editing==='price'" class="sbi-dialog" @submit.prevent="submit('price',{...price,navPer10000:Number(price.navPer10000)},'基準価額を更新しました')">
        <div class="sbi-line-heading"><h3>基準価額</h3><button type="button" class="sbi-close" @click="editing=''">×</button></div>
        <p>銘柄コード：{{price.fundCode}}</p>
        <label>基準価額（1万口当たり円）<input v-model.number="price.navPer10000" type="number" min="1" step="1" required /></label>
        <label>基準日<input v-model="price.priceDate" type="date" required /></label>
        <div class="sbi-actions"><button type="button" class="button-secondary" @click="editing=''">キャンセル</button><button class="button-primary" type="submit" :disabled="saving">保存</button></div>
      </form>
      <form v-else-if="editingTransfer!==null" class="sbi-dialog" @submit.prevent="submitTransfer">
        <div class="sbi-line-heading"><h3>振替の買付月</h3><button class="sbi-close" type="button" @click="editingTransfer=null">×</button></div>
        <label>対象月<input v-model="newPurchaseMonth" type="month" required /></label>
        <div class="sbi-actions"><button type="button" class="button-secondary" @click="editingTransfer=null">キャンセル</button><button type="submit" class="button-primary" :disabled="saving">保存</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.sbi-portfolio{display:grid;gap:12px;min-width:0}
.sbi-section-title,.sbi-line-heading{display:flex;justify-content:space-between;align-items:center;gap:10px}
.sbi-section-title h2,.sbi-line-heading h3{font-size:16px;margin:0}
.sbi-section-title p{font-size:11px;color:var(--muted);margin:3px 0 0}
.sbi-line-heading{margin-bottom:12px}
.sbi-line-heading>span,.sbi-hint,.sbi-card small,.sbi-overline{font-size:11px;color:var(--muted)}
.sbi-period{display:flex;justify-content:space-between;align-items:center;gap:10px;color:var(--muted);font-size:12px}
.sbi-period label{display:flex;align-items:center;gap:8px}
.sbi-period input{width:auto;max-width:150px;border:1px solid var(--line);border-radius:10px;padding:7px;background:var(--card);color:var(--ink)}
.sbi-card,.sbi-reconcile{padding:15px}
.sbi-reconcile{display:grid;gap:10px}
.sbi-reconcile p{margin:0}
.sbi-money{display:flex;flex-direction:column;gap:5px}
.sbi-money strong{font-size:25px;line-height:1.1}
.sbi-money>span{font-size:13px;color:var(--muted)}
.sbi-progress{height:8px;background:var(--line);border-radius:99px;overflow:hidden}
.sbi-progress>span{height:100%;display:block;background:var(--blue);border-radius:inherit}
.sbi-plain-button{border:0;background:transparent;color:var(--blue-dark);font-weight:750;font-size:12px;padding:8px 4px;min-height:35px}
.sbi-fund-row,.sbi-transfer-row{display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--line);padding:11px 0}
.sbi-fund-info,.sbi-fund-numbers,.sbi-transfer-row>div{display:flex;flex-direction:column;gap:5px;min-width:0}
.sbi-fund-info{flex:1}
.sbi-fund-info strong{font-size:12px;overflow-wrap:anywhere}
.sbi-fund-numbers{text-align:right;align-items:flex-end;min-width:92px}
.sbi-fund-numbers strong{font-size:14px;font-variant-numeric:tabular-nums}
.sbi-positive{color:#23856b!important}.sbi-negative{color:#ca5364!important}
.sbi-value{font-size:25px;font-weight:800;margin:5px 0 12px}
.sbi-value small{font-size:12px;margin-left:8px}
.sbi-empty{text-align:center;font-size:12px;padding:14px 0;color:var(--muted)}
.sbi-empty p{margin:0 0 8px}
.sbi-error,.sbi-success{padding:10px;border-radius:10px;font-size:12px;margin:0}
.sbi-error{background:#fff0f1;color:#9b2938}.sbi-success{background:#e8f7ee;color:#287957}
.sbi-overlay{position:fixed;z-index:30;inset:0;background:#23273580;display:flex;align-items:center;justify-content:center;padding:16px}
.sbi-dialog{box-sizing:border-box;display:grid;gap:13px;width:min(100%,430px);max-height:88dvh;overflow:auto;padding:20px;border-radius:19px;background:var(--card);color:var(--ink)}
.sbi-dialog label{display:grid;gap:5px;font-size:12px;font-weight:700}
.sbi-dialog label input,.sbi-dialog label select{box-sizing:border-box;width:100%;min-height:44px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px;font-size:16px;color:var(--ink)}
.sbi-dialog .sbi-checkbox{display:flex;align-items:center;gap:10px}
.sbi-dialog .sbi-checkbox input{width:auto;min-height:auto}
.sbi-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.sbi-actions button{min-height:44px}
.sbi-close{border:0;background:transparent;color:var(--muted);font-size:25px}
</style>
