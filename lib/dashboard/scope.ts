import type { ProducerScope } from "../agency/visibilityCore.ts";

/**
 * AG-0.5 · the dashboard's two scope shapes. The scope itself always comes from the session
 * (`scopeFor(context)` on the page), never from a request; null means no filter — an individual-plan
 * tenant or an all-seeing role (owner/admin, bookkeeper, retention) — and every read is then exactly
 * what it was before.
 */

/**
 * The scope plus the reader: for rows the reader may hold himself even when he is not one of "his"
 * producers — an assistant's scope is the producers he assists, yet a callback assigned to him, or a
 * transfer he claimed, is his own. The same union the Agent Floor uses for callbacks.
 */
export function scopeWithSelf(scope: ProducerScope, userId: string): ProducerScope {
  return scope === null ? null : [...new Set([...scope, userId])];
}

/**
 * The PostgREST `or` filter for the inbound transfers a scoped session may count: the live ones still
 * waiting (nobody's row yet — every member who may claim sees them, AG-0.10) and the ones held by a
 * producer in its scope (lib/transferInbox/scopeCore `workItemVisible`). Ids are user uuids from the
 * session's own scope, never request text.
 */
export function waitingTransferOr(visible: readonly string[]): string {
  const ids = visible.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  return ids.length ? `owner_user_id.is.null,owner_user_id.in.(${ids.join(",")})` : "owner_user_id.is.null";
}
