import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AgentPackageSnapshot } from '@educlaw/shared';
import type { PoolClient } from 'pg';
import { barrier, isolatedPostgres } from '../../test-utils/isolated-postgres.js';

const enabled = process.env.HARDENING_POSTGRES_TESTS === '1';
let db: Awaited<ReturnType<typeof isolatedPostgres>>;
let service: typeof import('./package-service.js');
let beforeTransaction: (() => Promise<void>) | undefined;
let readerPid=0;
beforeAll(async () => {
  if (!enabled) return;
  db = await isolatedPostgres();
  vi.doMock('./db.js', () => ({
    checkDbConnection: () => db.pool.query('select 1'),
    query: (text: string, values?: unknown[]) => db.pool.query(text, values),
    withTransaction: async (work: (client: PoolClient) => Promise<unknown>) => {
      const hook = beforeTransaction; beforeTransaction = undefined;
      const client = await db.pool.connect();
      try { if(hook)readerPid=(await client.query('select pg_backend_pid() as pid')).rows[0].pid; await hook?.(); await client.query('begin'); const result = await work(client); await client.query('commit'); return result; }
      catch (e) { await client.query('rollback'); throw e; }
      finally { client.release(); }
    },
  }));
  await (await import('./db-schema.js')).initDbSchema();
  service = await import('./package-service.js');
}, 30_000);
afterAll(async () => { if (db) await db.close(); vi.doUnmock('./db.js'); });
const md = (name: string) => `---\nname: ${name}\ndescription: Teaching procedure\n---\n# Steps\nUse the rule.`;
function snapshot(): AgentPackageSnapshot {
  return { name: 'Isolated fixture', description: 'Concurrency', agentMd: '# Agent', rubricMd: '# Rubric', skills: ['one','two'].map(id => ({id,dirName:id,name:id,description:'Teaching procedure',skillMd:md(id)})), versionLabel:'v1' };
}
it.runIf(enabled).each(['agent','rubric','skill'] as const)('rejects a stale %s edit after another connection commits without moving its head', async target => {
  const seed = await db.pool.connect();
  let ids;
  try { await seed.query('begin'); ids=await service.createPackageWithSnapshotTx(seed,'owner',snapshot(),'manual'); await seed.query('commit'); }
  finally { seed.release(); }
  const entered=barrier(), resume=barrier();
  beforeTransaction=async()=>{entered.release();await resume.promise;};
  const stale=service.applyManualMarkdownEdit('owner',String(ids.packageId),{target,skillId:'one',content:target==='skill'?md('changed'):'# Changed',expectedPackageVersionId:String(ids.packageVersionId)} as Parameters<typeof service.applyManualMarkdownEdit>[2]);
  const outcome=stale.then(()=>null,e=>e);
  await entered.promise;
  const writer=await db.pool.connect();
  let next;
  try {
    await writer.query('begin');
    expect((await writer.query('select pg_backend_pid() as pid')).rows[0].pid).not.toBe(readerPid);
    const updated=snapshot();updated.skills[1].skillMd=md('writer-wins');
    next=await service.createPackageVersionWithSnapshotTx(writer,{userId:'owner',packageId:ids.packageId,expectedPackageVersionId:ids.packageVersionId,snapshot:updated,source:'manual'});
    await writer.query('commit');
  } finally {writer.release();resume.release();}
  expect(await outcome).toMatchObject({message:'PACKAGE_VERSION_CONFLICT'});
  const head=await db.pool.query('select current_version_id from agent_packages where id=$1',[ids.packageId]);
  expect(String(head.rows[0].current_version_id)).toBe(String(next.packageVersionId));
  expect((await db.pool.query('select count(*)::int as n from agent_package_versions where package_id=$1',[ids.packageId])).rows[0].n).toBe(2);
  expect((await service.getPackage('owner',ids.packageId)).snapshot.skills[1].skillMd).toContain('writer-wins');
});
it.runIf(enabled)('rejects missing preconditions and a different owner without writing',async()=>{
  const client=await db.pool.connect();let ids;
  try{await client.query('begin');ids=await service.createPackageWithSnapshotTx(client,'owner',snapshot(),'manual');await client.query('commit');}finally{client.release();}
  await expect(service.applyManualMarkdownEdit('owner',String(ids.packageId),{target:'agent',content:'# Changed'} as Parameters<typeof service.applyManualMarkdownEdit>[2])).rejects.toMatchObject({status:422});
  await expect(service.applyManualMarkdownEdit('other',String(ids.packageId),{target:'agent',content:'# Changed',expectedPackageVersionId:String(ids.packageVersionId)} as Parameters<typeof service.applyManualMarkdownEdit>[2])).rejects.toThrow();
  expect((await db.pool.query('select count(*)::int as n from agent_package_versions where package_id=$1',[ids.packageId])).rows[0].n).toBe(1);
});
it.runIf(enabled).each(['agent','rubric','skill'] as const)('saves a matching %s edit as exactly one new version',async target=>{
 const client=await db.pool.connect();let ids;
 try{await client.query('begin');ids=await service.createPackageWithSnapshotTx(client,'owner',snapshot(),'manual');await client.query('commit');}finally{client.release();}
 const result=await service.applyManualMarkdownEdit('owner',String(ids.packageId),{target,skillId:'one',content:target==='skill'?md('edited'):'# Edited',expectedPackageVersionId:String(ids.packageVersionId)});
 expect(result.versionNumber).toBe(2);
 expect((await db.pool.query('select count(*)::int as n from agent_package_versions where package_id=$1',[ids.packageId])).rows[0].n).toBe(2);
 expect(result.snapshot.skills[1].skillMd).toBe(md('two'));
});
