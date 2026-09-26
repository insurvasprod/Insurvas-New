// Client-safe: no `server-only`. The words for a partner plan limit, shared by the partner routes
// (their 403 bodies) and the publishers page (its upgrade prompt), so both say the same thing.
//
// LA-1.19 (user decision): only ACTIVE partners hold a slot. A draft holds none. Activating a draft
// or resuming a paused partner takes one, and the create, resume and usage figures use that count.

export type PartnerCapKey = "max_publishers" | "max_marketing_partners" | "max_affiliates" | "max_partner_users";

const NOUNS: Record<PartnerCapKey, { one: string; many: string; kind: string }> = {
  max_publishers: { one: "active publisher", many: "active publishers", kind: "publisher" },
  max_marketing_partners: { one: "active marketing partner", many: "active marketing partners", kind: "marketing partner" },
  max_affiliates: { one: "active affiliate", many: "active affiliates", kind: "affiliate" },
  max_partner_users: { one: "active partner user", many: "active partner users", kind: "partner user" },
};

/** What the caller was trying to do when the limit stopped it. */
export type PartnerLimitAction = "add" | "activate" | "resume" | "change_type" | "invite" | "reactivate";

export function isPartnerCapKey(value: unknown): value is PartnerCapKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(NOUNS, value);
}

/** "active publishers" — the limit in words, never the raw key. */
export function partnerLimitName(key: PartnerCapKey, count = 2): string {
  return count === 1 ? NOUNS[key].one : NOUNS[key].many;
}

function nextStep(key: PartnerCapKey, action: PartnerLimitAction): string {
  const kind = NOUNS[key].kind;
  const freeOne = key === "max_partner_users" ? "deactivate another partner user" : `pause another ${kind}`;
  switch (action) {
    case "add": return `Upgrade your plan to add another ${kind}, or ${key === "max_partner_users" ? "deactivate one" : "pause an active one"} first.`;
    case "activate": return `Upgrade your plan to activate this ${kind}, or ${freeOne} first.`;
    case "resume": return `Upgrade your plan to resume this ${kind}, or ${freeOne} first.`;
    case "change_type": return `Upgrade your plan to make this partner a ${kind}, or ${freeOne} first.`;
    case "invite": return `Upgrade your plan to invite another ${kind}, or ${freeOne} first.`;
    case "reactivate": return `Upgrade your plan to reactivate this ${kind}, or ${freeOne} first.`;
  }
}

/**
 * "Your plan allows 10 active publishers and 10 are active. Upgrade your plan to resume this
 * publisher, or pause another publisher first."
 */
export function partnerLimitMessage(key: PartnerCapKey, used: number, limit: number, action: PartnerLimitAction): string {
  // Activating or resuming a partner brings its users back into the count: `used` is the figure
  // they would make, which is why it is over the limit.
  if (key === "max_partner_users" && (action === "activate" || action === "resume")) {
    return `Your plan allows ${limit.toLocaleString("en-US")} ${partnerLimitName(key, limit)}, and ${action === "resume" ? "resuming" : "activating"} this partner would make it ${used.toLocaleString("en-US")}. Upgrade your plan, or deactivate some partner users first.`;
  }
  if (limit <= 0) return `Your plan does not include ${NOUNS[key].kind}s. Upgrade your plan to use them.`;
  const allows = `Your plan allows ${limit.toLocaleString("en-US")} ${partnerLimitName(key, limit)}`;
  const inUse = used > limit ? `${used.toLocaleString("en-US")} are active, over the limit` : used === 1 ? "1 is active" : `${used.toLocaleString("en-US")} are active`;
  return `${allows} and ${inUse}. ${nextStep(key, action)}`;
}

/** Reads `partner_limit_reached:max_publishers:10:10` or `partner_user_limit_reached:max_partner_users:40:40`. */
export function parsePartnerLimitError(message: string): { key: PartnerCapKey; used: number; limit: number } | null {
  const match = message.match(/(?:partner_limit_reached|partner_user_limit_reached):(max_publishers|max_marketing_partners|max_affiliates|max_partner_users):(\d+):(\d+)/)
    ?? message.match(/\b(max_partner_users):(\d+):(\d+)/);
  if (!match || !isPartnerCapKey(match[1])) return null;
  return { key: match[1], used: Number(match[2]), limit: Number(match[3]) };
}

/** The 403 body every partner-limit refusal returns. `code` stays `limit_reached` for existing callers. */
export function partnerLimitBody(key: PartnerCapKey, used: number, limit: number, action: PartnerLimitAction) {
  return { error: partnerLimitMessage(key, used, limit, action), code: "limit_reached" as const, limitKey: key, limitName: partnerLimitName(key, limit), usage: used, limit, upgrade: true as const };
}
