"use client";

/**
 * The household strip (LA-3.24): both insureds on the case side by side — status, carrier and
 * premium — and the combined monthly total, so the agent reads the client both figures. Each side
 * opens its own application. Renders nothing for a single-insured case.
 *
 * Meant to sit under the workspace header (application-workspace.tsx), once per page.
 */

import Link from "next/link";

import { householdTotal } from "@/lib/applications/afterSubmitRules";
import type { AttemptView, CaseView } from "@/lib/applications/types";
import { cn } from "@/lib/utils";

import { AttemptStatusChip, money } from "@/components/app/applications/parts";
import { coverageOf } from "@/components/app/applications/outcome/model";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The attempt that speaks for an insured: the live one, else the newest. */
function sideOf(caseView: CaseView, role: "primary" | "spouse"): AttemptView | null {
  const mine = caseView.attempts.filter((a) => a.insuredRole === role).sort((a, b) => b.attemptNo - a.attemptNo);
  return mine.find((a) => a.status !== "closed") ?? mine[0] ?? null;
}

export function HouseholdHeader({ caseView, insured }: { caseView: CaseView; insured: "primary" | "spouse" }) {
  const primary = sideOf(caseView, "primary");
  const spouse = sideOf(caseView, "spouse");
  if (!primary || !spouse) return null;
  const sides = [primary, spouse].map((a) => {
    const name = [str(a.values["insured.first_name"]?.value), str(a.values["insured.last_name"]?.value)].filter(Boolean).join(" ") || (a.insuredRole === "primary" ? caseView.clientName : "Spouse");
    // A closed-without-issue side pays nothing; the total counts what is live or issued.
    const counts = a.status !== "closed" || a.outcome === "issued";
    return { a, name, monthly: counts ? coverageOf(a).monthlyCents || null : null };
  });
  const total = householdTotal(sides.map((s) => s.monthly));

  return (
    <section aria-label="Household" className="flex flex-wrap items-stretch gap-px overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--border)]">
      {sides.map(({ a, name, monthly }) => (
        <Link
          key={a.id}
          href={`?insured=${a.insuredRole}&attempt=${a.attemptNo}`}
          scroll={false}
          aria-current={a.insuredRole === insured ? "true" : undefined}
          className={cn("flex min-w-[220px] flex-1 flex-col gap-1 bg-[var(--surface)] px-4 py-3 outline-none hover:bg-[var(--canvas)] focus-visible:ring-2 focus-visible:ring-ring", a.insuredRole === insured && "bg-[var(--canvas)]")}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--ink)]">{name}</span>
            <AttemptStatusChip status={a.status} outcome={a.outcome} />
          </span>
          <span className="text-xs text-[var(--muted)]">{a.carrierName ?? "No carrier yet"} · {monthly ? `${money(monthly)} a month` : a.status === "closed" ? "closed, not counted" : "not quoted yet"}</span>
        </Link>
      ))}
      <div className="flex min-w-[180px] flex-col justify-center bg-[var(--surface)] px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-[0.02em] text-[var(--muted)]">Combined monthly total</span>
        <span className="text-lg font-semibold text-[var(--ink)] tabular-nums">{money(total.totalCents || null)}{total.complete ? "" : " so far"}</span>
      </div>
    </section>
  );
}
