"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

/**
 * Onboarding (p-app-publisher-detail): the four things a partner needs before its leads flow, each
 * read from what the product records rather than ticked by hand.
 *
 *   Commercial terms agreed   an active term exists (what the partner is paid)
 *   Products approved         at least one product this partner may submit
 *   Portal users invited      how many of the partner's invited users have accepted
 *   First lead submitted      the partner's last submission, if any
 *
 * The board's "Lead form published" step is not drawn: a partner's form inherits the business
 * default, so there is always a publishable form and the step could never be anything but done —
 * the real prerequisite is an approved product. Its "Who" column is "Detail" here, because who
 * completed a step is not recorded per step (the Activity tab has the audit trail).
 */
export type OnboardingTarget = "terms" | "products" | "people";
/** `go`: the step still to do, as a link to where it is done (2026-10-29: say where, then take you there). */
type Step = { step: string; state: string; tone: StatusTone; detail: string; go?: { label: string; to: OnboardingTarget } };
type PartnerUserLite = { status: "active" | "revoked"; accepted_at: string | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

export function PartnerOnboarding({ partnerId, termText, hasTerm, approved, lastSubmission, onGo }: {
  partnerId: string;
  /** Opens the tab or section where a step is done; without it the steps are plain text. */
  onGo?: (to: OnboardingTarget) => void;
  termText: string;
  hasTerm: boolean;
  approved: { count: number; total: number } | null;
  lastSubmission: string | null;
}) {
  const [users, setUsers] = useState<PartnerUserLite[] | null>(null);
  const [usersError, setUsersError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      try {
        const response = await fetch(`/api/app/partners/${encodeURIComponent(partnerId)}/users`, { cache: "no-store" });
        const body = await response.json().catch(() => null);
        if (!active) return;
        if (!response.ok) { setUsersError(true); return; }
        setUsers((body?.users ?? []) as PartnerUserLite[]);
      } catch { if (active) setUsersError(true); }
    })();
    return () => { active = false; };
  }, [partnerId]);

  const invited = (users ?? []).filter((user) => user.status === "active");
  const accepted = invited.filter((user) => user.accepted_at).length;
  const steps: Step[] = [
    hasTerm ? { step: "Commercial terms agreed", state: "Done", tone: "good", detail: termText } : { step: "Commercial terms agreed", state: "Not started", tone: "neutral", detail: "No terms recorded yet", go: { label: "Set terms", to: "terms" } },
    !approved ? { step: "Products approved", state: "Checking…", tone: "neutral", detail: "—" }
      : approved.count > 0 ? { step: "Products approved", state: "Done", tone: "good", detail: `${approved.count} of ${approved.total} approved` }
      : { step: "Products approved", state: "Not started", tone: "neutral", detail: "None approved yet", go: { label: "Approve products", to: "products" } },
    usersError ? { step: "Portal users invited", state: "Unknown", tone: "neutral", detail: "The team could not be read" }
      : !users ? { step: "Portal users invited", state: "Checking…", tone: "neutral", detail: "—" }
      : invited.length === 0 ? { step: "Portal users invited", state: "Not started", tone: "neutral", detail: "Nobody invited yet", go: { label: "Invite people", to: "people" } }
      : accepted === invited.length ? { step: "Portal users invited", state: "Done", tone: "good", detail: `${accepted} of ${invited.length} accepted` }
      : { step: "Portal users invited", state: `${accepted} of ${invited.length} accepted`, tone: accepted > 0 ? "warning" : "info", detail: "Waiting on the invitations" },
    lastSubmission ? { step: "First lead submitted", state: "Done", tone: "good", detail: `Latest ${day(lastSubmission)}` } : { step: "First lead submitted", state: "Not started", tone: "neutral", detail: "Nothing submitted yet" },
  ];
  const done = steps.filter((step) => step.state === "Done").length;

  // Once every step is done the checklist is scaffolding: four green ticks and a full bar, kept at the
  // top of Overview for the rest of the partner's life (owner, 2026-10-29: simplify). It goes, and the
  // page starts with the figures that keep mattering. It comes back on its own if a step stops holding
  // — terms expiring, the last product unapproved — because each row is read from the record, not ticked.
  if (done === steps.length) return null;

  const pct = Math.round((done / steps.length) * 100);
  // A checklist with a progress bar, not a data table (2026-10-29): each step says whether it is done,
  // what is missing, and links to where it is done.
  return (
    <section aria-labelledby={`onboarding-${partnerId}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <h2 id={`onboarding-${partnerId}`} className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Onboarding</h2>
          <InfoTip label="About onboarding">A partner moves from created to onboarded, active, paused and offboarded. Nothing skips a step.</InfoTip>
        </div>
        <div className="flex min-w-[180px] items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-alt)]" role="progressbar" aria-label="Onboarding progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
            <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-sm font-semibold tabular-nums text-[var(--ink)]">{done} of {steps.length}</span>
        </div>
      </div>
      <ol className="mt-3.5 flex list-none flex-col overflow-hidden rounded-lg border border-border p-0">
        {steps.map((step, index) => {
          const isDone = step.state === "Done";
          return (
            <li key={step.step} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-3 first:border-t-0">
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums",
                  isDone ? "bg-[var(--success-surface)] text-[var(--success-ink)]" : "border border-[var(--border-strong)] text-[var(--muted)]",
                )}
              >
                {isDone ? <Check className="size-4" /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-semibold", isDone ? "text-[var(--body)]" : "text-[var(--ink)]")}>{step.step}</span>
                <span className="block text-xs text-[var(--muted)]">{step.detail}</span>
              </span>
              {isDone ? <StatusChip tone="good">Done</StatusChip>
                : step.go && onGo ? <Button type="button" variant="outline" size="sm" onClick={() => onGo(step.go!.to)}>{step.go.label}</Button>
                : <StatusChip tone={step.tone}>{step.state}</StatusChip>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
