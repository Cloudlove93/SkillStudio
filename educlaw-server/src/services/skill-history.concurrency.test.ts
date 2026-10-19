import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { AgentPackageSnapshot } from '@educlaw/shared';
import { barrier, isolatedPostgres } from '../../test-utils/isolated-postgres.js';
const enabled=process.env.HARDENING_POSTGRES_TESTS==='1';
let db:Awaited<ReturnType<typeof isolatedPostgres>>;
let packages:typeof import('./package-service.js');
let skills:typeof import('./skill-version-service.js');
let afterRead: (()=>Promise<void>)|undefined;
let writerPid=0;
let readerPid=0;
let role='';
let writerEntered=barrier();
let readerEntered=barrier();
beforeAll(async()=>{
 if(!enabled)return;
 db=await isolatedPostgres();
 vi.doMock('./db.js',()=>({checkDbConnection:()=>db.pool.query('select 1'),query:(sql:string,args?:unknown[])=>db.pool.query(sql,args),withTransaction:async(work:(client:PoolClient)=>Promise<unknown>)=>{
  const currentRole=role;const client=await db.pool.connect();
  const original=client.query.bind(client);
  // Keep production SQL and transactions real; this hook only controls interleaving.
  const wrapped={query:async(sql:string,args?:unknown[])=>{
   const result=await original(sql,args);
   if(currentRole==='reader'&&sql.startsWith('select * from agent_packages')&&afterRead){const hook=afterRead;afterRead=undefined;await hook();}
   return result;
  }};
  try{
   await original('begin');
   if(currentRole==='writer'){writerPid=(await original('select pg_backend_pid() as pid')).rows[0].pid;writerEntered.release();}
   if(currentRole==='reader'){readerPid=(await original('select pg_backend_pid() as pid')).rows[0].pid;readerEntered.release();}
   const result=await work(wrapped as unknown as PoolClient);await original('commit');return result;
  }catch(e){await original('rollback');throw e;}finally{client.release();}
 }}));
 await (await import('./db-schema.js')).initDbSchema();packages=await import('./package-service.js');skills=await import('./skill-version-service.js');
},30_000);
afterAll(async()=>{if(db)await db.close();vi.doUnmock('./db.js');});
const md=(id:string)=>`---\nname: ${id}\ndescription: Teaching procedure\n---\n# Steps\nUse the rule.`;
const snapshot=(ids:string[]):AgentPackageSnapshot=>({name:'History fixture',description:'Concurrency',agentMd:'# Agent',rubricMd:'# Rubric',skills:ids.map(id=>({id,dirName:id,name:id,description:'Teaching procedure',skillMd:md(id)})),versionLabel:'v1'});
async function seed(){
 const client=await db.pool.connect();
 try{
  await client.query('begin');const first=await packages.createPackageWithSnapshotTx(client,'owner',snapshot([]),'manual');
  const next=await packages.createPackageVersionWithSnapshotTx(client,{userId:'owner',packageId:first.packageId,expectedPackageVersionId:first.packageVersionId,snapshot:snapshot(['one','two']),source:'manual'});
  await client.query('commit');return next;
 }finally{client.release();}
}
it.runIf(enabled).each(['remove','edit','add'] as const)('serializes read backfill with a concurrent %s without restoring a stale head',async(change)=>{
 const ids=await seed();const read=barrier(),resume=barrier();writerEntered=barrier();
 role='reader';afterRead=async()=>{read.release();await resume.promise;};
 const reading=skills.listPackageSkills({authUserId:'owner',packageId:String(ids.packageId),includeRemoved:true});
 await read.promise;role='writer';
 const next=snapshot(change==='remove'?['one']:change==='add'?['one','two','three']:['one','two']);
 if(change==='edit')next.skills[1].skillMd=md('writer-edited');
 let committed=false;
 const writing=(async()=>{
  // Use the same transaction boundary and package lock as normal writes.
  const dbModule=await import('./db.js');
  const result=await dbModule.withTransaction(client=>packages.createPackageVersionWithSnapshotTx(client,{userId:'owner',packageId:ids.packageId,expectedPackageVersionId:ids.packageVersionId,snapshot:next,source:'manual'}));
  committed=true;return result;
 })();
 await writerEntered.promise;
 let blocked=false;
 try{
  await vi.waitFor(async()=>{
   blocked=(await db.pool.query('select cardinality(pg_blocking_pids($1)) > 0 as blocked',[writerPid])).rows[0].blocked;
   expect(blocked||committed).toBe(true);
  });
 }finally{resume.release();}
 const saved=await writing;await reading;role='';
 expect(blocked).toBe(true);
 expect((await packages.getPackage('owner',ids.packageId)).snapshot.skills).toEqual(next.skills);
 const rows=await db.pool.query('select skill_uid,status,description from agent_package_skills where package_id=$1 order by skill_uid',[ids.packageId]);
 expect(rows.rows.find(x=>x.skill_uid==='two')?.status).toBe(change==='remove'?'removed':'active');
 expect(String((await db.pool.query('select current_version_id from agent_packages where id=$1',[ids.packageId])).rows[0].current_version_id)).toBe(String(saved.packageVersionId));
});
it.runIf(enabled).each(['remove','edit','add'] as const)('reads the committed head when %s obtains the package lock before backfill',async(change)=>{
 role='';const ids=await seed();const writer=await db.pool.connect();
 await writer.query('begin');await writer.query('select id from agent_packages where id=$1 for update',[ids.packageId]);
 readerEntered=barrier();role='reader';
 const reading=skills.listPackageSkills({authUserId:'owner',packageId:String(ids.packageId),includeRemoved:true});
 await readerEntered.promise;
 const next=snapshot(change==='remove'?['one']:change==='add'?['one','two','three']:['one','two']);
 if(change==='edit')next.skills[1].skillMd=md('writer-edited');
 try{
  await vi.waitFor(async()=>expect((await db.pool.query('select cardinality(pg_blocking_pids($1)) > 0 as blocked',[readerPid])).rows[0].blocked).toBe(true));
  await packages.createPackageVersionWithSnapshotTx(writer,{userId:'owner',packageId:ids.packageId,expectedPackageVersionId:ids.packageVersionId,snapshot:next,source:'manual'});
  await writer.query('commit');
 }catch(e){await writer.query('rollback');throw e;}finally{writer.release();role='';}
 const summaries=await reading;
 expect(summaries.find(x=>x.skillUid==='two')?.status).toBe(change==='remove'?'removed':'active');
 expect((await packages.getPackage('owner',ids.packageId)).snapshot.skills).toEqual(next.skills);
});
it.runIf(enabled)('does not repeatedly rewrite current summaries for empty historical snapshots',async()=>{
 role='';const ids=await seed();
 await db.pool.query("update agent_package_skills set updated_at='2000-01-01' where package_id=$1",[ids.packageId]);
 for(let i=0;i<2;i++)await skills.listPackageSkills({authUserId:'owner',packageId:String(ids.packageId)});
 expect((await db.pool.query('select extract(year from updated_at)::int as year from agent_package_skills where package_id=$1',[ids.packageId])).rows.map(x=>x.year)).toEqual([2000,2000]);
 await expect(skills.listPackageSkills({authUserId:'other',packageId:String(ids.packageId)})).rejects.toMatchObject({status:404});
});
