"use client";

/**
 * Review step (LA-3.11; board l3-ws-review). The one verdict screen: will this go through, and if
 * not, exactly what will get it kicked back — each item with why it matters, the field it is about
 * and a way straight to it. Warnings are amber and never block. "Mark ready to submit" is the only
 * way to `ready`, and the server re-runs the same checks before it lets the attempt through.
 * Once submitted (or closed) the step shows the verdict frozen with the latest submission.
 */

import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, CircleX, RefreshCw } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import type { QaItem, QaVerdict } from "@/lib/applications/qa";
import { cn } from "@/lib/utils";

import { shortDate } from "@/components/app/applications/parts";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { StepCard } from "@/components/app/applications/workspace/step-card";

type Tone = "fail" | "warn" | "pass" | "neutral";
type Frozen = { submissionId: string; submittedAt: string; verdict: QaVerdict | null };

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const count = (n: number) => WORDS[n] ?? String(n);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const BANNER: Record<Tone, { box: string; icon: string; ink: string }> = {
  fail: { box: "border-l-[var(--error)] bg-[var(--error-surface)]", icon: "text-[var(--error)]", ink: "text-[var(--error-ink)]" },
  warn: { box: "border-l-[var(--warning)] bg-[var(--warning-surface)]", icon: "text-[var(--warning)]", ink: "text-[var(--warning-ink)]" },
  pass: { box: "border-l-[var(--success)] bg-[var(--success-surface)]", icon: "text-[var(--success)]", ink: "text-[var(--success-ink)]" },
  neutral: { box: "border-l-[var(--border-strong)] bg-[var(--surface)]", icon: "text-[var(--muted)]", ink: "text-[var(--ink)]" },
};

function toneOf(verdict: QaVerdict["verdict"] | null): Tone {
  return verdict === "fail" ? "fail" : verdict === "pass_with_warnings" ? "warn" : verdict === "pass" ? "pass" : "neutral";
}

function Banner({ tone, title, text, actions }: { tone: Tone; title: string; text: string; actions?: ReactNode }) {
  const t = BANNER[tone];
  const Icon = tone === "fail" ? CircleX : tone === "warn" ? CircleAlert : CircleCheck;
  return (
    <section aria-live="polite" className={cn("flex flex-wrap items-center gap-[18px] rounded-[12px] border border-[var(--border)] border-l-[3px] p-5", t.box)}>
      <span aria-hidden="true" className={cn("inline-flex size-[52px] shrink-0 items-center justify-center rounded-full bg-[var(--surface)]", t.icon)}>
        <Icon className="size-7" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className={cn("text-2xl font-semibold leading-[1.25] tracking-[-0.02em]", t.ink)}>{title}</h2>
        <p className="mt-1 text-sm text-[var(--body)]">{text}</p>
      </div>
      {actions && <span className="flex flex-wrap items-center gap-2.5">{actions}</span>}
    </section>
  );
}

/** A grey strip inside the card that heads one group, like the card's own header. */
function GroupHeader({ title, n, tone }: { title: string; n: number; tone: "danger" | "warning" | "good" }) {
  return (
    <div className="flex items-center justify-between gap-4 border-y border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 first:border-t-0">
      <h3 className="text-sm font-semibold text-[var(--ink)]">{title}</h3>
      <StatusChip tone={tone}>{n}</StatusChip>
    </div>
  );
}

function ItemRow({ item, level }: { item: QaItem; level: "block" | "warn" }) {
  const { goTo } = useWorkspace();
  return (
    <div className="m-row flex flex-wrap items-start gap-3 border-t border-[var(--border)] px-[22px] py-3.5 first:border-t-0">
      <span aria-hidden="true" className={cn("mt-[7px] size-2 shrink-0 rounded-full", level === "block" ? "bg-[var(--error)]" : "bg-[var(--warning)]")} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-sm font-semibold", level === "block" ? "text-[var(--error-ink)]" : "text-[var(--warning-ink)]")}>
          <span className="sr-only">{level === "block" ? "Must fix: " : "Worth a look: "}</span>{item.message}
        </span>
        {item.detail && <span className="text-sm text-[var(--body)]">{item.detail}</span>}
        {item.fieldKey && <span className="truncate font-mono text-xs text-[var(--muted)]">{item.fieldKey}</span>}
      </span>
      <Button type="button" variant="ghost" onClick={() => goTo(item.step, item.fieldKey)} aria-label={`Go to the field: ${item.message}`}>
        Go to the field<ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
}

function passedSentence(passed: string[]) {
  if (!passed.length) return "Nothing has passed yet.";
  const text = passed.join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function Groups({ qa, actions }: { qa: QaVerdict; actions?: ReactNode }) {
  return (
    <StepCard title="Must fix" chips={<StatusChip tone="danger">{qa.blocking.length}</StatusChip>} bodyClassName="gap-0 p-0" actions={actions}>
      <div className="flex flex-col">
        {qa.blocking.length
          ? qa.blocking.map((item, n) => <ItemRow key={`b-${item.code}-${item.fieldKey ?? n}-${n}`} item={item} level="block" />)
          : <p className="px-[22px] py-3.5 text-sm text-[var(--muted)]">Nothing blocks this application.</p>}
      </div>
      <GroupHeader title="Worth a look" n={qa.warnings.length} tone="warning" />
      <div className="flex flex-col">
        {qa.warnings.length
          ? qa.warnings.map((item, n) => <ItemRow key={`w-${item.code}-${item.fieldKey ?? n}-${n}`} item={item} level="warn" />)
          : <p className="px-[22px] py-3.5 text-sm text-[var(--muted)]">Nothing to look at.</p>}
      </div>
      <GroupHeader title="Passed" n={qa.passed.length} tone="good" />
      <p className="px-[22px] py-3.5 text-sm text-[var(--muted)]">{passedSentence(qa.passed)}</p>
    </StepCard>
  );
}

/** Submitted or closed: the verdict as it froze with the latest submission. */
function FrozenReview() {
  const { attempt, sample, goTo, timeZone } = useWorkspace();
  const latest = [...attempt.submissions].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0] ?? null;
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const [loading, setLoading] = useState(Boolean(latest) && !sample);

  useEffect(() => {
    if (!latest || sample) return;
    let live = true;
    void fetch(`/api/app/applications/attempts/${attempt.id}/frozen-qa`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { frozen?: Frozen | null }).frozen ?? null : null))
      .catch(() => null)
      .then((f) => { if (live) { setFrozen(f); setLoading(false); } });
    return () => { live = false; };
  }, [attempt.id, latest, sample]);

  if (!latest) {
    return <Banner tone="neutral" title="Closed without being submitted" text="This attempt never reached the carrier, so no verdict was frozen." actions={<Button type="button" variant="outline" onClick={() => goTo("timeline")}>Open the case timeline</Button>} />;
  }
  const verdict = frozen?.verdict ?? null;
  const v = verdict?.verdict ?? latest.qaVerdict;
  const nb = verdict?.blocking.length ?? 0;
  const nw = verdict?.warnings.length ?? 0;
  const title = v === "fail" ? `Submitted with ${count(nb).toLowerCase()} ${plural(nb, "thing", "things")} to fix` : v === "pass_with_warnings" ? (verdict ? `Submitted with ${count(nw).toLowerCase()} ${plural(nw, "warning", "warnings")}` : "Submitted with warnings") : "Submitted clean";
  return (
    <>
      <Banner
        tone={toneOf(v)}
        title={title}
        text={`Checked ${shortDate(frozen?.submittedAt ?? latest.submittedAt, { timeZone })}, when it was submitted.`}
        actions={<Button type="button" variant="outline" onClick={() => goTo(attempt.status === "closed" ? "timeline" : "after")}>{attempt.status === "closed" ? "Open the case timeline" : "Open After submit"}</Button>}
      />
      {loading ? <SectionLoading /> : verdict ? <Groups qa={verdict} /> : null}
    </>
  );
}

export function ReviewStep() {
  const { qa, attempt, sample, goTo, updateAttempt, actions } = useWorkspace();
  const [marking, setMarking] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const live = attempt.status === "draft" || attempt.status === "ready";

  // The rail runs as the agent types; arriving here also re-reads the case, so a disclosure an
  // answer added on the server, or a colleague's change, is in the verdict.
  useEffect(() => {
    if (!sample && live) void actions.refresh();
    // Once per visit to the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!live) return <FrozenReview />;

  const nb = qa.blocking.length;
  const nw = qa.warnings.length;
  const tone = toneOf(qa.verdict);
  const title = qa.verdict === "fail" ? (nb === 1 ? "One thing must be fixed" : `${count(nb)} things must be fixed`) : qa.verdict === "pass_with_warnings" ? `Pass with ${count(nw).toLowerCase()} ${plural(nw, "warning", "warnings")}` : "Ready to submit";
  const text = qa.verdict === "fail"
    ? `Submit and the carrier-site fill stay closed until ${nb === 1 ? "it is" : nb === 2 ? "both are" : `all ${nb} are`} cleared.`
    : qa.verdict === "pass_with_warnings"
      ? "Nothing blocks this application. Look over the warnings before you mark it ready."
      : "Every check passed. Mark it ready, then submit it on the carrier's site.";

  async function rerun() {
    setRerunning(true);
    try {
      await actions.refresh();
      notify.done("Checks re-run", { detail: "Read from the saved application, not only this screen." });
    } finally {
      setRerunning(false);
    }
  }

  // The server re-runs QA and refuses a failing attempt (QA_FAILED); the workspace shows that refusal.
  async function markReady() {
    setMarking(true);
    try {
      if (!(await actions.transition("ready"))) return;
      if (sample) updateAttempt({ status: "ready" });
      notify.done("Marked ready to submit");
      goTo("submit");
    } finally {
      setMarking(false);
    }
  }

  const blocked = qa.verdict === "fail";
  const primary = attempt.status === "ready" ? (
    <Button type="button" onClick={() => goTo("submit")}>Continue to Submit<ArrowRight aria-hidden="true" /></Button>
  ) : (
    <Button type="button" onClick={() => { void markReady(); }} disabled={blocked || marking} title={blocked ? "Fix everything under Must fix first." : marking ? "Checking…" : undefined}>
      {marking ? "Checking…" : "Mark ready to submit"}
    </Button>
  );

  return (
    <>
      <Banner
        tone={tone}
        title={title}
        text={text}
        actions={<>
          <Button type="button" variant="outline" onClick={() => { void rerun(); }} disabled={rerunning || sample} title={sample ? "Sample data — the checks already run as you type." : rerunning ? "Re-running…" : undefined}>
            <RefreshCw aria-hidden="true" className={cn(rerunning && "animate-spin")} />Re-run checks
          </Button>
          {primary}
        </>}
      />
      <Groups
        qa={qa}
        actions={<>
          <Button type="button" variant="outline" onClick={() => goTo("disclosures")}><ArrowLeft aria-hidden="true" />Back to Disclosures</Button>
          {primary}
        </>}
      />
    </>
  );
}
