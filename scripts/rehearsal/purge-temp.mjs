// Finds the pooled backend still holding the rehearsal's committed temp objects and discards them.
// Each connection through the transaction pooler may land on a different backend, so it keeps trying.
import { createRequire } from "node:module";
const R = process.cwd(); // run from the repository root
const pg = createRequire(`${R}/package.json`)("pg");
let purged = 0; const seen = new Map();
for (let i = 0; i < 400; i++) {
  const c = new pg.Client({ connectionString: process.env.TENANT_DB_URL });
  await c.connect();
  try {
    const r = (await c.query("select pg_backend_pid() pid, pg_my_temp_schema()::regnamespace::text sch, (select count(*) from pg_class where relnamespace = pg_my_temp_schema()) rels, (select count(*) from pg_proc where pronamespace = pg_my_temp_schema()) fns")).rows[0];
    seen.set(r.pid, `${r.rels} rels, ${r.fns} fns`);
    if (Number(r.rels) > 0 || Number(r.fns) > 0) {
      await c.query("discard temp");
      const after = (await c.query("select (select count(*) from pg_class where relnamespace = pg_my_temp_schema()) rels, (select count(*) from pg_proc where pronamespace = pg_my_temp_schema()) fns")).rows[0];
      console.log(`backend ${r.pid}: held ${r.rels} relations, ${r.fns} functions in ${r.sch} → discarded (now ${after.rels}/${after.fns})`);
      purged++;
    }
  } finally { await c.end(); }
}
console.log(`checked ${seen.size} distinct backends over 400 connections; purged ${purged}`);
for (const [pid, s] of seen) console.log(`  ${pid}: ${s}`);
