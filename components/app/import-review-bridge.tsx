"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileWarning } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Callout, DashedCard, SettingsCard, SettingsMeter, btn } from "@/components/app/settings/primitives";
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

/** The scrub's progress as the server reports it (importPreflight.ScreeningProgress). */
export type ScreeningView = {
  batchId: string;
  fileName: string | null;
  totalRows: number;
  screened: number;
  total: number;
  unavailable: number;
  message: string | null;
  startedAt: string;
  updatedAt: string;
};

/** Steps in a row that answered nothing while a vendor was unavailable, before the screen pauses. */
const STALLED_STEPS = 3;

function readTabFile(batchId: string) {
  try {
    return sessionStorage.getItem(`${IMPORT_CSV_KEY}:${batchId}`);
  } catch {
    return null;
  }
}

/**
 * LA-2.2-10 · the review screen while the file is still being screened.
 *
 * The scrub is a job whose progress lives on the batch row. This screen drives it — one PATCH per
 * slice, each screening for up to twenty seconds — and shows how far it has got. Nothing is staged
 * until every number has an answer; the last step sends the file from this tab so the plan can be
 * built, and the page then reloads into the ordinary review. Leaving the page loses nothing: the
 * answers are saved, and the same file uploaded with the same choices carries on from here.
 */
export function ImportScreeningBridge({ progress: initial }: { progress: ScreeningView }) {
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  const [paused, setPaused] = useState<string | null>(null);
  const [needsFile, setNeedsFile] = useState(false);
  const [run, setRun] = useState(0);
  const rate = useRef<{ at: number; screened: number } | null>(null);
  const [perSecond, setPerSecond] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let idle = 0;
    async function drive() {
      let latest = initial;
      while (!cancelled) {
        const csv = readTabFile(initial.batchId);
        const finishing = latest.screened >= latest.total;
        let response: Response;
        try {
          response = await fetch("/api/app/leads/import/preflight", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ batch_id: initial.batchId, ...(finishing && csv ? { csv } : {}) }),
          });
        } catch {
          if (!cancelled) setPaused("The connection dropped. The progress so far is saved.");
          return;
        }
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          setPaused(typeof body?.error === "string" ? body.error : "The check could not continue. The progress so far is saved.");
          return;
        }
        if (body?.state === "staged" || body?.state === "committed") {
          router.refresh();
          return;
        }
        const next = body?.progress as ScreeningView | undefined;
        if (!next) { setPaused("The check could not continue. The progress so far is saved."); return; }
        const now = Date.now();
        if (rate.current && next.screened > rate.current.screened && now > rate.current.at)
          setPerSecond(((next.screened - rate.current.screened) * 1000) / (now - rate.current.at));
        rate.current = { at: now, screened: next.screened };
        idle = next.screened > latest.screened ? 0 : idle + 1;
        latest = next;
        setProgress(next);
        if (body?.needsFile && !csv) { setNeedsFile(true); return; }
        // A vendor outage answers nothing. Unknown numbers are never let through, so the job waits;
        // after a few empty steps the screen stops asking and says why.
        if (idle >= STALLED_STEPS && next.screened < next.total) {
          setPaused(next.message ?? "A scrub vendor is not answering.");
          return;
        }
        if (idle > 0 && next.screened < next.total) await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    void drive();
    return () => { cancelled = true; };
    // `run` restarts the loop after a pause.
  }, [initial, router, run]);

  const pct = progress.total > 0 ? Math.floor((progress.screened / progress.total) * 100) : 100;
  const left = progress.total - progress.screened;
  const minutes = perSecond && perSecond > 0 ? Math.ceil(left / perSecond / 60) : null;

  return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
    <PageHeader eyebrow={sectionForPath("/app/import") ?? undefined} title="Review before committing" description="The last moment anyone can check what is about to enter the pipeline." />
    <ImportStepper current={3} />
    <SettingsCard pad={20} title="Screening the file" sub={`${progress.fileName ?? "This file"} · ${progress.totalRows.toLocaleString()} rows`} bodyClassName="flex flex-col gap-3">
      <SettingsMeter
        value={progress.screened}
        max={Math.max(1, progress.total)}
        label="Numbers checked against DNC, litigator and your own lists"
        valueLabel={`${progress.screened.toLocaleString()} of ${progress.total.toLocaleString()}`}
        caption={`${pct}%${minutes !== null && left > 0 ? ` · about ${minutes.toLocaleString()} min left` : ""}`}
        ariaLabel={`Screening: ${pct}% of numbers checked`}
      />
      <p role="status" className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
        {left > 0
          ? "Nothing is staged or imported until every number has an answer. The progress is saved as it goes: you can leave this page, and uploading the same file with the same campaign and cost picks it up where it stopped."
          : "Every number has an answer. Building the review…"}
      </p>
    </SettingsCard>
    {paused && <Callout tone="warning" title="Screening paused">
      <div className="flex flex-col gap-2">
        <p className="m-0">{paused} No number without an answer is ever let through, so nothing has been staged.</p>
        <button type="button" className={btn("secondary", "self-start")} onClick={() => { setPaused(null); setRun((value) => value + 1); }}>Carry on checking</button>
      </div>
    </Callout>}
    {needsFile && <DashedCard
      icon={<FileWarning className="size-4" aria-hidden />}
      title="Every number is checked, but this tab no longer holds the file"
      action={<Link href="/app/import" className={btn("secondary", "h-11")}>Upload the file again</Link>}
    >
      The review is built from the file, which stays in the tab it was uploaded from. Upload it again with the same
      campaign and cost: the answers are saved, so nothing is screened or charged twice.
    </DashedCard>}
  </div>;
}
