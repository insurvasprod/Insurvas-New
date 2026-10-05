"use client";

/**
 * Step ① — who is on the line (LA-1.11; board l3-ws-verify). The real check is `VerificationPanel`
 * on the inbound work item; this step shows the four identity values the application carries, how
 * many are confirmed, and goes back to that panel when the case came from one. A value counts as
 * confirmed when the call's verification completed (computed on the server) or the agent has checked
 * it here or on the Application step.
 */

import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Field } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { US_STATES } from "@/lib/appointments/constants";
import type { FieldValue } from "@/lib/applications/types";

import { useWorkspace } from "@/components/app/applications/workspace/context";
import { StepCard } from "@/components/app/applications/workspace/step-card";
import { RevealBox } from "@/components/app/applications/workspace/use-reveal";
import { calendarDate, hasContent, isPrefilled, PrefillHint, ssnMask, ValueBox } from "./step-bits";

const text = (f: FieldValue | undefined) => (f?.value === null || f?.value === undefined ? "" : String(f.value));
const STATE_NAME = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));

type Item = { key: string; label: string; shown: string; fields: (FieldValue | undefined)[]; keys: string[] };

/** One marker for a value made of several fields (the full name): checked only when every part is. */
function combined(fields: (FieldValue | undefined)[]): FieldValue | undefined {
  const present = fields.filter((f): f is FieldValue => hasContent(f));
  if (!present.length) return undefined;
  const carried = present.find((f) => f.source !== "manual");
  return carried ? { ...carried, reviewed: present.every((f) => f.reviewed) } : present[0];
}

export function VerifyStep() {
  const { attempt, caseView, goTo, readOnly } = useWorkspace();
  const v = attempt.values;
  const verification = caseView.verification;
  const complete = Boolean(verification?.complete);
  const workItemId = verification?.workItemId ?? null;

  const name = [text(v["insured.first_name"]), text(v["insured.middle_initial"]), text(v["insured.last_name"])].filter(Boolean).join(" ");
  const dob = text(v["insured.dob"]);
  const state = text(v["addr.state"]) || caseView.clientState || "";
  const ssn = v["insured.ssn"];

  const items: Item[] = [
    { key: "insured.first_name", label: "Full name", shown: name, fields: [v["insured.first_name"], v["insured.last_name"]], keys: ["insured.first_name", "insured.last_name"] },
    { key: "insured.dob", label: "Date of birth", shown: dob ? calendarDate(dob) : "", fields: [v["insured.dob"]], keys: ["insured.dob"] },
    { key: "addr.state", label: "State", shown: state ? STATE_NAME.get(state.toUpperCase()) ?? state : "", fields: [v["addr.state"]], keys: ["addr.state"] },
    { key: "insured.ssn", label: "Social Security number", shown: ssn?.hasValue ? "yes" : "", fields: [ssn], keys: ["insured.ssn"] },
  ];
  const confirmed = (item: Item) => Boolean(item.shown) && (complete || (item.fields.some(hasContent) && item.fields.every((f) => !hasContent(f) || f!.reviewed)));
  const count = items.filter(confirmed).length;
  const chip = `${count} of ${items.length} confirmed`;

  const backToInbound = workItemId ? (
    <Button asChild variant="outline">
      <Link href={`/app/inbound/${workItemId}/verification`}><ArrowLeft aria-hidden="true" />Back to inbound</Link>
    </Button>
  ) : (
    <Button type="button" variant="outline" disabled title="This case did not come from an inbound call, so there is no verification to go back to."><ArrowLeft aria-hidden="true" />Back to inbound</Button>
  );

  return (
    <StepCard
      title="Verify who you are talking to"
      chips={<StatusChip tone={count === items.length ? "good" : "warning"}>{chip}</StatusChip>}
      actions={<>{backToInbound}<Button type="button" onClick={() => goTo("interview")}>Continue to Interview<ArrowRight aria-hidden="true" /></Button></>}
    >
      <div className="flex flex-col gap-1.5">
        <Meter value={count} max={items.length} tone="good" label={chip} className="h-1.5" />
        <span className="text-[12px] leading-[1.5] text-[var(--muted)]">
          {chip}{complete ? " · verified on the call" : verification?.workItemId ? " · the call's verification is not finished" : ""}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.slice(0, 3).map((item) => {
          const fv = combined(item.fields);
          return (
            <Field key={item.key} label={item.label} htmlFor={item.key}>
              <ValueBox id={item.key} prefilled={isPrefilled(fv)}>{item.shown || <span className="text-[var(--muted)]">Not given — add it on the Application step</span>}</ValueBox>
              {item.shown && <PrefillHint fv={fv} fieldKey={item.keys} readOnly={readOnly || complete} />}
            </Field>
          );
        })}
        <Field label="Social Security number" htmlFor="insured.ssn">
          <RevealBox id="insured.ssn" fieldKey="insured.ssn" masked={ssn?.masked} display={ssnMask(ssn?.masked)} hasValue={ssn?.hasValue} label="Social Security number" />
          <PrefillHint fv={ssn} fieldKey="insured.ssn" readOnly={readOnly || complete} extra={ssn?.hasValue ? "One field per reveal. Each one writes an audit row." : "Added on the Application step."} />
        </Field>
      </div>
    </StepCard>
  );
}
