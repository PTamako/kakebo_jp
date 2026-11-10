<script setup>
import {nextTick,onBeforeUnmount,ref,watch} from 'vue'
const props=defineProps({open:{type:Boolean,default:false},busy:{type:Boolean,default:false},
  error:{type:String,default:''}})
const emit=defineEmits(['submit','cancel'])
const code=ref('')
const input=ref(null)
const sheet=ref(null)
const submit=()=>{if(code.value.trim()&&!props.busy)emit('submit',code.value)}
let previousOverflow=''
function onKeydown(event){
  if(!props.open)return
  if(event.key==='Escape'&&!props.busy){event.preventDefault();emit('cancel');return}
  if(event.key!=='Tab')return
  const controls=[...(sheet.value?.querySelectorAll('input:not(:disabled),button:not(:disabled)')||[])]
  if(!controls.length)return
  const first=controls[0],last=controls.at(-1)
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
watch(()=>props.open,async opened=>{
  if(opened){
    code.value=''
    previousOverflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    document.addEventListener('keydown',onKeydown)
    await nextTick();input.value?.focus({preventScroll:true})
  }else{
    // The access code must not persist in memory after cancel or successful login.
    code.value=''
    document.body.style.overflow=previousOverflow
    document.removeEventListener('keydown',onKeydown)
  }
},{immediate:true})
onBeforeUnmount(()=>{
  if(props.open)document.body.style.overflow=previousOverflow
  document.removeEventListener('keydown',onKeydown)
})
</script>
<template>
  <Teleport to="body">
    <div v-if="open" class="login-sheet-backdrop" @click.self="!busy && emit('cancel')">
      <section ref="sheet" class="login-sheet" role="dialog" aria-modal="true" aria-label="アクセスコードを入力">
        <span class="login-sheet-handle" aria-hidden="true"></span>
        <h2>ログイン</h2>
        <p>アクセスコードを入力してください</p>
        <form @submit.prevent="submit">
          <label for="kakeibo-access-code">アクセスコード</label>
          <input id="kakeibo-access-code" ref="input" v-model="code" type="password"
            autocomplete="current-password" :disabled="busy" required
            placeholder="アクセスコード" />
          <p v-if="error" role="alert" class="login-sheet-error">{{error}}</p>
          <div class="login-sheet-actions">
            <button type="button" :disabled="busy" @click="emit('cancel')">キャンセル</button>
            <button type="submit" :disabled="busy || !code.trim()">{{busy?'確認中…':'ログイン'}}</button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.login-sheet-backdrop{position:fixed;inset:0;z-index:2147483640;background:#1118;display:flex;align-items:flex-end;justify-content:center;overscroll-behavior:contain}
.login-sheet{box-sizing:border-box;width:min(100%,560px);max-height:85dvh;overflow-y:auto;border-radius:24px 24px 0 0;background:var(--card,#fff);color:var(--ink,#242832);padding:12px 20px calc(20px + env(safe-area-inset-bottom,0px));box-shadow:0 -12px 36px #0002}
.login-sheet-handle{display:block;width:40px;height:5px;border-radius:8px;background:var(--line,#d9dce2);margin:0 auto 16px}
.login-sheet h2{font-size:19px;margin:0 0 8px}
.login-sheet p{font-size:14px;margin:0 0 16px}
.login-sheet form{display:grid;gap:12px}
.login-sheet label{font-size:14px;font-weight:700}
.login-sheet input{box-sizing:border-box;width:100%;min-height:48px;border:1px solid var(--line,#ddd);border-radius:12px;background:var(--card,#fff);color:var(--ink,#222);padding:12px;font-size:16px}
.login-sheet-actions{display:flex;gap:8px}
.login-sheet-actions button{flex:1;min-height:48px;border-radius:12px;border:1px solid var(--line,#ddd);background:var(--tint,#eee);color:var(--ink,#222);font-size:16px;font-weight:700}
.login-sheet-actions button[type=submit]{background:var(--blue,#6298d3);color:white;border-color:transparent}
.login-sheet-error{color:#b52b32;font-weight:600}
</style>
