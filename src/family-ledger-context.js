// Reuse the ORIGINAL LedgerPage for the family member. All mutations are
// handed to the HomeFlow approval surface; no legacy write API is reachable.
import {ref,computed,watch} from 'vue'
import {groupAnnualEntries} from './detail-pagination.js'
import {ICON_LIBRARY} from './icon-library.js'

export function makeFamilyLedgerContext({tab,month,selectedYear,entries,entryTypeFilter,
 load,more,openApproval,onError}){
 const categories=computed(()=>[...new Set((entries.value||[]).map(e=>e.category).filter(Boolean))])
 const input=ref('')
 const paymentSources=ref([])
 const transferDestinations=ref([])
 const rewardDestinations=ref([])
 const editReceiptImage=ref(null),editReceiptFileName=ref('')
 const receiptSaveError=ref('')
 const receiptImageIds=ref(new Set())
 const viewedReceiptUrl=ref(null)
 const editingEntry=ref(null)
 const pendingEntryIds=ref(new Set())
 const editSaving=ref(false)
 const selectedDay=ref('')
 const calendarExpanded=ref(false)
 const swipedEntryId=ref(null)
 const detailFilter=ref(null),prepaidHistoryFilter=ref(null),detailLoading=ref(false)
 const visibleEntryCount=ref(20),listPageSize=20
 const expandedMonth=ref(''),expandedEntryDays=ref(new Set())
 const annualVisibleCounts=ref({})
 const formatMoney=n=>'¥'+Math.abs(Number(n)||0).toLocaleString('ja-JP')
 const yen=n=>n===null||n===undefined?'—':formatMoney(n)
 const monthLabel=computed(()=>{
  const [year,num]=month.value.split('-')
  return year+'年'+Number(num)+'月'
 })
 const INCOME_CATEGORIES=['給与','賞与','副収入','ポイント還元','その他']
 const categoryIconPath=()=>ICON_LIBRARY.find(i=>i.id==='other')?.path||''
 const categoryLabel=v=>v||'その他'
 const resetMonth=()=>{month.value=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'}).slice(0,7)}
 const selectedDateType=(e,kind)=>kind==='all'||(kind==='expense'?(e.type==='expense'||!e.type):e.type===kind)
 const filteredEntries=computed(()=>(entries.value||[]).filter(e=>String(e.date||'').startsWith(month.value) &&
   selectedDateType(e,entryTypeFilter.value)&&(!selectedDay.value||e.date===selectedDay.value)))
 const displayEntries=computed(()=>filteredEntries.value)
 const sortedDisplayEntries=computed(()=>[...displayEntries.value].sort((a,b)=>
  String(b.date||'').localeCompare(String(a.date||'')) ||
  String(b.time||'').localeCompare(String(a.time||''))||String(b.id).localeCompare(String(a.id))))
 const annualDetailMode=computed(()=>false)
 const paymentMethodAnnualTotals=computed(()=>new Map())
 const annualMonthGroups=computed(()=>groupAnnualEntries(sortedDisplayEntries.value,annualVisibleCounts.value,listPageSize,entryTypeFilter.value))
 const groupedPagedEntries=computed(()=>{
  const map=new Map()
  for(const e of sortedDisplayEntries.value){
   if(!map.has(e.date))map.set(e.date,{date:e.date,items:[],count:0,total:0})
   const g=map.get(e.date);g.count++
   if(!e.pending_approval||e.pending_operation!=='create')
    g.total+=e.type==='income'?Number(e.amount||0):e.type==='transfer'&&entryTypeFilter.value==='all'
     ?0:-Number(e.amount||0)
  }
  const shown=new Set(sortedDisplayEntries.value.slice(0,visibleEntryCount.value).map(x=>x.id))
  for(const e of sortedDisplayEntries.value)if(shown.has(e.id))map.get(e.date).items.push(e)
  return [...map.values()].filter(g=>g.items.length)
 })
 function formatLedgerTotal(n,kind){return (Number(n)>0?'+':'')+yen(n)}
 const calendarDays=computed(()=>{
  const [y,m]=month.value.split('-').map(Number)
  if(!Number.isInteger(y)||!Number.isInteger(m)||m<1||m>12)return []
  const count=new Date(y,m,0).getDate(),first=new Date(y,m-1,1).getDay()
  const relevant=(entries.value||[]).filter(e=>!e.pending_approval||e.pending_operation!=='create')
   .filter(e=>String(e.date||'').startsWith(month.value))
   .filter(e=>selectedDateType(e,entryTypeFilter.value))
  const days=new Map()
  for(const row of relevant){
   const d=row.date,v=Number(row.amount||0)
   if(!days.has(d))days.set(d,{income:0,expense:0,transfer:0,count:0})
   const acc=days.get(d);acc.count++
   acc[row.type==='income'?'income':row.type==='transfer'?'transfer':'expense']+=v
  }
  const biggest=t=>Math.max(0,...[...days.values()].map(x=>x[t]))
  const maxIn=biggest('income'),maxOut=biggest('expense'),maxTrans=biggest('transfer')
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'})
  const result=Array.from({length:first},(_,i)=>({key:'blank-'+i,blank:true}))
  for(let d=1;d<=count;d++){
   const date=month.value+'-'+String(d).padStart(2,'0'),v=days.get(date)||{income:0,expense:0,transfer:0,count:0}
   const value=entryTypeFilter.value==='income'?v.income:entryTypeFilter.value==='expense'?-v.expense:
    entryTypeFilter.value==='transfer'?-v.transfer:v.income-v.expense
   result.push({key:date,date,day:d,blank:false,amount:value,hasEntries:v.count>0,isToday:date===today,
    topExpense:v.expense>0&&v.expense===maxOut,
    topIncome:v.income>0&&v.income===maxIn,
    topTransfer:v.transfer>0&&v.transfer===maxTrans})
  }
  while(result.length%7)result.push({key:'end-'+result.length,blank:true})
  return result
 })
 const visibleCalendarDays=computed(()=>{
  if(calendarExpanded.value)return calendarDays.value
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'})
  const target=today.startsWith(month.value)?today:
   selectedDay.value.startsWith(month.value)?selectedDay.value:
   calendarDays.value.find(d=>!d.blank)?.date
  const i=Math.max(0,calendarDays.value.findIndex(x=>x.date===target))
  return calendarDays.value.slice(Math.floor(i/7)*7,Math.floor(i/7)*7+7)
 })
 const touch=ref(null)
 function startSwipe(ev){const t=ev.touches?.[0];if(t)touch.value={x:t.clientX,y:t.clientY}}
 function endSwipe(ev,id){
  const t=ev.changedTouches?.[0],v=touch.value;touch.value=null
  if(t&&v&&Math.abs(t.clientX-v.x)>50&&Math.abs(t.clientX-v.x)>Math.abs(t.clientY-v.y)*1.4)
   swipedEntryId.value=t.clientX<v.x?id:null
 }
 function setEntryTypeFilter(next){
  if(!['all','income','expense','transfer'].includes(next))return
  entryTypeFilter.value=next;visibleEntryCount.value=20;selectedDay.value=''
  swipedEntryId.value=null
 }
 function toggleDay(date){selectedDay.value=selectedDay.value===date?'':date;visibleEntryCount.value=20}
 function toggleEntryDay(date){
  const state=new Set(expandedEntryDays.value)
  state.has(date)?state.delete(date):state.add(date)
  expandedEntryDays.value=state
 }
 watch(groupedPagedEntries,groups=>{
  if(expandedEntryDays.value.size===0&&groups.length)
   expandedEntryDays.value=new Set(groups.map(x=>x.date))
 },{immediate:true})
 watch(month,()=>{visibleEntryCount.value=20;selectedDay.value='';calendarExpanded.value=false;expandedEntryDays.value=new Set()})
 function loadMoreEntries(){visibleEntryCount.value+=20;
  if(visibleEntryCount.value>(entries.value||[]).length)void more()
 }
 function loadMoreAnnualEntries(group){annualVisibleCounts.value={...annualVisibleCounts.value,
  [group.month]:group.items.length+listPageSize}}
 function clearDetailFilter(){detailFilter.value=null;prepaidHistoryFilter.value=null}
 function cancelEdit(){editingEntry.value=null;editReceiptImage.value=null}
 function startEdit(entry){
  if(entry?.pending_approval){onError('この明細は HomeFlow 審査中です');return}
  editingEntry.value={...entry,paymentSource:'',payment_source:null,transferTarget:''}
  swipedEntryId.value=null
 }
 function setEntryType(row,type){if(['income','expense'].includes(type)){row.type=type;row.category=''}}
 function manualPayment(){}
 function handleEntryClick(entry){startEdit(entry)}
 async function saveEdit(){
  if(!editingEntry.value||editSaving.value)return
  const row={...editingEntry.value}
  editSaving.value=true
  try{
   await openApproval('update',row)
   cancelEdit()
  }catch(e){onError(e.message||'編集申請の送信に失敗しました')}
  finally{editSaving.value=false}
 }
 async function remove(id,entry){
  const row=entry||entries.value.find(e=>e.id===id)
  if(!row||row.pending_approval)return
  if(!window.confirm('この明細の削除を HomeFlow の管理者へ申請しますか？承認前は削除されません。'))return
  try{await openApproval('delete',row)}
  catch(e){onError(e.message||'削除申請の送信に失敗しました')}
 }
 const closeReceipt=()=>{viewedReceiptUrl.value=null}
 const viewReceipt=()=>onError('其他成员的私人收据不可直接查看')
 const removeReceiptImage=()=>onError('私人收据不允许跨成员删除')
 const selectEditReceipt=()=>onError('家庭附件必须经过共享审批')
 const loadFull=()=>load()
 return {categories,tab,month,resetMonth,selectedYear,input,paymentSources,
  transferDestinations,rewardDestinations,editReceiptImage,editReceiptFileName,
  receiptSaveError,selectEditReceipt,receiptImageIds,viewedReceiptUrl,
  viewReceipt,closeReceipt,removeReceiptImage,editingEntry,INCOME_CATEGORIES,
  categoryIconPath,categoryLabel,yen,load:loadFull,setEntryType,
  pendingEntryIds,editSaving,remove,startEdit,cancelEdit,saveEdit,manualPayment,
  selectedDay,entryTypeFilter,calendarExpanded,swipedEntryId,detailFilter,
  prepaidHistoryFilter,detailLoading,visibleEntryCount,listPageSize,displayEntries,
  setEntryTypeFilter,sortedDisplayEntries,annualDetailMode,expandedMonth,
  annualMonthGroups,paymentMethodAnnualTotals,loadMoreAnnualEntries,
  loadMoreEntries,expandedEntryDays,groupedPagedEntries,toggleEntryDay,
  clearDetailFilter,visibleCalendarDays,toggleDay,startSwipe,endSwipe,
  handleEntryClick,monthLabel,formatLedgerTotal}
}
