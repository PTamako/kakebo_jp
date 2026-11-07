// Read-only financial checks and portable backup format. Never mutate ledger records here.
export const backupVersion = 4

const RESTORE_SETTING_ORDER = [
  'paymentSources','categoryMetadata','categories','categoryIcons',
  'defaultRules','customRules','merchantPaymentRules','bills',
  'investmentPlans','investmentPlanHistory','investmentHoldings','fundPrices','plans','archivedPlans','recurringExclusions','recurringDateExclusions','trashedEntries'
]
// Setting collections are restored in dependency order, with no silent fallback
// that omits display names, sorting or portfolio data for large archives.
// Transaction-linked collections are handled alongside their source entries.
export function chunkRestoreSettings(archive, batchSize=100) {
  if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>500)throw Error('復元単位が正しくありません')
  const chunks=[]
  let current={}, size=0
  const flush=()=>{
    if(size)chunks.push(current)
    current={};size=0
  }
  const put=(name,key,value)=>{
    if(size===batchSize)flush()
    if(name==='categoryIcons')(current.categoryIcons??={})[key]=value
    else(current[name]??=[]).push(value)
    size++
  }
  for(const name of RESTORE_SETTING_ORDER) {
    if(name==='categoryIcons'){
      for(const [key,value] of Object.entries(archive.categoryIcons||{}))put(name,key,value)
    }else for(const item of archive[name]||[])put(name,null,item)
  }
  flush()
  return chunks
}

// A portable restore cannot reuse source-database entry IDs. Rebase newly restored
// wallet cards at the backed-up current balance AFTER historical entries are inserted.
// Existing target cards always win. Never fabricate a recharge/income entry.
// Future prepaid movements must be replayed AFTER the restored opening-balance
// anchor. Otherwise a scheduled transfer already present in the backup is
// excluded forever because its new entry ID is at or below the new anchor.
export function isFuturePrepaidMovement(entry, prepaidNames, today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)) {
  if(!entry || !prepaidNames?.length)return false
  const source=entry.payment_source||entry.paymentSource||''
  const prepaidSource=prepaidNames.includes(source)
  const prepaidTarget=prepaidNames.some(name=>entry.transfer_target==='prepaid:'+name)
  if(entry.type==='expense')return prepaidSource && entry.date>today
  if(entry.type==='income')return entry.category==='ポイント還元' && prepaidSource && entry.date>today
  if(entry.type!=='transfer' || (!prepaidSource && !prepaidTarget))return false
  return entry.date>today || (entry.transfer_date||entry.date)>today
}

export function prepaidRestoreBalances(archive, today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)) {
  const rows=Array.isArray(archive.entries)?archive.entries:[]
  return (archive.paymentSources||[]).filter(source=>source?.source_type==='prepaid').map(source=>{
    const start=source.opening_date||today
    const cutoff=Number(source.opening_entry_id||0)
    if(!validDate(start)||!Number.isSafeInteger(cutoff)||cutoff<0)throw Error('プリペイドの復元基準が正しくありません')
    const eligible=rows.filter(e=>Number(e.id)>cutoff && e.date>=start)
    // Future prepaid rows are NOT included in this balance. The restore
    // workflow stages them after the rebase so they remain effective on due day.
    const charged=eligible.filter(e=>e.type==='transfer'&&e.transfer_target==='prepaid:'+source.name&&e.payment_source!==source.name&&e.date<=today&&(e.transfer_date||e.date)<=today).reduce((n,e)=>n+Number(e.amount),0)
    const earned=eligible.filter(e=>e.type==='income'&&e.category==='ポイント還元'&&e.payment_source===source.name&&e.date<=today).reduce((n,e)=>n+Number(e.amount),0)
    const spent=eligible.filter(e=>e.type==='expense'&&e.payment_source===source.name&&e.date<=today).reduce((n,e)=>n+Number(e.amount),0)
    const transferredOut=eligible.filter(e=>e.type==='transfer'&&e.payment_source===source.name&&e.transfer_target!=='prepaid:'+source.name&&e.date<=today&&(e.transfer_date||e.date)<=today).reduce((n,e)=>n+Number(e.amount),0)
    const opening=Number(source.opening_balance||0)
    const balance=opening+charged+earned-spent-transferredOut
    if(!Number.isSafeInteger(balance)||balance<0||balance>100000000)throw Error('プリペイド残高が計算できません。復元を中止しました')
    return {name:source.name,openingBalance:balance}
  })
}

const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value

// Keep all user-relevant fields: same-day purchases with different payment methods
// or notes are not interchangeable.
export const transactionKey = e => [
  e.date, e.time || '', Number(e.amount), e.type || 'expense',
  (e.merchant || '').trim(), e.category || '', e.note || '', e.payment_source || e.paymentSource || '',
  e.transfer_target || e.transferTarget || '', e.transfer_date || e.transferDate || ''
].join('|')

export function duplicateCandidates(rows, target) {
  return rows.filter(e => transactionKey(e) === transactionKey(target))
}

export function prepareRestoreRows(existing, incoming) {
  const known = new Set(existing.map(transactionKey))
  const seen = new Set()
  const newRows = []
  const conflicts = []
  incoming.forEach((entry, backupIndex) => {
    const key = transactionKey(entry)
    const indexed = { ...entry, backupIndex }
    // Keep every conflict visible for explicit review; never silently discard it.
    if (known.has(key) || seen.has(key)) conflicts.push(indexed)
    else newRows.push(indexed)
    seen.add(key)
  })
  return { newRows, conflicts }
}

// Restore IDs are deterministic across retries, but financial relationships
// must be rebased together: never use the source database's numeric entry IDs.
export async function prepareLinkedRestoreRows(selectedRows, archiveEntries, existingRows = [], plans = []) {
  const selectedIds = new Set(selectedRows.map(e => Number(e.id)))
  if (selectedIds.size !== selectedRows.length ||
      selectedRows.some(e => !Number.isSafeInteger(Number(e.id)) || Number(e.id) <= 0))
    throw Error('復元元の明細IDを確認してください')

  const originalChargeParents = new Map()
  const originalChargeRows = new Map()
  for (const income of archiveEntries) {
    if (income.type !== 'income' || income.category !== 'ポイント還元' ||
        !String(income.transfer_target || '').startsWith('prepaid:')) continue
    const requestId = income.client_request_id
    const originalPairId = typeof requestId === 'string' && requestId && requestId.length <= 100
      ? 'point_charge_' + requestId : 'point_charge_entry_' + income.id
    originalChargeParents.set(originalPairId, income)
  }
  for (const entry of archiveEntries) {
    if (entry.type !== 'transfer' || typeof entry.client_request_id !== 'string' ||
        !entry.client_request_id.startsWith('point_charge_')) continue
    const income = originalChargeParents.get(entry.client_request_id)
    if (!income || entry.transfer_target !== income.transfer_target ||
        Number(entry.amount) !== Number(income.amount) || entry.date !== income.date ||
        entry.payment_source !== 'ポイント還元')
      throw Error('バックアップのポイント自動チャージに対応する還元収入がありません')
    if (originalChargeRows.has(Number(income.id)))
      throw Error('ポイント自動チャージが重複しています')
    originalChargeRows.set(Number(income.id), entry)
  }
  for (const [parentId, charge] of originalChargeRows) {
    if (selectedIds.has(parentId) && !selectedIds.has(Number(charge.id)))
      throw Error('ポイント還元収入と自動チャージはセットで復元してください')
    if (selectedIds.has(Number(charge.id)) && !selectedIds.has(parentId)) {
      const income = originalChargeParents.get(charge.client_request_id)
      if (!existingRows.some(e => transactionKey(e) === transactionKey(income)))
        throw Error('自動チャージの元となるポイント還元収入も復元してください')
    }
  }

  const idByOriginalEntry = new Map()
  for (const entry of selectedRows) {
    const payload = JSON.stringify([
      entry.id, entry.backupIndex, entry.date, entry.time, entry.amount, entry.merchant,
      entry.type, entry.category, entry.note, entry.payment_source,
      entry.transfer_target, entry.transfer_date
    ])
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
    let id = 'restore_' + Array.from(new Uint8Array(bytes)).slice(0,16)
      .map(x => x.toString(16).padStart(2,'0')).join('')
    // Keep a genuine recurring occurrence's server ID. Cron deduplication and
    // explicit deletion/skipping both depend on this exact occurrence identity.
    const original = String(entry.client_request_id || '')
    if (entry.type === 'expense' && plans.some(plan => {
      const prefix = 'recurring_' + String(plan.id || '').replace(/-/g,'') + '_'
      const suffix = original.startsWith(prefix) ? original.slice(prefix.length) : ''
      return /^\d{6}(?:\d{2})?$/.test(suffix) &&
        suffix.length === (plan.scheduleType === 'monthly' || !plan.scheduleType ? 6 : 8)
    })) id = original
    idByOriginalEntry.set(Number(entry.id), id)
  }

  return selectedRows.map(entry => {
    let clientRequestId = idByOriginalEntry.get(Number(entry.id))
    const parent = originalChargeParents.get(entry.client_request_id)
    if (parent && entry.type === 'transfer') {
      const restoredParentId = idByOriginalEntry.get(Number(parent.id))
      const existingParent = restoredParentId ? null
        : existingRows.find(e => transactionKey(e) === transactionKey(parent))
      const source = restoredParentId || (
        existingParent && typeof existingParent.client_request_id === 'string' &&
        /^[a-zA-Z0-9_-]{8,100}$/.test(existingParent.client_request_id)
          ? existingParent.client_request_id : null
      )
      clientRequestId = source ? 'point_charge_' + source :
        existingParent && Number.isSafeInteger(Number(existingParent.id))
          ? 'point_charge_entry_' + existingParent.id : ''
      if (!clientRequestId || clientRequestId.length > 128)
        throw Error('ポイント還元と自動チャージの対応関係を復元できません')
    }
    return {...entry, clientRequestId}
  })
}

export function validateBackup(value) {
  if (!value || value.format !== 'kakeibo-ledger-backup' ||
      ![1, 2, 3, backupVersion].includes(value.version) || !Array.isArray(value.entries)) {
    throw Error('対応していないバックアップ形式です')
  }
  if (value.entries.length > 100000) throw Error('バックアップ件数が多すぎます')
  for (const e of value.entries) {
    if (!validDate(e.date) || (e.time != null && e.time !== '' && (typeof e.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(e.time))) || !Number.isSafeInteger(Number(e.amount)) ||
        Number(e.amount) <= 0 || !['income','expense','transfer'].includes(e.type)) {
      throw Error('取引データに不正な値があります')
    }
  }
  const arrayNames = ['plans', 'bills', 'investments', 'paymentSources', 'merchantPaymentRules', 'customRules', 'defaultRules', 'categories', 'categoryMetadata', 'investmentPlans', 'investmentPlanHistory', 'investmentHoldings', 'fundPrices', 'transferLinks', 'recurringExclusions', 'recurringDateExclusions', 'archivedPlans', 'trashedEntries']
  for (const name of arrayNames) {
    if (value[name] != null && (!Array.isArray(value[name]) || value[name].length > 10000)) {
      throw Error('バックアップの' + name + 'が不正です')
    }
  }

  // Archived entries are not active ledger rows; preserve exact snapshots and
  // reject malformed or mismatched IDs before any restore write.
  for(const item of value.trashedEntries||[]) {
    if(!item || !/^[1-9]\d*$/.test(String(item.item_id)) ||
        typeof item.payload_json!=='string' || item.payload_json.length>250000 ||
        typeof item.deleted_at!=='string' || !item.deleted_at ||
        item.deleted_at.length>40) throw Error('ゴミ箱の明細データが不正です')
    let data
    try {data=JSON.parse(item.payload_json)}catch{throw Error('ゴミ箱の明細データが不正です')}
    const e=data?.entry
    if(!e || String(e.id)!==String(item.item_id) || !validDate(e.date) ||
      !Number.isSafeInteger(e.amount) || e.amount<=0 ||
      !['income','expense','transfer'].includes(e.type))
      throw Error('ゴミ箱の明細内容を確認してください')
  }
  // Validate every writeable setting before the first restore API call.
  // Older v1/v2 archives may omit a whole collection; present collections must be sound.
  const isText = (value, max = 120) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
  const month = x => /^\d{4}-(0[1-9]|1[0-2])$/.test(x || '')
  const safeAmount = x => Number.isSafeInteger(x) && x >= 0
  const validPlan = x => x && isText(x.id,80) && /^[a-zA-Z0-9-]{8,80}$/.test(x.id) &&
    isText(x.name) && Number.isSafeInteger(x.amount) && x.amount > 0 &&
    Number.isInteger(x.day) && x.day >= 1 && x.day <= 31 &&
    isText(x.category) && typeof x.paymentSource === 'string' && x.paymentSource.length <= 80 &&
    month(x.startMonth) && typeof x.enabled === 'boolean' &&
    (x.postingMode == null || ['manual','auto'].includes(x.postingMode)) &&
    (x.autoFromMonth == null || x.autoFromMonth === '' || month(x.autoFromMonth)) &&
    (x.postingMode !== 'auto' || month(x.autoFromMonth)) &&
    (x.scheduleType == null || ['monthly','weekly','workday'].includes(x.scheduleType)) &&
    (x.weekday == null || (Number.isInteger(x.weekday) && x.weekday>=0 && x.weekday<=6))
  const validExclusion = x => x && typeof x.planId==='string' &&
    /^[a-zA-Z0-9-]{8,80}$/.test(x.planId) && month(x.month)
  const validDateExclusion = x => x && typeof x.planId==='string' && /^[a-zA-Z0-9-]{8,80}$/.test(x.planId) && validDate(x.date)
  const validBill = x => x && isText(x.name,80) && month(x.month) &&
    validDate(x.start) && validDate(x.end) && x.start <= x.end &&
    safeAmount(x.total) && safeAmount(x.count)
  // Validate legacy investment payloads for archive safety, but never write them to D1.
  if (Array.isArray(value.investments) && value.investments.some(x => !x || typeof x.platform!=='string' || (x.current_value!==null && (!Number.isSafeInteger(x.current_value) || x.current_value<0)) || (x.pnl!==null && !Number.isSafeInteger(x.pnl))))
    throw Error('旧版投資バックアップを確認してください')
  const validSource = x => x && isText(x.name,80) &&
    (x.source_type == null || ['standard','prepaid'].includes(x.source_type)) &&
    (x.stat_group == null || ['card','points'].includes(x.stat_group)) &&
    (x.is_archived == null || x.is_archived === 0 || x.is_archived === 1 || typeof x.is_archived === 'boolean') &&
    (x.opening_balance == null || (safeAmount(x.opening_balance) && x.opening_balance<=100000000)) &&
    (x.opening_entry_id == null || safeAmount(x.opening_entry_id)) &&
    (x.opening_date == null || x.opening_date==='' || validDate(x.opening_date)) &&
    (x.closing_day == null || (Number.isInteger(x.closing_day) && x.closing_day >= 0 && x.closing_day <= 31)) &&
    (x.is_default == null || x.is_default === 0 || x.is_default === 1 || typeof x.is_default === 'boolean')
  const validCustom = x => x && isText(x.keyword,120) && isText(x.category,120)
  const validDefaultRule = x => validCustom(x) && !x.keyword.startsWith('__')
  const validPaymentRule = x => x && isText(x.keyword,120) && isText(x.payment_source,80)
  for (const [name, check] of [
    ['plans',validPlan],['archivedPlans',validPlan],['recurringExclusions',validExclusion],['recurringDateExclusions',validDateExclusion],['bills',validBill],['paymentSources',validSource],
    ['customRules',validCustom],['defaultRules',validDefaultRule],['merchantPaymentRules',validPaymentRule],
    ['categories',x => isText(x,20)]
  ]) {
    if (Array.isArray(value[name]) && value[name].some(x => !check(x)))
      throw Error('バックアップの' + name + 'に不正な設定があります')
  }
  if (Array.isArray(value.categoryMetadata) && value.categoryMetadata.some(x =>
      !x || !isText(x.category,20) ||
      (x.display_name != null && (typeof x.display_name !== 'string' || x.display_name.length > 80)) ||
      (x.icon != null && (typeof x.icon !== 'string' || !/^[a-z][a-z-]{1,40}$/.test(x.icon))) ||
      (x.entry_type != null && !['expense','income','transfer'].includes(x.entry_type)) ||
      (x.is_default != null && ![0,1].includes(x.is_default)) ||
      (x.sort_order != null && (!Number.isSafeInteger(x.sort_order) || x.sort_order < 0 || x.sort_order > 99999))))
    throw Error('カテゴリー表示設定が不正です')
  if (value.categoryIcons && Object.entries(value.categoryIcons).some(([k,v]) =>
      !isText(k,20) || !isText(v,80))) throw Error('カテゴリーアイコンが不正です')
  if (value.dismissedTransfers != null && (!Array.isArray(value.dismissedTransfers) ||
      value.dismissedTransfers.length > 100000 ||
      value.dismissedTransfers.some(id => !Number.isSafeInteger(id) || id <= 0))) {
    throw Error('振替通知情報を確認してください')
  }
  if (value.categoryIcons != null && (typeof value.categoryIcons !== 'object' || Array.isArray(value.categoryIcons))) {
    throw Error('バックアップのアイコン情報が不正です')
  }
  const fundCode=x=>typeof x==='string' && /^[A-Z0-9]{8}$/.test(x)
  const account=x=>x==='growth'||x==='tsumitate'
  const validPlanPortfolio=p=>p && fundCode(p.fund_code) && account(p.account_type) &&
    isText(p.fund_name,120) && safeAmount(p.monthly_amount) && p.monthly_amount<=100000000 &&
    Number.isInteger(p.order_day) && p.order_day>=1 && p.order_day<=28 && [0,1].includes(p.enabled)
  const checks=[
    ['investmentPlans',p=>validPlanPortfolio(p)],
    ['investmentPlanHistory',p=>validPlanPortfolio(p) && month(p.effective_month)],
    ['investmentHoldings',p=>p && fundCode(p.fund_code) && (account(p.account_type)||p.account_type==='combined') &&
      isText(p.fund_name,120) && safeAmount(p.units) && safeAmount(p.acquisition_cost) &&
      p.units<=1000000000000 && p.acquisition_cost<=1000000000000 &&
      (p.reported_value==null || safeAmount(p.reported_value)) &&
      (p.reported_at==null || (typeof p.reported_at==='string' && p.reported_at.length<=40))],
    ['fundPrices',p=>p && fundCode(p.fund_code) && safeAmount(p.nav_per_10000) &&
      p.nav_per_10000>0 && p.nav_per_10000<=1000000000 && validDate(p.price_date) &&
      isText(p.source,80)],
    ['transferLinks',p=>p && Number.isSafeInteger(p.entry_id) && p.entry_id>0 && month(p.purchase_month)]
  ]
  for(const [name,check] of checks)
    if(Array.isArray(value[name]) && value[name].some(x=>!check(x)))
      throw Error('バックアップの'+name+'に不正な設定があります')
  if (Array.isArray(value.investments)) for (const item of value.investments) {
    if (!item || typeof item.platform !== 'string' ||
      (item.current_value != null && (!Number.isSafeInteger(item.current_value) || item.current_value < 0)) ||
      (item.pnl != null && !Number.isSafeInteger(item.pnl))) {
      throw Error('資産の評価額を確認してください')
    }
  }
  return value
}

export function restoreMissingByKey(existing, incoming, keyFn) {
  const keys = new Set(existing.map(keyFn))
  return incoming.filter(item => {
    const key = keyFn(item)
    if (!key || keys.has(key)) return false
    keys.add(key)
    return true
  })
}

export function reconcileStatement(rows, total) {
  const sum = rows.filter(e => e.type === 'expense').reduce((n,e) => n + Number(e.amount || 0), 0)
  return { sum, difference: Number(total) - sum }
}

export function nextScheduledDate(day, now = new Date(), startMonth = '', enabled = true) {
  if (!enabled) return '停止中'
  const d = Math.max(1,Math.min(31,Number(day) || 1))
  const current = new Date(now.getFullYear(),now.getMonth(),now.getDate())
  const start = /^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth) ? new Date(Number(startMonth.slice(0,4)),Number(startMonth.slice(5,7))-1,1) : current
  const baseline = start>current ? start : current
  const candidate = (y,m) => new Date(y,m,Math.min(d,new Date(y,m+1,0).getDate()))
  const y = baseline.getFullYear(),m=baseline.getMonth()
  const date = candidate(y,m)>=current ? candidate(y,m) : candidate(y,m+1)
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')
}
