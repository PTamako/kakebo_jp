<script setup>
import { computed, inject, ref } from 'vue'
import SbiPortfolio from '../SbiPortfolio.vue'
import PrepaidAssets from '../PrepaidAssets.vue'
const props=defineProps({personalAssets:{type:Array,default:null},
 openPersonalManagement:{type:Function,default:null},
 onCreatePersonalAccount:{type:Function,default:null}})
const isPersonal=computed(()=>Array.isArray(props.personalAssets))
const {tab,openPrepaidHistoryDetails,ledgerRevision,transferLoading,api,openCardSettingsFromWallet}=
 inject('kakeibo-page-context',{})
const activeView = ref('wallets')
const creating=ref(false),createOpen=ref(false),assetName=ref(''),createError=ref('')
const createKind=computed(()=>activeView.value==='funds'?'securities':'prepaid')
function beginPersonalAsset(){
 createOpen.value=true;assetName.value='';createError.value=''
}
async function savePersonalAsset(){
 const label=assetName.value.trim()
 if(!label||label.length>80||creating.value||!props.onCreatePersonalAccount)return
 creating.value=true;createError.value=''
 try{
  await props.onCreatePersonalAccount(createKind.value,label)
  assetName.value='';createOpen.value=false
 }catch(e){createError.value='口座を追加できませんでした：'+String(e.message||e)}
 finally{creating.value=false}
}
const selectView = value => { activeView.value = value }
const portfolioSummary = ref(null)
const prepaidSummary = ref(null)
const onPortfolioSummary = value => { portfolioSummary.value = value }
const onPrepaidSummary = value => { prepaidSummary.value = value }
const openCardSettings = () => isPersonal.value?props.openPersonalManagement?.():openCardSettingsFromWallet()
const yen = value => value === null || !Number.isFinite(Number(value)) ? '—' : '¥'+Number(value).toLocaleString('ja-JP')
const investment = computed(() => isPersonal.value?null:portfolioSummary.value?.valuation ?? null)
const prepaid = computed(() => {
 if(!isPersonal.value)return prepaidSummary.value?.balance ?? null
 const items=props.personalAssets.filter(a=>a.account_kind==='prepaid'&&!a.is_archived)
 if(!items.length||items.some(a=>a.balance_jpy===null||!a.balance_verified))return null
 return items.reduce((sum,a)=>sum+Number(a.balance_jpy),0)
})
const latestUsage = computed(() => isPersonal.value?null:prepaidSummary.value?.latestUsage || null)
const latestCharge = computed(() => isPersonal.value?null:prepaidSummary.value?.latestCharge || null)
const shortDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value||'')) ? String(value).slice(5).replace('-', '/') : ''
// This is a view of *tracked* wallets and funds, not a total net-worth figure.
const pnl = computed(() => isPersonal.value?null:portfolioSummary.value?.pnl ?? null)
const acquisition = computed(() => {
 if(!isPersonal.value)return portfolioSummary.value?.acquisition ?? null
 const holdings=props.personalAssets.filter(a=>a.account_kind==='securities'&&!a.is_archived)
 return holdings.length&&holdings.every(a=>a.sbi_confirmed_cost_jpy!==null)
  ?holdings.reduce((sum,a)=>sum+Number(a.sbi_confirmed_cost_jpy),0):null
})
const pnlRatio = computed(() => isPersonal.value?null:portfolioSummary.value?.ratio ?? null)
const fundCount = computed(() => isPersonal.value?props.personalAssets.filter(a=>a.account_kind==='securities'&&!a.is_archived).length:portfolioSummary.value?.fundCount ?? 0)
const allocation = computed(() => isPersonal.value?[]:portfolioSummary.value?.allocation ?? [])
const gainYen = value => value === null || !Number.isFinite(Number(value)) ? '—' : (Number(value) >= 0 ? '+' : '−') + '¥' + Math.abs(Number(value)).toLocaleString('ja-JP')
</script>
<template>
  <section class="page-section assets-page">
    <div class="page-heading">
      <div><h1>残高</h1><p class="heading-subtitle">電子マネー・投資信託</p></div>
    </div>

    <section class="asset-overview" aria-label="残高の概要">
      <div class="asset-wallet">
        <div class="asset-wallet-head">
          <div class="asset-overview-label">
            <span class="asset-label-icon asset-label-wallet" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18M15 15h3"/></svg>
            </span>
            <span>電子マネー残高<small>{{isPersonal?'本人のプリペイドのみ':'Suica・PASMO など'}}</small></span>
          </div>
          <strong class="asset-wallet-value">{{yen(prepaid)}}</strong>
        </div>
        <div class="asset-wallet-activity" aria-label="電子マネーの最近の記録">
          <div class="asset-wallet-event">
            <div class="asset-wallet-event-info">
              <div class="asset-wallet-event-primary">
                <span class="asset-wallet-event-kind">↘ 最近の利用</span>
                <strong v-if="latestUsage" class="asset-wallet-card" :title="latestUsage.card">{{latestUsage.card}}</strong>
              </div>
              <small v-if="latestUsage" class="asset-wallet-event-meta" :title="latestUsage.merchant || ''">{{latestUsage.merchant || '店舗名なし'}}</small>
              <small v-else class="asset-wallet-event-empty">{{prepaidSummary ? '記録なし' : '—'}}</small>
            </div>
            <div v-if="latestUsage" class="asset-wallet-event-side">
              <strong class="asset-wallet-event-amount">{{'−'+yen(latestUsage.amount)}}</strong>
              <small>{{shortDate(latestUsage.date)}}</small>
            </div>
          </div>
          <div class="asset-wallet-event">
            <div class="asset-wallet-event-info">
              <div class="asset-wallet-event-primary">
                <span class="asset-wallet-event-kind">↗ 最近のチャージ</span>
                <strong v-if="latestCharge" class="asset-wallet-card" :title="latestCharge.card">{{latestCharge.card}}</strong>
              </div>
              <small v-if="latestCharge" class="asset-wallet-event-meta" :title="latestCharge.funding_source || ''">{{latestCharge.funding_source ? latestCharge.funding_source+'から' : 'チャージ元未設定'}}</small>
              <small v-else class="asset-wallet-event-empty">{{prepaidSummary ? '記録なし' : '—'}}</small>
            </div>
            <div v-if="latestCharge" class="asset-wallet-event-side">
              <strong class="asset-wallet-event-amount asset-wallet-plus">{{'+'+yen(latestCharge.amount)}}</strong>
              <small>{{shortDate(latestCharge.date)}}</small>
            </div>
          </div>
        </div>
      </div>
      <div class="asset-investment" :class="{'asset-investment-loss':pnl !== null && pnl < 0}">
        <div class="asset-overview-label">
          <span class="asset-label-icon asset-label-investment" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18V9m6 9V5m6 13v-6m4 6V8"/><path d="M3 21h18"/></svg>
          </span>
          <span>評価額・損益の内訳<small>{{isPersonal?'本人の証券口座':'SBI証券'}} · {{fundCount}}銘柄</small></span>
        </div>
        <strong class="asset-investment-value">{{yen(investment)}}</strong>
        <div class="asset-investment-foot">
          <span>評価損益</span>
          <strong :class="{'asset-pnl-negative':pnl !== null && pnl < 0}">{{gainYen(pnl)}}<small v-if="pnlRatio!==null"> ({{pnlRatio>=0?'+':''}}{{pnlRatio.toFixed(2)}}%)</small></strong>
        </div>
        <div class="asset-cost-line"><span>取得金額</span><strong>{{yen(acquisition)}}</strong></div>
        <div v-if="allocation.length" class="asset-allocation" role="img" :aria-label="'銘柄別評価額比率：'+allocation.map(a=>a.name+' '+a.ratio.toFixed(1)+'%').join('、')">
          <span v-for="a in allocation" :key="a.key" :style="{width:a.ratio+'%',background:a.color}" aria-hidden="true"></span>
        </div>
      </div>
    </section>

    <nav class="balance-view-switch" aria-label="残高の表示切替" role="tablist">
      <button type="button" role="tab" :aria-selected="activeView==='wallets'" :class="{selected:activeView==='wallets'}" @click="selectView('wallets')">電子マネー</button>
      <button type="button" role="tab" :aria-selected="activeView==='funds'" :class="{selected:activeView==='funds'}" @click="selectView('funds')">投資信託</button>
    </nav>

    <div v-if="isPersonal" class="personal-asset-list" aria-label="本人の残高明細">
      <div class="personal-asset-actions">
       <button type="button" class="button-secondary" @click="beginPersonalAsset">
        ＋ {{activeView==='funds'?'証券口座を追加':'電子マネーを追加'}}
       </button>
      </div>
      <form v-if="createOpen" class="personal-asset-create" @submit.prevent="savePersonalAsset">
       <label>{{activeView==='funds'?'証券口座名':'電子マネー名'}}
        <input v-model="assetName" maxlength="80" required
         :placeholder="activeView==='funds'?'例：SBI証券':'例：Suica'"/>
       </label>
       <div class="personal-asset-create-actions">
        <button type="submit" :disabled="creating||!assetName.trim()">追加</button>
        <button type="button" :disabled="creating" @click="createOpen=false">キャンセル</button>
       </div>
       <p v-if="createError" role="alert">{{createError}}</p>
      </form>
      <p class="personal-asset-hint">本人の金融口座だけ表示します。未核証の銀行残高や券商市值は「—」のままです。</p>
      <div v-for="a in personalAssets.filter(a=>!a.is_archived&&
       (activeView==='wallets'?a.account_kind!=='securities':a.account_kind==='securities'))"
       :key="a.account_id" class="personal-asset-row">
       <strong>{{a.label}}</strong>
       <span v-if="a.account_kind==='prepaid'">{{yen(a.balance_jpy)}}</span>
       <span v-else-if="a.account_kind==='credit_card'">請求 {{yen(a.credit_liability_jpy)}}</span>
       <span v-else-if="a.account_kind==='points'">{{a.balance_units??'—'}} pt</span>
       <span v-else-if="a.account_kind==='securities'">取得 {{yen(a.sbi_confirmed_cost_jpy)}}</span>
       <span v-else>残高 —</span>
       <small v-if="a.balance_note">{{a.balance_note}}</small>
      </div>
      <p v-if="!personalAssets.filter(a=>!a.is_archived&&
       (activeView==='funds'?a.account_kind==='securities':a.account_kind!=='securities')).length"
        class="personal-asset-hint">本人の{{activeView==='funds'?'証券口座':'電子マネー'}}はまだありません。上の「＋」から追加できます。</p>
    </div>
    <SbiPortfolio v-else :api="api" :transfer-loading="transferLoading" :active-view="activeView" :refresh-key="ledgerRevision" @summary="onPortfolioSummary">
      <template #before-holdings>
        <PrepaidAssets :api="api" :active="true" :revision="ledgerRevision" @summary="onPrepaidSummary" @open-card-settings="openCardSettings" @open-history="openPrepaidHistoryDetails" />
      </template>
    </SbiPortfolio>
  </section>
</template>
<style scoped>
.assets-page{display:grid;gap:7px;min-width:0}
.personal-asset-list{display:grid;gap:8px;margin-top:7px;min-width:0}
.personal-asset-actions{display:flex;justify-content:flex-end}
.personal-asset-actions button{min-height:44px;border:1px solid var(--line);border-radius:11px;padding:8px 14px;background:var(--tint);color:var(--blue-dark);font-weight:750}
.personal-asset-create{display:grid;gap:10px;padding:12px;border:1px solid var(--line);border-radius:13px;background:var(--card)}
.personal-asset-create label{display:grid;gap:6px;font-size:12px;color:var(--muted)}
.personal-asset-create input{width:100%;min-width:0;min-height:44px;font-size:16px;border:1px solid var(--line);border-radius:10px;background:var(--card);padding:8px 12px;color:var(--ink)}
.personal-asset-create-actions{display:flex;gap:8px}
.personal-asset-create-actions button{flex:1;min-height:44px;border:1px solid var(--line);border-radius:11px;background:var(--tint);color:var(--blue-dark);font-weight:750}
.personal-asset-create p[role=alert]{color:#b42f48;font-size:12px}

.personal-asset-hint{font-size:12px;color:var(--muted);margin:4px 0}
.personal-asset-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;border:1px solid var(--line);padding:12px;border-radius:13px;background:var(--card);min-width:0}
.personal-asset-row>strong{overflow-wrap:anywhere}
.personal-asset-row>span{font-variant-numeric:tabular-nums;font-weight:750}
.personal-asset-row>small{grid-column:1/-1;font-size:11px;color:var(--muted)}

.assets-page .page-heading{margin-bottom:0;min-height:0}
.assets-page .page-heading h1{letter-spacing:-.035em}
.asset-overview{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;min-width:0}
.asset-investment,.asset-wallet{box-sizing:border-box;display:flex;flex-direction:column;min-width:0;min-height:0;padding:10px 12px;border:1px solid var(--line);border-radius:15px;background:var(--card)}
.asset-investment{background:linear-gradient(135deg,color-mix(in srgb,var(--blue) 12%,var(--card)),var(--card) 85%);border-color:color-mix(in srgb,var(--blue) 18%,var(--line))}
.asset-wallet{background:linear-gradient(135deg,color-mix(in srgb,var(--teal) 9%,var(--card)),var(--card) 85%);border-color:color-mix(in srgb,var(--teal) 17%,var(--line))}
.asset-overview-label{display:flex;gap:6px;align-items:center;min-width:0}
.asset-overview-label>span:last-child{display:grid;gap:1px;color:var(--ink);font-size:11px;font-weight:800;min-width:0;line-height:1.3}
.asset-overview-label small{color:var(--muted);font-size:9px;font-weight:500}
.asset-label-icon{display:grid;place-items:center;flex:none;width:26px;height:26px;border-radius:9px}
.asset-label-icon svg{width:15px;height:15px}
.asset-label-investment{background:color-mix(in srgb,var(--blue) 17%,var(--card));color:var(--blue-dark)}
.asset-label-wallet{background:color-mix(in srgb,var(--teal) 15%,var(--card));color:var(--teal)}
.asset-investment-value,.asset-wallet-value{display:block;font-size:clamp(21px,5.6vw,28px);font-weight:850;letter-spacing:-.045em;font-variant-numeric:tabular-nums;line-height:1.15;overflow-wrap:anywhere}
.asset-investment-value{padding-top:5px}
.asset-wallet-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.asset-wallet-head>.asset-overview-label{flex:1;min-width:0}
.asset-wallet-value{flex:0 1 auto;max-width:52%;min-width:0;text-align:right}
.asset-wallet-activity{display:grid;gap:6px;margin-top:7px;padding-top:7px;border-top:1px solid color-mix(in srgb,var(--teal) 20%,var(--line));min-width:0}
.asset-wallet-event{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:9px;min-width:0}
.asset-wallet-event+.asset-wallet-event{padding-top:6px;border-top:1px solid color-mix(in srgb,var(--teal) 10%,var(--line))}
.asset-wallet-event-info{display:flex;flex-direction:column;align-items:stretch;gap:3px;min-width:0;max-width:100%}
.asset-wallet-event-primary{display:flex;align-items:center;gap:7px;min-width:0;width:100%}
.asset-wallet-event-primary .asset-wallet-event-kind{flex:none}
.asset-wallet-event-primary .asset-wallet-card{flex:1;min-width:0}
.asset-wallet-event-kind{font-size:10px;color:var(--muted);font-weight:750;white-space:nowrap}
.asset-wallet-card,.asset-wallet-event-meta{display:block;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.asset-wallet-card{font-size:11px;line-height:1.25}
.asset-wallet-event-meta{font-size:10px;color:var(--muted)}
.asset-wallet-event-side{display:flex;flex-direction:column;align-items:flex-end;gap:2px;min-width:0}
.asset-wallet-event-amount{font-size:13px;white-space:nowrap;font-weight:850;font-variant-numeric:tabular-nums;letter-spacing:-.015em}
.asset-wallet-event-amount.asset-wallet-plus{color:var(--teal)}
.asset-wallet-event-side small{font-size:10px;color:var(--muted);white-space:nowrap}
.asset-wallet-event-empty{font-size:10px;color:var(--muted)}
.asset-investment-foot{display:flex;align-items:center;gap:5px;justify-content:space-between;margin-top:5px;padding-top:4px;border-top:1px solid color-mix(in srgb,var(--blue) 15%,var(--line));font-size:10px;color:var(--muted)}
.asset-investment-foot strong{font-size:10px;color:#18876c;font-variant-numeric:tabular-nums;white-space:nowrap}
.asset-investment-foot .asset-pnl-negative{color:#bf516d}
.asset-investment-foot strong small{font-size:9px;font-weight:650}
.asset-cost-line{display:flex;align-items:center;justify-content:space-between;gap:4px;color:var(--muted);font-size:10px}
.asset-cost-line strong{color:var(--ink);font-size:10px;font-variant-numeric:tabular-nums}
.asset-allocation{display:flex;width:100%;height:6px;margin-top:6px;border-radius:99px;overflow:hidden;gap:2px;background:var(--line)}
.asset-allocation>span{height:100%;min-width:0}
.balance-view-switch{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;min-width:0;padding:4px;border-radius:13px;border:1px solid var(--line);background:var(--paper)}
.balance-view-switch button{display:flex;justify-content:center;align-items:center;gap:4px;min-width:0;min-height:43px;padding:8px 3px;border:1px solid transparent;background:transparent;border-radius:10px;color:var(--muted);font-size:12px;font-weight:750;white-space:nowrap;cursor:pointer}
.balance-view-switch button.selected{color:var(--blue-dark);background:var(--card);border-color:color-mix(in srgb,var(--blue) 17%,var(--line));box-shadow:0 1px 5px #0000000a}
.balance-view-switch button:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}
.balance-view-count{display:inline-grid;place-items:center;min-width:15px;height:15px;padding:0 3px;border-radius:9px;background:color-mix(in srgb,var(--blue) 16%,var(--card));font-size:9px;line-height:1.1}
@media(min-width:768px){.asset-overview{grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch}}
@media(max-width:370px){.asset-investment,.asset-wallet{padding:10px}.asset-overview-label{gap:4px}.asset-overview-label>span:last-child{font-size:10px}.asset-label-icon{width:24px;height:24px}.asset-investment-value,.asset-wallet-value{font-size:20px}.asset-wallet-card{font-size:11px}.asset-wallet-event{gap:8px}.asset-wallet-event-amount{font-size:12px}.balance-view-switch button{font-size:11px}}
@media(prefers-reduced-motion:reduce){.pending-chevron{transition:none}}
</style>