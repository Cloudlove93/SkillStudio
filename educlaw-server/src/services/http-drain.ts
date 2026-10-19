import {Router,type Request,type RequestHandler} from 'express';

const workKey=Symbol('http-work');
type WorkRequest=Request & {[workKey]?:{begin():()=>void}};

function controlRequest(req:Request):boolean {
  if((req.method==='GET'||req.method==='HEAD')&&/^\/(?:livez|readyz|healthz)\/?$/.test(req.path))return true;
  const base='^/api/arena/threads/[^/]+/runs';
  if((req.method==='GET'||req.method==='HEAD')&&new RegExp(base+'(?:/[^/]+(?:/events)?)?/?$').test(req.path))return true;
  return req.method==='POST'&&new RegExp(base+'/[^/]+/stop/?$').test(req.path);
}

/** Admission and actual handler lifetime share one request token. Close is not completion. */
export function createHttpDrain(){
  let draining=false,active=0;
  const waiters=new Set<()=>void>();
  const middleware:RequestHandler=(req,res,next)=>{
    if(draining&&!controlRequest(req)){
      res.status(503).json({code:'SERVER_DRAINING',error:'Server is draining'});return;
    }
    active++;let ended=false,pending=0,released=false;
    const complete=()=>{
      if(released||!ended||pending)return;
      released=true;active--;res.removeListener('finish',endResponse);res.removeListener('close',endResponse);
      if(active===0){for(const resolve of waiters)resolve();waiters.clear();}
    };
    const endResponse=()=>{ended=true;complete();};
    (req as WorkRequest)[workKey]={begin:()=>{if(released){released=false;active++;}pending++;let done=false;return()=>{if(done)return;done=true;pending--;complete();};}};
    res.once('finish',endResponse);res.once('close',endResponse);next();
  };
  return {middleware,trackMiddleware:(handler:RequestHandler)=>track(handler) as RequestHandler,beginDrain(){draining=true;},waitForIdle():Promise<void>{return active===0?Promise.resolve():new Promise(resolve=>waiters.add(resolve));}};
}

function track(handler:unknown):unknown {
  if(Array.isArray(handler))return handler.map(track);
  if(typeof handler!=='function'||handler.length===4)return handler;
  const execute=handler as RequestHandler;
  const wrapped:RequestHandler=(req,res,next)=>{
    const work=(req as WorkRequest)[workKey];
    if(!work)return execute(req,res,next);
    const release=work.begin();
    const done=()=>{res.removeListener('finish',done);release();};
    let returned=false,asynchronous=false,advanced=false;
    const forward:typeof next=(...args)=>{advanced=true;try{return next(...args);}finally{if(returned&&!asynchronous)done();}};
    try{
      const result=execute(req,res,forward);
      asynchronous=Boolean(result&&typeof (result as PromiseLike<unknown>).then==='function');returned=true;
      if(asynchronous)return Promise.resolve(result).finally(done);
      // Callback middleware remains in flight until next(), and ordinary sync
      // responders until finish. An aborted socket alone cannot release either.
      if(advanced||res.writableFinished)done();else res.once('finish',done);
      return result;
    }catch(error){done();throw error;}
  };
  return wrapped;
}

/** Standard Express router, with registered route promises counted until settlement. */
export function createTrackedRouter(router:ReturnType<typeof Router>=Router()):ReturnType<typeof Router>{
  for(const method of ['get','post','put','patch','delete','all','head','options'] as const){
    const register=router[method].bind(router);
    Object.defineProperty(router,method,{configurable:true,writable:true,value:(path:unknown,...handlers:unknown[])=>Reflect.apply(register,router,[path,...handlers.map(track)])});
  }
  return router;
}
