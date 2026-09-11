/**
 * Read-only inventory of the configured Supabase project, for the SA QA recheck.
 *
 * Run with: npm run qa:inventory        (writes JSON to the path given by --out, or stdout)
 *
 * Reads only catalog views through TENANT_DB_URL, whose role is deliberately NOBYPASSRLS with no
 * DDL rights. It creates nothing, changes nothing, and prints no secret: the project reference,
 * connection string and keys never appear in the output.
 */
import { Client } from "pg";
import { writeFileSync } from "node:fs";
import process from "node:process";

const outArg = process.argv.indexOf("--out");
const outPath = outArg > -1 ? process.argv[outArg + 1] : null;

const client = new Client({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const one = async (sql, params = []) => (await client.query(sql, params)).rows;

const inventory = {};

inventory.tables = await one(`
  select c.relname as name,
         c.relrowsecurity as rls_enabled,
         c.relforcerowsecurity as rls_forced,
         (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count,
         (select count(*) from pg_index i where i.indrelid = c.oid) as index_count,
         (select count(*) from information_schema.columns col
           where col.table_schema = 'public' and col.table_name = c.relname) as column_count
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by c.relname`);

inventory.views = await one(`
  select c.relname as name, c.relkind as kind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v','m')
   order by c.relname`);

// RLS-enabled but with no policy at all: reachable by nobody, or by everybody if a grant exists.
inventory.rls_enabled_without_policy = await one(`
  select c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
   order by c.relname`);

inventory.rls_disabled_tables = await one(`
  select c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
   order by c.relname`);

// Security-definer functions a client role can call directly.
inventory.client_executable_security_definer = await one(`
  select p.proname as name,
         array_agg(distinct a.grantee order by a.grantee) as grantees,
         p.proconfig is null or not exists (
           select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'
         ) as mutable_search_path
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join information_schema.routine_privileges a
      on a.routine_schema = n.nspname and a.routine_name = p.proname
   where n.nspname = 'public' and p.prosecdef
     and a.grantee in ('anon','authenticated','PUBLIC')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
   group by p.proname, p.proconfig
   order by p.proname`);

inventory.mutable_search_path_functions = await one(`
  select p.proname as name
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
   order by p.proname`);

inventory.extensions_in_public = await one(`
  select e.extname as name
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where n.nspname = 'public'
   order by e.extname`);

inventory.table_grants_to_client_roles = await one(`
  select table_name, grantee, string_agg(distinct privilege_type, ',' order by privilege_type) as privileges
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon','authenticated')
   group by table_name, grantee
   order by table_name, grantee`);

inventory.functions = (await one(`
  select p.proname as name
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
   order by p.proname`)).map((r) => r.name);

inventory.triggers = await one(`
  select c.relname as table_name, t.tgname as trigger_name, p.proname as function_name, n2.nspname as function_schema
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n2 on n2.oid = p.pronamespace
   where not t.tgisinternal and n.nspname in ('public','auth')
   order by n.nspname, c.relname, t.tgname`);

inventory.foreign_keys_count = (await one(`
  select count(*)::int as n from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
   where n.nspname = 'public' and c.contype = 'f'`))[0].n;

inventory.summary = {
  tables: inventory.tables.length,
  views: inventory.views.length,
  functions: inventory.functions.length,
  rls_enabled_without_policy: inventory.rls_enabled_without_policy.length,
  rls_disabled_tables: inventory.rls_disabled_tables.length,
  client_executable_security_definer: inventory.client_executable_security_definer.length,
  mutable_search_path_functions: inventory.mutable_search_path_functions.length,
  extensions_in_public: inventory.extensions_in_public.length,
  collected_at: new Date().toISOString(),
};

await client.end();

const json = JSON.stringify(inventory, null, 2);
if (outPath) {
  writeFileSync(outPath, json);
  console.log(`Wrote ${outPath}`);
  console.log(JSON.stringify(inventory.summary, null, 2));
} else {
  console.log(json);
}
