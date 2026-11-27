import { readSecret, writeSecret } from "./secure";

/**
 * Board H1's swipe-left Snooze, as the web bell does it (lib/agentAlerts/bell.ts): a snoozed alert leaves
 * the Inbox until its time is up, then comes back as it was. Like the web's, the snooze is kept on the device
 * (there, the browser; here, this phone), keyed by the person, because the server has no snooze table yet
 * (bell.ts names the table it would need). Reading an alert is the server's and reaches every device.
 */
export type SnoozeOption = "1h" | "3h" | "tomorrow9";
export const SNOOZE_OPTIONS: readonly { key: SnoozeOption; label: string }[] = [
  { key: "1h", label: "1 hour" },
  { key: "3h", label: "3 hours" },
  { key: "tomorrow9", label: "Tomorrow 9 am" },
];

/** id → ISO time the snooze ends. */
export type SnoozeMap = Record<string, string>;

/** When a snooze ends; "Tomorrow 9 am" is in the phone's own time. */
export function snoozeUntil(option: SnoozeOption, now: Date): Date {
  if (option === "1h") return new Date(now.getTime() + 60 * 60_000);
  if (option === "3h") return new Date(now.getTime() + 3 * 60 * 60_000);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
}

/** Only the snoozes still running at `now`; anything unreadable is dropped. */
export function activeSnoozes(map: SnoozeMap, now: number): SnoozeMap {
  const out: SnoozeMap = {};
  for (const [id, until] of Object.entries(map)) {
    const at = Date.parse(until);
    if (Number.isFinite(at) && at > now) out[id] = until;
  }
  return out;
}

/** The stored value; anything malformed reads as "nothing snoozed". */
export function parseSnoozeMap(raw: string | null): SnoozeMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: SnoozeMap = {};
    for (const [id, until] of Object.entries(parsed as Record<string, unknown>)) if (typeof until === "string") out[id] = until;
    return out;
  } catch {
    return {};
  }
}

// The secure store keeps small values; a phone never needs more than the latest snoozes.
const MAX_KEPT = 40;
const keyFor = (userId: string) => `insurvas.snooze.${userId.replace(/[^A-Za-z0-9._-]/g, "")}`;

export async function readSnoozes(userId: string): Promise<SnoozeMap> {
  return activeSnoozes(parseSnoozeMap(await readSecret(keyFor(userId)).catch(() => null)), Date.now());
}

export async function writeSnoozes(userId: string, map: SnoozeMap): Promise<void> {
  const live = Object.entries(activeSnoozes(map, Date.now())).sort((a, b) => b[1].localeCompare(a[1])).slice(0, MAX_KEPT);
  await writeSecret(keyFor(userId), live.length ? JSON.stringify(Object.fromEntries(live)) : null).catch(() => undefined);
}
