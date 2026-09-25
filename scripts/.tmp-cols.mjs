import pg from "pg";
const c = new pg.Client({ connectionString: process.env.TENANT_DB_URL });
await c.connect();
const tables = process.argv.slice(2);
for (const t of tables) {
  const r = await c.query(`select a.attname, format_type(a.atttypid,a.atttypmod) typ, a.attnotnull nn, pg_get_expr(d.adbin,d.adrelid) def
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=('public.'||$1)::regclass and a.attnum>0 and not a.attisdropped order by a.attnum`, [t]);
  const k = await c.query(`select conname, contype, pg_get_constraintdef(oid) def from pg_constraint where conrelid=('public.'||$1)::regclass and contype in ('c','u','p','f','x')`, [t]);
  const tr = await c.query(`select tgname, pg_get_triggerdef(oid) d from pg_trigger where tgrelid=('public.'||$1)::regclass and not tgisinternal`, [t]);
  const ix = await c.query(`select indexdef from pg_indexes where schemaname='public' and tablename=$1 and indexdef ilike '%unique%'`, [t]);
  console.log(`\n=== ${t}`);
  for (const x of r.rows) console.log(`  ${x.attname} ${x.typ}${x.nn ? " NN" : ""}${x.def ? " = " + x.def : ""}`);
  for (const x of k.rows) if (x.contype !== "p") console.log(`  [${x.contype}] ${x.conname}: ${x.def}`);
  for (const x of ix.rows) console.log(`  [ux] ${x.indexdef.replace(/CREATE UNIQUE INDEX /, "")}`);
  for (const x of tr.rows) console.log(`  [trg] ${x.d.replace(/CREATE TRIGGER /, "")}`);
}
await c.end();
