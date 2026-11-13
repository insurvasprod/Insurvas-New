"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { TableCard } from "@/components/ui/table-card";
import { SectionLoading } from "@/components/ui/page-states";
import { Field, control, st } from "@/components/app/settings/primitives";
import { notify } from "@/lib/notify";
import { FormStatusLine, NeedsUpdate } from "@/components/app/form-templates/status-line";

type Hook = { id: string; target_url: string; status: string; events: string[]; last_success_at: string | null; last_failure_at: string | null };
type Delivery = { id: string; attempted_at: string; status_code: number | null; ok: boolean; duration_ms: number | null; attempt: number; event_type: string };
type State = { kind: "loading" } | { kind: "pending" } | { kind: "failed"; message: string } | { kind: "ready"; hook: Hook | null; deliveries: Delivery[] };

const when = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const EVENTS = [{ key: "form.submitted", label: "A form is sent" }, { key: "form.test", label: "A test is sent" }] as const;
const SAMPLE = `{ "type": "form.submitted", "data": { "lead_id": "…", "form": "…", "version": 8,
  "source": "partner", "answers": { "first_name": "…", "date_of_birth": "…", "tobacco_use": "true", … } } }`;

/**
 * Form settings › When a form is sent (board A8): a signed POST to the agency's own system each time
 * this form makes a lead, on the same queue as Settings › API keys & webhooks (signed, retried, logged).
 * It saves on its own, apart from the form's draft. Needs 20261112200000.
 */
export function FormWebhook({ copyId, available }: { copyId: string; available: boolean }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["form.submitted"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!available) { setState({ kind: "pending" }); return; }
    const response = await fetch(`/api/app/templates/${copyId}/webhook`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    if (response?.status === 503 || body?.code === "schema_pending") { setState({ kind: "pending" }); return; }
    if (!response?.ok) { setState({ kind: "failed", message: body?.error ?? "The webhook didn’t load." }); return; }
    setState({ kind: "ready", hook: body.hook, deliveries: body.deliveries ?? [] });
    if (body.hook) { setUrl(body.hook.target_url); setEvents(body.hook.events?.length ? body.hook.events : ["form.submitted"]); }
  }, [copyId, available]);
  // Loading external state into the card.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function call(method: "PUT" | "POST" | "DELETE") {
    setBusy(true);
    const response = await fetch(`/api/app/templates/${copyId}/webhook`, { method, headers: { "Content-Type": "application/json" }, body: method === "PUT" ? JSON.stringify({ target_url: url, events }) : undefined }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setBusy(false);
    if (!response?.ok) { notify.block(body?.error ?? "That didn’t work"); return; }
    if (method === "PUT") { if (body.secret) setSecret(body.secret); notify.done("Webhook saved"); }
    if (method === "POST") notify.done("Test sent", { detail: "It shows under Recent deliveries once your system answers." });
    if (method === "DELETE") { setUrl(""); setSecret(null); notify.done("Webhook removed"); }
    await load();
  }

  const disabled = !available || state.kind !== "ready";
  const hook = state.kind === "ready" ? state.hook : null;
  return (
    <div className="flex flex-col gap-4">
      {state.kind === "pending" && <FormStatusLine tone="warning" action={<NeedsUpdate />}>A webhook per form saves once Insurvas applies its database update.</FormStatusLine>}
      {state.kind === "failed" && <FormStatusLine tone="danger" action={<Button type="button" variant="ghost" size="sm" onClick={() => void load()}>Try again</Button>}>{state.message}</FormStatusLine>}
      {state.kind === "ready" && hook && <FormStatusLine tone={hook.last_failure_at && (!hook.last_success_at || hook.last_failure_at > hook.last_success_at) ? "warning" : "good"}>{hook.last_success_at ? `Working · last delivery ${when.format(new Date(hook.last_success_at))}` : "Saved · nothing sent yet"}</FormStatusLine>}
      {state.kind === "loading" ? <SectionLoading rows={3} columns={2} label="Reading the webhook" /> : (
        <>
          <Field label="Send to this address" htmlFor="form-hook-url" hint="HTTPS only. Private addresses are refused.">
            <input id="form-hook-url" className={control} placeholder="https://hooks.example.com/insurvas" value={url} disabled={disabled} onChange={(event) => setUrl(event.target.value)} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-label text-[var(--body)]">Send when</span>
            <div className="flex flex-wrap gap-2">
              {EVENTS.map((event) => <ToggleChip key={event.key} selected={events.includes(event.key)} disabled={disabled} onClick={() => setEvents((list) => (list.includes(event.key) ? list.filter((item) => item !== event.key) : [...list, event.key]))}>{event.label}</ToggleChip>)}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-label text-[var(--body)]">Signing secret</span>
            {secret ? (
              <div className="flex items-center gap-2 rounded-[8px] border border-[var(--border)] px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-sm text-[var(--ink)]">{secret}</code>
                <Button type="button" variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(secret)}>Copy</Button>
              </div>
            ) : <p className="m-0 text-sm text-[var(--body)]">{hook ? "Shown once, when the webhook was made. Remove and add it again for a new one." : "Made when you save, and shown that once."}</p>}
            <span className="text-xs text-[var(--muted)]">We sign every call so your system knows it came from Insurvas. SSN and bank answers are never sent.</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-label text-[var(--body)]">What we send</span>
            <pre className="m-0 overflow-x-auto rounded-[8px] bg-[var(--surface-alt)] p-3 font-mono text-xs leading-[1.6] text-[var(--ink)]">{SAMPLE}</pre>
          </div>
          {state.kind === "ready" && hook && (
            <TableCard title="Recent deliveries" description="Failed calls retry 5 times over about nine hours.">
              {state.deliveries.length ? (
                <table className={st.table}>
                  <thead className={st.headRow}><tr><th className={st.th}>When</th><th className={st.th}>What</th><th className={st.th}>Took</th><th className={st.th}>Answer</th></tr></thead>
                  <tbody>
                    {state.deliveries.map((row) => (
                      <tr key={row.id}>
                        <td className={st.td}>{when.format(new Date(row.attempted_at))}</td>
                        <td className={st.td}>{row.event_type === "webhook.test" ? "Test" : row.event_type === "form.test" ? "Test submission" : "Form sent"}</td>
                        <td className={st.td}>{row.duration_ms === null ? "—" : row.duration_ms >= 1000 ? `${Math.round(row.duration_ms / 1000)} s` : `${row.duration_ms} ms`}</td>
                        <td className={st.td}><StatusChip tone={row.ok ? (row.attempt > 1 ? "warning" : "good") : "danger"}>{row.ok ? (row.attempt > 1 ? `Retried · ${row.status_code} on try ${row.attempt}` : `${row.status_code} OK`) : row.status_code ? `${row.status_code}` : "No answer"}</StatusChip></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="m-0 px-4 pb-4 text-sm text-[var(--muted)]">Nothing sent yet.</p>}
            </TableCard>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
            {hook && <Button type="button" variant="ghost" className="text-[var(--error-ink)]" disabled={busy} onClick={() => void call("DELETE")}>Remove webhook</Button>}
            <span className="flex-1" />
            {hook && <Button type="button" variant="outline" disabled={busy} onClick={() => void call("POST")}>Send a test</Button>}
            <Button type="button" disabled={disabled || busy || !url.trim() || events.length === 0} onClick={() => void call("PUT")}>{busy ? "Saving…" : "Save webhook"}</Button>
          </div>
        </>
      )}
    </div>
  );
}
