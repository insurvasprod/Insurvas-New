"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SettingsCard, SettingsMeter } from "@/components/app/settings/primitives";
import { ImportReviewWorkspace, type ReviewPlan } from "@/components/app/import-review-workspace";
import { NextUp } from "@/components/app/lead-sources/next-up";
import { IMPORT_CSV_KEY } from "@/lib/agentTemplates/importReviewModel";
import { discardStagedFile, forgetStagedFile } from "@/components/app/import-discard";

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
  const router = useRouter();
  const [discarding, setDiscarding] = useState(false);
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

  // The file is not in this tab (another tab, a closed one, or site data blocked). Its way back opens
  // Import on the same campaign; or it can be dropped from here, so it stops waiting in the rail.
  // Said once, on the Next up line (2026-10-30): its one button uploads again; Discard stays outline.
  if (!csv)
    return <><div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <NextUp
        tone="warning"
        action={<>
          <Button type="button" variant="outline" className="text-[var(--error-ink)] hover:bg-[var(--error-surface)] hover:text-[var(--error-ink)]" disabled={discarding} onClick={() => {
            setDiscarding(true);
            void discardStagedFile(plan.batchId, plan.fileName).then((result) => {
              if (result === "done") router.push("/app/import");
              else if (result === "imported") router.refresh();
            }).finally(() => setDiscarding(false));
          }}><Trash2 aria-hidden="true" />{discarding ? "Discarding…" : "Discard it"}</Button>
          <Button asChild><Link href={plan.campaignId ? `/app/import?campaign=${encodeURIComponent(plan.campaignId)}` : "/app/import"}>Upload the file again</Link></Button>
        </>}
      >
        Upload <strong>{plan.fileName ?? "the file"}</strong> again to review it: this tab no longer has it. {plan.campaignName ? `Same campaign (${plan.campaignName}) and cost.` : "Use the same campaign and cost."} Nothing was imported, and the scrub is not charged twice.
      </NextUp>
    </div></>;

  // Steps 3–4 on the same moving ribbon as Lead sources, where steps 1–2 open (2026-10-26).
  return <><ImportReviewWorkspace plan={plan} csv={csv} /></>;
}

/**
 * The finished state, for a batch that was already committed.
 *
 * Here rather than in the page because the primitives are a client module.
 */
export function ImportAlreadyImported() {
  // An imported file is no longer this tab's to review: forget it, so the rail stops counting it.
  const { batchId } = useParams<{ batchId?: string }>();
  useEffect(() => { if (batchId) forgetStagedFile(batchId); }, [batchId]);
  // The next step in order is Clean (step 4): the Next up line's one button (2026-10-30), the rest outline.
  return <><div className="m-stagger flex w-full min-w-0 flex-col gap-4">
    <NextUp
      tone="action"
      action={<>
        <Button asChild variant="outline"><Link href="/app/lead-lists">Open lead lists</Link></Button>
        <Button asChild variant="outline"><Link href="/app/import">Import another list</Link></Button>
        <Button asChild><Link href="/app/duplicates">Continue to Clean<ArrowRight aria-hidden="true" /></Link></Button>
      </>}
    >
      This list has already been imported, and its leads are in your lead lists. Next, confirm the ones that match leads you have on Clean.
    </NextUp>
  </div></>;
}

/** A file that was discarded (or whose check was stopped): closed, nothing imported. Back after Discard lands here. */
export function ImportNotUnderReview() {
  const { batchId } = useParams<{ batchId?: string }>();
  useEffect(() => { if (batchId) forgetStagedFile(batchId); }, [batchId]);
  return <><div className="m-stagger flex w-full min-w-0 flex-col gap-4">
    <NextUp tone="action" action={<Button asChild><Link href="/app/import">Import a list</Link></Button>}>
      This file was discarded, and nothing from it was imported.
    </NextUp>
  </div></>;
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
  const [discarding, setDiscarding] = useState(false);
  /** Clean-up (2026-10-29): stop checking this file and drop it, then back to Import. */
  async function discard() {
    setDiscarding(true);
    try {
      const result = await discardStagedFile(initial.batchId, progress.fileName);
      if (result === "done") router.push("/app/import");
      else if (result === "imported") router.refresh();
    } finally {
      setDiscarding(false);
    }
  }

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

  // The Next up line (2026-10-30): a pause or a missing file waits on the person, and its fix is the
  // one button; while it runs there is nothing to press, and the line says so.
  const nextUp = needsFile
    ? <NextUp tone="warning" action={<Button asChild><Link href="/app/import">Upload the file again</Link></Button>}>
        Upload <strong>{progress.fileName ?? "the file"}</strong> again to finish the review. Use the same campaign and cost: every number is already checked, so nothing is screened or charged twice.
      </NextUp>
    : paused
      ? <NextUp tone="warning" action={<Button type="button" onClick={() => { setPaused(null); setRun((value) => value + 1); }}>Carry on checking</Button>}>
          Screening paused: {paused} Nothing has been staged.
        </NextUp>
      : <NextUp tone="done">
          {left > 0
            ? <>Checking <strong>{left.toLocaleString()}</strong> more number{left === 1 ? "" : "s"}. Saved as it goes, so you can leave this page; the review opens when it is done.</>
            : "Every number has an answer. Building the review…"}
        </NextUp>;

  return <><div className="m-stagger flex w-full min-w-0 flex-col gap-4">
    {nextUp}
    <SettingsCard pad={18} title="Screening the file" sub={`${progress.fileName ?? "This file"} · ${progress.totalRows.toLocaleString()} rows`} bodyClassName="flex flex-col gap-3">
      <SettingsMeter
        value={progress.screened}
        max={Math.max(1, progress.total)}
        label="Numbers checked against DNC, litigator and your own lists"
        valueLabel={`${progress.screened.toLocaleString()} of ${progress.total.toLocaleString()}`}
        caption={`${pct}%${minutes !== null && left > 0 ? ` · about ${minutes.toLocaleString()} min left` : ""}`}
        ariaLabel={`Screening: ${pct}% of numbers checked`}
      />
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button type="button" variant="outline" size="sm" className="text-[var(--error-ink)] hover:bg-[var(--error-surface)] hover:text-[var(--error-ink)]" disabled={discarding} onClick={() => void discard()}>
          <Trash2 aria-hidden="true" />{discarding ? "Discarding…" : "Discard this file"}
        </Button>
      </div>
    </SettingsCard>
  </div></>;
}
