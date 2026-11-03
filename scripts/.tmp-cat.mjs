import pg from "pg";
const c = new pg.Client({ connectionString: process.env.TENANT_DB_URL });
await c.connect();
const q = process.argv[2];
const r = await c.query(q);
console.log(JSON.stringify(r.rows, null, 0).replace(/\},\{/g, "},\n{"));
await c.end();
