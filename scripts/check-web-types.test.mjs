import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import test from 'node:test';
const script=resolve('scripts/check-web-types.mjs');
function cleanup(root){assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.match(basename(root),/^eduskill-types-/);rmSync(root,{recursive:true,force:true});}
test('incremental gate accepts old/removable diagnostics but rejects new or replaced diagnostics',()=>{
 const root=mkdtempSync(join(tmpdir(),'eduskill-types-'));
 try{
  writeFileSync(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,types:[],skipLibCheck:true},files:['example.ts']}));
  writeFileSync(join(root,'baseline.json'),JSON.stringify({version:1,diagnostics:[{file:'example.ts',code:2322,message:"Type 'number' is not assignable to type 'string'.",count:1}]}));
  const run=()=>spawnSync(process.execPath,[script,'--root',root,'--project','tsconfig.json','--baseline','baseline.json'],{encoding:'utf8'});
  writeFileSync(join(root,'example.ts'),'const x: string=1;');assert.equal(run().status,0);
  writeFileSync(join(root,'example.ts'),"const x: string='ok';");assert.equal(run().status,0);
  writeFileSync(join(root,'example.ts'),"const x: number='wrong';");const replaced=run();assert.equal(replaced.status,1);assert.match(replaced.stdout,/2322/);
  writeFileSync(join(root,'example.ts'),'const x: string=1;const y: string=2;');assert.equal(run().status,1);
  writeFileSync(join(root,'tsconfig.json'),'{ broken');assert.equal(run().status,2);
 }finally{cleanup(root);}
});
test('missing compiler/configuration cannot be mistaken for a passing gate',()=>{
 const root=mkdtempSync(join(tmpdir(),'eduskill-types-loader-'));
 try{
  mkdirSync(join(root,'scripts'));copyFileSync(script,join(root,'scripts/check-web-types.mjs'));
  const child=spawnSync(process.execPath,[join(root,'scripts/check-web-types.mjs')],{encoding:'utf8'});
  assert.equal(child.status,2);
 }finally{cleanup(root);}
});
