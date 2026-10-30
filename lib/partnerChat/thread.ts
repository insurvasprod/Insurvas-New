import { MONTHS, zonedParts } from "../format/dates.ts";
import type { PartnerMessage } from "./cards.ts";

/**
 * A flat list of messages becomes a conversation: days, then runs of messages from one sender.
 *
 * Pure on purpose. The thread's shape is the part worth testing — which messages share a bubble
 * group, where a day starts, what the separator says — and none of it needs React or a database.
 * The component (components/partner/chat-message.tsx) only draws what this returns.
 */

/** How far apart two messages from one sender may sit and still share a name and a time. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export type ThreadSide = "mine" | "theirs";

export type ThreadItem =
  /** A day's heading: "Today", "Yesterday", "28 Oct", "28 Oct 2024". */
  | { kind: "day"; key: string; label: string }
  /** Consecutive messages from one sender, under one name and one time. */
  | { kind: "group"; key: string; side: ThreadSide; authorId: string | null; messages: PartnerMessage[] }
  /** An automatic update. It interrupts a run: a notice is not part of anyone's turn speaking. */
  | { kind: "notice"; key: string; message: PartnerMessage };

/** The calendar day a moment falls on in `zone`, as a sortable key. Empty when it cannot be read. */
export function dayKey(value: string, zone: string): string {
  const parts = zonedParts(value, zone);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}` : "";
}

/**
 * What a day separator says. "Today" and "Yesterday" are relative to `now` **in the same zone**, so
 * a viewer in Auckland and one in Denver each read their own midnight.
 */
export function dayLabel(value: string, now: number, zone: string): string {
  const day = zonedParts(value, zone);
  if (!day) return "";
  const today = zonedParts(new Date(now), zone);
  if (today) {
    if (day.year === today.year && day.month === today.month && day.day === today.day) return "Today";
    const yesterday = zonedParts(new Date(now - 24 * 60 * 60 * 1000), zone);
    if (yesterday && day.year === yesterday.year && day.month === yesterday.month && day.day === yesterday.day) return "Yesterday";
    if (day.year !== today.year) return `${day.day} ${MONTHS[day.month - 1]} ${day.year}`;
  }
  return `${day.day} ${MONTHS[day.month - 1]}`;
}

/** Whether a message is the viewer's own. An automatic update belongs to nobody, so it is never. */
function sideOf(message: PartnerMessage, viewerId: string | null): ThreadSide {
  return viewerId && message.createdBy === viewerId ? "mine" : "theirs";
}

/**
 * The thread, in order: a day heading before each day's first item, then its messages — text
 * grouped into runs by sender, automatic updates standing alone.
 */
export function buildThread(
  messages: readonly PartnerMessage[],
  { viewerId, now = Date.now(), zone = "UTC" }: { viewerId: string | null; now?: number; zone?: string },
): ThreadItem[] {
  const items: ThreadItem[] = [];
  let day: string | null = null;
  let run: Extract<ThreadItem, { kind: "group" }> | null = null;

  for (const message of messages) {
    // An unreadable timestamp joins the day around it: a separator with nothing written on it is
    // worse than no separator, and a bad row should not split a conversation in two.
    const key = dayKey(message.createdAt, zone);
    if (key && key !== day) {
      day = key;
      run = null;
      items.push({ kind: "day", key: `day-${key}`, label: dayLabel(message.createdAt, now, zone) });
    }

    if (message.messageKind === "system_card") {
      run = null;
      items.push({ kind: "notice", key: message.id, message });
      continue;
    }

    const side = sideOf(message, viewerId);
    const continues = run
      && run.authorId === message.createdBy
      && run.side === side
      && new Date(message.createdAt).getTime() - new Date(run.messages[run.messages.length - 1]!.createdAt).getTime() <= GROUP_WINDOW_MS;

    if (continues && run) { run.messages.push(message); continue; }
    run = { kind: "group", key: message.id, side, authorId: message.createdBy, messages: [message] };
    items.push(run);
  }

  return items;
}
