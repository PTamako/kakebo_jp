import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'

const src=readFileSync(new URL('../src/FamilyFinanceProposals.vue',import.meta.url),'utf8')
function slice(a,b){
 const start=src.indexOf(a),end=src.indexOf(b,start+a.length)
 assert.ok(start>=0&&end>start,'missing real request component methods')
 return src.slice(start,end)
}
test('foreground load and close cannot invalidate an in-flight member proposal and strand busy state',async()=>{
 let requests=0
 const ctx=vm.createContext({
  props:{userId:'member-1'},
  open:{value:true},busy:{value:'create'},loading:{value:false},
  error:{value:''},notice:{value:''},items:{value:[]},offset:{value:0},nextOffset:{value:null},unavailable:{value:false},
  call:async()=>{requests++;return {ok:true,ledger_changed:false,items:[],next_offset:null}},
  verify:()=>true,
 })
 vm.runInContext('let revision=0,alive=true;\n'+
  slice('async function load(at=0){','async function toggle(){')+'\n'+
  slice('async function toggle(){','async function createProposal(){')+
  '\nthis.current=()=>revision;this.performLoad=load;this.performToggle=toggle;',ctx)
 await ctx.performLoad(0)
 await ctx.performToggle()
 assert.equal(ctx.current(),0,'busy background refresh may not invalidate mutation generation')
 assert.equal(ctx.open.value,true,'busy form cannot be closed accidentally')
 assert.equal(ctx.busy.value,'create')
 assert.equal(requests,0,'blocked refresh must not issue an extra D1 GET')
 ctx.busy.value=''
 await ctx.performLoad(0)
 assert.equal(ctx.current(),1)
 assert.equal(requests,1)
 assert.equal(ctx.loading.value,false)
})
test('proposal UI requires member-owned unarchived stable account and frozen retry',()=>{
 assert.match(src,/a\?\.owner_user_id===props.userId&&a.origin==='member_created'/)
 assert.match(src,/Number\(a.is_archived\)===0/)
 assert.match(src,/if\(frozenDraft\)\{/)
 assert.match(src,/body:JSON.stringify\(frozenDraft\)/)
 assert.match(src,/if\(busy.value\)return\s*open.value=!open.value/)
 assert.match(src,/if\(!alive\|\|!open.value\|\|busy.value\|\|!Number.isSafeInteger\(at\)/)
 assert.match(src,/const ticket=\+\+revision/)
 assert.doesNotMatch(src,/localStorage|sessionStorage|indexedDB/)
 assert.doesNotMatch(src,/\/api\/entries|\/api\/internal\/approved-actions/)
})
