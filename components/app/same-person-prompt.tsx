"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { dayMonthYear, viewerTimeZone } from "@/lib/format/dates";
import { productLineLabel } from "@/lib/format/productLine";
import { cn } from "@/lib/utils";

/** What the prompt reads: the stored pre-flight (lib/existingCustomerPreflight/types.ts), loosely. */
export type SamePersonCheck = {
  status: string;
  checkedAt?: string | null;
  policyMatchingNote?: string;
  matches?: Array<{ leadId: string | null; contactId?: string | null; submittedAt?: string | null; partnerName: string | null; productLine?: string | null; outcome: string | null; matchedOn?: string[]; sourceType?: "lead" | "contact" }>;
  soldByPartners?: Array<{ partnerId: string; partnerName: string }>;
  soldByMultiplePartners?: boolean;
};

const MATCHED_ON: Record<string, string> = { phone: "phone", name: "name", dob: "date of birth", address: "address", email: "email" };

/** Stored outcomes are keys ("application_submitted"); say them as words. */
function outcomeLabel(value: string | null) {
  if (!value) return "no outcome recorded";
  const words = value.replaceAll("_", " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One "Same person?" prompt (Module 1 simplified, 2026-10-25) wherever a lead may already be known:
 * the inbound call screen, the lead page and the transfer drawer. It reads the existing-customer
 * pre-flight (LA-1.24) and the partner's own duplicate flag, and says it the same way everywhere:
 *
 * - New household: nothing at all.
 * - Spoken before: amber, with what happened last time.
 * - Already a customer: red, and on a call the agent says they've checked before going on.
 * - Sold by two or more partners: its own red line, naming them (billing evidence, LA-1.24-5).
 * - Not checked: quiet, with Re-check where the page can run one.
 *
 * Policy matching is not part of the check yet, and the prompt says so (LA-1.24).
 */
export function SamePersonPrompt({
  check,
  duplicateFlagged = false,
  onRecheck,
  busy = false,
  acknowledged,
  onAcknowledge,
  compact = false,
  className,
}: {
  check: SamePersonCheck | null | undefined;
  /** The partner marked this lead as a possible duplicate when they sent it. */
  duplicateFlagged?: boolean;
  onRecheck?: () => void;
  busy?: boolean;
  /** On a call: whether the agent has said they checked an existing customer. */
  acknowledged?: boolean;
  onAcknowledge?: () => void;
  /** The drawer's narrow form: no per-match cards past the first two. */
  compact?: boolean;
  className?: string;
}) {
  const status = check?.status ?? "not_checked";
  const matches = check?.matches ?? [];
  const soldBy = check?.soldByMultiplePartners ? check.soldByPartners ?? [] : [];
  if (status === "new_household" && !duplicateFlagged && soldBy.length === 0) return null;

  const customer = status === "already_customer";
  const spoken = status === "spoken_before" || (duplicateFlagged && !customer && status !== "not_checked");
  const unchecked = status === "not_checked";
  const tone = customer || soldBy.length > 0 ? "danger" : spoken || duplicateFlagged ? "warning" : "neutral";
  const headline = customer ? "Already a customer" : spoken || duplicateFlagged ? "Same person?" : "Not checked yet";
  const latest = matches[0];
  const summary = customer
    ? `They match someone you already sold${latest?.partnerName ? ` through ${latest.partnerName}` : ""}. Check before you go on.`
    : status === "spoken_before" && latest
      ? `Looks like someone you spoke to before${latest.partnerName ? `, from ${latest.partnerName}` : ""}. Last time: ${outcomeLabel(latest.outcome).toLowerCase()}.`
      : duplicateFlagged
        ? "The partner marked this as a possible duplicate when they sent it."
        : "Insurvas has not checked this lead against earlier leads and customers.";
  const shown = compact ? matches.slice(0, 2) : matches.slice(0, 5);
  const zone = viewerTimeZone();

  return (
    <section
      aria-label="Same person?"
      role={customer && onAcknowledge && !acknowledged ? "alert" : undefined}
      className={cn(
        "rounded-[14px] border p-3.5",
        tone === "danger" ? "border-[color-mix(in_srgb,var(--error)_45%,transparent)] bg-[color-mix(in_srgb,var(--error)_8%,transparent)]" : tone === "warning" ? "border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]" : "border-[var(--border)]",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn("m-0 text-sm leading-[1.5] font-semibold tracking-[-0.02em]", tone === "danger" ? "text-[var(--error-ink)]" : tone === "warning" ? "text-[var(--warning-ink)]" : "text-foreground")}>{headline}</p>
          <p className="m-0 mt-0.5 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]">{summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {matches.length > 0 && <StatusChip tone={tone === "neutral" ? "neutral" : tone} dot={false}>{matches.length} match{matches.length === 1 ? "" : "es"}</StatusChip>}
          {onRecheck && <Button type="button" onClick={onRecheck} variant="outline" size="sm" disabled={busy}>{busy ? "Checking…" : "Re-check"}</Button>}
        </div>
      </div>

      {soldBy.length > 0 && (
        <p className="m-0 mt-2 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--error-ink)]">
          Sold by {soldBy.length} partners: {soldBy.map((partner) => partner.partnerName).join(", ")}
        </p>
      )}

      {!unchecked && shown.length > 0 && (
        <ul className="m-0 mt-2.5 flex list-none flex-col gap-1.5 p-0">
          {shown.map((match, index) => {
            const on = (match.matchedOn ?? []).map((key) => MATCHED_ON[key] ?? key.replaceAll("_", " "));
            const title = match.sourceType === "contact" ? "Contact on file" : `Lead${match.partnerName ? ` from ${match.partnerName}` : ""}`;
            return (
              <li key={`${match.leadId ?? match.contactId ?? "match"}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg border border-[var(--border)] bg-[var(--color-card)] px-3 py-2 text-xs leading-[1.5]">
                <span className="min-w-0">
                  <span className="font-semibold text-foreground">{title}</span>
                  <span className="text-muted-foreground"> · {[match.productLine ? productLineLabel(match.productLine) : null, outcomeLabel(match.outcome), match.submittedAt ? dayMonthYear(match.submittedAt, zone) : null].filter(Boolean).join(" · ")}</span>
                  {on.length > 0 && <span className="block text-muted-foreground">Matched on {on.join(", ")}</span>}
                </span>
                {match.leadId && match.sourceType !== "contact" && <Link href={`/app/leads/${encodeURIComponent(match.leadId)}`} className="shrink-0 font-semibold text-[var(--accent-ink)] hover:underline">Open lead</Link>}
              </li>
            );
          })}
          {matches.length > shown.length && <li className="text-xs leading-[1.5] text-muted-foreground">{matches.length - shown.length} more on the lead page</li>}
        </ul>
      )}

      {customer && onAcknowledge && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {acknowledged
            ? <span className="text-xs leading-[1.5] font-semibold text-[var(--body)]">✓ You checked it</span>
            : <Button type="button" onClick={onAcknowledge} size="sm" variant="destructive">I&apos;ve checked: carry on</Button>}
        </div>
      )}

      {!unchecked && <p className="m-0 mt-2 text-xs leading-[1.5] text-muted-foreground">{check?.policyMatchingNote || "Policy matching is not included yet."}</p>}
    </section>
  );
}
