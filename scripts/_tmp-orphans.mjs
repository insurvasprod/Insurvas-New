const base = process.env.WHOP_API_BASE_URL;
const headers = { authorization: `Bearer ${process.env.WHOP_API_KEY}`, accept: "application/json" };
const biz = process.env.WHOP_ACCOUNT_ID;
const res = await fetch(`${base}/memberships?company_id=${biz}&first=1`, { headers });
const one = ((await res.json()).data ?? [])[0];
console.log("TOP-LEVEL KEYS:", Object.keys(one).join(", "));
console.log("\nid:", one.id, "\nstatus:", one.status);
console.log("plan:", JSON.stringify(one.plan ?? one.plan_id ?? null).slice(0, 200));
console.log("metadata:", JSON.stringify(one.metadata));
console.log("\n--- filtered by plan works? ---");
for (const p of ["plan_n1KydLQBN0hEU", "plan_fCpKbKKfCqYZT", "plan_BeoAsT2oboRCi", "plan_7zAw4UrBlVOTw"]) {
  const r = await fetch(`${base}/memberships?company_id=${biz}&plan_id=${p}&first=50`, { headers });
  const rows = r.ok ? ((await r.json()).data ?? []) : [];
  console.log(`  ${p}  HTTP ${r.status}  memberships=${rows.length}  [${rows.map(m => m.status).join(", ")}]`);
}
