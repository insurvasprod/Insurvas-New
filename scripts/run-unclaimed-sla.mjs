const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
const secret = process.env.UNCLAIMED_SLA_SECRET;
if (!secret) throw new Error("UNCLAIMED_SLA_SECRET is required");
const response = await fetch(`${baseUrl}/api/internal/unclaimed-sla`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
const body = await response.text();
if (!response.ok) throw new Error(`Unclaimed SLA endpoint failed (${response.status}): ${body}`);
console.log(body);
