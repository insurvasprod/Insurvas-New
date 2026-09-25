import { createClient } from "@supabase/supabase-js";
import pg from "pg";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const T = "d6f3950f-0d88-4e66-869f-0de2ea6b396b";
const pgc = new pg.Client({ connectionString: process.env.TENANT_DB_URL });
await pgc.connect();
const sql = async (q, p) => (await pgc.query(q, p)).rows;
const show = (x) => console.log(typeof x === "string" ? x : JSON.stringify(x, null, 0));
const code = (await import("node:fs")).readFileSync(process.argv[2], "utf8");
const fn = new (Object.getPrototypeOf(async function () {}).constructor)("db", "T", "sql", "show", code);
try { await fn(db, T, sql, show); } finally { await pgc.end(); }
