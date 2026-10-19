import express from 'express';
import type {Server} from 'node:http';
import {afterEach,expect,it} from 'vitest';
import {createHttpDrain,createTrackedRouter} from './http-drain.js';
const servers:Server[]=[];
function barrier(){let release!:()=>void;const promise=new Promise<void>(r=>{release=r;});return{promise,release};}
async function serve(app:express.Express){const server=app.listen(0);servers.push(server);await new Promise<void>(r=>server.once('listening',r));return `http://127.0.0.1:${(server.address() as {port:number}).port}`;}
afterEach(async()=>{for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}});
it('rejects canonical, alias and other business requests during drain while preserving health and Run controls',async()=>{
 const app=express(),drain=createHttpDrain(),router=createTrackedRouter();let executions=0;
 app.use(drain.middleware);
 router.all(/.*/,(_req,res)=>{executions++;res.json({ok:true});});app.use(router);
 const url=await serve(app);drain.beginDrain();
 for(const path of ['/api/arena/threads/91/messages/stream','/api/arena/threads/messages/stream?threadId=91','/api/actions','/api/packages/7/manual-edit','/api/arena/threads/91/runs']){
  const res=await fetch(url+path,{method:'POST'});expect(res.status).toBe(503);expect(await res.json()).toMatchObject({code:'SERVER_DRAINING'});
 }
 expect(executions).toBe(0);
 for(const path of ['/readyz','/healthz','/livez','/api/arena/threads/91/runs','/api/arena/threads/91/runs/r1','/api/arena/threads/91/runs/r1/events'])expect((await fetch(url+path)).status).toBe(200);
 expect((await fetch(url+'/api/arena/threads/91/runs/r1/stop',{method:'POST'})).status).toBe(200);
 expect((await fetch(url+'/api/packages')).status).toBe(503);
});
it('waits for handler completion after a client disconnect instead of equating socket close with idle',async()=>{
 const app=express(),drain=createHttpDrain(),router=createTrackedRouter(),started=barrier(),finish=barrier();
 app.use(drain.middleware);router.post('/work',async(_req,res)=>{res.write('started');started.release();await finish.promise;res.end();});app.use(router);
 const url=await serve(app),controller=new AbortController();const response=await fetch(url+'/work',{method:'POST',signal:controller.signal});await started.promise;
 await response.body!.getReader().read();controller.abort();drain.beginDrain();let idle=false;const waiting=drain.waitForIdle().then(()=>{idle=true;});
 await new Promise(r=>setTimeout(r,10));expect(idle).toBe(false);
 finish.release();await waiting;expect(idle).toBe(true);
});
it('does not release work merely because a response has finished before async cleanup',async()=>{
 const app=express(),drain=createHttpDrain(),router=createTrackedRouter(),cleanup=barrier();
 app.use(drain.middleware);router.get('/work',async(_req,res)=>{res.end('response');await cleanup.promise;});app.use(router);
 const url=await serve(app);await (await fetch(url+'/work')).text();drain.beginDrain();let idle=false;const wait=drain.waitForIdle().then(()=>{idle=true;});await Promise.resolve();expect(idle).toBe(false);cleanup.release();await wait;
});
it.each(['router','app'])('retains %s callback middleware and downstream persistence after socket close',async(place)=>{
 const app=express(),drain=createHttpDrain(),router=createTrackedRouter(),ready=barrier(),nextReady=barrier(),advance=barrier(),persist=barrier();
 app.use(drain.middleware);
 const middleware:express.RequestHandler=(_req,res,next)=>{res.write('started');ready.release();void advance.promise.then(()=>next());};
 const handler=async()=>{nextReady.release();await persist.promise;};
 if(place==='app'){app.use(drain.trackMiddleware(middleware));router.post('/work',handler);}else router.post('/work',middleware,handler);
 app.use(router);const url=await serve(app),controller=new AbortController();const res=await fetch(url+'/work',{method:'POST',signal:controller.signal});await ready.promise;await res.body!.getReader().read();controller.abort();drain.beginDrain();
 let idle=false;const wait=drain.waitForIdle().then(()=>{idle=true;});await new Promise(r=>setTimeout(r,10));expect(idle).toBe(false);
 advance.release();await nextReady.promise;expect(idle).toBe(false);persist.release();await wait;
});
