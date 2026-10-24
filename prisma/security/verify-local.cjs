// Usage: node verify-local.cjs <absolute path to @electric-sql/pglite>
// In-memory database only. Does not load environment files or connect remotely.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.argv[2]);
const sql = fs.readFileSync(path.join(__dirname,'20261023_public_permissions.sql'),'utf8');
const followup = fs.readFileSync(path.join(__dirname,'20261023_defaults_and_role_lookup.sql'),'utf8');
const tables = ['ConsultationReading','JuniorTotem','TotemOrder','TotemPipelineError','UserProfile','_prisma_migrations','admin_audit_log','commandes','erreurs_pipeline','oeuvre_versions','oeuvres','profiles','reponses_parcours','user_roles'];
const extended = ['commandes','oeuvres','oeuvre_versions','reponses_parcours'];
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let checks = 0;
async function fixture(db) {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE supabase_admin;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    CREATE TYPE public.app_role AS ENUM ('admin','user');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;`);
  for (const table of tables) {
    await db.exec(`CREATE TABLE public."${table}" (id uuid PRIMARY KEY, user_id uuid, role public.app_role, value text);
      ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY;
      GRANT ALL ON public."${table}" TO anon,authenticated,service_role;
      GRANT UPDATE(value) ON public."${table}" TO authenticated;
      INSERT INTO public."${table}" VALUES ('${uid(1)}','${uid(1)}','admin','one'),('${uid(2)}','${uid(2)}','user','two'),('${uid(3)}','${uid(3)}','user','three');`);
  }
  await db.exec(`CREATE FUNCTION public.has_role(_user_id uuid,_role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role) $$;
    CREATE POLICY "Users see own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid()=user_id);
    CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid()=id);
    CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid()=id);
    CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid()=id) WITH CHECK (auth.uid()=id);
    CREATE POLICY "Users manage own parcours" ON public.reponses_parcours FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);`);
  for (const [table, policy] of [['commandes','Admins see all commandes'],['oeuvres','Admins see all oeuvres'],['oeuvre_versions','Admins see all oeuvre versions'],['reponses_parcours','Admins read all parcours'],['user_roles','Admins see all roles']]) {
    await db.exec(`CREATE POLICY "${policy}" ON public."${table}" FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));`);
  }
  for (const table of extended.filter(t=>t!=='reponses_parcours')) {
    await db.exec(`CREATE POLICY "owner" ON public."${table}" FOR SELECT TO authenticated USING (auth.uid()=user_id);`);
  }
}
async function identity(db, role, user, aal) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,aal})]);
  await db.exec(`SET ROLE ${role}`);
}
(async()=>{
  const db = new PGlite();
  try {
    await fixture(db);
    await identity(db,'authenticated',uid(1),'aal1');
    assert.equal((await db.query('SELECT * FROM public.commandes')).rows.length,3); checks++;
    await db.exec('RESET ROLE');
    await db.exec(sql);
    for (const [user,aal,expected] of [[uid(1),'aal1',1],[uid(1),'aal2',3],[uid(2),'aal1',1],[uid(2),'aal2',1]]) {
      await identity(db,'authenticated',user,aal);
      for (const table of [...extended,'user_roles']) {
        assert.equal((await db.query(`SELECT * FROM public."${table}"`)).rows.length,expected,`${table}: ${user}/${aal}`); checks++;
      }
    }
    await identity(db,'authenticated',uid(1),'aal1');
    for (const command of ["UPDATE public.profiles SET value='changed'", "INSERT INTO public.reponses_parcours(id,user_id) VALUES ('00000000-0000-4000-8000-000000000004',auth.uid())",'DELETE FROM public.reponses_parcours','TRUNCATE public.commandes','SELECT * FROM public."TotemOrder"']) {
      await assert.rejects(db.exec(command),e=>e.code==='42501'); checks++;
    }
    await db.exec('RESET ROLE');
    for (const table of tables) {
      const result=await db.query(`SELECT has_table_privilege('anon',$1,'SELECT') AS anon_read,has_table_privilege('authenticated',$1,'TRUNCATE') AS truncate,has_column_privilege('authenticated',$1,'value','UPDATE') AS update_column,has_table_privilege('service_role',$1,'UPDATE') AS server_write`,[`public."${table}"`]);
      assert.deepEqual(result.rows[0],{anon_read:false,truncate:false,update_column:false,server_write:true}); checks++;
    }
    await identity(db,'service_role',uid(1),'aal1');
    await db.exec("UPDATE public.profiles SET value='server'; INSERT INTO public.reponses_parcours(id,user_id) VALUES ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002')"); checks++;
    await db.exec('RESET ROLE');
    await db.exec(sql); checks++; // repeatable, no data removal
    await db.exec(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;
      GRANT CREATE ON SCHEMA public TO supabase_admin;`);
    await db.exec(followup);
    await db.exec(followup); checks++;
    for (const [user,aal,expected] of [[uid(1),'aal1',1],[uid(1),'aal2',3],[uid(2),'aal1',1],[uid(2),'aal2',1]]) {
      await identity(db,'authenticated',user,aal);
      assert.equal((await db.query('SELECT * FROM public.commandes')).rows.length,expected); checks++;
      assert.equal((await db.query("SELECT public.has_role($1,'admin') AS allowed",[uid(1)])).rows[0].allowed,user===uid(1)); checks++;
    }
    await identity(db,'anon',uid(2),'aal1');
    await assert.rejects(db.query("SELECT public.has_role($1,'admin')",[uid(1)]),e=>e.code==='42501'); checks++;
    await db.exec('RESET ROLE');
    for (const creator of ['postgres','supabase_admin']) {
      await db.exec(`SET ROLE ${creator}; CREATE TABLE public.probe_${creator}(id integer); CREATE SEQUENCE public.probe_seq_${creator}; RESET ROLE`);
      for (const role of ['anon','authenticated','service_role']) {
        const result=await db.query("SELECT has_table_privilege($1,$2,'SELECT') AS table_read,has_sequence_privilege($1,$3,'USAGE') AS sequence_use",[role,`public.probe_${creator}`,`public.probe_seq_${creator}`]);
        const allowed = creator==='supabase_admin' || role==='service_role';
        assert.deepEqual(result.rows[0],{table_read:allowed,sequence_use:allowed}); checks++;
      }
    }
    await db.exec('DROP POLICY "Admins see all commandes" ON public.commandes; GRANT SELECT ON public."TotemOrder" TO anon');
    await assert.rejects(db.exec(sql));
    await db.exec('ROLLBACK');
    assert.equal((await db.query("SELECT has_table_privilege('anon','public.\"TotemOrder\"','SELECT') AS allowed")).rows[0].allowed,true); checks++;
    console.log(JSON.stringify({ok:true,checks,engine:'PGlite in-memory PostgreSQL',remoteConnections:0}));
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
