"use client";

/**
 * Disclosures step (LA-3.10; board l3-ws-disclosures). Each disclosure the answers brought up, why
 * it applies, its text to read, and how it was given. A required one blocks `ready` until it is
 * acknowledged — the method (read aloud / emailed / mailed), who and when are recorded by the
 * server — or marked not applicable with a written reason. A recorded acknowledgement is never
 * undone, and it keeps the version it was given at.
 */

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Field, control } from "@/components/app/settings/primitives";
import { CANONICAL_GROUPS } from "@/lib/applications/constants";
import { applicableDisclosures, type DisclosureClause } from "@/lib/applications/disclosureRules";
import type { AttemptView, DisclosureView, InterviewView } from "@/lib/applications/types";
import { parseLegalMarkdown } from "@/lib/legal/markdown";
import { cn } from "@/lib/utils";

import { dateTime } from "@/components/app/applications/parts";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { StepCard } from "@/components/app/applications/workspace/step-card";

type Method = NonNullable<DisclosureView["method"]>;
const METHOD_BUTTON: Record<Method, string> = { read_aloud: "Read aloud", emailed: "Email it", mailed: "Mail it" };
const METHOD_PAST: Record<Method, string> = { read_aloud: "read aloud", emailed: "email", mailed: "mail" };
const STATUS: Record<DisclosureView["status"], { label: string; tone: StatusTone }> = {
  required: { label: "Required", tone: "danger" },
  acknowledged: { label: "Acknowledged", tone: "good" },
  not_applicable: { label: "Not applicable", tone: "neutral" },
};
const FIELD_LABEL = new Map(CANONICAL_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.label] as const)));
const OP_WORD: Record<DisclosureClause["op"], string> = { eq: "was", neq: "was not", in: "was one of", not_in: "was none of", gt: "was over", lt: "was under" };

type Trigger = { disclosureId: string; states: string[]; carrierIds: string[]; rules: DisclosureClause[][] };

const when = (iso: string | null, timeZone?: string) => (iso ? dateTime(iso, timeZone) : "");

/** **bold** inside a line of disclosure text; everything else stays literal. */
function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i} className="font-semibold text-[var(--ink)]">{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>))}</>;
}

/**
 * The disclosure's text as it is read to the client: the library stores it as a small markdown
 * subset (hard-wrapped paragraphs, "- " bullets, **bold**), parsed into structure, never into HTML.
 */
function DisclosureBody({ id, text }: { id: string; text: string }) {
  return (
    <div id={id} className="flex max-w-[72ch] flex-col gap-2.5 text-sm leading-[1.6] text-[var(--body)]">
      {parseLegalMarkdown(text).map((b, i) => b.kind === "list" ? (
        <ul key={i} className="list-disc space-y-1 pl-5">{b.items.map((item, j) => <li key={j}><Inline text={item} /></li>)}</ul>
      ) : b.kind === "heading" ? (
        <p key={i} className="font-semibold text-[var(--ink)]"><Inline text={b.text} /></p>
      ) : (
        <p key={i}><Inline text={b.text} /></p>
      ))}
    </div>
  );
}

function valueWords(v: unknown): string {
  if (v === true || v === "true" || v === "yes") return "Yes";
  if (v === false || v === "false" || v === "no") return "No";
  if (Array.isArray(v)) return v.map(valueWords).join(", ");
  return v === null || v === undefined ? "blank" : String(v);
}

/** "Required because “Do you have coverage in force?” was Yes, in AZ." — from the rule that holds now. */
function triggerSentence(trigger: Trigger | undefined, attempt: AttemptView, interview: InterviewView | null): string | null {
  if (!trigger) return null;
  const values = Object.fromEntries(Object.entries(attempt.values).map(([k, f]) => [k, f.value]));
  const answers = Object.fromEntries(Object.entries(interview?.answers ?? {}).map(([k, a]) => [k, a?.value]));
  const state = typeof values["addr.state"] === "string" ? (values["addr.state"] as string) : null;
  const scope = new Map([[trigger.disclosureId, { states: trigger.states, carrierIds: trigger.carrierIds }]]);
  const holding = trigger.rules.find((clauses) => applicableDisclosures({ rules: [{ disclosureId: trigger.disclosureId, clauses }], scopes: scope, values, answers, state, carrierId: attempt.carrierId }).size > 0);
  const where = trigger.states.length && state ? ` in ${state}` : "";
  if (!holding) return trigger.states.length && state ? `Required for applications in ${state}.` : null;
  const parts = holding.map((c) => {
    const label = c.field.startsWith("health.")
      ? interview?.questions.find((q) => q.key === c.field.slice(7))?.label ?? c.field.slice(7).replaceAll("_", " ")
      : FIELD_LABEL.get(c.field) ?? c.field;
    return `“${label}” ${OP_WORD[c.op]} ${valueWords(c.value)}`;
  });
  return `Required because ${parts.join(" and ")}${where}.`;
}

function DisclosureRow({ d, reason, readOnly, sample, onChange }: { d: DisclosureView; reason: string | null; readOnly: boolean; sample: boolean; onChange: (patch: Partial<DisclosureView>) => void }) {
  const { actions, timeZone } = useWorkspace();
  const [naOpen, setNaOpen] = useState(false);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = STATUS[d.status];
  const by = d.acknowledgedBy ? ` · ${d.acknowledgedBy}` : "";

  /** An acknowledgement is a compliance record: the server writes who, when and how, then the case is re-read. */
  async function resolve(input: { status: "acknowledged" | "not_applicable"; method: Method | null; note: string | null }) {
    setBusy(true);
    try {
      if (!(await actions.resolveDisclosure(d.id, input))) return;
      if (sample) onChange({ ...input, acknowledgedAt: new Date().toISOString(), acknowledgedBy: "You" });
      setNaOpen(false);
      notify.done(input.status === "acknowledged" ? `${d.title} acknowledged` : `${d.title} marked not applicable`, { detail: input.status === "acknowledged" && input.method ? `Recorded as given by ${METHOD_PAST[input.method]}.` : undefined });
    } finally {
      setBusy(false);
    }
  }

  function notApplicable() {
    if (!note.trim()) { setNoteError("Say why it doesn't apply — it is recorded."); return; }
    void resolve({ status: "not_applicable", method: null, note: note.trim() });
  }

  return (
    <div id={`disclosure.${d.code}`} tabIndex={-1} className="m-row flex flex-col gap-3 border-t border-[var(--border)] px-[22px] py-4 outline-none first:border-t-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-[var(--ink)]">{d.title}</h3>
          {d.status === "not_applicable" && d.note ? (
            <span className="text-xs text-[var(--muted)]">“{d.note}”</span>
          ) : reason ? (
            <span className="text-xs text-[var(--muted)]">{reason}</span>
          ) : null}
          {d.status === "acknowledged" && (
            <span className="text-xs text-[var(--muted)]">Acknowledged by {d.method ? METHOD_PAST[d.method] : "the agent"} · {when(d.acknowledgedAt, timeZone)}{by} · version {d.version}</span>
          )}
          {d.status === "not_applicable" && (
            <span className="text-xs text-[var(--muted)]">Marked not applicable · {when(d.acknowledgedAt, timeZone)}{by} · version {d.version}</span>
          )}
        </div>
        <StatusChip tone={status.tone}>{status.label}</StatusChip>
      </div>

      {d.status === "required" && d.body && (
        <DisclosureBody id={`disclosure.${d.code}.body`} text={d.body} />
      )}

      {!readOnly && d.status === "required" && !naOpen && (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(METHOD_BUTTON) as Method[]).map((m) => (
            <Button key={m} type="button" variant="outline" onClick={() => { void resolve({ status: "acknowledged", method: m, note: null }); }} disabled={busy} title={busy ? "Recording…" : `Record that it was given by ${METHOD_PAST[m]}`}>
              {METHOD_BUTTON[m]}
            </Button>
          ))}
          <Button type="button" variant="ghost" onClick={() => { setNote(""); setNoteError(null); setNaOpen(true); }} disabled={busy} title={busy ? "Recording…" : undefined}>Not applicable…</Button>
        </div>
      )}

      {!readOnly && d.status === "required" && naOpen && (
        <div className="flex flex-col gap-2">
          <Field label="Why doesn't it apply?" htmlFor={`disclosure.${d.code}.reason`} required error={noteError}>
            <textarea
              id={`disclosure.${d.code}.reason`}
              rows={2}
              className={cn(control, "h-auto py-2")}
              value={note}
              onChange={(e) => { setNote(e.target.value); if (noteError) setNoteError(null); }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setNaOpen(false)} disabled={busy} title={busy ? "Recording…" : undefined}>Cancel</Button>
            <Button type="button" onClick={notApplicable} disabled={busy} title={busy ? "Recording…" : undefined}>{busy ? "Recording…" : "Mark not applicable"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DisclosuresStepFor() {
  const { attempt, interview, readOnly, sample, updateAttempt, goTo, actions } = useWorkspace();
  const list = attempt.disclosures;
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const change = (id: string, patch: Partial<DisclosureView>) => updateAttempt({ disclosures: list.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const open = list.filter((d) => d.status === "required");
  const idsKey = list.map((d) => d.id).join(",");

  // An answer given on the interview adds its disclosure on the server; read the case again so it
  // is here without a page reload.
  useEffect(() => {
    if (!sample && !readOnly) void actions.refresh();
    // Once per visit to the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sample || !idsKey) return;
    let live = true;
    void fetch(`/api/app/applications/attempts/${attempt.id}/disclosure-triggers`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { triggers?: Trigger[] }).triggers ?? [] : []))
      .catch(() => [])
      .then((t) => { if (live) setTriggers(t); });
    return () => { live = false; };
  }, [sample, attempt.id, idsKey]);

  const chip = list.length === 0
    ? <StatusChip tone="neutral">None apply</StatusChip>
    : open.length
      ? <StatusChip tone="danger">{open.length} required, not acknowledged</StatusChip>
      : <StatusChip tone="good">All acknowledged</StatusChip>;

  return (
    <StepCard
      title="Disclosures"
      chips={chip}
      bodyClassName="gap-0 p-0"
      actions={<>
        <Button type="button" variant="outline" onClick={() => goTo("payment")}><ArrowLeft aria-hidden="true" />Back to Payment</Button>
        <Button type="button" onClick={() => goTo("review")} disabled={!readOnly && open.length > 0} title={!readOnly && open.length > 0 ? `Acknowledge ${open.map((d) => d.title).join(", ")} first, or mark it not applicable` : undefined}>
          Continue to Review<ArrowRight aria-hidden="true" />
        </Button>
      </>}
    >
      {list.length === 0 ? (
        <EmptyState title="No disclosures apply" hint="Answering yes to existing coverage adds the replacement notice." />
      ) : (
        <div className="flex flex-col">
          {list.map((d) => (
            <DisclosureRow
              key={d.id}
              d={d}
              reason={triggerSentence(triggers.find((t) => t.disclosureId === d.id), attempt, interview)}
              readOnly={readOnly}
              sample={sample}
              onChange={(p) => change(d.id, p)}
            />
          ))}
        </div>
      )}
    </StepCard>
  );
}

export function DisclosuresStep() {
  const { attempt } = useWorkspace();
  return <DisclosuresStepFor key={attempt.id} />;
}
