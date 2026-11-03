// Runs the unclaimed-SLA job once against a running app: advances the ladder and delivers every
// pending side effect (escalation email, agent alerts, partner card, nurture on expiry). The ladder
// itself also runs every minute in the database (20260924250100); this is what sends what it found.
//
// Either secret works: UNCLAIMED_SLA_SECRET for /api/internal/unclaimed-sla, or CRON_SECRET for
// /api/cron/unclaimed-sla. Both routes call the same runUnclaimedSlaJob.
const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
const internalSecret = process.env.UNCLAIMED_SLA_SECRET;
const cronSecret = process.env.CRON_SECRET;
if (!internalSecret && !cronSecret) throw new Error("UNCLAIMED_SLA_SECRET or CRON_SECRET is required");
const response = internalSecret
  ? await fetch(`${baseUrl}/api/internal/unclaimed-sla`, { method: "POST", headers: { authorization: `Bearer ${internalSecret}` } })
  : await fetch(`${baseUrl}/api/cron/unclaimed-sla`, { method: "GET", headers: { authorization: `Bearer ${cronSecret}` } });
const body = await response.text();
if (!response.ok) throw new Error(`Unclaimed SLA endpoint failed (${response.status}): ${body}`);
console.log(body);
