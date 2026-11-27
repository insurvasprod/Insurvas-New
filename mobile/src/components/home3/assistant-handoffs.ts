import { clockShort } from "@/components/home/when";
import type { IconName } from "@/components/icon";
import { ago, codeLabel, displayName } from "@/lib/format";
import type { IconTone } from "@/components/ui";
import type { Tone } from "@/theme/tokens";

/**
 * Board B5 · Home for an assistant: "Your handoffs" and the "Today" tiles, from
 * GET /api/app/inbound/handoff?mine=1 (app/api/app/inbound/handoff/mine.ts): the handoffs this assistant
 * offered today and today's counts, in the workspace's days. Pure, so it is tested.
 */
export type HandoffState = "waiting" | "accepted" | "returned" | "expired";
export type MyHandoff = {
  id: string; workItemId: string; leadId: string | null; customer: string; agentName: string; state: HandoffState;
  offeredAt: string; acceptedAt: string | null; checked: number | null; fields: number | null; disposition: string | null;
};
export type MyHandoffsAnswer = {
  timezone: string;
  handoffs: MyHandoff[];
  today: { verified: number; handedOff: number; handedOffYesterday: number; avgSecondsToHandOff: number | null; accepted: number };
};

const STATE: Record<HandoffState, { tone: Tone; label: string; icon: IconName; iconTone: IconTone }> = {
  waiting: { tone: "info", label: "Waiting", icon: "userPlus", iconTone: "gold" },
  accepted: { tone: "ok", label: "Accepted", icon: "checkC", iconTone: "plain" },
  returned: { tone: "warn", label: "Returned", icon: "undo", iconTone: "plain" },
  expired: { tone: "warn", label: "Timed out", icon: "undo", iconTone: "plain" },
};

export type HandoffLine = { id: string; leadId: string | null; title: string; meta: string; chip: { tone: Tone; label: string }; icon: IconName; iconTone: IconTone };

/**
 * "Nora Bell → Jordan Reyes" · "Offered 3 min ago · 9 of 12 checked" · Waiting;
 * "Earl Johnson → Ava Kim" · "Accepted 11:02 · sold" · Accepted. Waiting ones first, then newest first.
 */
export function handoffLines(list: MyHandoff[], now: number, limit = 5): HandoffLine[] {
  const order = [...list].sort((a, b) => Number(b.state === "waiting") - Number(a.state === "waiting") || Date.parse(b.offeredAt) - Date.parse(a.offeredAt));
  return order.slice(0, limit).map((h) => {
    const s = STATE[h.state];
    const checked = h.checked !== null && h.fields ? `${h.checked} of ${h.fields} checked` : null;
    const outcome = codeLabel(h.disposition)?.toLowerCase() ?? null;
    const parts = h.state === "accepted" && h.acceptedAt
      ? [`Accepted ${clockShort(new Date(h.acceptedAt))}`, outcome]
      : [`Offered ${ago(h.offeredAt, now)}`, checked];
    return { id: h.id, leadId: h.leadId, title: `${displayName(h.customer)} → ${displayName(h.agentName)}`, meta: parts.filter(Boolean).join(" · "), chip: { tone: s.tone, label: s.label }, icon: s.icon, iconTone: s.iconTone };
  });
}

/** "6m 40s", "45s", "1h 05m". */
export function handOffTime(seconds: number | null): string {
  if (seconds === null) return "–";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** The Handed off tile's detail: "↑ 3" / "↓ 2" with "vs yesterday", or the same as yesterday. */
export function versusYesterday(today: number, yesterday: number): { strong: string; rest: string; good: boolean } {
  const d = today - yesterday;
  if (d === 0) return { strong: "Same", rest: "as yesterday", good: false };
  return { strong: `${d > 0 ? "↑" : "↓"} ${Math.abs(d)}`, rest: "vs yesterday", good: d > 0 };
}
