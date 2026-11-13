import test from 'node:test'
import assert from 'node:assert/strict'
import {readdirSync,readFileSync} from 'node:fs'
import {join,extname,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
// A conservative scan of tracked source folders prevents new high-confidence
// credential literals in public commits. This does not rewrite Git history.
const root=fileURLToPath(new URL('../',import.meta.url))
const dirs=['src','functions','workers','scripts','.github','docs','migrations','public']
const extensions=new Set(['.js','.mjs','.ts','.vue','.md','.json','.toml','.yml','.yaml','.sql','.html','.css'])
const patterns=[
  /AIza[0-9A-Za-z_-]{35}/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{70,}/g,
  /sk-[0-9A-Za-z]{32,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
]
const files=[]
function walk(path){
 for(const entry of readdirSync(path,{withFileTypes:true})){
   if(entry.name==='node_modules'||entry.name==='.git')continue
   const full=join(path,entry.name)
   if(entry.isDirectory())walk(full)
   else if(extensions.has(extname(entry.name)))files.push(full)
 }
}
for(const dir of dirs)walk(join(root,dir))
test('public source tree contains no high-confidence embedded API keys or private keys',()=>{
 const leaks=[]
 for(const path of files){
   const data=readFileSync(path,'utf8')
   for(const pattern of patterns){
     pattern.lastIndex=0
     const m=pattern.exec(data)
     if(m)leaks.push(relative(root,path)+':'+data.slice(0,m.index).split('\n').length)
   }
 }
 assert.deepEqual(leaks,[],'Secrets must be stored in Cloudflare/GitHub Secret stores, not source')
})