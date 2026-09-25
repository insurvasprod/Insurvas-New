const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
const secret = process.env.CALLBACK_REMINDER_SECRET;
if (!secret) throw new Error("CALLBACK_REMINDER_SECRET is required");
const response = await fetch(`${baseUrl}/api/internal/callback-reminders`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
const body = await response.text();
if (!response.ok) throw new Error(`Callback reminder endpoint failed (${response.status}): ${body}`);
console.log(body);
