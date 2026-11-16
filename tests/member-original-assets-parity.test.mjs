import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {memberInvestmentSnapshot} from '../src/member-investment-view.js'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const owner='owner-household-user',member='member-household-user'
test('wife and husband use same real balance components, not member alternate account list',()=>{
 const page=read('src/pages/AssetsPage.vue')
 const shared=read('src/OriginalKakeiboPages.vue')
 const memberView=read('src/FamilyMemberWorkspace.vue')
 assert.match(page,/<SbiPortfolio :key="isPersonal\?'funds:'\+personalUserId:'funds:owner'"/)
 assert.match(page,/<PrepaidAssets :key="isPersonal\?'wallet:'\+personalUserId:'wallet:owner'"/)
 assert.doesNotMatch(page,/<div v-if="isPersonal" class="personal-asset-list"/)
 assert.doesNotMatch(page,/証券口座名/)
 assert.doesNotMatch(page,/電子マネー名/)
 assert.match(shared,/:personal-prepaid-api="member\?personalPrepaidApi:null"/)
 assert.match(shared,/:personal-portfolio-api="member\?personalPortfolioApi:null"/)
 assert.match(memberView,/:on-open-personal-management="openMemberPrepaidAdd"/)
 assert.match(memberView,/preferredCardType.value='prepaid';cardMode.value='add'/)
})
test('same prepaid editor defaults to prepaid on spouse balance add button',()=>{
 const control=read('src/OriginalCardManagementPanel.vue')
 const sheet=read('src/MobileCardEditorSheet.vue')
 const wallet=read('src/PrepaidAssets.vue')
 assert.match(control,/:default-source-type="defaultSourceType"/)
 assert.match(sheet,/sourceType.value=props.defaultSourceType==='prepaid'\?'prepaid':'standard'/)
 assert.match(wallet,/>＋ カードを追加<\/button>/)
 assert.match(wallet,/props.onMemberOpening\(card,amount\)/)
 assert.match(wallet,/props.memberMode\?'prepaid-report':'prepaid-assets'/)
})
test('fund holdings from other family member are forbidden, no fake valuation',()=>{
 const p={owner_user_id:member,fund_code:'0331418A',fund_name:'オール・カントリー',
 account_type:'tsumitate',units:10000,acquisition_cost:10000,
 market_value:null,pnl:null,version:1}
 const data=memberInvestmentSnapshot({userId:member,requestedMonth:'2026-11',
 plans:[],manualHoldings:[p],occurrences:null})
 assert.equal(data.holdings.length,1)
 assert.equal(data.holdings[0].fund_name,'オール・カントリー')
 assert.equal(data.valuation.value,null)
 assert.equal(data.valuation.pnl,null)
 assert.throws(()=>memberInvestmentSnapshot({userId:member,requestedMonth:'2026-11',
  plans:[],manualHoldings:[{...p,owner_user_id:owner}],occurrences:null}),
  /MEMBER_INVESTMENT_OWNER_CHANGED/)
})
test('member manual fund D1 rows carry household and user scope, separate from owner investment_holdings',()=>{
 const api=read('functions/api/family-finance/manual-holdings.js')
 const route=read('functions/api/family-finance/[[path]].js')
 const migration=read('migrations/0063_member_manual_fund_holdings.sql')
 assert.match(route,/familyManualHoldings\(request,env,url,user,parts\)/)
 assert.match(api,/WHERE household_id=\? AND owner_user_id=\?/)
 assert.match(api,/expected_user_id!==user.user_id/)
 assert.match(api,/ledger_changed:false/)
 assert.doesNotMatch(api,/INSERT INTO investment_holdings|UPDATE investment_holdings|INSERT INTO entries/)
 assert.match(migration,/PRIMARY KEY\(household_id,owner_user_id,fund_code,account_type\)/)
 assert.match(migration,/MANUAL_HOLDING_SCOPE_IMMUTABLE/)
})
