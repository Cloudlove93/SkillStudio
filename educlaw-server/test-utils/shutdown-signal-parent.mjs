import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
async function scenario(stalled){
 const child=spawn(process.execPath,[fileURLToPath(new URL('./shutdown-signal-child.mjs',import.meta.url))],{stdio:['pipe','pipe','inherit'],env:{...process.env,HARDENING_STALLED:stalled?'1':'0'}});
 const events=[],waiters=[];
 createInterface({input:child.stdout}).on('line',line=>{events.push(JSON.parse(line));for(const resolve of waiters.splice(0))resolve();});
 const wait=async(predicate)=>{while(!events.some(predicate))await new Promise(resolve=>waiters.push(resolve));return events.find(predicate);};
 const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 const watchdog=setTimeout(()=>child.kill('SIGKILL'),8000);
 try{
  const ready=await wait(e=>e.event==='ready'),url=`http://127.0.0.1:${ready.port}`;
  const initial=await (await fetch(url+'/api/arena/threads/91/runs',{method:'POST'})).json();
  const ordinary=fetch(url+'/ordinary',{method:'POST'}).then(async res=>({status:res.status,body:await res.text()}),()=>null);
  await wait(e=>e.event==='accepted'&&e.kind==='ordinary');const streams=[];
  if(!stalled)for(const path of ['/api/arena/threads/91/messages/stream','/api/arena/threads/messages/stream?threadId=91']){
   const res=await fetch(url+path,{method:'POST'});streams.push(res.text().then(body=>({status:res.status,body})));
  }
  child.kill('SIGTERM');child.kill('SIGINT');
  if(!stalled){
   let readiness;for(let n=0;n<100;n++){readiness=await fetch(url+'/readyz');if(readiness.status===503)break;await new Promise(r=>setTimeout(r,5));}assert.equal(readiness.status,503);
   for(const path of ['/api/arena/threads/91/messages/stream','/api/arena/threads/messages/stream?threadId=91','/ordinary','/api/actions','/api/arena/threads/91/runs']){
    const rejected=await fetch(url+path,{method:'POST'});assert.equal(rejected.status,503);assert.equal((await rejected.json()).code,'SERVER_DRAINING');
   }
   assert.equal((await (await fetch(url+'/api/arena/threads/91/runs')).json()).run.runId,initial.runId);
   child.stdin.write('finish\n');assert.equal((await ordinary).status,200);
   for(const stream of streams){const result=await stream;assert.equal(result.status,200);assert.match(result.body,/"ok":true/);}
  }
  const finished=await exit,result=await wait(e=>e.event==='exit');assert.equal(finished.code,stalled?1:0);assert.equal(finished.signal,null);assert.equal(result.dbClosed,!stalled);
  if(!stalled){const closing=result.order.indexOf('db-close-start');assert.ok(closing>=0);assert.ok(result.order.includes('http-closed'));assert.ok(closing>result.order.indexOf('http-closed'));for(const kind of ['ordinary','canonical','alias']){assert.ok(result.order.includes(`persist:${kind}`));assert.ok(closing>result.order.indexOf(`persist:${kind}`));}}
  else{assert.ok(result.order.includes('shutdown.incomplete'));assert.equal(result.order.includes('db-close-start'),false);await ordinary;}
  return {stalled,...finished,dbClosed:result.dbClosed,order:result.order};
 }finally{clearTimeout(watchdog);child.kill('SIGKILL');}
}
const normal=await scenario(false),forced=await scenario(true);
console.log(JSON.stringify({realExpress:true,realPostgres:true,realSignals:['SIGTERM','SIGINT'],normal,forced,modelCalls:0}));
