<script setup>
import {onUnmounted,ref} from 'vue'
const props=defineProps({userId:{type:String,required:true},
 householdId:{type:String,required:true}})
const open=ref(false),loading=ref(false),data=ref(null),error=ref('')
let generation=0,alive=true
const yen=v=>v==null?'待估值':new Intl.NumberFormat('ja-JP',{style:'currency',
 currency:'JPY',maximumFractionDigits:0}).format(v)
const verified=item=>item.identity_status==='verified_legacy'&&
 typeof item.owner_user_id==='string'&&item.owner_user_id.length>0
const owner=item=>!verified(item)?'归属待核验':
 item.owner_user_id===props.userId?'本人账户':'家庭成员账户'
function toggle(){
 if(loading.value)return
 open.value=!open.value
 if(open.value)void load()
 else{generation++;data.value=null;error.value=''}
}
async function load(){
 if(!alive||!open.value||loading.value)return
 const current=++generation,user=props.userId,household=props.householdId
 loading.value=true;error.value=''
 try{
  const response=await fetch('/api/family-finance/shared/asset-summary',{
   credentials:'same-origin',cache:'no-store'})
  const output=await response.json().catch(()=>({}))
  if(!alive||current!==generation||!open.value||user!==props.userId||
   household!==props.householdId)return
  if(!response.ok||output.ok!==true||output.scope!=='household'||
   output.household_id!==household||output.ledger_changed!==false||
   !Array.isArray(output.prepaid?.cards)||
   !Array.isArray(output.securities?.holdings)||
   !Array.isArray(output.credit_card_bills)||
   !Array.isArray(output.member_credit_card_charges?.statements)||
   output.ownership_verification?.proof!=='immutable_legacy_owner_mapping'||
   output.ownership_verification?.read_only!==true)
   throw Error(output.code||'资产归属核对未完成，请重新读取')
  const rows=[...output.prepaid.cards,...output.securities.holdings,
   ...output.credit_card_bills]
  if(rows.some(x=>!['verified_legacy','unverified'].includes(x.identity_status)||
   (x.identity_status==='unverified'&&
    (x.owner_user_id!==null||x.account_id!==null))))
   throw Error('资产账户身份信息异常，禁止猜测归属')
  data.value=output
 }catch(e){
  if(alive&&current===generation&&user===props.userId){
   data.value=null;error.value=String(e.message||e)
  }
 }finally{
  if(alive&&current===generation&&user===props.userId)loading.value=false
 }
}
onUnmounted(()=>{alive=false;generation++;open.value=false;data.value=null})
</script>
<template>
 <section class="asset-proof" aria-label="家庭资产归属核对">
  <div class="head">
   <strong>家庭资产与归属</strong>
   <button type="button" :aria-expanded="open" :disabled="loading"
    @click="toggle">{{open?'收起':'查看资产归属'}}</button>
  </div>
  <template v-if="open">
   <p class="note">两位成员查看相同的家庭资产与账单；只有已验证的原账户映射才显示所属人。不会改账或重复计算。</p>
   <p v-if="loading" class="note">正在读取家庭资产…</p>
   <p v-if="error" role="alert" class="error">{{error}}</p>
   <template v-if="data">
    <p class="note">已跟踪资产 {{yen(data.tracked_assets_jpy)}} · 不代表包含银行现金的全部净资产</p>
    <div class="rows">
     <strong>储值卡 · 合计 {{yen(data.prepaid.total_jpy)}}</strong>
     <p v-for="a in data.prepaid.cards" :key="a.name">
      <span>{{a.name}} · {{yen(a.balance_jpy)}}</span><small>{{owner(a)}}</small>
     </p>
     <strong>SBI 持仓 · 已知市值 {{yen(data.securities.total_market_value_jpy)}}</strong>
     <p v-for="h in data.securities.holdings" :key="h.fund_code+':'+h.account_type">
      <span>{{h.fund_name}} · {{yen(h.market_value_jpy)}}</span><small>{{owner(h)}}</small>
     </p>
     <strong>家庭成员信用卡消费 · 待对账应付 {{yen(data.member_credit_card_charges.recorded_unsettled_total_jpy)}}</strong>
     <p v-for="b in data.member_credit_card_charges.statements"
      :key="b.account_id+':'+b.closing_month">
      <span>{{b.account_label}} · {{b.closing_month}} 截止账期 · {{yen(b.liability_jpy)}}</span>
      <small>{{b.owner_user_id===props.userId?'本人账户':'家庭成员账户'}} · {{b.purchases}} 笔
       <template v-if="data.member_credit_card_charges.settlement_reconciliation_supported">
        · 已核销 {{yen(b.settled_jpy)}} / 原消费 {{yen(b.gross_charges_jpy)}}
       </template>
      </small>
     </p>
     <p v-if="data.member_credit_card_charges.statements.length" class="note">
      {{data.member_credit_card_charges.settlement_reconciliation_supported?
       '按已审批的银行流水核对还款减少应付；扣款需人工核实，付款到期日未自动核验，不代表银行实时欠款。':
       '这是已记消费形成的应付义务；还款尚未纳入本账务口径，付款到期日未核验，不代表银行当前实时欠款。'}}
     </p>
     <strong>信用卡账单（负债快照，不计资产）</strong>
     <p v-for="b in data.credit_card_bills" :key="b.payment_source+':'+b.month">
      <span>{{b.payment_source}} · {{b.month}} · {{yen(b.current_total_jpy)}}</span>
      <small>{{owner(b)}}</small>
     </p>
    </div>
    <p class="note">待核验：储值卡 {{data.ownership_verification.prepaid_unverified}}、
     持仓 {{data.ownership_verification.holdings_unverified}}、
     信用卡账单 {{data.ownership_verification.card_bills_unverified}} 项。
     未核验不代表归其他成员。</p>
   </template>
   <button type="button" :disabled="loading" @click="load">重新读取</button>
  </template>
 </section>
</template>
<style scoped>
.asset-proof{display:grid;gap:9px;min-width:0;border-top:1px solid var(--line,#ddd);padding-top:12px}
.head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.head strong,.rows strong{font-size:13px}
.asset-proof button{font:inherit;min-height:44px;padding:8px 12px;border-radius:10px;
 border:1px solid var(--line,#ddd);background:transparent;color:inherit;font-size:12px}
.asset-proof button:disabled{opacity:.5}
.rows{display:grid;gap:6px;min-width:0}
.rows p{margin:0;padding:8px;display:flex;justify-content:space-between;
 gap:8px;flex-wrap:wrap;border:1px solid var(--line,#ddd);border-radius:10px}
.rows span{font-size:12px;overflow-wrap:anywhere}
.rows small,.note{font-size:11px;line-height:1.5;color:var(--muted,#777);margin:0}
.error{font-size:12px;color:#b44444;margin:0;overflow-wrap:anywhere}
</style>