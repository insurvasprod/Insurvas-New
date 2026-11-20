// Where a step's "Continue" button goes. Pure and client-safe.
//
// Walk 2026-11-20: Payment's "Continue to Disclosures" did nothing useful when Disclosures was already
// done (none applied), and the agent typed Review into the address. Continue now lands on the next
// step that still needs work, and never past Review: Review is where everything is checked once more.

/** The first step after `from`, in `order`, that `isDone` says is not finished — or `stop` (Review). */
export function nextOpenStep<S extends string>(order: readonly S[], from: S, stop: S, isDone: (step: S) => boolean): S {
  const start = order.indexOf(from);
  const end = order.indexOf(stop);
  if (start < 0 || end < 0 || end <= start) return stop;
  for (let i = start + 1; i < end; i++) if (!isDone(order[i])) return order[i];
  return stop;
}
