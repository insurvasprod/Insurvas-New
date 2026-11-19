import type { ReactNode } from "react";

/**
 * Frame first, data after (UI-CONSISTENCY §7a, owner 2026-11-12), for the Commissions pages. A page does its gate
 * checks, starts its reads as one promise of the parts that need them (`startParts`), and returns the
 * `CommissionsPage` frame at once. Each part streams into its own place:
 *
 *   const view = startParts(build(...));          // the page's reads, started, not awaited
 *   <CommissionsPage
 *     title={<Suspense fallback={<TitleShape />}><Part read={view} part="title" /></Suspense>}
 *     tabs={<Suspense fallback={sameTabsWithoutCounts}><Part read={view} part="tabs" /></Suspense>}
 *     actions={<Suspense fallback={null}><Part read={view} part="actions" /></Suspense>}
 *   >
 *     <StreamSection shape="strip+table"><Part read={view} part="body" /></StreamSection>
 *   </CommissionsPage>
 *
 * A page reads exactly what it read before, once: every part comes from the same promise.
 */
export type FrameParts = { title?: ReactNode; tabs?: ReactNode; actions?: ReactNode; body: ReactNode };

/** Starts a page's reads without awaiting them. A failure is raised where a part awaits it, inside its boundary. */
export function startParts<T extends FrameParts>(read: Promise<T>): Promise<T> {
  read.catch(() => undefined);
  return read;
}

/**
 * Like `startParts`, but the reads start only when the first part asks for them: after the frame has rendered. For a
 * page whose one read is heavy enough that, started first, it held the frame back past 400ms (Pay issues and its
 * letters, 2026-11-12: ~440ms against ~280ms for the other steps).
 */
export function afterFrame<T extends FrameParts>(start: () => Promise<T>): Promise<T> {
  let read: Promise<T> | null = null;
  const run = () => (read ??= startParts(start()));
  return {
    then: (done, failed) => run().then(done, failed),
    catch: (failed) => run().catch(failed),
    finally: (always) => run().finally(always),
    [Symbol.toStringTag]: "Promise",
  } as Promise<T>;
}

/**
 * One part of the page, once its reads land. A page may stream more parts than the four (a stepper either side of a
 * slot that must draw at once): name them in the promise's type.
 */
export async function Part<T extends FrameParts>({ read, part }: { read: Promise<T>; part: keyof T & string }) {
  return ((await read)[part] as ReactNode) ?? null;
}
