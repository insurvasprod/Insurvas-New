/**
 * The producer record's decisions, kept free of React and of the app's aliases so node:test can run them
 * (producer-record-core.test.mjs). Bug walk 2026-11-20: the manager choice, what a manager save proves, the
 * onboarding count and where a licence is set.
 */

/**
 * A refresh follows a change, so it asks the server afresh: it never joins a read already on its way (the cache's
 * `load` does), which may have left before the change landed and would draw the old rows again (a saved
 * appointment still said "None yet"; an approved item still counted as missing). Errors carry the status and the
 * body, as the cache's do, so the screen can show the server's own sentence.
 */
export async function readFresh<T>(url: string, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(url, { cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const said = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
    throw Object.assign(new Error(typeof said === "string" ? said : `Request failed (${response.status})`), { status: response.status, body });
  }
  return body as T;
}

/** The "Reports to" value meaning nobody but the owner (a producer id is a uuid, so it never collides). */
export const OWNER_CHOICE = "owner";

export type ManagerCandidate = { id: string; displayName: string; email: string | null; status: string; role: string | null };
export type ManagerChoice = { value: string; label: string; description?: string; group?: string };

/**
 * Who a producer can report to: the owner, then the agency's managers, then everyone else still working. Two
 * people can share a name ("Demo Manager" twice), so each carries their email as the muted second line.
 */
export function managerChoices(rows: readonly ManagerCandidate[], producerId: string): ManagerChoice[] {
  const working = rows.filter((r) => r.id !== producerId && r.status !== "offboarded" && r.status !== "invited");
  const choice = (r: ManagerCandidate, group: string): ManagerChoice => ({ value: r.id, label: r.displayName, ...(r.email ? { description: r.email } : {}), group });
  return [
    { value: OWNER_CHOICE, label: "The owner" },
    ...working.filter((r) => r.role === "manager").map((r) => choice(r, "Managers")),
    ...working.filter((r) => r.role !== "manager").map((r) => choice(r, "Producers")),
  ];
}

export type ManagerSaveOutcome = { ok: true; managerName: string | null } | { ok: false; message: string };

/**
 * After the PUT answered, the record is read back: a change from today or earlier must show on it, or the save is
 * reported as failed (never a manager that was not stored). A change dated ahead cannot show yet; it is trusted to
 * the route's answer. `saved` is null when the record could not be read back.
 */
export function managerSaveOutcome({ chosen, effectiveFrom, today, saved }: {
  chosen: string | null;
  effectiveFrom: string;
  today: string;
  saved: { managerProducerId: string | null; managerName: string } | null;
}): ManagerSaveOutcome {
  if (effectiveFrom > today) return { ok: true, managerName: null };
  if (!saved) return { ok: false, message: "The change was sent but the record could not be read back. Reload the page to check who they report to." };
  if ((saved.managerProducerId ?? null) !== (chosen ?? null)) {
    return { ok: false, message: `That did not save: they still report to ${saved.managerName === "Owner" ? "the owner" : saved.managerName}. Try again.` };
  }
  return { ok: true, managerName: saved.managerName === "Owner" ? "the owner" : saved.managerName };
}

export type ChecklistRow = { item: string; done: boolean };

/**
 * The onboarding card's title, counted from the same rows the card draws: an item the owner just approved (its row
 * wears the "Approved" stamp until the fresh rows land) is no longer counted as missing.
 */
export function onboardingTitle({ items, canSubmit, isSelf, stamped }: { items: readonly ChecklistRow[]; canSubmit: boolean; isSelf: boolean; stamped?: (item: string) => boolean }) {
  const missing = items.filter((i) => !i.done && !stamped?.(i.item)).length;
  if (canSubmit) return { missing, title: isSelf ? "You can submit applications" : "They can submit applications" };
  const who = isSelf ? "You can't" : "They can't";
  return { missing, title: `${who} submit yet${missing ? ` · ${missing} item${missing === 1 ? "" : "s"} missing` : ""}` };
}

/** Settings › Team & Access opened on one member's sheet (the panel reads `member` once, on mount). */
export function teamAccessMemberHref(userId: string): string {
  return `/app/settings?member=${encodeURIComponent(userId)}#team-access`;
}

export type LicencePointer = { kind: "link"; href: string; label: string } | { kind: "text"; text: string };

/**
 * Where a producer's licence (state, number, expiry) is set: only the owner (or an admin) can, in Settings › Team &
 * Access. They get a link that opens this person there; anyone else is told who sets it, with no dead link.
 */
export function licencePointer({ viewerIsOwner, isSelf, userId }: { viewerIsOwner: boolean; isSelf: boolean; userId: string | null }): LicencePointer {
  if (viewerIsOwner && userId) return { kind: "link", href: teamAccessMemberHref(userId), label: "Set in Team & Access" };
  return { kind: "text", text: isSelf ? "Your owner sets it in Settings › Team & Access" : "The owner sets it in Settings › Team & Access" };
}
