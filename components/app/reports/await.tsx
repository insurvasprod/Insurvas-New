import type { ReactNode } from "react";

/**
 * Frame first (UI-CONSISTENCY §7a): a Reports server page starts its read as a promise, returns the frame at once and
 * draws each block from that read inside a `<StreamSection>` (or a title or facts line inside a `<Suspense>`). This is
 * the async child that waits for it: `<Await read={report}>{(r) => <View report={r} />}</Await>`. Several blocks may
 * wait on the same promise; it is read once.
 */
export async function Await<T>({ read, children }: { read: Promise<T>; children: (value: T) => ReactNode }) {
  return children(await read);
}

/**
 * A record's facts line not known yet (its counts, read from the data): one muted bar where the line will be, so the
 * title line keeps its height when the facts land. Pass it as the Suspense fallback of ReportsPage `facts`; the bar
 * waits 180ms like every skeleton (.m-skel).
 */
export function FactsShape() {
  return <span aria-hidden="true" className="inline-block h-3.5 w-72 max-w-full m-skel rounded-full align-middle" />;
}
