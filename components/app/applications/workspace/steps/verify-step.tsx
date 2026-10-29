"use client";

/**
 * Step ① — who is on the line (LA-1.11; board l3-ws-verify). The real check is `VerificationPanel`
 * on the inbound work item; this step shows the identity values the application carries and lets the
 * agent confirm each one by reading it back. A value counts as confirmed when the call's verification
 * completed (computed on the server), the agent confirmed it on the call, or it was checked here or on
 * the Application step.
 *
 * Owner 2026-10-28: drawn like the interview — one section, two values to a line, each with "It's
 * right"; the section folds to "Complete · 4 of 4" once every value is confirmed. The Social Security
 * number is not asked here: it is taken on the Application step.
 */

import Link from "next/link";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { US_STATES } from "@/lib/appointments/constants";
import type { AttemptView, CaseView, FieldValue } from "@/lib/applications/types";
import { cn } from "@/lib/utils";

import { useWorkspace } from "@/components/app/applications/workspace/context";
import { FoldSection } from "@/components/app/applications/workspace/fold-section";
import { calendarDate, hasContent } from "./step-bits";

const text = (f: FieldValue | undefined) => (f?.value === null || f?.value === undefined ? "" : String(f.value));
const STATE_NAME = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));

/** "(817) 555-0142" for a ten-digit US number; anything else as typed. */
function phoneText(raw: string) {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
}

type Item = { key: string; label: string; shown: string; keys: string[]; ask: string };

/** The values read back to the caller, in the order they are asked. */
export function verifyItems(attempt: AttemptView, caseView: CaseView): Item[] {
  const v = attempt.values;
  const name = [text(v["insured.first_name"]), text(v["insured.middle_initial"]), text(v["insured.last_name"])].filter(Boolean).join(" ");
  const dob = text(v["insured.dob"]);
  const state = (text(v["addr.state"]) || caseView.clientState || "").toUpperCase();
  const cityLine = [text(v["addr.city"]), [state, text(v["addr.zip"])].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const address = [text(v["addr.line1"]), cityLine].filter(Boolean).join(", ") || (state ? STATE_NAME.get(state) ?? state : "");
  return [
    { key: "insured.first_name", label: "Full name", shown: name, keys: ["insured.first_name", "insured.last_name"], ask: "Can I have your full name?" },
    { key: "insured.dob", label: "Date of birth", shown: dob ? calendarDate(dob) : "", keys: ["insured.dob"], ask: "And your date of birth?" },
    { key: "addr.line1", label: "Address", shown: address, keys: ["addr.line1", "addr.city", "addr.state", "addr.zip"], ask: "What address should the policy go to?" },
    { key: "contact.phone", label: "Phone", shown: phoneText(text(v["contact.phone"])), keys: ["contact.phone"], ask: "Is this the best number to reach you?" },
  ];
}

/** Whether one value is confirmed: the call verified, the agent confirmed it on the call, or it was checked. */
export function verifyConfirmed(item: Item, attempt: AttemptView, caseView: CaseView): boolean {
  if (!item.shown) return false;
  if (caseView.verification?.complete) return true;
  const present = item.keys.filter((k) => hasContent(attempt.values[k]));
  const onCall = new Set(caseView.verification?.confirmedKeys ?? []);
  if (present.length > 0 && present.every((k) => onCall.has(k))) return true;
  return present.length > 0 && present.every((k) => attempt.values[k]!.reviewed);
}

export function VerifyStep() {
  const { attempt, caseView, goTo, readOnly, markReviewed } = useWorkspace();
  const verification = caseView.verification;
  const workItemId = verification?.workItemId ?? null;
  const onCall = new Set(verification?.confirmedKeys ?? []);
  const items = verifyItems(attempt, caseView);
  const confirmed = items.map((item) => verifyConfirmed(item, attempt, caseView));
  const count = confirmed.filter(Boolean).length;

  const backToInbound = workItemId ? (
    <Button asChild variant="outline">
      <Link href={`/app/inbound/${workItemId}/verification`}><ArrowLeft aria-hidden="true" />Back to inbound</Link>
    </Button>
  ) : (
    <Button type="button" variant="outline" disabled title="This case did not come from an inbound call, so there is no verification to go back to."><ArrowLeft aria-hidden="true" />Back to inbound</Button>
  );

  return (
    <section aria-label="Verify who you are talking to" className="m-glass flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--border)] p-[18px]">
      <FoldSection heading="Who you are talking to" done={count} total={items.length} complete={count === items.length} unit="confirmed">
        {items.map((item, i) => {
          const ok = confirmed[i];
          const fromCall = ok && item.keys.filter((k) => hasContent(attempt.values[k])).every((k) => onCall.has(k));
          const isNext = !ok && confirmed.indexOf(false) === i;
          return (
            <div
              key={item.key}
              id={item.key}
              tabIndex={-1}
              className={cn(
                "flex h-full gap-3 rounded-[14px] border p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isNext ? "border-[color-mix(in_srgb,var(--primary)_60%,transparent)] bg-[var(--primary-soft)]" : "border-[var(--border)] bg-[var(--surface-alt)]",
              )}
            >
              <span aria-hidden="true" className={cn("inline-grid size-[30px] shrink-0 place-items-center rounded-full text-xs font-bold", ok ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "bg-[var(--surface)] text-[var(--muted)]")}>
                {ok ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="min-w-0">
                  <p className="text-card-title text-[var(--ink)]">
                    {item.label}
                    {isNext && <span className="ml-2 inline-flex rounded-full bg-[var(--primary)] px-2 py-0.5 align-middle text-xs font-bold text-[var(--ink)]">Ask now</span>}
                  </p>
                  <p className="mt-0.5 text-xs leading-[1.5] text-[var(--muted)]">“{item.ask}”</p>
                </div>
                {item.shown ? (
                  <span className="text-sm font-semibold break-words text-[var(--ink)]">{item.shown}</span>
                ) : (
                  <span className="text-sm text-[var(--muted)]">Not given yet</span>
                )}
                <span className="flex flex-wrap items-center gap-2">
                  {ok ? (
                    <StatusChip tone="good" dot={false}>{fromCall ? "Confirmed on the call" : "Confirmed"}</StatusChip>
                  ) : item.shown ? (
                    !readOnly && (
                      <Button type="button" size="sm" variant="outline" className="border-[color-mix(in_srgb,var(--primary)_55%,transparent)] text-[var(--accent-ink)]" onClick={() => { for (const k of item.keys) if (hasContent(attempt.values[k])) markReviewed(k); }}>
                        <Check aria-hidden="true" />It&apos;s right
                      </Button>
                    )
                  ) : null}
                  {!ok && !readOnly && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => goTo("application", item.key)}>{item.shown ? "Correct it" : "Add it"} on Application</Button>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </FoldSection>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
        <span className="text-xs text-[var(--muted)]">
          {verification?.complete ? "Verified on the call." : onCall.size ? "Confirmed on the call where marked; the call's verification is not finished." : workItemId ? "The call's verification is not finished." : "Read each one back and confirm it."}
        </span>
        <span className="flex flex-wrap items-center gap-3">
          {backToInbound}
          <Button type="button" onClick={() => goTo("interview")}>Continue to Interview<ArrowRight aria-hidden="true" /></Button>
        </span>
      </div>
    </section>
  );
}
