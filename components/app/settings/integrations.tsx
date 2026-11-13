"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState, SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import { SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { IDLE_DAYS, type ApiKeyView, type WebhookView } from "@/lib/apiKeys/constants";
import { answerWords, keyState, replacedKeyIds, type HookExtras, type KeyState } from "@/lib/apiKeys/hub";
import type { LeadPostBoard } from "@/lib/leadPost/board";
import { viewerTimeZone } from "@/lib/format/dates";
import { notify } from "@/lib/notify";
import { DeveloperDocs, type DocTopic } from "@/components/app/settings/integrations/developer-docs";
import { IdleDialog, NewKeyWizard, RevokeDialog, RotateDialog } from "@/components/app/settings/integrations/key-dialogs";
import { KeySheet, KeysTable, type KeyFilter } from "@/components/app/settings/integrations/keys";
import { Overview, type ExtensionRead, type VendorsRead } from "@/components/app/settings/integrations/overview";
import { clockWords, inWords, InlineLink, send, StatusLine } from "@/components/app/settings/integrations/shared";
import { AddWebhookSheet, WebhookSheet, WebhooksTable, type HookFilter, type HookSheetTab } from "@/components/app/settings/integrations/webhooks";

/**
 * Settings › Integrations — round 8, option A "Integrations hub" (owner pick 2026-11-12,
 * docs/design/settings-r8/api-webhooks.html). One place for everything connected to Insurvas:
 * Overview (apps, webhook endpoints, lead vendors and the browser extension, each saying where it is
 * managed) · API keys · Webhooks · Developer docs. Records open as right sheets; a key and a signing
 * secret are each shown once and never again — the server does not have them to show (LA-8.7).
 */

type Tab = "overview" | "keys" | "webhooks" | "docs";
type Loaded = { keys: ApiKeyView[]; keysPending: boolean; hooks: WebhookView[]; hooksPending: boolean; extras: Record<string, HookExtras> };

const NO_EXTRAS: HookExtras = { nextTryAt: null, missed: 0, lastAnswer: null };
const KEPT_STORE = "insurvas.integrations.kept-idle-keys";
const KEEP_MS = IDLE_DAYS * 86_400_000;

/** "Keep it, ask again in 90 days": remembered on this computer (there is no column for it yet). */
function readKept(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(KEPT_STORE);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function writeKept(value: Record<string, number>) {
  try { window.localStorage.setItem(KEPT_STORE, JSON.stringify(value)); } catch { /* private window: it asks again next time */ }
}

async function readOrPending<T>(url: string, pick: (json: Record<string, unknown>) => T, empty: T): Promise<{ value: T; pending: boolean }> {
  try {
    return { value: pick(await send<Record<string, unknown>>(url, "GET")), pending: false };
  } catch (error) {
    if ((error as { code?: string }).code === "schema_pending") return { value: empty, pending: true };
    throw error;
  }
}

export function IntegrationsSettings() {
  const [tab, setTab] = useState<Tab>("overview");
  const [topic, setTopic] = useState<DocTopic>("address");
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<VendorsRead>(null);
  const [extension, setExtension] = useState<ExtensionRead>(null);
  const [now, setNow] = useState(() => Date.now());
  const [kept, setKept] = useState<Record<string, number>>({});
  const [origin, setOrigin] = useState("https://app.insurvas.com");

  const [keyFilter, setKeyFilter] = useState<KeyFilter>("active");
  const [keyQuery, setKeyQuery] = useState("");
  const [hookFilter, setHookFilter] = useState<HookFilter>("all");
  const [keySheet, setKeySheet] = useState<string | null>(null);
  const [hookSheet, setHookSheet] = useState<{ id: string; tab: HookSheetTab } | null>(null);
  const [wizard, setWizard] = useState(false);
  const [adding, setAdding] = useState(false);
  const [rotating, setRotating] = useState<ApiKeyView | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyView | null>(null);
  const [idleFor, setIdleFor] = useState<ApiKeyView | null>(null);
  const [busyHook, setBusyHook] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [keys, hooks] = await Promise.all([
        readOrPending("/api/app/api-keys", (json) => (json.keys as ApiKeyView[]) ?? [], [] as ApiKeyView[]),
        readOrPending("/api/app/webhooks", (json) => ({ hooks: (json.webhooks as WebhookView[]) ?? [], extras: (json.extras as Record<string, HookExtras>) ?? {} }), { hooks: [] as WebhookView[], extras: {} as Record<string, HookExtras> }),
      ]);
      setData({ keys: keys.value, keysPending: keys.pending, hooks: hooks.value.hooks, hooksPending: hooks.pending, extras: hooks.value.extras });
      setError(null);
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Integrations didn't load");
    }
  }, []);

  // Lead posting and the browser extension are read, never changed, here; either may be off the plan.
  const loadAround = useCallback(async () => {
    const tz = encodeURIComponent(viewerTimeZone());
    const [board, grants] = await Promise.allSettled([
      send<LeadPostBoard>(`/api/app/lead-post-keys/board?tz=${tz}`, "GET"),
      send<{ grants?: { issuedAt?: string }[]; sites?: unknown[] }>("/api/app/extension/grants", "GET"),
    ]);
    setVendors(board.status === "fulfilled" && Array.isArray(board.value?.vendors) ? { vendors: board.value.vendors, campaigns: board.value.campaigns ?? [], allVendors: board.value.allVendors ?? [] } : "off");
    if (grants.status === "fulfilled") {
      const last = (grants.value.grants ?? []).map((grant) => grant.issuedAt).filter((at): at is string => Boolean(at)).sort().reverse()[0] ?? null;
      setExtension({ sites: (grants.value.sites ?? []).length, lastAt: last });
    } else setExtension("off");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setKept(readKept());
      setOrigin(window.location.origin);
      void load();
      void loadAround();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, loadAround]);

  const reload = useCallback(async () => { await load(); }, [load]);

  const keys = useMemo(() => data?.keys ?? [], [data]);
  const hooks = useMemo(() => data?.hooks ?? [], [data]);
  const extras = useMemo(() => data?.extras ?? {}, [data]);
  const replaced = useMemo(() => replacedKeyIds(keys), [keys]);
  const states = useMemo(() => {
    const map = new Map<string, KeyState>();
    for (const key of keys) {
      const state = keyState(key, replaced.has(key.id), now);
      const keptAt = kept[key.id];
      // Kept after the idle question: it stops asking for 90 days, and says so.
      map.set(key.id, state.kind === "idle" && keptAt && now - keptAt < KEEP_MS ? { ...state, kind: "working", label: `Kept · idle ${state.idleDays ?? IDLE_DAYS} days`, tone: "neutral" } : state);
    }
    return map;
  }, [keys, replaced, now, kept]);

  const openKey = keys.find((key) => key.id === keySheet) ?? null;
  const openHook = hooks.find((hook) => hook.id === hookSheet?.id) ?? null;
  const goDocs = (next: DocTopic) => { setHookSheet(null); setAdding(false); setTopic(next); setTab("docs"); };

  async function retryHook(hook: WebhookView, mode: "waiting" | "missed") {
    setBusyHook(hook.id);
    try {
      const result = await send<{ queued: number; turnedOn: boolean; sent: { succeeded: number } }>(`/api/app/webhooks/${hook.id}`, "POST", { mode });
      notify.done(`${hook.label}: ${result.turnedOn ? "turned on · " : ""}${result.queued} sent again${result.sent.succeeded ? ` · ${result.sent.succeeded} delivered` : ""}.`);
      await reload();
    } catch (cause) {
      notify.fail(cause instanceof Error ? cause.message : "That did not work. Try again.");
    } finally {
      setBusyHook(null);
    }
  }

  const newKeyButton = <Button type="button" variant="highlight" onClick={() => setWizard(true)}><Plus aria-hidden="true" />New API key</Button>;
  const addHookButton = (gold: boolean) => <Button type="button" variant={gold ? "highlight" : "outline"} onClick={() => setAdding(true)}>{gold && <Plus aria-hidden="true" />}Add a webhook</Button>;

  const liveKeys = keys.filter((key) => states.get(key.id)?.live && states.get(key.id)?.kind !== "rotating_out");
  const header = (
    <SettingsSectionHeader
      tabs={
        <UnderlineTabs
          label="Integrations"
          tabs={[
            { key: "overview", label: "Overview" },
            { key: "keys", label: "API keys", count: data ? liveKeys.length : null },
            { key: "webhooks", label: "Webhooks", count: data ? hooks.length : null },
            { key: "docs", label: "Developer docs" },
          ]}
          value={tab}
          onChange={setTab}
        />
      }
      actions={
        tab === "overview" ? <>{addHookButton(false)}{newKeyButton}</>
          : tab === "keys" ? newKeyButton
            : tab === "webhooks" ? addHookButton(true)
              : undefined
      }
    />
  );

  if (error && !data) {
    return (
      <SettingsStack className="gap-4">
        {header}
        <StatusLine tone="bad">Integrations didn&rsquo;t load · <InlineLink onClick={() => void load()}>try again</InlineLink></StatusLine>
        <TableCard title="Everything connected">
          <ErrorState title="Couldn't load your integrations" detail="Keys keep working and deliveries keep going; only this page failed to load." action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} />
        </TableCard>
      </SettingsStack>
    );
  }
  if (!data) {
    return (
      <SettingsStack className="gap-4">
        {header}
        <StatusLine tone="muted">Reading your integrations</StatusLine>
        <TableCard title={tab === "webhooks" ? "Webhooks" : tab === "keys" ? "API keys" : "Everything connected"}><SectionLoading label="Loading your integrations" rows={6} columns={6} /></TableCard>
      </SettingsStack>
    );
  }

  // ── the status line ──────────────────────────────────────────────────────────
  const failing = hooks.find((hook) => hook.status === "failing") ?? null;
  const turnedOff = hooks.find((hook) => hook.status === "disabled") ?? null;
  const idleKey = keys.find((key) => states.get(key.id)?.kind === "idle") ?? null;
  const endingKey = keys.filter((key) => states.get(key.id)?.kind === "ends_soon").sort((a, b) => (states.get(a.id)?.endsInDays ?? 0) - (states.get(b.id)?.endsInDays ?? 0))[0] ?? null;
  const openDeliveries = (hook: WebhookView) => setHookSheet({ id: hook.id, tab: "deliveries" });
  const working = liveKeys.filter((key) => states.get(key.id)?.tone !== "warning").length;

  const hookTrouble = failing ? (() => {
    const extra = extras[failing.id] ?? NO_EXTRAS;
    const said = extra.lastAnswer ? answerWords({ ok: false, statusCode: extra.lastAnswer.statusCode, error: extra.lastAnswer.error }).chip.toLowerCase() : "failed";
    return (
      <>
        {failing.label} isn&rsquo;t receiving events · {failing.consecutiveFailures} failed tries in a row, last at {clockWords(failing.lastFailureAt)}: {said}
        {tab === "webhooks" && extra.nextTryAt ? ` · next try ${inWords(extra.nextTryAt)}` : ""}
        {failing.pending ? ` · ${failing.pending} ${failing.pending === 1 ? "event" : "events"} waiting` : ""} — <InlineLink onClick={() => openDeliveries(failing)}>see deliveries</InlineLink>
      </>
    );
  })() : turnedOff ? (
    <>
      {turnedOff.label} was turned off after failing{(extras[turnedOff.id]?.missed ?? 0) ? ` · ${extras[turnedOff.id]?.missed} events not delivered` : ""} — <InlineLink onClick={() => setHookSheet({ id: turnedOff.id, tab: "setup" })}>turn it back on</InlineLink>
    </>
  ) : null;
  const keyNotes = [
    endingKey ? <span key="end">{tab === "keys" ? `${endingKey.label} ends in ${states.get(endingKey.id)?.endsInDays ?? 0} days` : `1 key ends in ${states.get(endingKey.id)?.endsInDays ?? 0} days`}</span> : null,
    idleKey ? <span key="idle">{idleKey.label} hasn&rsquo;t been used in {states.get(idleKey.id)?.idleDays ?? IDLE_DAYS} days — <InlineLink onClick={() => setIdleFor(idleKey)}>review it</InlineLink></span> : null,
  ].filter(Boolean);
  const pendingNote = data.keysPending || data.hooksPending ? `${data.keysPending ? "API keys" : "Webhooks"} need a database update` : null;

  let tone: "ok" | "warn" | "bad" | "muted" = "ok";
  let line: React.ReactNode;
  if (tab === "docs") {
    tone = "ok";
    line = <>Version 1 · for the developer connecting an app to your agency</>;
  } else if (tab === "webhooks") {
    tone = hookTrouble ? "bad" : hooks.length ? "ok" : "muted";
    const workingHooks = hooks.filter((hook) => hook.status === "active" && hook.consecutiveFailures === 0).length;
    line = hookTrouble ?? (hooks.length ? <>{workingHooks} {workingHooks === 1 ? "webhook" : "webhooks"} working{hooks.length > workingHooks ? ` · ${hooks.length - workingHooks} paused or retrying` : ""}</> : <>No webhooks yet</>);
  } else if (tab === "keys") {
    tone = keyNotes.length ? "warn" : liveKeys.length ? "ok" : "muted";
    line = <>{liveKeys.length ? `${working} ${working === 1 ? "key" : "keys"} working` : "No keys yet"}{keyNotes.map((note, index) => <span key={index}> · {note}</span>)}</>;
  } else {
    tone = hookTrouble ? "bad" : keyNotes.length ? "warn" : liveKeys.length || hooks.length ? "ok" : "muted";
    line = hookTrouble
      ? <>{hookTrouble}{keyNotes.map((note, index) => <span key={index}> · {note}</span>)}</>
      : keyNotes.length
        ? <>{keyNotes.map((note, index) => <span key={index}>{index ? " · " : ""}{note}</span>)}</>
        : <>{liveKeys.length} {liveKeys.length === 1 ? "app" : "apps"} and {hooks.length} {hooks.length === 1 ? "webhook" : "webhooks"} connected</>;
  }
  if (pendingNote) { tone = tone === "ok" || tone === "muted" ? "warn" : tone; line = <>{line} · {pendingNote}</>; }
  if (error) { tone = "bad"; line = <>Integrations didn&rsquo;t refresh · <InlineLink onClick={() => void load()}>try again</InlineLink></>; }

  return (
    <SettingsStack className="gap-4 lg:min-h-0 lg:flex-1">
      {header}
      <StatusLine tone={tone}>{line}</StatusLine>

      {tab === "overview" && (
        <Overview
          keys={keys}
          keyStates={states}
          hooks={hooks}
          vendors={vendors}
          extension={extension}
          onKeys={() => setTab("keys")}
          onWebhooks={() => setTab("webhooks")}
          onOpenKey={(key) => setKeySheet(key.id)}
          onOpenHook={(hook) => setHookSheet({ id: hook.id, tab: hook.status === "failing" ? "deliveries" : "setup" })}
          emptyActions={<>{addHookButton(false)}{newKeyButton}</>}
        />
      )}

      {tab === "keys" && (
        <KeysTable
          keys={keys}
          states={states}
          filter={keyFilter}
          onFilter={setKeyFilter}
          query={keyQuery}
          onQuery={setKeyQuery}
          selectedId={keySheet}
          onOpen={(key) => setKeySheet(key.id)}
          onReview={setIdleFor}
          newKeyButton={newKeyButton}
        />
      )}

      {tab === "webhooks" && (
        <WebhooksTable
          hooks={hooks}
          extras={extras}
          filter={hookFilter}
          onFilter={setHookFilter}
          selectedId={hookSheet?.id ?? null}
          onOpen={(hook) => setHookSheet({ id: hook.id, tab: hook.status === "failing" ? "deliveries" : "setup" })}
          onRetry={(hook, mode) => void retryHook(hook, mode)}
          busyId={busyHook}
          addButton={addHookButton(false)}
        />
      )}

      {tab === "docs" && <DeveloperDocs origin={origin} topic={topic} onTopic={setTopic} />}

      {openKey && (
        <KeySheet
          key={`${openKey.id}:${openKey.label}:${openKey.scopes.join()}:${openKey.expiresAt ?? ""}`}
          apiKey={openKey}
          state={states.get(openKey.id) as KeyState}
          replaced={replaced.has(openKey.id)}
          origin={origin}
          onClose={() => setKeySheet(null)}
          onSaved={reload}
          onRotate={() => setRotating(openKey)}
          onRevoke={() => setRevoking(openKey)}
        />
      )}
      {openHook && hookSheet && (
        <WebhookSheet
          key={`${openHook.id}:${openHook.label}:${openHook.targetUrl}:${openHook.eventTypes.join()}`}
          hook={openHook}
          extra={extras[openHook.id] ?? NO_EXTRAS}
          tab={hookSheet.tab}
          onTab={(next) => setHookSheet({ id: openHook.id, tab: next })}
          onClose={() => setHookSheet(null)}
          onChanged={reload}
          onDocs={() => goDocs("signature")}
        />
      )}
      {adding && <AddWebhookSheet onClose={() => setAdding(false)} onAdded={reload} onDocs={() => goDocs("signature")} />}
      {wizard && <NewKeyWizard origin={origin} onClose={() => setWizard(false)} onCreated={() => void reload()} />}
      {rotating && <RotateDialog apiKey={rotating} origin={origin} onClose={() => setRotating(null)} onRotated={() => { setKeySheet(null); void reload(); }} />}
      {revoking && <RevokeDialog apiKey={revoking} onClose={() => setRevoking(null)} onRevoked={() => { setRevoking(null); setKeySheet(null); setIdleFor(null); void reload(); }} />}
      {idleFor && (
        <IdleDialog
          apiKey={idleFor}
          onClose={() => setIdleFor(null)}
          onRevoke={() => { setRevoking(idleFor); setIdleFor(null); }}
          onKept={() => { const next = { ...readKept(), [idleFor.id]: Date.now() }; writeKept(next); setKept(next); setIdleFor(null); void reload(); }}
        />
      )}
    </SettingsStack>
  );
}
