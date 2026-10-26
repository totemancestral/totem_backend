// Read-only remote audit. Never print connection strings or customer records.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
process.loadEnvFile(path.resolve(__dirname, '../.env'));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ log: [] });
const migrationDir = path.resolve(__dirname, '../prisma/migrations');
(async () => {
 try {
  const result = await db.$transaction(async tx => {
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '10000ms'");
   const [schema] = await tx.$queryRawUnsafe(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS history,
     to_regclass('public."TotemIdentity"') IS NOT NULL AS identity`);
   const history = schema.history ? await tx.$queryRawUnsafe(`SELECT migration_name, checksum, finished_at IS NOT NULL AS finished,
     rolled_back_at IS NOT NULL AS rolled_back FROM public._prisma_migrations ORDER BY started_at`) : [];
   const local = fs.readdirSync(migrationDir, { withFileTypes:true }).filter(entry=>entry.isDirectory()).map(entry=>({
    name:entry.name, checksum:crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir,entry.name,'migration.sql'))).digest('hex'),
    lfChecksum:crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir,entry.name,'migration.sql'),'utf8').replace(/\r\n/g,'\n')).digest('hex'),
   }));
   const duplicates = await tx.$queryRawUnsafe(`SELECT
     (SELECT count(*)::int FROM (SELECT "userId" FROM public."TotemOrder" WHERE "queuedAt" IS NOT NULL OR status::text IN ('processing','done') GROUP BY "userId" HAVING count(*)>1) x) AS generation_accounts,
     (SELECT count(*)::int FROM (SELECT "userId" FROM public."JuniorTotem" GROUP BY "userId" HAVING count(*)>1) x) AS junior_accounts,
     (SELECT count(DISTINCT j."userId")::int FROM public."JuniorTotem" j JOIN public."TotemOrder" o ON o."userId"=j."userId" WHERE o.offer::text<>'junior' AND (o."queuedAt" IS NOT NULL OR o.status::text IN ('processing','done'))) AS mixed_accounts,
     (SELECT count(*)::int FROM (SELECT "userId" FROM public."TotemOrder" GROUP BY "userId" HAVING count(*)>1) x) AS accounts_with_multiple_orders`);
   const orders = await tx.$queryRawUnsafe(`SELECT status::text AS status, offer::text AS offer, count(*)::int AS total FROM public."TotemOrder" GROUP BY status,offer ORDER BY status,offer`);
   const histories = await tx.$queryRawUnsafe(`WITH accounts AS (
     SELECT "userId" FROM public."TotemOrder" WHERE "queuedAt" IS NOT NULL OR status::text IN ('processing','done') GROUP BY "userId" HAVING count(*)>1
     UNION SELECT "userId" FROM public."JuniorTotem" GROUP BY "userId" HAVING count(*)>1
   ), numbered AS (SELECT "userId", row_number() OVER (ORDER BY "userId") AS account FROM accounts)
   SELECT n.account::int AS account,o.status::text AS status,o.offer::text AS offer,count(*)::int AS total
     FROM numbered n JOIN public."TotemOrder" o USING ("userId") GROUP BY n.account,o.status,o.offer ORDER BY n.account,o.status,o.offer`);
   return { schema, duplicates:duplicates[0], orders,
    histories,
    migrations:local.map(item=>({name:item.name, applied:history.some(row=>row.migration_name===item.name&&row.finished&&!row.rolled_back),
     checksumMatches:history.filter(row=>row.migration_name===item.name&&row.finished&&!row.rolled_back).every(row=>row.checksum===item.checksum),
     matchesAfterLfNormalization:history.filter(row=>row.migration_name===item.name&&row.finished&&!row.rolled_back).every(row=>row.checksum===item.lfChecksum)})),
    failedMigrations:history.filter(row=>!row.finished&&!row.rolled_back).map(row=>row.migration_name),
    unknownAppliedMigrations:history.filter(row=>row.finished&&!row.rolled_back&&!local.some(item=>item.name===row.migration_name)).map(row=>row.migration_name),
   };
  }, { maxWait:5000,timeout:30000 });
  console.log(JSON.stringify({ok:true,readOnly:true,...result},null,2));
 } catch(error) {
  const message = typeof error.message === 'string' ? error.message : '';
  const category = /reach database|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(message) ? 'database_unreachable'
   : /authentication|password|credentials/i.test(message) ? 'database_authentication'
   : /engine|binary|query_engine|libquery/i.test(message) ? 'local_prisma_engine'
   : 'connection_or_query_failed';
  console.error(JSON.stringify({ok:false,code:typeof error.code==='string'?error.code:typeof error.errorCode==='string'?error.errorCode:category,
   errorType:error?.constructor?.name,sqlState:typeof error.meta?.code==='string'?error.meta.code:undefined}));
  process.exitCode=1;
 } finally { await db.$disconnect(); }
})();
