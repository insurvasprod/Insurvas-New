import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const T = "d6f3950f-0d88-4e66-869f-0de2ea6b396b";
// usage: node .tmp-q.mjs table "select" limit [filterjson]
const [table, sel = "*", limit = "5", extra] = process.argv.slice(2);
let q = db.from(table).select(sel, { count: "exact" }).eq("tenant_id", T).limit(Number(limit));
if (extra) for (const [k, v] of Object.entries(JSON.parse(extra))) q = q.eq(k, v);
const r = await q;
if (r.error) console.log("ERR", r.error.message);
console.log("count", r.count);
for (const row of r.data ?? []) console.log(JSON.stringify(row));
