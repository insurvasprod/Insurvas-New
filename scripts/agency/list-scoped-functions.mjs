// AG-0.5 · regenerates lib/agency/scopedData.mjs's SCOPED_FUNCTIONS from the live catalog: every public SQL
// function whose body names a producer-scoped table. Read-only (one rolled-back read transaction).
//   node --env-file=.env.local scripts/agency/list-scoped-functions.mjs > /tmp/fns.txt
import pg from "pg";
import { SCOPED_TABLES } from "../../lib/agency/scopedData.mjs";

const client = new pg.Client({ connectionString: process.env.TENANT_DB_URL });
await client.connect();
await client.query("begin read only");
try {
  const { rows } = await client.query(
    `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      where p.prokind = 'f' and pg_get_functiondef(p.oid) ~* $1 order by 1`,
    [`\\m(${SCOPED_TABLES.join("|")})\\M`],
  );
  for (const row of rows) console.log(`  ${JSON.stringify(row.proname)},`);
} finally {
  await client.query("rollback");
  await client.end();
}
