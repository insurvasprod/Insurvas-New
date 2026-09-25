"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { CheckCircle2, FileWarning } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { DashedCard, btn } from "@/components/app/settings/primitives";
import { ImportStepper } from "@/components/app/import-stepper";
import { ImportReviewWorkspace, type ReviewPlan } from "@/components/app/import-review-workspace";
import { IMPORT_CSV_KEY } from "@/lib/agentTemplates/importReviewModel";
import { sectionForPath } from "@/lib/menu/definition";

/**
 * Carries the uploaded file across the redirect to the review screen.
 *
 * The staged PLAN lives on the server, keyed by batch id; only the file itself has to travel, and
 * it travels in `sessionStorage` rather than in the URL or in the staged row. Twenty thousand rows
 * is megabytes — too big for a query string, and storing it server-side would duplicate every lead
 * record into a jsonb column for the sake of one screen.
 *
 * `sessionStorage` rather than `localStorage`: a half-finished import is not something to find
 * again next week, and it must not leak into another tab where a different file may be under
 * review.
 */
/** Never changes for the life of the page: the file is written before the redirect, not after. */
const subscribe = () => () => {};

export function ImportReviewBridge({ plan }: { plan: ReviewPlan }) {
  /**
   * `useSyncExternalStore` rather than an effect, because `sessionStorage` IS an external store and
   * this component has to render correctly on the server, where it does not exist. The server
   * snapshot is `null`, so the first paint is the "upload it again" state and the client corrects
   * it on hydration — no flash of an empty review, and no setState inside an effect.
   */
  const csv = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return sessionStorage.getItem(`${IMPORT_CSV_KEY}:${plan.batchId}`);
      } catch {
        // Private browsing, or site data disabled. Treated the same as a missing file: say so and
        // let them upload again, rather than failing on commit with a checksum mismatch.
        return null;
      }
    },
    () => null,
  );

  if (!csv)
    return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader eyebrow={sectionForPath("/app/import") ?? undefined} title="Review before committing" description="The last moment anyone can check what is about to enter the pipeline." />
      <ImportStepper current={3} />
      <DashedCard
        icon={<FileWarning className="size-4" aria-hidden />}
        title="This review is no longer holding your file"
        action={<Link href="/app/import" className={btn("secondary", "h-11")}>Upload the file again</Link>}
      >
        The checks are still saved, but the file itself is not — it stays in this browser tab only, and this
        tab does not have it. Upload it again with the same campaign and cost and the review will be waiting:
        nothing was imported, and the scrub is not charged twice for the same file.
      </DashedCard>
    </div>;

  return <ImportReviewWorkspace plan={plan} csv={csv} />;
}

/**
 * The finished state, for a batch that was already committed.
 *
 * Here rather than in the page because the primitives are a client module: a server component can
 * render `DashedCard`, but it cannot call `btn()` to style the links.
 */
export function ImportAlreadyImported() {
  return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
    <PageHeader eyebrow={sectionForPath("/app/import") ?? undefined} title="Review before committing" description="The last moment anyone can check what is about to enter the pipeline." />
    <ImportStepper current={5} />
    <DashedCard
      icon={<CheckCircle2 className="size-4" aria-hidden />}
      title="This list has already been imported"
      action={<span className="flex flex-wrap justify-center gap-3">
        <Link href="/app/import" className={btn("primary", "h-11")}>Import another list</Link>
        <Link href="/app/lead-lists" className={btn("secondary", "h-11")}>Open lead lists</Link>
      </span>}
    >
      Nothing further is pending for it. The leads are in your lead lists; this review step is finished and
      cannot be repeated, because the decisions it carried have already been applied.
    </DashedCard>
  </div>;
}
