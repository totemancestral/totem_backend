// Applies only the reviewed migration after verifying history and preserving
// fingerprints of all original order/Junior rows. No customer data is logged.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.loadEnvFile(path.join(root, '.env'));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ log: [] });
const target = '20261025000000_one_totem_per_account';
const dir = path.join(root, 'prisma/migrations');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const evidenceFile = path.resolve(root, '../audit-totem-2026-10-22/totem-uniqueness-activation-2026-10-26.json');

async function snapshot() {
 return db.$transaction(async tx => {
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout='10000ms'");
  return tx.$queryRawUnsafe(`SELECT 'orders' AS source,count(*)::int AS total,
    md5(coalesce(string_agg(md5((to_jsonb(o)-'checkoutExpiredAt')::text),'' ORDER BY id),'')) AS fingerprint
    FROM public."TotemOrder" o
    UNION ALL SELECT 'junior',count(*)::int,
    md5(coalesce(string_agg(md5(to_jsonb(j)::text),'' ORDER BY id),'')) FROM public."JuniorTotem" j ORDER BY source`);
 },{maxWait:5000,timeout:20000});
}

async function verify() {
 const [result]=await db.$queryRawUnsafe(`SELECT
  (SELECT count(*)::int FROM public."TotemIdentity") AS protected_accounts,
  (SELECT count(*)::int FROM public."TotemOrder" o WHERE o.status::text='done'
    AND NOT EXISTS (SELECT 1 FROM public."TotemIdentity" i WHERE i."userId"=o."userId")) AS uncovered_orders,
  (SELECT count(*)::int FROM public."JuniorTotem" j WHERE NOT EXISTS
    (SELECT 1 FROM public."TotemIdentity" i WHERE i."userId"=j."userId")) AS uncovered_juniors,
  (SELECT count(*)::int FROM pg_trigger WHERE tgname IN ('TotemOrder_one_per_account','JuniorTotem_one_per_account') AND tgenabled='O') AS enabled_triggers,
  (SELECT relrowsecurity FROM pg_class WHERE oid='public."TotemIdentity"'::regclass) AS rls,
  has_table_privilege('anon','public."TotemIdentity"','SELECT,INSERT,UPDATE,DELETE') AS anon_access,
  has_table_privilege('authenticated','public."TotemIdentity"','SELECT,INSERT,UPDATE,DELETE') AS authenticated_access`);
 if(result.uncovered_orders || result.uncovered_juniors || result.enabled_triggers!==2 || !result.rls || result.anon_access || result.authenticated_access) {
  throw new Error('post_migration_verification_failed');
 }
 return result;
}

(async()=>{
 let before;
 let stage='history';
 try {
  const history=await db.$queryRawUnsafe(`SELECT migration_name,checksum,finished_at IS NOT NULL AS finished,
    rolled_back_at IS NOT NULL AS rolled_back FROM public._prisma_migrations ORDER BY started_at`);
  if(history.some(row=>!row.finished&&!row.rolled_back))throw new Error('failed_migration_requires_review');
  const local=fs.readdirSync(dir,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>{
   const file=path.join(dir,entry.name,'migration.sql');
   const original=fs.readFileSync(file);
   return {name:entry.name,file,original,lf:original.toString('utf8').replace(/\r\n/g,'\n')};
  });
  for(const row of history.filter(row=>row.finished&&!row.rolled_back)){
   const item=local.find(item=>item.name===row.migration_name);
   if(!item || (hash(item.original)!==row.checksum&&hash(item.lf)!==row.checksum))throw new Error('migration_history_mismatch');
  }
  const pending=local.filter(item=>!history.some(row=>row.migration_name===item.name&&row.finished&&!row.rolled_back));
  if(pending.length===0){console.log(JSON.stringify({ok:true,alreadyApplied:true,verification:await verify()}));return;}
  if(pending.length!==1||pending[0].name!==target)throw new Error('unexpected_pending_migrations');
  stage='before_snapshot';
  before=await snapshot();
  if(!process.argv.includes('--apply')){console.log(JSON.stringify({ok:true,readOnly:true,pending:target,before}));return;}
  stage='normalize_migration_files';
  fs.writeFileSync(evidenceFile.replace(/\.json$/,'.before.json'),JSON.stringify({checkedAt:new Date().toISOString(),migration:target,before},null,2));
  // Restore only line endings proven to match the already-applied checksums.
  for(const row of history.filter(row=>row.finished&&!row.rolled_back)){
   const item=local.find(item=>item.name===row.migration_name);
   if(hash(item.original)!==row.checksum)fs.writeFileSync(item.file,item.lf,'utf8');
  }
  fs.writeFileSync(pending[0].file,pending[0].lf,'utf8');
  stage='migrate_deploy';
  const migration=spawnSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','deploy','--schema',path.join(root,'prisma/schema.prisma')],{
   cwd:root,env:process.env,encoding:'utf8',timeout:120000,windowsHide:true,
  });
  if(migration.status!==0){
   const code=((migration.stdout||'')+'\n'+(migration.stderr||'')).match(/\bP\d{4}\b/);
   throw new Error(code?`migration_failed_${code[0]}`:'migration_command_failed');
  }
  stage='after_snapshot';
  const after=await snapshot();
  const preserved=JSON.stringify(before)===JSON.stringify(after);
  stage='verify';
  const verification=await verify();
  const evidence={appliedAt:new Date().toISOString(),migration:target,checksum:hash(fs.readFileSync(pending[0].file)),
   previousRowsPreserved:preserved,before,after,verification};
  fs.writeFileSync(evidenceFile,JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({ok:true,applied:true,previousRowsPreserved:preserved,before,after,verification,evidenceFile},null,2));
  if(!preserved)process.exitCode=2;
 }catch(error){
  const safe=new Set(['failed_migration_requires_review','migration_history_mismatch','unexpected_pending_migrations',
   'post_migration_verification_failed','migration_command_failed']);
  const message=typeof error.message==='string'?error.message:'';
  const code=safe.has(message)||/^migration_failed_P\d{4}$/.test(message)?message:typeof error.code==='string'?error.code:'connection_or_query_failed';
  console.error(JSON.stringify({ok:false,code,stage,errorType:error?.constructor?.name,
   initializationCode:typeof error.errorCode==='string'?error.errorCode:undefined}));process.exitCode=1;
 }finally{await db.$disconnect();}
})();
