"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Plus } from "lucide-react";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { InfoTip } from "@/components/ui/info-tip";
import { Callout, control, Field, SettingsSectionHeader, SettingsStack, st } from "@/components/app/settings/primitives";
import { cn } from "@/lib/utils";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import {
  API_SCOPES, DEFAULT_ROTATION_OVERLAP_HOURS, IDLE_DAYS, KEY_EXPIRY_DAYS, ROTATION_OVERLAP_HOURS, WEBHOOK_EVENTS,
  apiKeyStatus, isIdleKey, type ApiKeyStatus, type ApiKeyView, type ApiScope, type WebhookAttemptView, type WebhookEventType, type WebhookStatus, type WebhookView,
} from "@/lib/apiKeys/constants";

/**
 * Settings › API keys & webhooks (LA-8.7). Two lists, one at a time: the agency's integration keys
 * and its webhook subscriptions. A key and a signing secret are each shown once, in a dialog, and
 * never again — the server does not have them to show.
 */

const code = cn(st.code, "text-sm");
const when = (value: string | null) => (value ? dateTime(value, viewerTimeZone()) : null);

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error ?? "That did not work. Try again.");
  return json;
}

const KEY_STATUS: Record<ApiKeyStatus, { label: string; tone: StatusTone }> = {
  active: { label: "Active", tone: "good" },
  rotating_out: { label: "Rotating out", tone: "warning" },
  expired: { label: "Expired", tone: "neutral" },
  revoked: { label: "Revoked", tone: "neutral" },
};

const HOOK_STATUS: Record<WebhookStatus, { label: string; tone: StatusTone }> = {
  active: { label: "Active", tone: "good" },
  paused: { label: "Paused", tone: "neutral" },
  failing: { label: "Failing", tone: "warning" },
  disabled: { label: "Turned off", tone: "danger" },
};

const scopeLabel = (scope: ApiScope) => API_SCOPES.find((s) => s.key === scope)?.label ?? scope;
const eventLabel = (event: string) => WEBHOOK_EVENTS.find((e) => e.key === event)?.label ?? (event === "webhook.test" ? "Test event" : event);

type View = "keys" | "webhooks";
type Revealed = { title: string; lines: { label: string; value: string }[]; note: string };

export function IntegrationsSettings() {
  const [view, setView] = useState<View>("keys");
  const [keys, setKeys] = useState<ApiKeyView[] | null>(null);
  const [hooks, setHooks] = useState<WebhookView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);
  const [creatingHook, setCreatingHook] = useState(false);
  const [rotating, setRotating] = useState<ApiKeyView | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyView | null>(null);
  const [deleting, setDeleting] = useState<WebhookView | null>(null);
  const [logFor, setLogFor] = useState<WebhookView | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    () =>
      Promise.all([send("/api/app/api-keys", "GET"), send("/api/app/webhooks", "GET")])
        .then(([k, h]) => {
          setKeys(k.keys);
          setHooks(h.webhooks);
          setError(null);
          setNow(Date.now());
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : "Could not load integrations");
        }),
    [],
  );
  useEffect(() => { void load(); }, [load]);
  async function reload() {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify.done("Copied.");
    } catch {
      notify.fail("Your browser would not let us copy. Select the text and copy it by hand.");
    }
  }

  async function run(id: string, action: () => Promise<void>) {
    setBusy(id);
    try { await action(); } catch (e) { notify.block(e instanceof Error ? e.message : "That did not work"); } finally { setBusy(null); }
  }

  if (error && !keys) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <Callout tone="error" title={error} />
      </SettingsStack>
    );
  }
  if (!keys || !hooks) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <TableCard><SectionLoading label="Loading API keys and webhooks" /></TableCard>
      </SettingsStack>
    );
  }

  const replaced = new Set(keys.map((k) => k.rotatedFrom).filter((id): id is string => Boolean(id)));
  const idle = keys.filter((k) => isIdleKey(k, now));
  const failingHooks = hooks.filter((h) => h.status === "failing" || h.status === "disabled").length;

  return (
    <SettingsStack>
      <SettingsSectionHeader />

      <ViewTabs
        label="Integrations"
        value={view}
        onChange={setView}
        tabs={[
          { key: "keys", label: "API keys", count: keys.filter((k) => !k.revokedAt).length },
          { key: "webhooks", label: "Webhooks", count: failingHooks || hooks.length, tone: failingHooks ? "danger" : undefined },
        ]}
      />

      {view === "keys" ? (
        <PagedTableCard
          total={keys.length}
          noun="keys"
          title="API keys"
          toolbar={
            <DataToolbar actions={<><Button type="button" onClick={() => setCreatingKey(true)}><Plus aria-hidden="true" />Create a key</Button><RefreshButton onClick={() => void reload()} refreshing={refreshing} /></>}>
              {idle.length > 0 && <StatusChip tone="warning">{idle.length} unused for {IDLE_DAYS}+ days</StatusChip>}
            </DataToolbar>
          }
        >
          {keys.length === 0 ? (
            <EmptyState title="No API keys yet" hint="A key lets another system post leads in or read your book. It is shown once, when it is created." action={<Button type="button" onClick={() => setCreatingKey(true)}>Create a key</Button>} />
          ) : (
            <table className={st.table}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={cn(st.th, "w-[240px]")}>Key</th>
                  <th scope="col" className={st.th}>Scopes</th>
                  <th scope="col" className={cn(st.th, "w-[200px]")}>Last used</th>
                  <th scope="col" className={cn(st.th, "w-[170px]")}>Ends</th>
                  <th scope="col" className={st.th}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <PagedBody>
                {keys.map((key) => {
                  const status = apiKeyStatus(key, replaced.has(key.id), now);
                  const live = status === "active" || status === "rotating_out";
                  const keyIdle = isIdleKey(key, now);
                  return (
                    <tr key={key.id} className={cn(!live && "opacity-60")}>
                      <td className={st.td}>
                        <span className="font-semibold text-[var(--ink)]">{key.label}</span>
                        <span className={cn(st.sub, "flex flex-wrap items-center gap-1.5")}>
                          <StatusChip tone={KEY_STATUS[status].tone} dot>{KEY_STATUS[status].label}</StatusChip>
                          <code className={code}>{key.keyPrefix}…{key.lastFour}</code>
                        </span>
                      </td>
                      <td className={st.td}>{key.scopes.map(scopeLabel).join(", ")}</td>
                      <td className={st.td}>
                        {key.lastUsedAt ? <>{when(key.lastUsedAt)}<span className={st.sub}>from {key.lastUsedIp ?? "an unknown address"}</span></> : "Never used"}
                        {keyIdle && <span className={st.sub}><StatusChip tone="warning">Unused {IDLE_DAYS}+ days — revoke?</StatusChip></span>}
                      </td>
                      <td className={st.td}>{key.revokedAt ? `Revoked ${when(key.revokedAt)}` : key.expiresAt ? when(key.expiresAt) : "No end date"}</td>
                      <td className={cn(st.td, "whitespace-nowrap text-right")}>
                        {live && (
                          <span className="inline-flex gap-2">
                            {status === "active" && <Button type="button" variant="outline" size="sm" disabled={busy === key.id} onClick={() => setRotating(key)}>Rotate</Button>}
                            <Button type="button" variant="outline" size="sm" disabled={busy === key.id} onClick={() => setRevoking(key)}>Revoke</Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </PagedBody>
            </table>
          )}
        </PagedTableCard>
      ) : (
        <PagedTableCard
          total={hooks.length}
          noun="webhooks"
          title="Webhooks"
          toolbar={<DataToolbar actions={<><Button type="button" onClick={() => setCreatingHook(true)}><Plus aria-hidden="true" />Add a webhook</Button><RefreshButton onClick={() => void reload()} refreshing={refreshing} /></>} />}
        >
          {hooks.length === 0 ? (
            <EmptyState title="No webhooks yet" hint="A webhook sends policy and commission events to your system as they happen, signed so it can check they came from us." action={<Button type="button" onClick={() => setCreatingHook(true)}>Add a webhook</Button>} />
          ) : (
            <table className={st.table}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={cn(st.th, "w-[280px]")}>Webhook</th>
                  <th scope="col" className={st.th}>Events</th>
                  <th scope="col" className={cn(st.th, "w-[220px]")}>Last delivery</th>
                  <th scope="col" className={st.th}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <PagedBody>
                {hooks.map((hook) => (
                  <tr key={hook.id}>
                    <td className={st.td}>
                      <span className="font-semibold text-[var(--ink)]">{hook.label}</span>
                      <span className={cn(st.sub, "flex flex-wrap items-center gap-1.5")}>
                        <StatusChip tone={HOOK_STATUS[hook.status].tone} dot>{HOOK_STATUS[hook.status].label}</StatusChip>
                        <span className="break-all font-mono">{hook.targetUrl}</span>
                      </span>
                      {hook.disabledReason && <span className={cn(st.sub, "text-[var(--error-ink)]")}>{hook.disabledReason}</span>}
                    </td>
                    <td className={st.td}>{hook.eventTypes.map(eventLabel).join(", ")}{hook.pending > 0 && <span className={st.sub}>{hook.pending} waiting to send</span>}</td>
                    <td className={st.td}>
                      {hook.lastSuccessAt ? <>Delivered {when(hook.lastSuccessAt)}</> : "Nothing delivered yet"}
                      {hook.lastFailureAt && (!hook.lastSuccessAt || hook.lastFailureAt > hook.lastSuccessAt) && <span className={cn(st.sub, "text-[var(--error-ink)]")}>Failed {when(hook.lastFailureAt)} · {hook.consecutiveFailures} in a row</span>}
                    </td>
                    <td className={cn(st.td, "whitespace-nowrap text-right")}>
                      <span className="inline-flex gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setLogFor(hook)}>Log</Button>
                        {(hook.status === "active" || hook.status === "failing") && (
                          <Button type="button" variant="outline" size="sm" disabled={busy === hook.id} onClick={() => void run(hook.id, async () => {
                            const { attempt } = await send(`/api/app/webhooks/${hook.id}/test`, "POST", {});
                            if (attempt?.ok) notify.done(`Test delivered: HTTP ${attempt.statusCode}.`);
                            else notify.block(`Test failed: ${attempt?.error ?? "no answer"}`);
                            await load();
                          })}>Send test</Button>
                        )}
                        {hook.status === "active" || hook.status === "failing" ? (
                          <Button type="button" variant="outline" size="sm" disabled={busy === hook.id} onClick={() => void run(hook.id, async () => { await send(`/api/app/webhooks/${hook.id}`, "PATCH", { status: "paused" }); await load(); })}>Pause</Button>
                        ) : (
                          <Button type="button" variant="outline" size="sm" disabled={busy === hook.id} onClick={() => void run(hook.id, async () => { await send(`/api/app/webhooks/${hook.id}`, "PATCH", { status: "active" }); notify.done("Resumed. Waiting events are due now."); await load(); })}>Resume</Button>
                        )}
                        <Button type="button" variant="outline" size="sm" disabled={busy === hook.id} onClick={() => setDeleting(hook)}>Delete</Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </PagedBody>
            </table>
          )}
        </PagedTableCard>
      )}

      {creatingKey && <CreateKeyDialog onClose={() => setCreatingKey(false)} onCreated={(key, record) => {
        setCreatingKey(false);
        setRevealed({ title: `${record.label}`, note: "This is the only time this key is shown. If it is lost, rotate it.", lines: [{ label: "API key", value: key }] });
        void load();
      }} />}

      {creatingHook && <CreateHookDialog onClose={() => setCreatingHook(false)} onCreated={(secret, record) => {
        setCreatingHook(false);
        setRevealed({ title: `${record.label}: signing secret`, note: "Shown once. Your receiver checks each delivery's Insurvas-Signature header with it.", lines: [{ label: "Signing secret", value: secret }] });
        void load();
      }} />}

      {rotating && <RotateDialog key={rotating.id} keyRow={rotating} onClose={() => setRotating(null)} onRotated={(key, oldEnds) => {
        const label = rotating?.label ?? "";
        setRotating(null);
        setRevealed({ title: `${label}: new key`, note: `Shown once. The old key keeps working until ${when(oldEnds)}, then stops.`, lines: [{ label: "API key", value: key }] });
        void load();
      }} />}

      <Dialog open={revoking !== null} onOpenChange={(next) => { if (!next && busy !== revoking?.id) setRevoking(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke {revoking?.label}?</DialogTitle>
            <DialogDescription>
              <code className={code}>{revoking?.keyPrefix}…{revoking?.lastFour}</code> · last used {revoking?.lastUsedAt ? when(revoking.lastUsedAt) : "never"}
            </DialogDescription>
          </DialogHeader>
          <Callout tone="error" title={<>Anything using this key is refused from its next request. A revoked key cannot be turned back on.</>} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRevoking(null)}>Keep the key</Button>
            <Button type="button" variant="destructive" disabled={busy === revoking?.id} onClick={() => revoking && void run(revoking.id, async () => { await send(`/api/app/api-keys/${revoking.id}`, "DELETE"); setRevoking(null); notify.done("Key revoked."); await load(); })}>
              {busy === revoking?.id ? "Revoking…" : "Revoke the key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(next) => { if (!next) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.label}?</DialogTitle>
            <DialogDescription>{deleting?.targetUrl}</DialogDescription>
          </DialogHeader>
          <Callout tone="error" title={<>Nothing more is sent to it, and its waiting events and delivery log are deleted with it.</>} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>Keep it</Button>
            <Button type="button" variant="destructive" disabled={busy === deleting?.id} onClick={() => deleting && void run(deleting.id, async () => { await send(`/api/app/webhooks/${deleting.id}`, "DELETE"); setDeleting(null); notify.done("Webhook deleted."); await load(); })}>
              {busy === deleting?.id ? "Deleting…" : "Delete the webhook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {logFor && <DeliveryLogDialog key={logFor.id} hook={logFor} onClose={() => setLogFor(null)} />}

      <Dialog open={revealed !== null} onOpenChange={(next) => !next && setRevealed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{revealed?.title}</DialogTitle>
            <DialogDescription>{revealed?.note}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {revealed?.lines.map((line) => (
              <div key={line.label}>
                <span className="text-xs font-semibold text-[var(--muted)]">{line.label}</span>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 rounded-[8px] border border-[var(--border)] bg-[var(--surface-sunken)] p-3 font-mono text-sm break-all text-[var(--ink)]">{line.value}</code>
                  <Button type="button" variant="outline" size="icon" aria-label={`Copy ${line.label.toLowerCase()}`} onClick={() => void copy(line.value)}><Copy aria-hidden="true" /></Button>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setRevealed(null)}>I have copied it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsStack>
  );
}

/** Mounted only while open, so every opening starts empty. */
function CreateKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string, record: ApiKeyView) => void }) {
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [expiry, setExpiry] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await send("/api/app/api-keys", "POST", { label, scopes, expiresInDays: expiry ? Number(expiry) : null });
      onCreated(result.key, result.record);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the key");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create an API key</DialogTitle>
          <DialogDescription>The key is shown once, on the next screen.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Name" htmlFor="key-label" required hint="What uses it, e.g. “Zapier — lead posting”.">
            <input id="key-label" className={control} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} autoComplete="off" />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-[var(--ink)]">
              Scopes <InfoTip label="About scopes">Choose only what this key needs. No scope returns an SSN, bank details or a card number.</InfoTip>
            </legend>
            {API_SCOPES.map((scope) => (
              <label key={scope.key} className="flex items-start gap-2 text-sm text-[var(--body)]">
                <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={scopes.includes(scope.key)} onChange={(e) => setScopes(e.target.checked ? [...scopes, scope.key] : scopes.filter((s) => s !== scope.key))} />
                <span><span className="font-semibold text-[var(--ink)]">{scope.label}</span> <code className={code}>{scope.key}</code><span className="block text-xs text-[var(--muted)]">{scope.description}</span></span>
              </label>
            ))}
          </fieldset>
          <Field label="Ends" htmlFor="key-expiry" hint="An end date is a good idea for anything temporary.">
            <select id="key-expiry" className={control} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              <option value="">No end date</option>
              {KEY_EXPIRY_DAYS.map((days) => <option key={days} value={days}>After {days} days</option>)}
            </select>
          </Field>
          {error && <span role="alert" className="text-xs text-[var(--error-ink)]">{error}</span>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !label.trim() || scopes.length === 0}>{saving ? "Creating…" : "Create key"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RotateDialog({ keyRow, onClose, onRotated }: { keyRow: ApiKeyView; onClose: () => void; onRotated: (key: string, oldEndsAt: string) => void }) {
  const [overlap, setOverlap] = useState<number>(DEFAULT_ROTATION_OVERLAP_HOURS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rotate() {
    setSaving(true);
    try {
      const result = await send(`/api/app/api-keys/${keyRow.id}/rotate`, "POST", { overlapHours: overlap });
      onRotated(result.key, result.oldExpiresAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rotate the key");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotate {keyRow.label}?</DialogTitle>
          <DialogDescription>A new key with the same scopes. The old one keeps working for the overlap, so nothing breaks mid-deploy.</DialogDescription>
        </DialogHeader>
        <Field label="Old key keeps working for" htmlFor="rotate-overlap">
          <select id="rotate-overlap" className={control} value={overlap} onChange={(e) => setOverlap(Number(e.target.value))}>
            {ROTATION_OVERLAP_HOURS.map((hours) => <option key={hours} value={hours}>{hours === 1 ? "1 hour" : `${hours} hours`}</option>)}
          </select>
        </Field>
        {error && <span role="alert" className="text-xs text-[var(--error-ink)]">{error}</span>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={saving} onClick={() => void rotate()}>{saving ? "Rotating…" : "Rotate the key"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateHookDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (secret: string, record: WebhookView) => void }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEventType[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await send("/api/app/webhooks", "POST", { label, targetUrl: url, eventTypes: events });
      onCreated(result.secret, result.record);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the webhook");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a webhook</DialogTitle>
          <DialogDescription>Its signing secret is shown once, on the next screen.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Name" htmlFor="hook-label" required>
            <input id="hook-label" className={control} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="URL" htmlFor="hook-url" required hint="HTTPS, on a public address.">
            <input id="hook-url" type="url" className={control} value={url} maxLength={500} placeholder="https://" onChange={(e) => setUrl(e.target.value)} autoComplete="off" />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-[var(--ink)]">
              Events <InfoTip label="About payloads">Each event carries identifiers and figures only — never an SSN, bank details or the client&rsquo;s record.</InfoTip>
            </legend>
            {WEBHOOK_EVENTS.map((item) => (
              <label key={item.key} className="flex items-start gap-2 text-sm text-[var(--body)]">
                <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={events.includes(item.key)} onChange={(e) => setEvents(e.target.checked ? [...events, item.key] : events.filter((x) => x !== item.key))} />
                <span><span className="font-semibold text-[var(--ink)]">{item.label}</span> <code className={code}>{item.key}</code><span className="block text-xs text-[var(--muted)]">{item.description}</span></span>
              </label>
            ))}
          </fieldset>
          {error && <span role="alert" className="text-xs text-[var(--error-ink)]">{error}</span>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !label.trim() || !url.trim() || events.length === 0}>{saving ? "Adding…" : "Add webhook"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeliveryLogDialog({ hook, onClose }: { hook: WebhookView; onClose: () => void }) {
  const [attempts, setAttempts] = useState<WebhookAttemptView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    send(`/api/app/webhooks/${hook.id}`, "GET").then((r) => setAttempts(r.attempts), (e) => setError(e instanceof Error ? e.message : "Could not load the log"));
  }, [hook.id]);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Delivery log · {hook.label}</DialogTitle>
          <DialogDescription>The last 50 attempts, newest first.</DialogDescription>
        </DialogHeader>
        {error ? <Callout tone="error" title={error} /> : !attempts ? <SectionLoading label="Loading the delivery log" /> : attempts.length === 0 ? (
          <EmptyState title="Nothing sent yet" hint="Attempts appear here as events are delivered. Send a test to try the receiver." />
        ) : (
          <div className="max-h-[420px] overflow-y-auto">
            <table className={st.table}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={st.th}>When</th>
                  <th scope="col" className={st.th}>Event</th>
                  <th scope="col" className={st.th}>Result</th>
                  <th scope="col" className={st.th}>Response</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id}>
                    <td className={cn(st.td, "whitespace-nowrap")}>{when(a.attemptedAt)}<span className={st.sub}>Attempt {a.attempt}{a.durationMs != null ? ` · ${a.durationMs} ms` : ""}</span></td>
                    <td className={st.td}>{eventLabel(a.eventType)}</td>
                    <td className={st.td}><StatusChip tone={a.ok ? "good" : "danger"} dot>{a.statusCode ? `HTTP ${a.statusCode}` : "No answer"}</StatusChip></td>
                    <td className={cn(st.td, "max-w-[280px] break-words text-xs")}>{a.error && !a.ok ? <span className="text-[var(--error-ink)]">{a.error}</span> : null}{a.responseSnippet ? <span className="block font-mono text-[var(--muted)]">{a.responseSnippet}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
