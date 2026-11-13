"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { control, Field } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState, ErrorState, LoadingRows, NoMatches } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Segmented, UnderlineTabs } from "@/components/ui/view-tabs";
import { st } from "@/components/app/settings/primitives";
import { WEBHOOK_EVENTS, webhookEventLabel, type WebhookAttemptView, type WebhookEventType, type WebhookView } from "@/lib/apiKeys/constants";
import { answerWords, EVENT_SAMPLES, hookState, MAX_TRIES, OFF_AFTER, hostOf, maskedUrl, sentWords, tookWords, type DeliveryLogRow, type HookExtras } from "@/lib/apiKeys/hub";
import { dayMonth, viewerTimeZone } from "@/lib/format/dates";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { clockWords, CodeCard, inWords, InlineLink, send, SheetSection, ShownOnce, TechnicalDetails, TickCard, whenWords } from "./shared";

/**
 * Settings › Integrations, round 8 option A · the Webhooks tab (board A9), a webhook's sheet with
 * Setup and Deliveries (A10, A12), the add-a-webhook sheet (A11) and the signing secret, shown once.
 * Health is one chip; the address shows as its site name; problems ride the status line with the fix.
 */


export type HookFilter = "all" | "working" | "needs_you";
const NO_EXTRAS: HookExtras = { nextTryAt: null, missed: 0, lastAnswer: null };

/** "Failed 9:41 AM", "Delivered 9:40 AM", "Last worked Nov 6", "Nothing sent yet". */
export function lastDeliveryWords(hook: WebhookView): string {
  const failedLast = hook.lastFailureAt && (!hook.lastSuccessAt || hook.lastFailureAt > hook.lastSuccessAt);
  if (hook.status === "disabled") return hook.lastSuccessAt ? `Last worked ${whenWords(hook.lastSuccessAt)}` : "Never delivered";
  if (failedLast) return `Failed ${clockWords(hook.lastFailureAt)}`;
  if (hook.lastSuccessAt) return `Delivered ${clockWords(hook.lastSuccessAt)}`;
  return "Nothing sent yet";
}

export function WebhooksTable({
  hooks,
  extras,
  filter,
  onFilter,
  selectedId,
  onOpen,
  onRetry,
  busyId,
  addButton,
}: {
  hooks: WebhookView[];
  extras: Record<string, HookExtras>;
  filter: HookFilter;
  onFilter: (filter: HookFilter) => void;
  selectedId: string | null;
  onOpen: (hook: WebhookView) => void;
  onRetry: (hook: WebhookView, mode: "waiting" | "missed") => void;
  busyId: string | null;
  addButton: React.ReactNode;
}) {
  const needsYou = (hook: WebhookView) => hookState(hook).needsYou;
  const shown = hooks.filter((hook) => filter === "all" || (filter === "needs_you" ? needsYou(hook) : !needsYou(hook)));
  return (
    <TableCard
      title="Webhooks"
      className="lg:min-h-0 lg:flex-1"
      bodyClassName="min-h-[200px] overflow-y-auto lg:min-h-0"
      toolbar={
        <Segmented
          label="Show webhooks"
          options={[
            { key: "all", label: "All", count: hooks.length },
            { key: "working", label: "Working", count: hooks.filter((hook) => !needsYou(hook)).length },
            { key: "needs_you", label: "Needs you", count: hooks.filter(needsYou).length, tone: "danger" },
          ]}
          value={filter}
          onChange={onFilter}
        />
      }
      footer={<span>Each delivery is signed so the receiver can tell it came from us · We try each event {MAX_TRIES} times over about 9 hours, waiting longer each time; after {OFF_AFTER} failures in a row we turn the webhook off and tell you</span>}
    >
      {hooks.length === 0 ? (
        <EmptyState title="No webhooks yet" hint="A webhook tells another app the moment a policy is issued or lapses, or a commission doesn't match. Each delivery is signed." action={addButton} />
      ) : shown.length === 0 ? (
        <NoMatches noun="webhooks" onClear={() => onFilter("all")} />
      ) : (
        <table className={st.table} aria-label="Webhooks">
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Name</th>
              <th scope="col" className={st.th}>Sends to</th>
              <th scope="col" className={st.th}>Events</th>
              <th scope="col" className={st.th}>Last delivery</th>
              <th scope="col" className={cn(st.th, "text-right")}>Waiting</th>
              <th scope="col" className={st.th}>Status</th>
              <th scope="col" className={cn(st.th, "w-[110px]")}><span className="sr-only">Act</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((hook) => {
              const state = hookState(hook);
              const extra = extras[hook.id] ?? NO_EXTRAS;
              return (
                <tr key={hook.id} className={cn("cursor-pointer hover:bg-[var(--hover-wash)]", hook.id === selectedId && "bg-[var(--primary-soft)]")} onClick={() => onOpen(hook)}>
                  <td className={cn(st.td, "max-w-[220px] truncate")}>
                    <button type="button" className="max-w-full truncate border-0 bg-transparent p-0 text-left font-semibold text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]" aria-label={`Open ${hook.label}`} onClick={(event) => { event.stopPropagation(); onOpen(hook); }}>{hook.label}</button>
                  </td>
                  <td className={cn(st.td, "max-w-[200px] truncate")}>{hostOf(hook.targetUrl)}</td>
                  <td className={cn(st.td, "max-w-[240px] truncate")}>{hook.eventTypes.length === WEBHOOK_EVENTS.length ? `All ${WEBHOOK_EVENTS.length} events` : hook.eventTypes.map(webhookEventLabel).join(", ")}</td>
                  <td className={cn(st.td, "whitespace-nowrap")}>{lastDeliveryWords(hook)}</td>
                  <td className={cn(st.td, st.num)}>{hook.status === "disabled" ? "—" : hook.pending.toLocaleString("en-US")}</td>
                  <td className={cn(st.td, "whitespace-nowrap")}><StatusChip tone={state.tone}>{state.kind === "off" && extra.missed ? `${state.label} · ${extra.missed} missed` : state.label}</StatusChip></td>
                  <td className={cn(st.td, "text-right text-[var(--muted)]")}>
                    {state.kind === "failing" || (state.kind === "retrying" && hook.pending > 0) ? (
                      <Button type="button" variant="outline" size="sm" disabled={busyId === hook.id} onClick={(event) => { event.stopPropagation(); onRetry(hook, hook.pending > 0 ? "waiting" : "missed"); }}>{busyId === hook.id ? "Retrying…" : "Retry now"}</Button>
                    ) : state.kind === "off" ? (
                      <Button type="button" variant="outline" size="sm" disabled={busyId === hook.id} onClick={(event) => { event.stopPropagation(); onRetry(hook, "missed"); }}>{busyId === hook.id ? "Turning on…" : "Turn on"}</Button>
                    ) : <ChevronRight aria-hidden="true" className="ml-auto size-4" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

/** The sentence under a webhook's name in its sheet. */
function sheetLine(hook: WebhookView, extra: HookExtras): string {
  const zone = viewerTimeZone();
  if (hook.status === "disabled") {
    const when = hook.disabledAt ? dayMonth(hook.disabledAt, zone) : "recently";
    return `We turned it off on ${when} after ${hook.consecutiveFailures || OFF_AFTER} failed deliveries in a row and told your owners.${extra.missed ? ` ${extra.missed} ${extra.missed === 1 ? "event was" : "events were"} not delivered.` : ""}`;
  }
  if (hook.status === "paused") return `Paused · ${hook.pending} ${hook.pending === 1 ? "event" : "events"} waiting until you resume it`;
  if (hook.status === "failing" || hook.consecutiveFailures > 0) {
    const said = extra.lastAnswer ? answerWords({ ok: false, statusCode: extra.lastAnswer.statusCode, error: extra.lastAnswer.error }).chip.toLowerCase() : "failed";
    const left = Math.max(0, OFF_AFTER - hook.consecutiveFailures);
    return [
      `Last try ${clockWords(hook.lastFailureAt)}: ${said}`,
      extra.nextTryAt ? `next try ${inWords(extra.nextTryAt)}` : null,
      `${hook.pending} ${hook.pending === 1 ? "event" : "events"} waiting`,
      `we turn it off and tell you after ${left} more failed ${left === 1 ? "try" : "tries"}`,
    ].filter(Boolean).join(" · ");
  }
  return `Sends to ${hostOf(hook.targetUrl)} · ${lastDeliveryWords(hook).toLowerCase()}`;
}

export type HookSheetTab = "setup" | "deliveries";
type Draft = { label: string; targetUrl: string; events: WebhookEventType[] };
const draftOf = (hook: WebhookView): Draft => ({ label: hook.label, targetUrl: hook.targetUrl, events: [...hook.eventTypes] });
const httpsProblem = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "Enter the address to send to.";
  if (!/^https:\/\//i.test(trimmed)) return "Must start with https:// so deliveries are encrypted on the way.";
  try { new URL(trimmed); } catch { return "Enter a full address, starting https://"; }
  return null;
};

/** A webhook's sheet: Setup (name, address, events, signing secret, turn on) and Deliveries (log, retry, test). */
export function WebhookSheet({
  hook,
  extra,
  tab,
  onTab,
  onClose,
  onChanged,
  onDocs,
}: {
  hook: WebhookView;
  extra: HookExtras;
  tab: HookSheetTab;
  onTab: (tab: HookSheetTab) => void;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onDocs: () => void;
}) {
  const base = draftOf(hook);
  const [draft, setDraft] = useState<Draft>(base);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [log, setLog] = useState<DeliveryLogRow[] | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const state = hookState(hook);
  const set = (patch: Partial<Draft>) => setDraft((value) => ({ ...value, ...patch }));
  const dirty = draft.label.trim() !== base.label || draft.targetUrl.trim() !== base.targetUrl || draft.events.slice().sort().join() !== base.events.slice().sort().join();
  const urlProblem = draft.targetUrl.trim() !== base.targetUrl ? httpsProblem(draft.targetUrl) : null;
  const invalid = !draft.label.trim() || Boolean(urlProblem) || draft.events.length === 0;
  const canSend = hook.status === "active" || hook.status === "failing";

  const loadLog = useCallback(async () => {
    try {
      const result = await send<{ rows: DeliveryLogRow[] }>(`/api/app/webhooks/${hook.id}?view=deliveries`, "GET");
      setLog(result.rows ?? []);
      setLogError(null);
    } catch {
      // The preview and an older server answer the plain log: show that rather than nothing.
      try {
        const plain = await send<{ attempts: WebhookAttemptView[] }>(`/api/app/webhooks/${hook.id}`, "GET");
        setLog((plain.attempts ?? []).map((a) => ({ ...a, deliveryStatus: null, nextAttemptAt: null, deliveryAttempts: null, facts: {} })));
        setLogError(null);
      } catch (cause) {
        setLogError(cause instanceof Error ? cause.message : "The deliveries didn't load.");
      }
    }
  }, [hook.id]);
  useEffect(() => { const timer = window.setTimeout(() => void loadLog(), 0); return () => window.clearTimeout(timer); }, [loadLog]);

  async function act(name: string, run: () => Promise<void>) {
    setBusy(name);
    try { await run(); } catch (cause) { notify.fail(cause instanceof Error ? cause.message : "That did not work. Try again."); } finally { setBusy(null); }
  }

  async function save(): Promise<boolean> {
    if (invalid) return false;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (draft.label.trim() !== base.label) body.label = draft.label.trim();
      if (draft.targetUrl.trim() !== base.targetUrl) body.targetUrl = draft.targetUrl.trim();
      if (draft.events.slice().sort().join() !== base.events.slice().sort().join()) body.eventTypes = draft.events;
      await send(`/api/app/webhooks/${hook.id}`, "PATCH", body);
      notify.done(`${draft.label.trim()} saved.`);
      await onChanged();
      return true;
    } catch (cause) {
      notify.fail(cause instanceof Error ? cause.message : "That did not save. Try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function close() {
    if (dirty && !(await confirmAction({ title: "Discard your changes?", description: `The unsaved changes to ${hook.label} are lost.`, confirmLabel: "Discard changes", cancelLabel: "Keep editing" }))) return;
    onClose();
  }

  const sendTest = () => act("test", async () => {
    const { attempt } = await send<{ attempt: WebhookAttemptView | null }>(`/api/app/webhooks/${hook.id}/test`, "POST", {});
    if (attempt?.ok) notify.done(`Test delivered · their server answered in ${tookWords(attempt.durationMs)}.`);
    else notify.block(`Test didn't get through: ${attempt ? answerWords(attempt).said : "no answer yet"}.`);
    await Promise.all([onChanged(), loadLog()]);
  });
  const retry = (mode: "waiting" | "missed" | "delivery", deliveryId?: string) => act(`retry:${deliveryId ?? mode}`, async () => {
    const result = await send<{ queued: number; turnedOn: boolean; sent: { succeeded: number; failed: number; retry: number } }>(`/api/app/webhooks/${hook.id}`, "POST", { mode, deliveryId });
    const sentLine = result.sent.succeeded ? `${result.sent.succeeded} delivered` : result.sent.retry || result.sent.failed ? "their server still didn't take it" : "nothing was due";
    notify.done(`${result.turnedOn ? "Turned on · " : ""}${result.queued} sent again · ${sentLine}.`);
    await Promise.all([onChanged(), loadLog()]);
  });
  const setStatus = (status: "active" | "paused") => act(status, async () => {
    await send(`/api/app/webhooks/${hook.id}`, "PATCH", { status });
    notify.done(status === "paused" ? `${hook.label} paused.` : `${hook.label} is on. Waiting events are due now.`);
    await onChanged();
  });
  const remove = () => act("delete", async () => {
    if (!(await confirmAction({ title: `Delete ${hook.label}?`, description: "Nothing more is sent to it, and its waiting events and delivery log are deleted with it.", confirmLabel: "Delete webhook", cancelLabel: "Keep it" }))) return;
    await send(`/api/app/webhooks/${hook.id}`, "DELETE");
    notify.done(`${hook.label} deleted.`);
    onClose();
    await onChanged();
  });
  const newSecret = () => act("secret", async () => {
    if (!(await confirmAction({ title: "Make a new signing secret?", description: `From the next delivery on, ${hook.label} signs with the new secret. Their app must swap it in, or it will refuse our deliveries.`, confirmLabel: "Make a new secret", cancelLabel: "Keep the old one", destructive: false }))) return;
    const made = await send<{ secret: string }>(`/api/app/webhooks/${hook.id}`, "PATCH", { newSecret: true });
    setSecret(made.secret);
  });

  // The sheet's own sections (Setup · Deliveries), under its title, as on the vendor sheet.
  const sectionTabs = <UnderlineTabs label={`${hook.label}'s sections`} tabs={[{ key: "setup", label: "Setup" }, { key: "deliveries", label: "Deliveries", count: log ? log.length : null }]} value={tab} onChange={onTab} className="w-full" />;

  return (
    <Sheet
      title={hook.label}
      subtitle={sheetLine(hook, extra)}
      status={
        <>
          <StatusChip tone={state.tone}>{state.label}</StatusChip>
          {sectionTabs}
        </>
      }
      onClose={() => void close()}
      closeLabel={`Close ${hook.label}`}
      className="lg:w-[640px]"
      bodyClassName={tab === "deliveries" ? "flex min-h-0 flex-col p-0" : "flex flex-col gap-5 p-4"}
      footer={tab === "setup" ? (
        <>
          <Button type="button" variant="destructive" disabled={busy !== null} onClick={() => void remove()}>Delete</Button>
          <span className="ml-auto flex gap-2">
            {hook.status === "paused"
              ? <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void setStatus("active")}>Resume</Button>
              : hook.status !== "disabled" && <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void setStatus("paused")}>Pause</Button>}
            <Button type="button" disabled={!dirty || saving || invalid} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
          </span>
        </>
      ) : (
        <>
          {hook.status === "paused"
            ? <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void setStatus("active")}>Resume</Button>
            : hook.status !== "disabled" && <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void setStatus("paused")}>Pause</Button>}
          <Button type="button" variant="ghost" className="ml-auto" onClick={() => void close()}>Close</Button>
        </>
      )}
    >
      {tab === "setup" && (
        <>
          {hook.status === "disabled" && (
            <SheetSection title="Turn it back on" help={extra.missed ? `We deliver the ${extra.missed} missed ${extra.missed === 1 ? "event" : "events"} in order once it's on. Fix their server first, or they fail again.` : "Fix their server first, then turn it on; a test is the quickest check."}>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void setStatus("active")}>Turn on</Button>
                {extra.missed > 0 && <Button type="button" disabled={busy !== null} onClick={() => void retry("missed")}>{busy === "retry:missed" ? "Sending…" : `Turn on and send ${extra.missed} missed`}</Button>}
              </div>
            </SheetSection>
          )}
          <SheetSection title="Name and address" help="Name it after the app that receives it.">
            <Field label="Name" htmlFor="hook-sheet-name">
              <input id="hook-sheet-name" className={control} value={draft.label} maxLength={80} onChange={(event) => set({ label: event.target.value })} autoComplete="off" />
            </Field>
            <Field label="Address" htmlFor="hook-sheet-url" error={urlProblem ?? undefined}>
              <input id="hook-sheet-url" type="url" className={control} value={draft.targetUrl} maxLength={500} onChange={(event) => set({ targetUrl: event.target.value })} autoComplete="off" aria-invalid={urlProblem ? true : undefined} />
            </Field>
          </SheetSection>
          <SheetSection title="Events" help="Each event carries names and figures only, never a Social Security number, bank details or health answers.">
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map((event) => (
                <ToggleChip key={event.key} selected={draft.events.includes(event.key)} onClick={() => set({ events: draft.events.includes(event.key) ? draft.events.filter((item) => item !== event.key) : [...draft.events, event.key] })}>{event.label}</ToggleChip>
              ))}
            </div>
          </SheetSection>
          <SheetSection title="Signing secret" help="Their app uses it to check each delivery really came from Insurvas. It was shown once, when the webhook was added.">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate rounded-[8px] border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 font-mono text-xs text-[var(--ink)]">whsec_••••••••••••••••</span>
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void newSecret()}>{busy === "secret" ? "Making…" : "Make a new secret"}</Button>
            </div>
            <p className="m-0 text-xs text-[var(--muted)]"><InlineLink onClick={onDocs}>How to check our signature ›</InlineLink> (Developer docs)</p>
          </SheetSection>
          <TechnicalDetails rows={[{ label: "Full address", value: hook.targetUrl, shown: maskedUrl(hook.targetUrl) }, { label: "Event names", value: hook.eventTypes.join(", ") }]} />
          <LeaveGuard dirty={dirty} onSave={save} onDiscard={() => setDraft(base)} what={hook.label} />
        </>
      )}

      {tab === "deliveries" && (
        <DeliveriesTab log={log} error={logError} onReload={() => void loadLog()} canSend={canSend} pending={hook.pending} busy={busy} onTest={() => void sendTest()} onRetry={retry} />
      )}

      {secret && (
        <Dialog open onOpenChange={(next) => { if (!next) setSecret(null); }}>
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>{hook.label}&rsquo;s new signing secret</DialogTitle>
              <DialogDescription>Shown once. Paste it into the app that receives the webhook.</DialogDescription>
            </DialogHeader>
            <ShownOnce label="Signing secret" value={secret} copyLabel="Copy secret" />
            <DialogFooter><Button type="button" onClick={() => setSecret(null)}>Done</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Sheet>
  );
}

type LogFilter = "all" | "failed" | "delivered";

function DeliveriesTab({ log, error, onReload, canSend, pending, busy, onTest, onRetry }: {
  log: DeliveryLogRow[] | null;
  error: string | null;
  onReload: () => void;
  canSend: boolean;
  pending: number;
  busy: string | null;
  onTest: () => void;
  onRetry: (mode: "waiting" | "delivery", deliveryId?: string) => void;
}) {
  const [filter, setFilter] = useState<LogFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const rows = log ?? [];
  const shown = rows.filter((row) => filter === "all" || (filter === "failed" ? !row.ok : row.ok));
  const newestOf = new Map<string, string>();
  for (const row of rows) if (!newestOf.has(row.deliveryId)) newestOf.set(row.deliveryId, row.id);
  const openId = open ?? shown.find((row) => !row.ok)?.id ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <Segmented
          label="Show deliveries"
          options={[
            { key: "all", label: "All" },
            { key: "failed", label: "Failed", count: rows.filter((row) => !row.ok).length, tone: "danger" },
            { key: "delivered", label: "Delivered", count: rows.filter((row) => row.ok).length },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <span className="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={!canSend || busy !== null} title={canSend ? undefined : "Turn it on to send a test"} onClick={onTest}>{busy === "test" ? "Sending…" : "Send test"}</Button>
          {pending > 0 && canSend && <Button type="button" size="sm" disabled={busy !== null} onClick={() => onRetry("waiting")}>{busy === "retry:waiting" ? "Retrying…" : `Retry ${pending} waiting`}</Button>}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <ErrorState title="Couldn't load the deliveries" detail="Deliveries keep going; only this list failed to load." action={<Button type="button" variant="outline" onClick={onReload}>Try again</Button>} />
        ) : !log ? (
          <LoadingRows rows={6} columns={5} />
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing sent yet" hint="Each try appears here as events are delivered. Send a test to try their server." />
        ) : shown.length === 0 ? (
          <NoMatches noun="deliveries" onClear={() => setFilter("all")} />
        ) : (
          <table className={st.table} aria-label="Deliveries">
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>When</th>
                <th scope="col" className={st.th}>Event</th>
                <th scope="col" className={st.th}>Try</th>
                <th scope="col" className={st.th}>Result</th>
                <th scope="col" className={cn(st.th, "text-right")}>Took</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const answer = answerWords(row);
                const isOpen = openId === row.id;
                const latest = newestOf.get(row.deliveryId) === row.id;
                const canRetry = latest && !row.ok && row.deliveryStatus !== "succeeded" && canSend;
                return (
                  <Fragment key={row.id}>
                    <tr className={cn("cursor-pointer hover:bg-[var(--hover-wash)]", isOpen && "bg-[var(--hover-wash)]")} onClick={() => setOpen(isOpen ? "" : row.id)} aria-expanded={isOpen}>
                      <td className={cn(st.td, "whitespace-nowrap")}>{whenWords(row.attemptedAt)}</td>
                      <td className={cn(st.td, "max-w-[220px] truncate")}>{webhookEventLabel(row.eventType)}</td>
                      <td className={cn(st.td, "whitespace-nowrap")}>{row.attempt <= MAX_TRIES ? `${row.attempt} of ${MAX_TRIES}` : `${row.attempt}, by hand`}</td>
                      <td className={cn(st.td, "whitespace-nowrap")}><StatusChip tone={answer.tone}>{answer.chip}</StatusChip></td>
                      <td className={cn(st.td, st.num)}>{tookWords(row.durationMs)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-[var(--hover-wash)]">
                        <td colSpan={5} className="border-t border-[var(--border)] px-3 py-3">
                          <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-xs text-[var(--body)]">
                            <dt className="text-[var(--muted)]">What we sent</dt><dd className="m-0">{sentWords(row.eventType, row.facts)}</dd>
                            <dt className="text-[var(--muted)]">What they said</dt><dd className="m-0">{answer.said}</dd>
                            {latest && row.deliveryStatus === "pending" && row.nextAttemptAt && <><dt className="text-[var(--muted)]">Next try</dt><dd className="m-0">{clockWords(row.nextAttemptAt)} ({inWords(row.nextAttemptAt)})</dd></>}
                            {latest && (row.deliveryStatus === "failed" || row.deliveryStatus === "cancelled") && <><dt className="text-[var(--muted)]">Next try</dt><dd className="m-0">None. {row.deliveryStatus === "cancelled" ? "It was stopped when the webhook was turned off." : "It used up its tries."}</dd></>}
                          </dl>
                          <div className="mt-2 flex flex-wrap items-start gap-3">
                            {canRetry && <Button type="button" size="sm" disabled={busy !== null} onClick={() => onRetry("delivery", row.deliveryId)}>{busy === `retry:${row.deliveryId}` ? "Retrying…" : "Retry now"}</Button>}
                            <TechnicalDetails rows={[
                              { label: "Status code", value: row.statusCode ? String(row.statusCode) : "none" },
                              ...(row.error ? [{ label: "Error", value: row.error }] : []),
                              ...(row.responseSnippet ? [{ label: "Their reply", value: row.responseSnippet }] : []),
                              { label: "Event name", value: row.eventType },
                            ]} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Add a webhook (board A11): name, HTTPS address, events in plain words; then the secret, shown once, and a test. */
export function AddWebhookSheet({ onClose, onAdded, onDocs }: { onClose: () => void; onAdded: () => Promise<void> | void; onDocs: () => void }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [events, setEvents] = useState<WebhookEventType[]>(["policy.issued", "policy.lapsed"]);
  const [testAfter, setTestAfter] = useState(true);
  const [example, setExample] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ secret: string; record: WebhookView; test: WebhookAttemptView | null | "skipped" | "failed" } | null>(null);
  const problem = httpsProblem(url);
  // Said once the address is long enough to judge, or the field is left.
  const showProblem = problem && (touched || url.trim().length >= 8) ? problem : null;
  const invalid = !label.trim() || Boolean(problem) || events.length === 0;

  async function add() {
    setSaving(true);
    setError(null);
    try {
      const created = await send<{ secret: string; record: WebhookView }>("/api/app/webhooks", "POST", { label: label.trim(), targetUrl: url.trim(), eventTypes: events });
      let test: WebhookAttemptView | null | "skipped" | "failed" = "skipped";
      if (testAfter) {
        try {
          test = (await send<{ attempt: WebhookAttemptView | null }>(`/api/app/webhooks/${created.record.id}/test`, "POST", {})).attempt;
        } catch {
          test = "failed";
        }
      }
      setMade({ ...created, test });
      await onAdded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the webhook");
    } finally {
      setSaving(false);
    }
  }

  if (made) {
    const test = made.test;
    return (
      <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{made.record.label}&rsquo;s signing secret</DialogTitle>
            <DialogDescription>Shown once. Paste it into the app that receives the webhook.</DialogDescription>
          </DialogHeader>
          <ShownOnce label="Signing secret" value={made.secret} copyLabel="Copy secret" />
          {test !== "skipped" && (
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
              {test && test !== "failed" && test.ok
                ? <><StatusChip tone="good">Test delivered</StatusChip><span className="text-xs text-[var(--muted)]">Their server answered in {tookWords(test.durationMs)}</span></>
                : <><StatusChip tone="danger">Test didn&rsquo;t get through</StatusChip><span className="text-xs text-[var(--muted)]">{test && test !== "failed" ? answerWords(test).said : "No answer yet"} · see Deliveries</span></>}
            </div>
          )}
          <DialogFooter><Button type="button" onClick={onClose}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet
      title="Add a webhook"
      subtitle="We'll send a signed message to this address the moment an event happens"
      onClose={onClose}
      closeLabel="Close add a webhook"
      className="lg:w-[640px]"
      bodyClassName="flex flex-col gap-5 p-4"
      footer={
        <>
          {error && <span role="alert" className="min-w-0 flex-1 text-xs text-[var(--error-ink)]">{error}</span>}
          <span className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="button" disabled={invalid || saving} onClick={() => void add()}>{saving ? "Adding…" : "Add webhook"}</Button>
          </span>
        </>
      }
    >
      <SheetSection title="Name and address" help="Name it after the app that receives it.">
        <Field label="Name" htmlFor="add-hook-name">
          <input id="add-hook-name" className={control} value={label} maxLength={80} autoFocus placeholder="Agency CRM" onChange={(event) => setLabel(event.target.value)} autoComplete="off" />
        </Field>
        <Field label="Address" htmlFor="add-hook-url" error={showProblem ?? undefined}>
          <input id="add-hook-url" type="url" className={control} value={url} maxLength={500} placeholder="https://" onBlur={() => setTouched(true)} onChange={(event) => setUrl(event.target.value)} autoComplete="off" aria-invalid={showProblem ? true : undefined} />
        </Field>
      </SheetSection>
      <SheetSection title="Which events?" help="Each event carries names and figures only, never a Social Security number, bank details or health answers.">
        <div className="flex flex-col gap-2">
          {WEBHOOK_EVENTS.map((event) => (
            <div key={event.key} className="flex flex-col gap-2">
              <TickCard
                checked={events.includes(event.key)}
                onChange={(checked) => setEvents(checked ? [...events, event.key] : events.filter((item) => item !== event.key))}
                title={event.label}
                sub={event.description}
                end={<InlineLink onClick={() => setExample(example === event.key ? null : event.key)}>{example === event.key ? "Hide the example" : "See an example"}</InlineLink>}
              />
              {example === event.key && <CodeCard code={EVENT_SAMPLES[event.key] ?? "{}"} />}
            </div>
          ))}
          <TickCard checked={false} disabled onChange={() => undefined} title="Lead created · Lead sold" sub="Coming later" />
        </div>
      </SheetSection>
      <SheetSection title="After saving" help={<>We show its signing secret once and offer a test delivery. <InlineLink onClick={onDocs}>How to check our signature ›</InlineLink></>}>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--body)]">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={testAfter} onChange={(event) => setTestAfter(event.target.checked)} />
          Send a test delivery right away
        </label>
      </SheetSection>
    </Sheet>
  );
}

