import {afterEach,expect,it,vi} from 'vitest';
import {createServerShutdown} from './server-shutdown.js';
afterEach(()=>vi.useRealTimers());
function barrier(){let release!:()=>void;const promise=new Promise<void>(r=>{release=r;});return{promise,release};}
it('starts drain synchronously, waits for accepted work, and coalesces repeated signals',async()=>{
 const work=barrier();const order:string[]=[];
 const shutdown=createServerShutdown({beginDrain:()=>order.push('drain'),stopBackground:()=>order.push('stop-claims'),waitForIdle:()=>work.promise,abortActive:()=>order.push('abort'),closeHttp:async()=>{order.push('http');},forceCloseHttp:()=>order.push('force'),closeResources:async()=>{order.push('db');},exit:code=>order.push(`exit${code}`),log:()=>{}});
 const first=shutdown();expect(order).toEqual(['drain','stop-claims']);expect(shutdown()).toBe(first);
 work.release();await first;expect(order).toEqual(['drain','stop-claims','http','db','exit0']);
});
it('aborts only after grace and records failure if producer never confirms idle',async()=>{
 vi.useFakeTimers();const work=barrier();const abort=vi.fn(),exit=vi.fn(),log=vi.fn();
 const shutdown=createServerShutdown({beginDrain:()=>{},stopBackground:()=>{},waitForIdle:()=>work.promise,abortActive:abort,closeHttp:async()=>{},forceCloseHttp:()=>{},closeResources:async()=>{},exit,log,drainMs:30,cancelMs:5,closeMs:5});
 const done=shutdown();await vi.advanceTimersByTimeAsync(29);expect(abort).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);expect(abort).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(10);await done;expect(exit).toHaveBeenCalledWith(1);expect(log).toHaveBeenCalledWith('shutdown.unconfirmed');
});
it('bounds resource cleanup and does not label a failed cleanup successful',async()=>{
 vi.useFakeTimers();const exit=vi.fn();const shutdown=createServerShutdown({beginDrain:()=>{},stopBackground:()=>{},waitForIdle:async()=>{},abortActive:()=>{},closeHttp:()=>new Promise(()=>{}),forceCloseHttp:()=>{},closeResources:async()=>{},exit,log:()=>{},closeMs:5});
 const done=shutdown();await vi.advanceTimersByTimeAsync(5);await done;expect(exit).toHaveBeenCalledWith(1);
});
it('keeps database resources open until delayed ordinary HTTP work has persisted and finished',async()=>{
 const http=barrier(),closing=barrier();const order:string[]=[];let databaseClosed=false;
 const shutdown=createServerShutdown({beginDrain:()=>{},stopBackground:()=>{},waitForIdle:async()=>{},abortActive:()=>{},closeHttp:()=>{closing.release();return http.promise;},forceCloseHttp:()=>{},closeResources:async()=>{databaseClosed=true;order.push('db-close');},exit:()=>{},log:()=>{}});
 const done=shutdown();await closing.promise;
 expect(databaseClosed).toBe(false);
 order.push('persist');http.release();await done;
 expect(order).toEqual(['persist','db-close']);
});
it('never closes the database or reports success after forced disconnect with unfinished business',async()=>{
 vi.useFakeTimers();const pending=barrier();const closeDb=vi.fn(),exit=vi.fn(),force=vi.fn();
 const shutdown=createServerShutdown({beginDrain:()=>{},stopBackground:()=>{},waitForIdle:()=>pending.promise,abortActive:()=>{},closeHttp:async()=>{},forceCloseHttp:force,closeResources:closeDb,exit,log:()=>{},drainMs:30,cancelMs:5,closeMs:5});
 const done=shutdown();await vi.advanceTimersByTimeAsync(39);expect(exit).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);await done;
 expect(force).toHaveBeenCalled();expect(closeDb).not.toHaveBeenCalled();expect(exit).toHaveBeenCalledWith(1);
});
