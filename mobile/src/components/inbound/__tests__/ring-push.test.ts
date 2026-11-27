import { pushAction, pushWorkItem, RING_CATEGORIES, SNOOZE_SECONDS } from "../ring-push";

/** Board C2 · the lock-screen buttons: what each one does with the push it is on. */
const W = "0b7c1d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";

test("the two categories carry the board's buttons, in its order", () => {
  expect(RING_CATEGORIES.transfer.map((a) => a.buttonTitle)).toEqual(["Take call", "Pass"]);
  expect(RING_CATEGORIES.callback.map((a) => a.buttonTitle)).toEqual(["Open", "Snooze 10 min"]);
});

test("Take call claims the transfer the push names, else the longest waiting", () => {
  expect(pushAction("take", { workItemId: W })).toEqual({ kind: "claim", workItemId: W });
  expect(pushAction("take", { href: `/app/inbound/call/${W}?phase=check` })).toEqual({ kind: "claim", workItemId: W });
  expect(pushAction("take", { href: "/app/inbound" })).toEqual({ kind: "claim", workItemId: null });
  expect(pushWorkItem({ workItemId: "not-a-uuid" })).toBeNull();
});

test("Pass only clears it here; Snooze rings again in ten minutes; a tap opens the link", () => {
  expect(pushAction("pass", { href: "/app/inbound" })).toEqual({ kind: "dismiss" });
  expect(pushAction("snooze", {})).toEqual({ kind: "snooze", seconds: SNOOZE_SECONDS });
  expect(SNOOZE_SECONDS).toBe(600);
  expect(pushAction("expo.modules.notifications.actions.DEFAULT", { href: "/app/leads/l1" })).toEqual({ kind: "open", href: "/app/leads/l1" });
  expect(pushAction("open", undefined)).toEqual({ kind: "open", href: null });
});
