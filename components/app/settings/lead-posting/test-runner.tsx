"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { control, Field } from "@/components/ui/field";
import { StatusChip } from "@/components/ui/status-chip";
import { REASON_CHIP, REASON_WORDS, fixForReason } from "@/lib/leadPost/board";
import { readFieldMap } from "@/lib/leadPost/fieldMap";
import type { TestResult } from "@/lib/leadPost/boardStore";
import { OUR_FIELD_LABELS } from "./shared";

/** The made-up lead a test sends; edited in plain fields, sent in the vendor's own field names. */
export type TestLead = { first_name: string; last_name: string; phone: string; state: string; date_of_birth: string; consent_text: string; consent_ip: string };

export const DEFAULT_TEST_LEAD: TestLead = {
  first_name: "Martha",
  last_name: "Reyes",
  phone: "(512) 555-0142",
  state: "TX",
  date_of_birth: "03/14/1956",
  consent_text: "By clicking Get quotes I agree to be contacted about insurance by phone, including by automated means.",
  consent_ip: "73.12.4.9",
};

/** The test lead in THEIR field names, so it travels through their field map as a real post would. */
export function payloadFor(lead: TestLead, fieldMap: Record<string, string>): Record<string, string> {
  const theirs = new Map(readFieldMap(fieldMap).map((entry) => [entry.ours, entry.theirs]));
  const out: Record<string, string> = {};
  for (const [ours, value] of Object.entries(lead)) if (value.trim()) out[theirs.get(ours) ?? ours] = value;
  return out;
}

export function describeLead(lead: TestLead) {
  return [`${lead.first_name} ${lead.last_name}`.trim(), lead.phone, lead.state, lead.date_of_birth ? `born ${lead.date_of_birth}` : ""].filter(Boolean).join(" · ");
}

const time = (value: string) => new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** One test's outcome: the chip, whose test and when, what a real post would do, and one fix. */
export function TestResultCard({
  result,
  who,
  onFix,
  fixing,
}: {
  result: Pick<TestResult, "accepted" | "reasonCode" | "message" | "at" | "ms"> & Partial<Pick<TestResult, "checks" | "leadName" | "campaignName" | "suggestions">>;
  who: string;
  onFix?: (suggestion: { theirs: string; ours: string }) => void;
  fixing?: boolean;
}) {
  const fix = fixForReason(result.reasonCode, null);
  const suggestion = !result.accepted && fix.kind === "map" ? result.suggestions?.[0] : undefined;
  const checked = (result.checks ?? []).filter((check) => check.ok).map((check) => check.label.toLowerCase());
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex min-w-0 items-center gap-2">
        {result.accepted
          ? <StatusChip tone="good">Accepted</StatusChip>
          : <StatusChip tone={REASON_CHIP[result.reasonCode] ?? "danger"}>Refused · {(REASON_WORDS[result.reasonCode] ?? result.reasonCode).toLowerCase()}</StatusChip>}
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--ink)]">{who}, {time(result.at)}</span>
        <span className="ml-auto shrink-0 text-xs text-[var(--muted)]">{result.ms === null ? "" : `${(result.ms / 1000).toFixed(1)} s`}</span>
      </div>
      <p className="m-0 text-sm text-[var(--body)]">
        {result.accepted
          ? `A real post like this would make the lead ${result.leadName ?? "this person"}${result.campaignName ? ` in ${result.campaignName}` : ""}, stage New, and queue a first dial. Nothing was created or charged.`
          : result.message}
      </p>
      {checked.length > 0 && <p className="m-0 text-xs text-[var(--muted)]">Checked: {checked.join(" · ")}</p>}
      {suggestion && onFix && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--body)]">
          <span>Read <b className="font-mono text-xs">{suggestion.theirs}</b> as the {(OUR_FIELD_LABELS[suggestion.ours] ?? suggestion.ours).toLowerCase()}, then send this same test again.</span>
          <Button type="button" size="sm" disabled={fixing} onClick={() => onFix(suggestion)}>{fixing ? "Fixing…" : "Fix and resend"}</Button>
        </div>
      )}
      {!result.accepted && (fix.kind === "licence" || fix.kind === "campaign") && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--body)]">
          <span>{fix.kind === "licence" ? "Add a licence for that state, or ask the vendor to filter it out." : "Open the campaign and make it active and scrubbed."}</span>
          <Button asChild variant="outline" size="sm"><Link href={fix.href}>{fix.label}</Link></Button>
        </div>
      )}
    </div>
  );
}

/** Edit the made-up lead. */
export function TestLeadDialog({ open, lead, onClose, onSave }: { open: boolean; lead: TestLead; onClose: () => void; onSave: (lead: TestLead) => void }) {
  const [draft, setDraft] = useState(lead);
  const set = (key: keyof TestLead) => (event: React.ChangeEvent<HTMLInputElement>) => setDraft((value) => ({ ...value, [key]: event.target.value }));
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Edit the test lead</DialogTitle>
          <DialogDescription>A made-up person. It is sent in the vendor&rsquo;s own field names.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="First name" htmlFor="test-first"><input id="test-first" className={control} value={draft.first_name} onChange={set("first_name")} /></Field>
          <Field label="Last name" htmlFor="test-last"><input id="test-last" className={control} value={draft.last_name} onChange={set("last_name")} /></Field>
          <Field label="Phone" htmlFor="test-phone"><input id="test-phone" className={control} value={draft.phone} onChange={set("phone")} /></Field>
          <Field label="State" htmlFor="test-state"><input id="test-state" className={control} maxLength={2} value={draft.state} onChange={(event) => setDraft((value) => ({ ...value, state: event.target.value.toUpperCase() }))} /></Field>
          <Field label="Date of birth" htmlFor="test-dob"><input id="test-dob" className={control} value={draft.date_of_birth} onChange={set("date_of_birth")} placeholder="MM/DD/YYYY" /></Field>
          <Field label="Consent IP" htmlFor="test-ip"><input id="test-ip" className={control} value={draft.consent_ip} onChange={set("consent_ip")} /></Field>
          <Field label="Consent words" htmlFor="test-consent" className="sm:col-span-2"><input id="test-consent" className={control} value={draft.consent_text} onChange={set("consent_text")} /></Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => { onSave(draft); onClose(); }}>Use this lead</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
