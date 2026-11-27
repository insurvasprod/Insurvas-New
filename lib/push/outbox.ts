import "server-only";

import { after } from "next/server";

import { isPendingSchema } from "@/lib/carriers/schemaGap";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { deliveryByKind } from "@/lib/notifications/preferences";
import { pushToUsers } from "./send";

/**
 * Push for the bell (2026-11-24). Bell rows (agent_notifications) are written from more than twenty
 * places, sixteen of them SQL jobs, so push follows the email outbox's pattern: it reads the table, not
 * the writers. Each row is claimed once (push_handled_at), and sent only when the recipient's own
 * choice for that event allows push right now (Settings › Notifications, quiet hours; protected events
 * always go) — the same answer the web bell uses for its browser notification.
 *
 * Runs from the notifications cron, and straight after the app's own alert writers (notifyTenantAgents,
 * notifyAgentUser) so a transfer rings the phone in seconds, not at the next cron run.
 * A row older than ten minutes is closed without a push: a stale buzz is noise, the Inbox still has it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- push_handled_at is not in database.types.ts yet
const db = () => getSupabaseServiceClient() as any;
const FRESH_MS = 10 * 60_000;

type Row = { id: string; tenant_id: string; recipient_user_id: string; kind: string; title: string; body: string | null; link: string | null };

export async function processPushOutbox(now = new Date(), tenantId?: string): Promise<{ pushed: number; off: number; stale: number; available: boolean }> {
  const out = { pushed: 0, off: 0, stale: 0, available: true };
  const at = now.toISOString();
  const since = new Date(now.getTime() - FRESH_MS).toISOString();
  const scoped = <Q extends { eq(column: string, value: string): Q }>(q: Q): Q => (tenantId ? q.eq("tenant_id", tenantId) : q);

  const stale = await scoped(db().from("agent_notifications").update({ push_handled_at: at }).is("push_handled_at", null).lt("created_at", since)).select("id");
  if (stale.error) {
    if (isPendingSchema(stale.error)) return { ...out, available: false };
    throw new Error(stale.error.message);
  }
  out.stale = (stale.data ?? []).length;

  // Claim the fresh rows in one statement: only one run ever gets a given row.
  const claimed = await scoped(db().from("agent_notifications").update({ push_handled_at: at }).is("push_handled_at", null).gte("created_at", since))
    .select("id, tenant_id, recipient_user_id, kind, title, body, link").limit(500);
  if (claimed.error) throw new Error(claimed.error.message);

  for (const row of (claimed.data ?? []) as Row[]) {
    const choice = (await deliveryByKind(row.recipient_user_id, row.tenant_id, now).catch(() => null))?.get(row.kind);
    if (choice && (!choice.in_app || !choice.push)) { out.off += 1; continue; }
    await pushToUsers(row.tenant_id, [row.recipient_user_id], { title: row.title, body: row.body, href: row.link, category: row.kind, notificationId: row.id });
    out.pushed += 1;
  }
  return out;
}

/** After a bell write in a request: push it once the response has gone, never delaying the caller. */
export function pushSoon(tenantId: string): void {
  const run = () => processPushOutbox(new Date(), tenantId).then(() => undefined, (e) => console.error("[push] outbox", e instanceof Error ? e.message : e));
  try {
    after(run);
  } catch {
    void run();
  }
}
