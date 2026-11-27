import "server-only";

import { livePushDevices, retireUnregisteredTokens } from "./devices";
import { chunk, toExpoMessage, unregisteredFromTickets, type PushInput } from "./rules";

/**
 * Send one bell alert to the phones of these people (2026-11-24), through Expo's push service, which
 * hands it to APNs (iPhone) and FCM (Android). Best effort, never throws: the bell row is the record,
 * push is only the tap on the shoulder. Set EXPO_ACCESS_TOKEN when the Expo project turns on enhanced
 * push security; PUSH_DISABLED=1 turns sending off everywhere.
 */
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export async function pushToUsers(tenantId: string, userIds: string[], input: PushInput): Promise<void> {
  if (process.env.PUSH_DISABLED === "1") return;
  try {
    const devices = await livePushDevices(tenantId, [...new Set(userIds)]);
    if (!devices.length) return;
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (process.env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    for (const batch of chunk(devices)) {
      const tokens = batch.map((d) => d.token);
      const res = await fetch(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(batch.map((d) => toExpoMessage(d.token, input))), signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        console.error("[push] expo answered", res.status);
        continue;
      }
      const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
      await retireUnregisteredTokens(unregisteredFromTickets(tokens, json?.data));
    }
  } catch (error) {
    console.error("[push] send", error instanceof Error ? error.message : error);
  }
}
