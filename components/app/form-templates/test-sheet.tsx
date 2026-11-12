"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { st } from "@/components/app/settings/primitives";
import type { Pipeline } from "@/lib/pipelines/types";
import type { TemplateField, TemplateFormDefinition } from "@/lib/templates/constants";
import { applicationFieldsFor } from "@/lib/templates/applicationMatch";
import { effectiveTemplateForm } from "@/lib/templates/sectionAvailability";
import { templateFormFieldVisible } from "@/lib/templates/visibility";
import { FormRun } from "@/components/app/form-templates/form-run";
import { FormStatusLine, NeedsUpdate } from "@/components/app/form-templates/status-line";

type Outcome = { ok: boolean; problems: Array<{ field_key: string; message: string }>; intake: string | null; values: Record<string, unknown> };

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** A plausible answer per kind, so a test can be sent in one click. */
function sample(field: TemplateField): unknown {
  const v = field.validation ?? {};
  switch (field.type) {
    case "date": { const age = Math.max(v.age_min ?? 18, Math.min(v.age_max ?? 67, 67)); const year = new Date().getUTCFullYear() - age - 1; return `${year}-06-02`; }
    case "number": return v.min ?? 1;
    case "currency": return Math.max(v.min ?? 15000, Math.min(v.max ?? 15000, 15000));
    case "boolean": return "false";
    case "single_select": return field.options[0] ?? "";
    case "multi_select": return field.options.slice(0, 1);
    case "phone": return "(214) 555-0142";
    case "email": return "test.person@example.com";
    case "ssn": return "";
    case "bank_routing": return "";
    case "bank_account": return "";
    case "long_text": return "A test submission from Settings.";
    default: return /first/.test(field.field_key) ? "Test" : /last/.test(field.field_key) ? "Person" : /zip/.test(field.field_key) ? "75201" : /state/.test(field.field_key) ? "TX" : "Test";
  }
}

const shown = (field: TemplateField | undefined, value: unknown) => {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) return "—";
  if (field?.type === "boolean") return String(value) === "true" ? "Yes" : "No";
  if (field?.type === "currency" && typeof value === "number") return "$" + value.toLocaleString("en-US");
  if (field?.type === "ssn" || field?.type === "bank_account" || field?.type === "bank_routing") return "•••• " + String(value).slice(-4);
  return Array.isArray(value) ? value.join(", ") : String(value);
};

/**
 * Test submission (board A6). The draft's answers go through the checks a sent form meets, and the
 * sheet shows where each answer lands: the lead field, the application field, the stage it starts in.
 * Nothing is written and nobody is told; a real, tagged test lead waits on the database update.
 */
export function TestSheet({ copyId, fields, form, title, initial, testLeads, hasWebhook, onClose }: {
  copyId: string;
  fields: TemplateField[];
  form: TemplateFormDefinition;
  title: string;
  /** Answers typed in the preview, if any. */
  initial: Record<string, unknown>;
  testLeads: boolean;
  hasWebhook: boolean | null;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const byKey = new Map(fields.map((field) => [field.field_key, field]));

  useEffect(() => {
    let live = true;
    fetch("/api/app/pipelines", { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => null);
      const pipelines = (body?.pipelines ?? []) as Pipeline[];
      const pipeline = pipelines.find((item) => item.is_default) ?? pipelines[0];
      const first = pipeline?.stages.filter((item) => !item.is_archived).sort((a, b) => a.position - b.position)[0];
      if (live) setStage(first ? `${first.name}${pipeline.name ? ` · ${pipeline.name}` : ""}` : "Your first open step");
    }, () => { if (live) setStage("Your first open step"); });
    return () => { live = false; };
  }, []);

  async function send(answers: Record<string, unknown>) {
    setBusy(true);
    const response = await fetch(`/api/app/templates/${copyId}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields, form_definition: form, values: answers }) }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setBusy(false);
    setSentAt(Date.now());
    setOutcome(response?.ok ? (body as Outcome) : { ok: false, problems: [], intake: body?.error ?? "The test didn’t run. Try again.", values: answers });
  }
  function fillSample() {
    const effective = effectiveTemplateForm(form, fields);
    const next: Record<string, unknown> = { ...values };
    for (let pass = 0; pass < 3; pass += 1)
      for (const section of effective.sections) for (const placed of section.fields) {
        const field = byKey.get(placed.field_key);
        if (field && next[field.field_key] === undefined && templateFormFieldVisible(placed, next)) { const answer = sample(field); if (answer !== "") next[field.field_key] = answer; }
      }
    setValues(next);
  }

  const name = outcome ? [outcome.values.first_name, outcome.values.last_name].filter(Boolean).join(" ") || String(outcome.values.full_name ?? outcome.values.name ?? "Test person") : "";
  const answered = outcome ? effectiveTemplateForm(form, fields).sections.flatMap((section) => section.fields).filter((placed) => byKey.has(placed.field_key) && templateFormFieldVisible(placed, outcome.values) && outcome.values[placed.field_key] !== undefined) : [];
  const onApplication = answered.filter((placed) => applicationFieldsFor(placed.field_key).length > 0).length;

  return (
    <Sheet
      title={outcome ? (outcome.ok ? "Test submission · it worked" : "Test submission · needs fixing") : "Test submission"}
      status={outcome ? <StatusChip tone={outcome.ok ? "good" : "danger"}>{outcome.ok ? "Passed every check" : "Would be refused"}</StatusChip> : !testLeads ? <NeedsUpdate /> : undefined}
      onClose={onClose}
      className="lg:w-[720px]"
      footer={outcome ? (
        <><span className="flex-1" /><Button type="button" variant="outline" onClick={() => setOutcome(null)}>Change the answers</Button><Button type="button" disabled={busy} onClick={() => void send(values)}>Send another</Button></>
      ) : (
        <><Button type="button" variant="ghost" onClick={fillSample}>Fill with sample answers</Button><span className="flex-1" /><Button type="button" disabled={busy} onClick={() => void send(values)}>{busy ? "Checking…" : "Send as a test"}</Button></>
      )}
    >
      {outcome ? (
        <div className="flex flex-col gap-4">
          <FormStatusLine tone={outcome.ok ? "good" : "danger"}>
            {sentAt ? `Test checked at ${clock.format(sentAt)} · ` : ""}not counted in results, nobody was notified. {testLeads ? "Making a tagged test lead from here is the next part of this build" : "A real, tagged test lead comes with the database update"}
          </FormStatusLine>
          <dl className="m-0 grid grid-cols-2 gap-3 rounded-[12px] border border-[var(--border)] p-3 sm:grid-cols-4">
            <div><dt className="text-xs text-[var(--muted)]">Test lead</dt><dd className="m-0 truncate text-base font-semibold text-[var(--ink)]">{name}</dd></div>
            <div><dt className="text-xs text-[var(--muted)]">Pipeline stage</dt><dd className="m-0 truncate text-base font-semibold text-[var(--ink)]">{stage ?? "…"}</dd></div>
            <div><dt className="text-xs text-[var(--muted)]">Lead made</dt><dd className="m-0 text-base font-semibold text-[var(--ink)]">No · checks only</dd></div>
            <div><dt className="text-xs text-[var(--muted)]">Webhook</dt><dd className="m-0 text-base font-semibold text-[var(--ink)]">{hasWebhook === null ? "—" : hasWebhook ? "Would be sent" : "None set"}</dd></div>
          </dl>
          {!outcome.ok && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {outcome.problems.map((problem) => <li key={problem.field_key} className="text-sm text-[var(--error-ink)]">{problem.message}</li>)}
              {outcome.intake && <li className="text-sm text-[var(--error-ink)]">{outcome.intake}</li>}
            </ul>
          )}
          <TableCard title="Where each answer landed" description={`${answered.length} answers · ${answered.length} on the lead, ${onApplication} on the application`}>
            <table className={st.table}>
              <thead className={st.headRow}><tr><th className={st.th}>Question</th><th className={st.th}>Answer</th><th className={st.th}>Lead field</th><th className={st.th}>Application field</th></tr></thead>
              <tbody>
                {answered.map((placed) => {
                  const field = byKey.get(placed.field_key);
                  const lands = applicationFieldsFor(placed.field_key);
                  return (
                    <tr key={placed.field_key}>
                      <td className={st.td}><span className="block max-w-[200px] truncate">{field?.label}</span></td>
                      <td className={st.td}><span className="block max-w-[180px] truncate">{shown(field, outcome.values[placed.field_key])}</span></td>
                      <td className={st.td}><span className="block max-w-[160px] truncate">{field?.label}</span></td>
                      <td className={st.td}>{lands.length ? lands.join(", ") : <StatusChip tone="warning">No match</StatusChip>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableCard>
          <p className="m-0 text-xs text-[var(--muted)]">“No match” means the carrier application has no field with that name. It still lives on the lead. Map it in Application field sets if a carrier needs it.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <FormStatusLine tone="neutral">Fill the draft in as a partner would, then send it as a test. Nothing is saved or sent anywhere.</FormStatusLine>
          <FormRun fields={fields} form={form} title={title} mode="computer" values={values} onValues={setValues} onSend={(answers) => void send(answers)} sendLabel="Send as a test" />
        </div>
      )}
    </Sheet>
  );
}
