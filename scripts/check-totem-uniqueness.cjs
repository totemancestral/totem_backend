// Runs the real migration against disposable PostgreSQL instances; never loads .env.
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const migration = readFileSync(join(__dirname, '../prisma/migrations/20261025000000_one_totem_per_account/migration.sql'), 'utf8');
const base = `CREATE TABLE public."TotemOrder" (id text PRIMARY KEY, "userId" text NOT NULL,
 status text NOT NULL DEFAULT 'pending', offer text NOT NULL DEFAULT 'ancestral', "queuedAt" timestamp,
 "createdAt" timestamp NOT NULL DEFAULT now(), note text);
 CREATE TABLE public."JuniorTotem" (id text PRIMARY KEY, "userId" text NOT NULL, "shareCount" integer NOT NULL DEFAULT 0);
 CREATE TABLE public.oeuvres (user_id text, statut text);`;
async function database(seed='') { const db=new PGlite();await db.exec(base+seed);return db; }
(async()=>{
 const db=await database();
 let assertions=0;
 try {
  await db.exec(migration);
  const query=sql=>db.query(sql);
  await db.exec(`INSERT INTO "TotemOrder" (id,"userId") VALUES ('one','u1'),('two','u1'),('three','u2');`);
  await query(`UPDATE "TotemOrder" SET "queuedAt"=now() WHERE id='one'`);
  await assert.rejects(query(`UPDATE "TotemOrder" SET "queuedAt"=now() WHERE id='two'`),/totem_already_exists/);assertions++;
  await db.exec(`UPDATE "TotemOrder" SET status='error' WHERE id='one'; UPDATE "TotemOrder" SET status='processing' WHERE id='one'; UPDATE "TotemOrder" SET status='done' WHERE id='one';`);
  assert.equal((await query(`SELECT count(*)::int AS n FROM "TotemIdentity" WHERE "userId"='u1'`)).rows[0].n,1);assertions++;
  await assert.rejects(query(`INSERT INTO "TotemOrder" (id,"userId") VALUES ('new-checkout','u1')`),/totem_already_exists/);assertions++;
  await query(`UPDATE "TotemOrder" SET status='done' WHERE id='three'`);
  assert.equal((await query(`SELECT count(*)::int AS n FROM "TotemIdentity"`)).rows[0].n,2);assertions++;
  await assert.rejects(query(`INSERT INTO "TotemOrder" (id,"userId",offer,status) VALUES ('junior','u1','junior','processing')`),/totem_already_exists/);assertions++;
  await assert.rejects(query(`UPDATE "TotemOrder" SET "userId"='u3' WHERE id='one'`),/totem_owner_immutable/);assertions++;
  await db.exec(`INSERT INTO "JuniorTotem" (id,"userId") VALUES ('j1','u4');`);
  await assert.rejects(query(`INSERT INTO "JuniorTotem" (id,"userId") VALUES ('j2','u4')`),/duplicate key|totem_already_exists/);assertions++;
  await assert.rejects(query(`INSERT INTO "JuniorTotem" (id,"userId") VALUES ('j-adult','u1')`),/totem_already_exists/);assertions++;
  await assert.rejects(query(`INSERT INTO "TotemOrder" (id,"userId",status) VALUES ('adult-junior','u4','processing')`),/totem_already_exists/);assertions++;
  const rls=await query(`SELECT relrowsecurity FROM pg_class WHERE oid='public."TotemIdentity"'::regclass`);
  assert.equal(rls.rows[0].relrowsecurity,true);assertions++;
  const races=await Promise.allSettled([
   query(`INSERT INTO "TotemOrder" (id,"userId",status) VALUES ('race-a','race','processing')`),
   query(`INSERT INTO "TotemOrder" (id,"userId",status) VALUES ('race-b','race','processing')`),
  ]);
  assert.equal(races.filter(x=>x.status==='fulfilled').length,1);assertions++;
 }finally{await db.close();}
 for(const seed of [
  `INSERT INTO "TotemOrder" (id,"userId",status) VALUES ('old','historical','done');`,
  `INSERT INTO "JuniorTotem" (id,"userId") VALUES ('old-junior','historical');`,
  `INSERT INTO oeuvres VALUES ('historical','livree');`,
 ]){
  const legacy=await database(seed);
  try{await legacy.exec(migration);await assert.rejects(legacy.query(`INSERT INTO "TotemOrder" (id,"userId",status) VALUES ('new','historical','processing')`),/totem_already_exists/);assertions++;}
  finally{await legacy.close();}
 }
 const duplicate=await database(`INSERT INTO "TotemOrder" (id,"userId",status) VALUES ('old1','u','done'),('old2','u','done');`);
 try{
  const before=await duplicate.query(`SELECT to_jsonb(o) AS item FROM "TotemOrder" o ORDER BY id`);
  await duplicate.exec(migration);
  const after=await duplicate.query(`SELECT to_jsonb(o)-'checkoutExpiredAt' AS item FROM "TotemOrder" o ORDER BY id`);
  assert.deepEqual(after.rows,before.rows);assertions++;
  assert.equal((await duplicate.query(`SELECT count(*)::int AS n FROM "TotemOrder"`)).rows[0].n,2);assertions++;
  assert.equal((await duplicate.query(`SELECT count(*)::int AS n FROM "TotemIdentity"`)).rows[0].n,1);assertions++;
  await duplicate.exec(`UPDATE "TotemOrder" SET note='link renewed' WHERE id IN ('old1','old2')`);assertions++;
  await assert.rejects(duplicate.query(`UPDATE "TotemOrder" SET status='processing' WHERE id='old2'`),/totem_already_exists/);assertions++;
  await assert.rejects(duplicate.query(`INSERT INTO "TotemOrder" (id,"userId",status) VALUES ('new','u','processing')`),/totem_already_exists/);assertions++;
 }finally{await duplicate.close();}
 const oldJuniors=await database(`INSERT INTO "JuniorTotem" (id,"userId") VALUES ('legacy-a','junior-u'),('legacy-b','junior-u');`);
 try{
  const before=await oldJuniors.query(`SELECT * FROM "JuniorTotem" ORDER BY id`);
  await oldJuniors.exec(migration);
  assert.deepEqual((await oldJuniors.query(`SELECT * FROM "JuniorTotem" ORDER BY id`)).rows,before.rows);assertions++;
  await oldJuniors.exec(`UPDATE "JuniorTotem" SET "shareCount"="shareCount"+1 WHERE "userId"='junior-u'`);assertions++;
  await assert.rejects(oldJuniors.query(`INSERT INTO "JuniorTotem" (id,"userId") VALUES ('legacy-c','junior-u')`),/totem_already_exists/);assertions++;
  await assert.rejects(oldJuniors.query(`INSERT INTO "TotemOrder" (id,"userId",status) VALUES ('new-adult','junior-u','processing')`),/totem_already_exists/);assertions++;
 }finally{await oldJuniors.close();}
 const firstJunior=await database();
 try{
  await firstJunior.exec(migration);
  await firstJunior.exec(`INSERT INTO "TotemOrder" (id,"userId",offer,status) VALUES ('junior-order','new-junior','junior','done')`);
  const race=await Promise.allSettled([
   firstJunior.query(`INSERT INTO "JuniorTotem" (id,"userId") VALUES ('a','new-junior')`),
   firstJunior.query(`INSERT INTO "JuniorTotem" (id,"userId") VALUES ('b','new-junior')`),
  ]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assertions++;
 }finally{await firstJunior.close();}
 console.log(`${assertions} PostgreSQL migration and uniqueness checks passed; no external database contacted.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
