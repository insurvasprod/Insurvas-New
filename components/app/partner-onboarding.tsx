"use client";

import { useEffect, useState } from "react";

import { StatusChip, type StatusTone } from "@/components/ui/status-chip";

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
type Step = { step: string; state: string; tone: StatusTone; detail: string };
type PartnerUserLite = { status: "active" | "revoked"; accepted_at: string | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const th = "bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";
const td = "border-t border-border px-3 py-2 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]";

export function PartnerOnboarding({ partnerId, termText, hasTerm, approved, lastSubmission }: {
  partnerId: string;
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
    hasTerm ? { step: "Commercial terms agreed", state: "Done", tone: "good", detail: termText } : { step: "Commercial terms agreed", state: "Not started", tone: "neutral", detail: "No terms recorded — set them on Commercial terms" },
    !approved ? { step: "Products approved", state: "Checking…", tone: "neutral", detail: "—" }
      : approved.count > 0 ? { step: "Products approved", state: "Done", tone: "good", detail: `${approved.count} of ${approved.total} approved` }
      : { step: "Products approved", state: "Not started", tone: "neutral", detail: "Approve at least one product on Products" },
    usersError ? { step: "Portal users invited", state: "Unknown", tone: "neutral", detail: "The team could not be read" }
      : !users ? { step: "Portal users invited", state: "Checking…", tone: "neutral", detail: "—" }
      : invited.length === 0 ? { step: "Portal users invited", state: "Not started", tone: "neutral", detail: "Invite them from Team" }
      : accepted === invited.length ? { step: "Portal users invited", state: "Done", tone: "good", detail: `${accepted} of ${invited.length} accepted` }
      : { step: "Portal users invited", state: `${accepted} of ${invited.length} accepted`, tone: accepted > 0 ? "warning" : "info", detail: "Waiting on the invitations" },
    lastSubmission ? { step: "First lead submitted", state: "Done", tone: "good", detail: `Latest ${day(lastSubmission)}` } : { step: "First lead submitted", state: "Not started", tone: "neutral", detail: "Nothing submitted yet" },
  ];
  const done = steps.filter((step) => step.state === "Done").length;

  return (
    <section aria-labelledby={`onboarding-${partnerId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 id={`onboarding-${partnerId}`} className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Onboarding</h2>
          <p className="mt-1 text-sm text-muted-foreground">Create → onboard → active → paused → offboarded. Nothing skips a step.</p>
        </div>
        <StatusChip tone={done === steps.length ? "good" : "neutral"}>{done} of {steps.length} done</StatusChip>
      </div>
      <div className="mt-3.5 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[520px] table-fixed border-collapse text-left">
          <thead><tr><th className={th}>Step</th><th className={`${th} w-[190px]`}>State</th><th className={th}>Detail</th></tr></thead>
          <tbody>{steps.map((step) => <tr key={step.step} className="m-row">
            <td className={`${td} font-semibold text-foreground`}>{step.step}</td>
            <td className={td}><StatusChip tone={step.tone}>{step.state}</StatusChip></td>
            <td className={`${td} text-muted-foreground`}>{step.detail}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
