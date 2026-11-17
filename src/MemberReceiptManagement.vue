<script setup>
import {ref,computed,onUnmounted,watch} from 'vue'
import MobileChoiceSheet from './MobileChoiceSheet.vue'
import {receiptZip} from './receipt-export.js'
const props=defineProps({
 items:{type:Array,default:()=>[]},
 onFetch:{type:Function,required:true},
 onDelete:{type:Function,required:true},
 onRefresh:{type:Function,required:true}
})
const busy=ref(false),notice=ref(''),year=ref(new Date().getFullYear().toString()),
 month=ref(''),page=ref(0),viewUrl=ref(''),previewId=ref('')
const rows=computed(()=>props.items.filter(x=>x.state==='ready'))
const years=computed(()=>[...new Set([new Date().getFullYear().toString(),
 ...rows.value.map(x=>String(x.date||'').slice(0,4))])].sort().reverse())
const filtered=computed(()=>rows.value.filter(r=>r.date?.startsWith(year.value+
 (month.value?'-'+month.value:''))))
const pages=computed(()=>Math.max(1,Math.ceil(filtered.value.length/5)))
const shown=computed(()=>filtered.value.slice(page.value*5,page.value*5+5))
watch([year,month],()=>{page.value=0})
watch(pages,n=>{if(page.value>=n)page.value=n-1})
function close(){if(viewUrl.value)URL.revokeObjectURL(viewUrl.value);viewUrl.value='';previewId.value=''}
onUnmounted(close)
async function view(item){
 if(busy.value)return
 busy.value=true;notice.value=''
 try{const blob=await props.onFetch(item.receipt_id)
  close();previewId.value=item.receipt_id;viewUrl.value=URL.createObjectURL(blob)
 }catch(e){notice.value='画像を表示できません：'+e.message}
 finally{busy.value=false}
}
async function saveImage(item){
 if(busy.value)return
 busy.value=true;notice.value=''
 try{
  const blob=await props.onFetch(item.receipt_id)
  const url=URL.createObjectURL(blob),link=document.createElement('a')
  link.href=url;link.download='receipt-'+item.date+'-'+item.receipt_id.slice(0,8)+
   (blob.type==='image/jpeg'?'.jpg':'.webp')
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)
 }catch(e){notice.value='画像を保存できません：'+e.message}
 finally{busy.value=false}
}
async function saveZip(input){
 if(busy.value||!input.length)return
 busy.value=true;notice.value=''
 try{
  const all=[...input].sort((a,b)=>a.created_at-b.created_at)
  for(let start=0;start<all.length;start+=200){
   const chunk=all.slice(start,start+200),images=[]
   for(let i=0;i<chunk.length;i++)images.push({entryId:start+i+1,
    blob:await props.onFetch(chunk[i].receipt_id)})
   const blob=await receiptZip(images),url=URL.createObjectURL(blob)
   const link=document.createElement('a')
   link.href=url;link.download='kakeibo-personal-receipts-'+(start/200+1)+'.zip'
   document.body.appendChild(link);link.click();link.remove()
   setTimeout(()=>URL.revokeObjectURL(url),60000)
  }
  notice.value=all.length+'件の画像をZIP保存しました'
 }catch(e){notice.value='ZIP保存できません：'+e.message}
 finally{busy.value=false}
}
async function removeRows(selected){
 if(busy.value||!selected.length)return
 if(!window.confirm('画像'+selected.length+'件を完全削除しますか？ZIP保存していない画像は復元できません。明細は保持します。'))return
 busy.value=true;notice.value=''
 let succeeded=0
 try{
  for(const row of selected){
   await props.onDelete(row.receipt_id)
   if(previewId.value===row.receipt_id)close()
   succeeded++
  }
  notice.value=succeeded+'件を削除しました（明細は保持）'
 }catch(e){notice.value=succeeded+'件削除後に中断：'+e.message}
 finally{await props.onRefresh().catch(()=>{});busy.value=false}
}
</script>
<template>
  <div class="member-receipt-tools">
    <div class="device-privacy-section">
      <div class="device-privacy-row">
        <strong>保存済みレシート画像</strong>
        <span class="device-privacy-count" aria-live="polite">{{rows.length}}件</span>
      </div>
      <div class="device-receipt-period">
        <strong>期間を選んで画像を確認</strong>
        <div class="member-receipt-period-fields">
          <label>対象年<MobileChoiceSheet v-model="year" label="対象年" :searchable="false"
            :options="years.map(n=>({value:n,label:n+'年'}))"/></label>
          <label>対象月<MobileChoiceSheet v-model="month" label="対象月" :searchable="false"
            :options="[{value:'',label:'1年分'},...Array.from({length:12},(_,i)=>({value:String(i+1).padStart(2,'0'),label:(i+1)+'月'}))]"/></label>
        </div>
        <p v-if="!filtered.length" class="help">この期間の画像はありません。</p>
        <div v-for="item in shown" :key="item.receipt_id" class="member-receipt-row">
          <div class="member-receipt-label">
            <strong>{{item.merchant||'レシート'}} · {{item.date}}</strong>
            <small>{{Math.ceil(item.size_bytes/1024)}} KB</small>
          </div>
          <div class="member-receipt-actions">
            <button type="button" :disabled="busy" @click="view(item)">表示</button>
            <button type="button" :disabled="busy" @click="saveImage(item)">保存</button>
            <button type="button" class="danger" :disabled="busy" @click="removeRows([item])">削除</button>
          </div>
        </div>
        <div v-if="pages>1" class="member-receipt-pages">
          <button type="button" :disabled="busy||page===0" @click="page--">前へ</button>
          <span>{{page+1}} / {{pages}}</span>
          <button type="button" :disabled="busy||page+1>=pages" @click="page++">次へ</button>
        </div>
        <div class="device-receipt-actions">
          <button type="button" :disabled="busy||!filtered.length" @click="saveZip(filtered)">この期間の画像をZIP保存</button>
          <button type="button" class="danger" :disabled="busy||!filtered.length" @click="removeRows(filtered)">この期間の画像を削除</button>
        </div>
      </div>
      <div class="device-receipt-actions">
        <button type="button" :disabled="busy||!rows.length" @click="saveZip(rows)">全画像を分割ZIP保存</button>
        <button type="button" class="danger" :disabled="busy||!rows.length" @click="removeRows(rows)">画像をすべて削除</button>
        <button type="button" :disabled="busy" @click="onRefresh">再読み込み</button>
      </div>
      <p v-if="notice" role="status" class="help">{{notice}}</p>
    </div>
    <div v-if="viewUrl" class="edit-overlay" @click.self="close">
      <div class="edit-dialog" role="dialog" aria-modal="true" aria-label="レシート画像">
        <div class="edit-dialog-heading"><h2>レシート画像</h2>
          <button type="button" class="icon-button" @click="close" aria-label="閉じる">×</button>
        </div>
        <img :src="viewUrl" alt="保存したレシート" class="member-receipt-preview"/>
        <button type="button" class="button-secondary" @click="close">閉じる</button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.member-receipt-period-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.member-receipt-period-fields label{min-width:0;display:grid;gap:5px;font-size:12px}
.member-receipt-row{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 0;border-bottom:1px solid var(--line,#e7e7e7)}
.member-receipt-label{display:grid;gap:4px;min-width:0;font-size:13px}
.member-receipt-label small{color:var(--muted,#888)}
.member-receipt-actions{display:flex;gap:5px}
.member-receipt-actions button,.member-receipt-pages button,.device-receipt-actions button{min-height:42px;border:1px solid var(--line,#ddd);border-radius:9px;background:var(--card,#fff);color:var(--ink,#222);padding:6px 10px}
.member-receipt-actions button.danger,.device-receipt-actions button.danger{color:#b4283c}
.member-receipt-pages{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0}
.device-receipt-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.member-receipt-preview{display:block;width:100%;max-height:65vh;object-fit:contain}
</style>