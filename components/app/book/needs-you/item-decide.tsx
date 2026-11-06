"use client";
import { BasisChip } from "@/components/app/agency/money";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, textareaControl } from "@/components/ui/field";
import { SelectMenu } from "@/components/ui/select-menu";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import { RESOLUTION_LABELS, RESOLUTIONS, type Resolution } from "@/lib/ingestion/exceptionQueues";
import type { QueueItemRow } from "@/lib/ingestion/exceptionQueuesStore";
import { MATCH_FIELDS, type FieldOutcome } from "@/lib/ingestion/policyMatching";
import { acceptsChargeback, chargebackAcceptedNote, dollars, KIND_META, unknownPolicyItemId, type NeedsYouKind } from "@/lib/needsYou/kinds";
import type { ItemDetail } from "@/lib/needsYou/store";
import { notify } from "@/lib/notify";
import { refreshStepCounts } from "@/components/app/step-frame/step-rail";
import { rowHref } from "@/lib/ingestion/trace";

import { ChoiceList, type Choice } from "./choice-list";

/**
 * Where a decision goes once saved. On the item page: the next item's page (or the list). In place (round 4,
 * owner 2026-11-02: a row of a file's page or the Needs you list opens under itself): the caller's `onDone`,
 * which closes the row and opens the next waiting one, and the page refreshes behind it.
 */
export type InlineNav = { hasNext: boolean; onDone: (how: "save" | "next") => void; onSkip?: () => void };
type Nav = { nextHref: string | null; listHref: string; readOnly: boolean; inline?: InlineNav };

/** In place the parts drop their cards: the row it opens under is the container (fewer containers). */
const Flat = createContext(false);

const OUTCOME_CLASS: Record<FieldOutcome, string> = { match: "text-[var(--success-ink)]", partial: "text-[var(--warning-ink)]", mismatch: "text-[var(--error-ink)]", missing: "text-muted-foreground" };
const OUTCOME_MARK: Record<FieldOutcome, string> = { match: " ✓", partial: " ~", mismatch: " ✕", missing: "" };

/** Sends a decision to the API its own screen uses, then opens the next item (or the list). */
function useDecision({ nextHref, listHref, inline }: Nav) {
  const router = useRouter();
  const [busy, setBusy] = useState<"save" | "next" | null>(null);
  async function send(how: "save" | "next", url: string, method: "POST" | "PATCH", body: unknown, done: string) {
    setBusy(how);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      if (inline) {
        notify.done(done);
        refreshStepCounts();
        setBusy(null);
        inline.onDone(how);
        router.refresh();
        return;
      }
      notify.done(how === "next" && nextHref ? `${done} Opening the next.` : done);
      router.push(how === "next" && nextHref ? nextHref : listHref);
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
      setBusy(null);
    }
  }
  return { busy, send };
}

/** The two buttons under every Decide tab: Save (back to the list) and "<verb> and open the next". */
function DecideButtons({ kind, nav, busy, ready, onSave }: { kind: NeedsYouKind; nav: Nav; busy: "save" | "next" | null; ready: boolean; onSave: (how: "save" | "next") => void }) {
  if (nav.readOnly) return <p className="m-0 text-sm text-muted-foreground">Your plan is read-only, so this can be looked at but not decided.</p>;
  const verb = KIND_META[kind].verb;
  if (nav.inline) {
    // In place: Skip, then one primary that saves and opens the next waiting row.
    const next = nav.inline.hasNext;
    return (
      <div className="flex flex-wrap justify-end gap-2">
        {next && nav.inline.onSkip && <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={nav.inline.onSkip}>Skip</Button>}
        <Button type="button" size="sm" disabled={!ready || busy !== null} onClick={() => onSave(next ? "next" : "save")}>{busy ? "Saving" : next ? `${verb} and next` : verb}</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {nav.nextHref && <Button type="button" variant="outline" disabled={!ready || busy !== null} onClick={() => onSave("save")}>{busy === "save" ? "Saving" : "Save"}</Button>}
      <Button type="button" disabled={!ready || busy !== null} onClick={() => onSave(nav.nextHref ? "next" : "save")}>{busy ? "Saving" : nav.nextHref ? `${verb} and open the next` : verb}</Button>
    </div>
  );
}

/** "When you save": what this choice does to the card and the money, in plain words. */
function WhenYouSave({ children }: { children: ReactNode }) {
  if (useContext(Flat)) return <p className="m-0 text-xs leading-[1.5] text-muted-foreground">{children}</p>;
  return (
    <Card>
      <CardHeader><CardTitle>When you save</CardTitle></CardHeader>
      <CardContent className="text-sm leading-[1.6] text-[var(--body)]">{children}</CardContent>
    </Card>
  );
}

function ChoicesCard({ title, children }: { title: string; children: ReactNode }) {
  if (useContext(Flat)) return <section className="flex min-w-0 flex-col gap-2"><h3 className="m-0 text-sm font-semibold text-foreground">{title}</h3>{children}</section>;
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A short list of facts about the item, as label and value. */
function Facts({ title, facts }: { title: string; facts: Array<[string, ReactNode]> }) {
  if (useContext(Flat)) return <FactList facts={facts} label={title} />;
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <dl className="m-0 grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="m-0 text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function FactList({ facts, label }: { facts: Array<[string, ReactNode]>; label: string }) {
  return (
    <dl aria-label={label} className="m-0 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      {facts.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-muted-foreground">{name}</dt>
          <dd className="m-0 text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The evidence table: a TableCard on the item page, the bare table in place. */
function Evidence({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  if (useContext(Flat)) return <div role="group" aria-label={title} className="min-w-0 overflow-x-auto">{children}</div>;
  return <TableCard title={title} description={description}>{children}</TableCard>;
}

const Grid = ({ children }: { children: ReactNode }) => <div className="grid gap-4 lg:grid-cols-2">{children}</div>;
const Reason = ({ id, label, value, onChange, required, placeholder, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; required?: boolean; placeholder?: string; disabled?: boolean }) => (
  <Field label={label} htmlFor={id} required={required}>
    <textarea id={id} className={textareaControl} value={value} maxLength={2000} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
  </Field>
);

/** Nothing to save here (a letter is out, a word Insurvas maps): only the way on. */
function NextOnly({ nav }: { nav: Nav }) {
  if (nav.inline) return nav.inline.hasNext && nav.inline.onSkip ? <div className="flex justify-end"><Button type="button" size="sm" variant="outline" onClick={nav.inline.onSkip}>Next</Button></div> : null;
  return nav.nextHref ? <div className="flex justify-end"><Button asChild><Link href={nav.nextHref}>Open the next</Link></Button></div> : null;
}

// ─── Pick the client ─────────────────────────────────────────────────────────────────────────────────────

function PickClient({ detail, nav }: { detail: Extract<ItemDetail, { kind: "pick-client" }>; nav: Nav }) {
  const { busy, send } = useDecision(nav);
  const first = detail.candidates[0];
  const [choice, setChoice] = useState<string | null>(first?.likely ? "0" : null);
  const saleWord = (type: string) => (type === "deal_flow" ? "sale" : "application");
  const matches = (fields: Record<string, FieldOutcome>) => MATCH_FIELDS.filter((f) => fields[f] === "match").length;
  const picked = choice === null || choice === "none" ? null : detail.candidates[Number(choice)];
  const row = detail.carrierRow;
  const cell = (outcome: FieldOutcome | undefined, value: ReactNode) => <span className={OUTCOME_CLASS[outcome ?? "missing"]}>{value}{OUTCOME_MARK[outcome ?? "missing"]}</span>;

  const choices: Choice<string>[] = [
    ...detail.candidates.map((c) => ({ key: String(c.index), label: c.name, hint: `${matches(c.fields)} of ${MATCH_FIELDS.length} match · ${saleWord(c.type)} of ${fileDay(c.date)}${c.likely ? " · likely" : ""}` })),
    { key: "none", label: "No one in Insurvas yet", hint: "keeps the policy and makes a provisional client" },
  ];

  return (
    <>
      <Evidence title="The carrier’s file against each sale" description="No single field decides: a matching name alone is not enough.">
        {detail.candidates.length === 0 ? (
          <p className="m-0 px-4 pb-4 text-sm text-muted-foreground">No sale or application for this carrier in the 14 days before the file looks like this policy.</p>
        ) : (
          <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
            <thead><tr><th className="w-[150px]" /><th>The carrier’s file</th>{detail.candidates.map((c) => <th key={c.index}>{c.name} · {saleWord(c.type)} {fileDay(c.date)}</th>)}</tr></thead>
            <tbody>
              <tr><td>Name</td><td>{row.name}</td>{detail.candidates.map((c) => <td key={c.index}>{cell(c.fields.surname === "match" && c.fields.givenName === "match" ? "match" : c.fields.surname === "mismatch" ? "mismatch" : "partial", c.name)}</td>)}</tr>
              <tr><td>Born</td><td>{row.dob ? fileDay(row.dob) : "—"}</td>{detail.candidates.map((c) => <td key={c.index}>{cell(c.fields.dob, c.dob ? fileDay(c.dob) : "—")}</td>)}</tr>
              <tr><td>Phone</td><td className="tabular-nums">{row.phone ?? "—"}</td>{detail.candidates.map((c) => <td key={c.index} className="tabular-nums">{cell(c.fields.phone, c.phone ?? "—")}</td>)}</tr>
              <tr><td>Monthly premium</td><td className="tabular-nums">{dollars(row.premiumCents)}</td>{detail.candidates.map((c) => <td key={c.index} className="tabular-nums">{cell(c.fields.premium, dollars(c.premiumCents))}</td>)}</tr>
              <tr><td>Face amount</td><td className="tabular-nums">{dollars(row.faceCents)}</td>{detail.candidates.map((c) => <td key={c.index} className="tabular-nums">{cell(c.fields.face, dollars(c.faceCents))}</td>)}</tr>
              <tr><td>Agent code</td><td className="font-mono text-xs">{row.agentIdentifier ?? "—"}</td>{detail.candidates.map((c) => <td key={c.index} className="text-muted-foreground">—</td>)}</tr>
              <tr><td className="font-semibold">Score</td><td />{detail.candidates.map((c) => <td key={c.index} className="font-semibold tabular-nums">{c.score}{c.likely ? " · likely" : ""}</td>)}</tr>
            </tbody>
          </table>
        )}
      </Evidence>
      <Grid>
        <ChoicesCard title="Who is it?">
          <ChoiceList name="pick-client" label="Who is it?" choices={choices} value={choice} onChange={setChoice} disabled={nav.readOnly || busy !== null} />
        </ChoicesCard>
        <WhenYouSave>
          {choice === null ? "Pick who this policy belongs to."
            : picked ? <>{detail.policyNumber} links to <strong>{picked.name}</strong> and the {saleWord(picked.type)} of {fileDay(picked.date)}. The policy’s waiting stages then run once: its card moves by your card-move rules, and its next commission lines post to that client.</>
            : <>{detail.policyNumber} keeps a provisional client made from the carrier’s file, and a “Policy with no sale” item goes to the writing agent to confirm the client.</>}
        </WhenYouSave>
      </Grid>
      <DecideButtons kind="pick-client" nav={nav} busy={busy} ready={choice !== null} onSave={(how) => void send(how, "/api/app/policy-matching", "POST", { action: "resolve", review_id: detail.reviewId, candidate: picked ? picked.index : null }, picked ? "Policy linked." : "Recorded: no client found.")} />
    </>
  );
}

// ─── The exception queues ────────────────────────────────────────────────────────────────────────────────

const QUEUE_HINTS: Partial<Record<Resolution, string>> = {
  not_mine: "hands it to operations, or to the owner",
  never_submitted: "closes the open application case, with your reason",
  raised_with_carrier: "records what you asked the carrier",
  another_writing_number: "the lines stay in the ledger as they are",
};

const QUEUE_EFFECT: Record<Resolution, string> = {
  confirm_client: "The client made from the carrier’s file becomes a confirmed client, and the policy stays linked to them.",
  link_existing_client: "The policy links to the client you pick; the provisional client made from the file is folded into them if nothing else points at it.",
  found_the_sale: "The policy links to the sale you pick and its client. Its waiting stages run once: the card moves by your card-move rules and its commission lines post to that client.",
  not_mine: "The item leaves your list and goes to operations (a bookkeeper), or to the owner if operations already had it.",
  found_the_policy: "The carrier’s policy links to this sale. The policy’s waiting stages run once, and the card moves by your card-move rules.",
  never_submitted: "The sale’s open application case closes as never submitted, with your reason kept on it.",
  resubmitted_elsewhere: "The item closes, pointing at the application attempt that replaced it. That attempt waits for its own carrier file.",
  same_person: "Every policy of the first client moves to the second, and the first is folded into the second if it was made from a carrier file.",
  different_people: "Both clients stay as they are, and the item closes.",
  reviewed: "The item closes. The clients made from your existing book keep their provisional mark until each is confirmed in Contacts.",
  another_writing_number: "The item closes with your note. The lines stay in the ledger and link themselves when a policy file lists the number.",
  raised_with_carrier: "The item closes with what you asked the carrier. The lines stay in the ledger until the carrier answers with a file.",
};

function queueFacts(q: QueueItemRow): Array<[string, ReactNode]> {
  const p = q.payload ?? {};
  const carrier = q.carrierName ?? p.carrier_name ?? "—";
  switch (q.queueType) {
    case "no_deal_flow":
      return [["Policy", <span key="p" className="font-mono">{q.policyNumber ?? "—"}</span>], ["Carrier", carrier], ["Insured in the file", [p.insured?.first_name, p.insured?.last_name].filter(Boolean).join(" ") || "—"], ["Born", p.insured?.dob ? fileDay(p.insured.dob) : "—"], ["Monthly premium", dollars(p.premium_cents ?? null)], ["Face amount", dollars(p.face_cents ?? null)], ["File of", fileDay(p.file_date ?? null)], ["Client now", q.contact ? `${q.contact.name}${q.contact.provisional ? " (made from the file)" : ""}` : "None could be made"]];
    case "no_policy":
      return [["Sold to", q.deal?.insuredName ?? "—"], ["Sold on", fileDay(q.deal?.date ?? null)], ["Carrier", q.deal?.carrier ?? carrier], ["Monthly premium", dollars(q.deal?.premiumCents ?? null)], ["Writing agent", q.assigneeName]];
    case "multi_policy":
      return [["First client", q.contact ? `${q.contact.name}${q.contact.provisional ? " (made from a carrier file)" : ""}` : "—"], ["Second client", q.related ? `${q.related.name}${q.related.provisional ? " (made from a carrier file)" : ""}` : "—"], ["Why it asks", "Not certain enough to merge them without a person"]];
    case "initial_import":
      return [["Carrier", carrier], ["File of", fileDay(p.file_date ?? null)], ["Policies", Number(p.policies ?? 0).toLocaleString("en-US")], ["New clients (provisional)", Number(p.provisional ?? 0).toLocaleString("en-US")], ["Existing clients", Number(p.existing ?? 0).toLocaleString("en-US")], ["Linked by number", Number(p.linkedByNumber ?? 0).toLocaleString("en-US")]];
    case "orphan_commission":
      return [["Policy number", <span key="p" className="font-mono">{q.policyNumber ?? "—"}</span>], ["Carrier", carrier], ["Paid", dollars(p.amount_cents == null ? null : Number(p.amount_cents))], ["Lines", String(p.lines ?? "—")], ["First seen", fileDay(p.first_seen ?? null)]];
    default:
      return [];
  }
}

function QueueDecide({ kind, queue: q, nav }: { kind: NeedsYouKind; queue: QueueItemRow; nav: Nav }) {
  const { busy, send } = useDecision(nav);
  const options = RESOLUTIONS[q.queueType] as readonly Resolution[];
  const [choice, setChoice] = useState<Resolution | null>(options.length === 1 ? options[0] : null);
  const [contactId, setContactId] = useState("");
  const [dealId, setDealId] = useState("");
  const [policy, setPolicy] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [note, setNote] = useState("");
  const off = nav.readOnly || busy !== null;
  const pickMenu = (label: string, value: string, onChange: (v: string) => void, list: Array<{ value: string; label: string; description?: string }>, empty: string) =>
    list.length === 0 ? <p className="m-0 text-xs text-muted-foreground">{empty}</p>
      : <SelectMenu label={label} value={value} onChange={onChange} disabled={off} className="w-full max-w-md" panelAlign="start" options={[{ value: "", label: `Choose ${label.toLowerCase()}` }, ...list]} />;

  const extra = (resolution: Resolution): ReactNode => {
    switch (resolution) {
      case "link_existing_client": return pickMenu("A client", contactId, setContactId, (q.choices.contacts ?? []).map((c) => ({ value: c.id, label: c.name, description: c.dob ? `born ${fileDay(c.dob)}` : undefined })), "No confirmed client has this last name.");
      case "found_the_sale": return pickMenu("A sale", dealId, setDealId, (q.choices.deals ?? []).map((d) => ({ value: d.id, label: d.name, description: fileDay(d.date) })), "No submitted sale in the last 120 days.");
      case "found_the_policy": return pickMenu("A policy", policy, setPolicy, (q.choices.policies ?? []).map((p) => ({ value: `${p.carrierId}|${p.policyNumber}`, label: p.label })), "This carrier’s files list no policy yet.");
      case "resubmitted_elsewhere": return pickMenu("An application", applicationId, setApplicationId, (q.choices.applications ?? []).map((a) => ({ value: a.id, label: a.label })), "This client has no other application attempt.");
      case "never_submitted": return <Reason id="queue-reason" label="Why it was never submitted" value={note} onChange={setNote} required disabled={off} />;
      case "raised_with_carrier": return <Reason id="queue-note" label="What you asked the carrier" value={note} onChange={setNote} required disabled={off} />;
      case "another_writing_number": return <Reason id="queue-note" label="Which writing number, if you know it" value={note} onChange={setNote} disabled={off} />;
      default: return null;
    }
  };

  const choices: Choice<Resolution>[] = options.map((resolution) => ({
    key: resolution,
    label: RESOLUTION_LABELS[resolution],
    hint: resolution === "confirm_client" ? (q.contact ? `${q.contact.name} becomes a confirmed client` : "no client could be made from the file") : QUEUE_HINTS[resolution],
    disabled: resolution === "confirm_client" && !q.contact,
    children: extra(resolution),
  }));

  const body = (): Record<string, unknown> | null => {
    if (!choice) return null;
    const base = { action: "resolve", item_id: q.id, resolution: choice };
    switch (choice) {
      case "link_existing_client": return contactId ? { ...base, contact_id: contactId } : null;
      case "found_the_sale": return dealId ? { ...base, deal_id: dealId } : null;
      case "found_the_policy": { const [carrierId, ...rest] = policy.split("|"); return policy ? { ...base, carrier_id: carrierId, policy_number: rest.join("|") } : null; }
      case "resubmitted_elsewhere": return applicationId ? { ...base, application_id: applicationId } : null;
      case "never_submitted": return note.trim() ? { ...base, reason: note.trim() } : null;
      case "raised_with_carrier": return note.trim() ? { ...base, note: note.trim() } : null;
      case "another_writing_number": return note.trim() ? { ...base, note: note.trim() } : base;
      default: return base;
    }
  };
  const ready = body() !== null;

  return (
    <>
      <Facts title={KIND_META[kind].label === "Same person?" ? "The two clients" : "What the file says"} facts={queueFacts(q)} />
      <Grid>
        <ChoicesCard title="What do you want to do?">
          <ChoiceList name="queue-resolution" label="What do you want to do?" choices={choices} value={choice} onChange={setChoice} disabled={off} />
        </ChoicesCard>
        <WhenYouSave>{choice ? QUEUE_EFFECT[choice] : "Choose what happened."}</WhenYouSave>
      </Grid>
      <DecideButtons kind={kind} nav={nav} busy={busy} ready={ready} onSave={(how) => { const b = body(); if (b) void send(how, "/api/app/exceptions", "POST", b, choice === "not_mine" ? "Handed on." : "Saved."); }} />
    </>
  );
}

// ─── Money doesn't match ─────────────────────────────────────────────────────────────────────────────────

type MoneyChoice = "letter" | "accept" | "rate" | "paid" | "write_off" | "sent_email" | "sent_portal" | "sent_post" | "carrier_paid" | "carrier_refused";

function MoneyDecide({ detail, nav }: { detail: Extract<ItemDetail, { kind: "money" }>; nav: Nav }) {
  const router = useRouter();
  const { busy, send } = useDecision(nav);
  const f = detail.finding;
  const disputed = f.status === "disputed";
  const [choice, setChoice] = useState<MoneyChoice | null>(detail.disputable && !disputed ? "letter" : null);
  const [note, setNote] = useState("");
  const off = nav.readOnly || busy !== null;

  const evidence = (
    <Evidence title="Expected against reported" description={f.explanation}>
      <table className="portal-lead-table w-full min-w-[560px] text-left text-sm">
        <thead><tr><th className="w-[160px]" /><th className="text-right">Expected</th><th className="text-right">Reported</th><th className="text-right">Difference</th></tr></thead>
        <tbody>
          <tr>
            <td>{f.policyNumber ? <span className="font-mono">{f.policyNumber}</span> : "Carrier account"}</td>
            <td className="text-right tabular-nums">{dollars(f.expectedCents)}</td>
            <td className="text-right tabular-nums">{dollars(f.reportedCents)}</td>
            <td className="text-right font-semibold tabular-nums text-[var(--error-ink)]">{dollars(f.differenceCents)}</td>
          </tr>
          <tr><td className="text-muted-foreground">Tolerance</td><td colSpan={3} className="text-right tabular-nums text-muted-foreground">{dollars(f.toleranceCents)}</td></tr>
          {f.reportedLines.map((line) => (
            <tr key={line.id}>
              <td className="text-muted-foreground">{line.type.replaceAll("_", " ")}</td>
              <td colSpan={2} className="text-right">{line.rowNumber !== null ? <Link href={rowHref(line.fileId, line.rowNumber)} className="text-[var(--accent-ink)] hover:underline">{line.fileName ?? "File"} · row {line.rowNumber}</Link> : line.fileName ?? "—"}</td>
              <td className="text-right tabular-nums">{dollars(line.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Evidence>
  );

  // QA 2026-11-03: a drafted letter left the item with nothing to answer ("record what the carrier did" had no
  // place here). A disputed finding closes only through its letter (set_discrepancy_status refuses it), so the
  // answers are the letter's next step: how it went out, then what the carrier said. Refused reopens the item,
  // where "The client cancelled" is one of its answers. A partial credit is recorded on Money › Discrepancies.
  const letter = detail.letter;
  const drafted = letter?.status === "draft";
  const awaiting = letter?.status === "sent" || letter?.status === "acknowledged";
  const choices: Choice<MoneyChoice>[] = disputed ? (drafted ? [
    { key: "sent_email", label: "I sent it by email", hint: `marks the letter to ${f.carrierName} sent` },
    { key: "sent_portal", label: "I sent it through their portal", hint: `marks the letter to ${f.carrierName} sent` },
    { key: "sent_post", label: "I posted it", hint: `marks the letter to ${f.carrierName} sent` },
  ] : awaiting ? [
    { key: "carrier_paid", label: `${f.carrierName} paid it back in full`, hint: `${dollars(letter!.totalCents)} credited; closes the item`, children: <Reason id="money-paid-back" label="Anything to add (optional)" value={note} onChange={setNote} disabled={off} /> },
    { key: "carrier_refused", label: `${f.carrierName} says the chargeback is right`, hint: "the item opens again, to close as accepted or written off", children: <Reason id="money-refused" label="What they said (optional)" value={note} onChange={setNote} disabled={off} /> },
  ] : []) : [
    ...(detail.disputable ? [{ key: "letter" as const, label: `Draft a letter to ${f.carrierName}`, hint: "with the figures; you send it" }] : []),
    // QA 2026-11-03: the most common real answer to a chargeback on an "active" policy — the client cancelled.
    ...(acceptsChargeback(f.type) ? [{ key: "accept" as const, label: "The client cancelled — the chargeback is right", hint: "closes it as accepted; the policy file shows the lapse when it comes", children: <Reason id="money-accept" label="Anything to add (optional)" value={note} onChange={setNote} disabled={off} /> }] : []),
    { key: "rate", label: "The rate is wrong", hint: "opens Setup › Rate card" },
    { key: "paid", label: "It was paid outside the statement", hint: "marks it settled, with when and how", children: <Reason id="money-paid" label="When and how it was paid" value={note} onChange={setNote} required disabled={off} /> },
    { key: "write_off", label: "Write it off", hint: "with a reason", children: <Reason id="money-off" label="Why it is written off" value={note} onChange={setNote} required disabled={off} /> },
  ];
  const ready = choice === "letter" || choice === "rate" || choice === "accept" || choice === "sent_email" || choice === "sent_portal" || choice === "sent_post" || choice === "carrier_paid" || choice === "carrier_refused" || ((choice === "paid" || choice === "write_off") && note.trim() !== "");
  const save = (how: "save" | "next") => {
    if (choice === "rate") { router.push("/app/rate-card"); return; }
    if (letter && (choice === "sent_email" || choice === "sent_portal" || choice === "sent_post")) {
      void send(how, "/api/app/commission-discrepancies", "POST", { action: "mark_sent", dispute_id: letter.id, via: choice === "sent_email" ? "email" : choice === "sent_portal" ? "portal" : "post" }, "Letter marked sent.");
      return;
    }
    if (letter && (choice === "carrier_paid" || choice === "carrier_refused")) {
      void send(how, "/api/app/commission-discrepancies", "POST", { action: "record_outcome", dispute_id: letter.id, outcome: choice === "carrier_paid" ? "accepted" : "rejected", amount_cents: null, notes: note.trim() || null }, choice === "carrier_paid" ? "Recorded: paid back." : "Recorded: the carrier says it's right.");
      return;
    }
    if (choice === "letter") void send(how, "/api/app/commission-discrepancies", "POST", { action: "draft_dispute", ids: [f.id], recipient: null }, "Letter drafted.");
    // Its own resolution, "accepted" (20261103301000); before that migration the store closes it as dismissed with the same note.
    else if (choice === "accept") void send(how, "/api/app/commission-discrepancies", "POST", { action: "set_status", id: f.id, status: "accepted", note: chargebackAcceptedNote(note) }, "Chargeback accepted.");
    else if (choice) void send(how, "/api/app/commission-discrepancies", "POST", { action: "set_status", id: f.id, status: choice === "paid" ? "resolved" : "dismissed", note: note.trim() }, choice === "paid" ? "Marked settled." : "Written off.");
  };

  return (
    <>
      {evidence}
      <Grid>
        <ChoicesCard title="What do you want to do?">
          <ChoiceList name="money" label="What do you want to do?" choices={choices} value={choice} onChange={setChoice} disabled={off} />
        </ChoicesCard>
        <WhenYouSave>
          {choice === "letter" ? <>A letter to {f.carrierName} is drafted with {f.policyNumber ?? "this item"}, the expected {dollars(f.expectedCents)} and what was paid. You send it from Money › Discrepancies; the item stays open until you record what the carrier did.</>
            : choice === "accept" ? <>The item closes as accepted, with “{chargebackAcceptedNote(note)}” as its note, and stays closed while the files keep showing it. The chargeback stays in the ledger as it is. The policy is not marked lapsed here: the next policy file from {f.carrierName} says so.</>
            : choice === "rate" ? "Nothing is saved here. The rate card opens; once the rate is right, the next check works this item out again."
            : choice === "sent_email" || choice === "sent_portal" || choice === "sent_post" ? `The letter is marked sent today. The item waits for ${f.carrierName}'s answer, which you record here.`
            : choice === "carrier_paid" ? `The letter closes as accepted with ${dollars(letter?.totalCents ?? null)} credited, and the item is settled. The money itself arrives on ${f.carrierName}'s next statement.`
            : choice === "carrier_refused" ? "The letter closes as refused and the item opens again, so you can close it as accepted (the client cancelled) or write it off."
            : disputed && !drafted && !awaiting ? "This letter's outcome is recorded on Money › Discrepancies."
            : choice === "paid" ?"The item closes as settled, with your note. Nothing posts to the ledger: the money came outside the statement."
            : choice === "write_off" ? "The item closes as written off, with your reason. It is not chased, and nothing posts."
            : "Choose what to do about it."}
        </WhenYouSave>
      </Grid>
      {nav.readOnly ? <DecideButtons kind="money" nav={nav} busy={busy} ready={ready} onSave={save} />
        : choice === "rate" ? <div className="flex justify-end"><Button type="button" onClick={() => save("save")}>Open the rate card</Button></div>
        : <DecideButtons kind="money" nav={nav} busy={busy} ready={ready} onSave={save} />}
    </>
  );
}

// ─── Who gets the credit ─────────────────────────────────────────────────────────────────────────────────

function CreditDecide({ detail, nav }: { detail: Extract<ItemDetail, { kind: "credit" }>; nav: Nav }) {
  const { busy, send } = useDecision(nav);
  const suggested = [detail.writingNumber, detail.application].filter((p, i, all): p is NonNullable<typeof p> => Boolean(p) && all.findIndex((q) => q?.userId === p!.userId) === i);
  const [choice, setChoice] = useState<string | null>(suggested.length === 1 ? suggested[0].userId : null);
  const [other, setOther] = useState("");
  const [reason, setReason] = useState("");
  const off = nav.readOnly || busy !== null;
  const producerId = choice === "other" ? other : choice;
  const producerName = detail.producers.find((p) => p.userId === producerId)?.name ?? suggested.find((p) => p.userId === producerId)?.name ?? null;

  const choices: Choice<string>[] = [
    ...suggested.map((p) => ({ key: p.userId, label: p.name, hint: [p.userId === detail.writingNumber?.userId && "named by the writing number", p.userId === detail.application?.userId && "submitted the application"].filter(Boolean).join(" · ") })),
    {
      key: "other", label: "Someone else", hint: "any producer in the agency",
      children: <SelectMenu label="Producer" value={other} onChange={setOther} disabled={off} className="w-full max-w-md" panelAlign="start" options={[{ value: "", label: "Choose a producer" }, ...detail.producers.map((p) => ({ value: p.userId, label: p.name }))]} />,
    },
  ];

  return (
    <>
      <Facts title="The statement row" facts={[
        ["Policy", detail.policyNumber ? <span key="p" className="font-mono">{detail.policyNumber}</span> : "No policy number"],
        ["Carrier", detail.carrierName ?? "—"],
        // AG-1.12: a producer money figure carries its basis (the carrier reported it); was the Attribution queue's.
        ["Amount", <span key="a" className="inline-flex items-center gap-2">{dollars(detail.amountCents)} <BasisChip basis="reported" /></span>],
        ["Writing number", detail.agentCode ? `${detail.agentCode}${detail.writingNumber ? ` → ${detail.writingNumber.name}` : " — not mapped"}` : "None on the row"],
        ["Submitted by", detail.application?.name ?? "No application"],
      ]} />
      <Grid>
        <ChoicesCard title="Who gets the credit?">
          <div className="flex flex-col gap-4">
            <ChoiceList name="credit" label="Who gets the credit?" choices={choices} value={choice} onChange={setChoice} disabled={off} />
            <Reason id="credit-reason" label="Why (kept with the decision)" value={reason} onChange={setReason} required disabled={off} />
          </div>
        </ChoicesCard>
        <WhenYouSave>
          {producerName ? <>This {dollars(detail.amountCents)} row counts for <strong>{producerName}</strong>: it posts to their ledger and shows in their totals, with your reason.</> : "Choose who gets the credit."}
        </WhenYouSave>
      </Grid>
      <DecideButtons kind="credit" nav={nav} busy={busy} ready={Boolean(producerId) && reason.trim() !== ""} onSave={(how) => void send(how, "/api/app/agency/attribution", "POST", { itemId: detail.id, producerUserId: producerId, reason: reason.trim() }, "Credit given.")} />
    </>
  );
}

// ─── Who's the agent ─────────────────────────────────────────────────────────────────────────────────────

function AgentDecide({ detail, nav }: { detail: Extract<ItemDetail, { kind: "agent" }>; nav: Nav }) {
  const { busy, send } = useDecision(nav);
  const [userId, setUserId] = useState("");
  const off = nav.readOnly || busy !== null;
  const name = detail.members.find((m) => m.userId === userId)?.name ?? null;
  return (
    <>
      <Facts title="The code" facts={[["Agent code", <span key="c" className="font-mono">{detail.code}</span>], ["Carrier", detail.carrierName], ["Policies with it", detail.policies.toLocaleString("en-US")]]} />
      <Grid>
        <ChoicesCard title="Whose code is it?">
          {detail.members.length === 0 ? <p className="m-0 text-sm text-muted-foreground">No owner or producer has joined the agency yet.</p>
            : <SelectMenu label="Agent" value={userId} onChange={setUserId} disabled={off} className="w-full max-w-md" panelAlign="start" options={[{ value: "", label: "Choose the agent" }, ...detail.members.map((m) => ({ value: m.userId, label: m.name }))]} />}
        </ChoicesCard>
        <WhenYouSave>
          {name ? <>Code {detail.code} at {detail.carrierName} belongs to <strong>{name}</strong>: its {detail.policies.toLocaleString("en-US")} {detail.policies === 1 ? "policy credits" : "policies credit"} them now, and so does every policy a later file lists under it.</> : "Choose the agent this code belongs to."}
        </WhenYouSave>
      </Grid>
      <DecideButtons kind="agent" nav={nav} busy={busy} ready={Boolean(userId)} onSave={(how) => void send(how, "/api/app/policy-matching", "POST", { action: "map_agent", carrier_id: detail.carrierId, agent_identifier: detail.code, user_id: userId }, "Agent code mapped.")} />
    </>
  );
}

// ─── Status word (Insurvas maps it) ──────────────────────────────────────────────────────────────────────

function StatusWordDecide({ detail, nav }: { detail: Extract<ItemDetail, { kind: "status-word" }>; nav: Nav }) {
  return (
    <>
      <Facts title="The word" facts={[["Word", <span key="w" className="font-mono">{detail.word}</span>], ["Carrier", detail.carrierName], ["File type", detail.fileType === "commissions" ? "Commissions" : "Policies"], ["Rows held", detail.rows.toLocaleString("en-US")]]} />
      {/* Round 3: "Waiting on Insurvas" is the muted line under the item page title (waitsLine), not a card. */}
      <NextOnly nav={nav} />
    </>
  );
}

// ─── Two rules disagree ──────────────────────────────────────────────────────────────────────────────────

function RulesDecide({ detail, nav }: { detail: Extract<ItemDetail, { kind: "rules" }>; nav: Nav }) {
  const { busy, send } = useDecision(nav);
  const [choice, setChoice] = useState<string | null>(null);
  const off = nav.readOnly || busy !== null;
  const picked = detail.options.find((o) => o.ruleId === choice) ?? null;
  const choices: Choice<string>[] = [
    ...detail.options.map((o) => ({ key: o.ruleId, label: `${o.ruleName} → ${o.stage}`, hint: `rule version ${o.version}` })),
    { key: "neither", label: "Neither: leave the card where it is", hint: "no rule moves it for this change" },
  ];
  return (
    <>
      <Facts title="The policy" facts={[["Client", detail.leadName ?? "—"], ["Policy", <span key="p" className="font-mono">{detail.policyNumber}</span>], ["Carrier", detail.carrierName], ["Rules that want to move it", detail.options.length.toLocaleString("en-US")]]} />
      <Grid>
        <ChoicesCard title="Which rule wins?">
          <ChoiceList name="rules" label="Which rule wins?" choices={choices} value={choice} onChange={setChoice} disabled={off} />
        </ChoicesCard>
        <WhenYouSave>
          {picked ? <>{detail.leadName ?? "The client"}’s card moves to <strong>{picked.stage}</strong>, as “{picked.ruleName}” says, with its note. The other rule leaves it alone for this change.</>
            : choice === "neither" ? "The card stays where it is, and neither rule moves it for this change."
            : "Choose which rule moves the card, or neither."}
        </WhenYouSave>
      </Grid>
      <DecideButtons kind="rules" nav={nav} busy={busy} ready={choice !== null} onSave={(how) => void send(how, "/api/app/pipeline-rules", "POST", { action: "resolve_hold", hold_id: detail.holdId, rule_id: picked ? picked.ruleId : null }, picked ? "Card moved." : "Left where it is.")} />
    </>
  );
}

// ─── File didn't read (LA-4.9 file_failed) ───────────────────────────────────────────────────────────────

function FileDecide({ detail, nav }: { detail: Extract<ItemDetail, { kind: "file" }>; nav: Nav }) {
  return (
    <>
      <Facts title="The file" facts={[["File", detail.fileName], ["Carrier", detail.carrierName], ["Type", detail.fileType === "commissions" ? "Commissions" : "Policies"], ["File of", detail.fileDate ? fileDay(detail.fileDate) : "—"], ["Why", detail.reason]]} />
      {/* Nothing to save here. One way on: the file page holds the balance check, Read again, and in More "Replace with
          a corrected file", preset to this file's carrier, type and day so the copy supersedes it. */}
      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild size={nav.inline ? "sm" : "default"}><Link href={`/app/carrier-files/file/${detail.fileId}`}>Open the file</Link></Button>
      </div>
      <NextOnly nav={nav} />
    </>
  );
}

// ─── Paid on a policy we don't have (QA 2026-11-03) ──────────────────────────────────────────────────────

type UnknownChoice = "wait" | "another_writing_number" | "raised_with_carrier" | "not_mine";

/**
 * Commission lines on a policy no policy file has, past ORPHAN_NOTICE_DAYS. Waiting saves nothing (the policy
 * file usually follows); the other answers are the orphan queue's own, saved by raising its item now
 * (POST /api/app/needs-you/item, answer_unknown_policy).
 */
function UnknownPolicyDecide({ detail, nav }: { detail: Extract<ItemDetail, { kind: "unknown-policy" }>; nav: Nav }) {
  const { busy, send } = useDecision(nav);
  const [choice, setChoice] = useState<UnknownChoice | null>(null);
  const [note, setNote] = useState("");
  const off = nav.readOnly || busy !== null;
  const choices: Choice<UnknownChoice>[] = [
    { key: "wait", label: "Wait for the policy file", hint: "nothing is saved; it stays here until the policy arrives" },
    { key: "another_writing_number", label: RESOLUTION_LABELS.another_writing_number, hint: QUEUE_HINTS.another_writing_number, children: <Reason id="unknown-number" label="Which writing number, if you know it" value={note} onChange={setNote} disabled={off} /> },
    { key: "raised_with_carrier", label: RESOLUTION_LABELS.raised_with_carrier, hint: QUEUE_HINTS.raised_with_carrier, children: <Reason id="unknown-asked" label="What you asked the carrier" value={note} onChange={setNote} required disabled={off} /> },
    { key: "not_mine", label: "Not ours: hand it on", hint: QUEUE_HINTS.not_mine },
  ];
  const ready = choice !== null && choice !== "wait" && (choice !== "raised_with_carrier" || note.trim() !== "");
  const facts: Array<[string, ReactNode]> = [
    ["Policy number", <span key="p" className="font-mono">{detail.policyNumber}</span>],
    ["Carrier", detail.carrierName],
    ["Paid", dollars(detail.amountCents)],
    ...(detail.heldCents ? [["Held", dollars(detail.heldCents)] as [string, ReactNode]] : []),
    ["Lines", detail.lines.length.toLocaleString("en-US")],
    ["First paid", fileDay(detail.firstSeen)],
    ["Agent code", [...new Set(detail.lines.map((l) => l.agentCode).filter(Boolean))].join(", ") || "—"],
  ];

  return (
    <>
      <Facts title="What the commission files say" facts={facts} />
      <Evidence title="The lines" description="Each line stays in the ledger as it is, whatever you answer.">
        <table className="portal-lead-table w-full min-w-[560px] text-left text-sm">
          <thead><tr><th>Line</th><th>From</th><th className="w-[110px]">Paid on</th><th className="w-[120px] text-right">Amount</th></tr></thead>
          <tbody>
            {detail.lines.map((line) => (
              <tr key={line.id}>
                <td className="capitalize">{line.type.replaceAll("_", " ")}</td>
                <td>{line.rowNumber !== null ? <Link href={rowHref(line.fileId, line.rowNumber)} className="text-[var(--accent-ink)] hover:underline">{line.fileName} · row {line.rowNumber}</Link> : line.fileName}</td>
                <td className="tabular-nums">{fileDay(line.seenOn)}</td>
                <td className="text-right tabular-nums">{dollars(line.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Evidence>
      <Grid>
        <ChoicesCard title="What do you want to do?">
          <ChoiceList name="unknown-policy" label="What do you want to do?" choices={choices} value={choice} onChange={setChoice} disabled={off} />
        </ChoicesCard>
        <WhenYouSave>
          {choice === "wait" ? "Nothing is saved. The item stays in Needs you until a policy file lists this number; then its lines join the policy by themselves."
            : choice === "not_mine" ? QUEUE_EFFECT.not_mine
            : choice ? QUEUE_EFFECT[choice]
            : "Choose what to do about it."}
        </WhenYouSave>
      </Grid>
      {choice === "wait" ? <NextOnly nav={nav} />
        : <DecideButtons kind="unknown-policy" nav={nav} busy={busy} ready={ready} onSave={(how) => { if (choice) void send(how, "/api/app/needs-you/item", "POST", { action: "answer_unknown_policy", id: unknownPolicyItemId(detail.carrierId, detail.policyNumber), answer: choice, note: note.trim() || null }, choice === "not_mine" ? "Handed on." : "Saved."); }} />}
    </>
  );
}

/** The Decide tab of a Needs you item: the evidence, the choices its own API accepts, and what saving does. */
export function ItemDecide({ detail, nextHref, listHref, readOnly, inline }: { detail: ItemDetail; nextHref: string | null; listHref: string; readOnly: boolean; inline?: InlineNav }) {
  const nav: Nav = { nextHref, listHref, readOnly, inline };
  return <Flat.Provider value={Boolean(inline)}><DecideBody detail={detail} nav={nav} /></Flat.Provider>;
}

function DecideBody({ detail, nav }: { detail: ItemDetail; nav: Nav }) {
  switch (detail.kind) {
    case "pick-client": return <PickClient detail={detail} nav={nav} />;
    case "money": return <MoneyDecide detail={detail} nav={nav} />;
    case "credit": return <CreditDecide detail={detail} nav={nav} />;
    case "agent": return <AgentDecide detail={detail} nav={nav} />;
    case "status-word": return <StatusWordDecide detail={detail} nav={nav} />;
    case "rules": return <RulesDecide detail={detail} nav={nav} />;
    case "file": return <FileDecide detail={detail} nav={nav} />;
    case "unknown-policy": return <UnknownPolicyDecide detail={detail} nav={nav} />;
    default: return <QueueDecide kind={detail.kind} queue={detail.queue} nav={nav} />;
  }
}
