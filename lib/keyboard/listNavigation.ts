/**
 * J and K, the two keys the account menu promises ("Slash to search, J and K to move").
 *
 * A list opts in by carrying `data-kbd-list`, and each row in it `data-kbd-item`. The keys only
 * act when focus is already inside such a list — J never steals a keystroke from a page that did
 * not ask for it, and never moves anything while a person is typing.
 *
 * Kept free of the DOM so the rules can be tested; the top bar applies them to elements.
 */

export const KBD_LIST_ATTRIBUTE = "data-kbd-list";
export const KBD_ITEM_ATTRIBUTE = "data-kbd-item";

export type ListKey = "next" | "previous" | null;

/** Which way a key moves, or null when it is not a list key (or a modifier makes it something else). */
export function listKeyDirection(event: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): ListKey {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === "j" || event.key === "J") return "next";
  if (event.key === "k" || event.key === "K") return "previous";
  return null;
}

/**
 * The index to focus next. From outside the list (-1) J lands on the first row and K on the last.
 * Stops at the ends rather than wrapping: a person pressing J to reach the bottom should find it,
 * not be thrown back to the top without noticing.
 */
export function nextListIndex(current: number, count: number, direction: Exclude<ListKey, null>): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return direction === "next" ? 0 : count - 1;
  if (direction === "next") return Math.min(count - 1, current + 1);
  return Math.max(0, current - 1);
}

/** Whether a keystroke is going into a field, where J and K are letters, not movement. */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}
