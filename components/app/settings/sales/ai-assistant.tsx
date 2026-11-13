"use client";

/**
 * Settings › AI assistant, round 8 (board settings-r8/products-and-ai, option A "What it will do", owner pick
 * 2026-11-12; first built as the LA-3.3 placeholder, board l3-set-ai). Still blocked on decision 4 — the
 * provider, and whether its terms allow health data — so no AI provider is called anywhere, and this page
 * says so in its status line ("Not available yet") instead of a warning card and a greyed switch.
 *
 *   What it does  the features first (Underwriting helper, "First to arrive", then call summaries, next best
 *                 step, quote explainer and compliance check), "You stay in charge", the fixed sent / never-sent
 *                 lists, and the "When it's ready" choice.
 *   Your data     the two lists in full and the data controls the agency has chosen.
 *
 * One gold button, "Join the early list": the opt-in stores the agency's place, the features it wants and what
 * should happen on the day, in its Sales settings (tenant_sales_settings.settings.aiEarlyList, through the
 * existing PUT /api/app/settings/sales/settings). The data-controls sheet stores the same way. Provider,
 * region, what the provider keeps and call transcripts are read only: nothing is wired to them.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";

import { Pane, StatusLine, ThreeWay } from "@/components/app/settings/sales-process/parts";
import { Button } from "@/components/ui/button";
import { ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { notify } from "@/lib/notify";
import type { SalesSettingsView } from "@/lib/salesSettings/settings";
import { cn } from "@/lib/utils";

import { blankEarlyList, DEFAULT_CONTROLS, FEATURES, KEEP_FOR, NEVER, SENT, WHEN_READY, WHO, type EarlyList, type FeatureKey } from "@/components/app/settings/ai/content";
import { DataControlsSheet, EarlyListDialog } from "@/components/app/settings/ai/early-list";

import { notSaved, salesApi, SalesPanelTop, useSalesSample } from "./shared";

type Status = { available: boolean; enabled: boolean; provider: string | null; reason: string; sends: string };
type Tab = "does" | "data";

const SAMPLE: Status = {
  available: false, enabled: false, provider: null,
  reason: "Not available yet — waiting on the choice of AI provider and its terms for health data.",
  sends: "Health answers and medications are sent. Social Security numbers, banking details and full contact records are never sent.",
};

const LINK = "font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

function DataLists({ full }: { full?: boolean }) {
  return (
    <div className="grid gap-0 sm:grid-cols-2">
      <div className="min-w-0 border-[var(--border)] px-4 py-3 sm:border-r">
        <h4 className="m-0 mb-2 text-sm font-semibold text-[var(--ink)]">Sent, only for the feature in use</h4>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {SENT.map((item) => (
            <li key={item.label} className="flex gap-2.5">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
              <span className="min-w-0 text-sm leading-[1.5] text-[var(--body)]">
                {item.label}
                {full ? <span className="block text-xs text-[var(--muted)]">{item.sub}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 border-t border-[var(--border)] px-4 py-3 sm:border-t-0">
        <h4 className="m-0 mb-2 text-sm font-semibold text-[var(--ink)]">Never sent</h4>
        <ul className={cn("m-0 grid list-none gap-2 p-0", full && "sm:grid-cols-2")}>
          {NEVER.map((label) => (
            <li key={label} className="flex gap-2.5">
              <X aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--error-ink)]" />
              <span className="text-sm leading-[1.5] text-[var(--body)]">{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const box = "rounded-lg border border-[var(--border)] bg-card";

export function SalesAiAssistant() {
  const sample = useSalesSample();
  const [status, setStatus] = useState<Status | null>(sample ? SAMPLE : null);
  const [view, setView] = useState<SalesSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!sample);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("does");
  const [dialog, setDialog] = useState<{ start: EarlyList } | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, settings] = await Promise.all([
      salesApi<Status>("/api/app/ai-assistant/status"),
      salesApi<SalesSettingsView>("/api/app/settings/sales/settings"),
    ]);
    if (!s.ok) setError(s.error || "The assistant's status could not be loaded.");
    else { setStatus(s.data); setError(null); }
    if (settings.ok) { setView(settings.data); setSettingsError(null); }
    else setSettingsError(settings.schemaPending ? "Your early-list choice needs a database update" : "Couldn't load your early-list choice");
    setLoading(false);
  }, []);

  useEffect(() => {
    if (sample) return;
    const t = window.setTimeout(load, 0);
    return () => window.clearTimeout(t);
  }, [load, sample]);

  const early = view?.settings.aiEarlyList ?? null;
  const joined = Boolean(early?.joined);
  const canEdit = sample || Boolean(view?.canEdit);
  const who = early?.joinedBy?.name || view?.me.name || "";

  /** Writes the whole Sales settings document with the new entry (the only save path the document has). */
  async function store(next: EarlyList | null, done: string) {
    if (sample) { notSaved(); return true; }
    if (!view) return false;
    setSaving(true);
    setSaveError(null);
    const res = await salesApi<SalesSettingsView>("/api/app/settings/sales/settings", {
      method: "PUT",
      body: { settings: { ...view.settings, aiEarlyList: next }, expected_updated_at: view.updatedAt },
    });
    setSaving(false);
    if (!res.ok) { setSaveError(`Couldn't save · ${res.error}`); return false; }
    setView(res.data);
    notify.done(done);
    return true;
  }

  const openJoin = (whenReady?: EarlyList["whenReady"]) => {
    const start = early ?? blankEarlyList();
    setDialog({ start: whenReady ? { ...start, whenReady } : start });
  };

  async function join(features: FeatureKey[], whenReady: EarlyList["whenReady"]) {
    const base = early ?? blankEarlyList();
    const next: EarlyList = {
      ...base,
      joined: true,
      joinedAt: base.joined ? base.joinedAt : new Date().toISOString(),
      joinedBy: base.joined && base.joinedBy ? base.joinedBy : view ? { name: view.me.name, email: view.me.email } : null,
      features,
      whenReady,
    };
    if (await store(next, joined ? "Early list choices saved" : "You're on the early list")) setDialog(null);
  }

  async function leave() {
    if (!early) return;
    if (await store({ ...early, joined: false, joinedAt: null, joinedBy: null }, "You left the early list")) setDialog(null);
  }

  async function saveControls(controls: EarlyList["controls"]) {
    if (await store({ ...(early ?? blankEarlyList()), controls }, "Data controls saved")) setControlsOpen(false);
  }

  async function pickWhenReady(whenReady: EarlyList["whenReady"]) {
    if (!joined || !early) { openJoin(whenReady); return; }
    await store({ ...early, whenReady }, whenReady === "email" ? "We'll just email you" : "Admins can try it the day it's ready");
  }

  const joinedOn = early?.joinedAt ? new Date(early.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  const controls = early?.controls ?? DEFAULT_CONTROLS;
  const readOnly = !canEdit ? "Only an owner can change this." : undefined;

  const statusLine = (() => {
    if (!status) return null;
    if (saveError) return <StatusLine tone="bad">{saveError}</StatusLine>;
    if (status.available) return <StatusLine tone="ok">Ready to turn on{status.provider ? ` · signed with ${status.provider}` : ""}</StatusLine>;
    if (settingsError) {
      return (
        <StatusLine tone="warn" action={<button type="button" onClick={() => void load()} className={cn("text-sm", LINK)}>Try again</button>}>
          Not available yet · {settingsError}
        </StatusLine>
      );
    }
    return (
      <StatusLine tone="warn">
        Not available yet · we&apos;re choosing a provider whose terms cover health data
        {joined ? ` · you're on the early list${joinedOn ? ` since ${joinedOn}` : ""}; we'll email ${who || "you"} the day it's ready` : " · join the early list to hear the day it's ready"}
      </StatusLine>
    );
  })();

  const joinButton = joined ? (
    <Button type="button" variant="outline" onClick={() => openJoin()}>On the early list</Button>
  ) : (
    <span title={readOnly ?? (settingsError ? settingsError : undefined)} className="inline-flex">
      <Button type="button" variant="highlight" disabled={!canEdit || (!sample && !view)} onClick={() => openJoin()}>Join the early list</Button>
    </span>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:h-full">
      <SalesPanelTop
        sample={sample}
        tabs={<ViewTabs label="AI assistant" tabs={[{ key: "does" as Tab, label: "What it does" }, { key: "data" as Tab, label: "Your data" }]} value={tab} onChange={setTab} controls="ai-assistant-panel" />}
        actions={(
          <>
            <Button type="button" variant="outline" onClick={() => setControlsOpen(true)} disabled={loading || Boolean(error)}>Data controls</Button>
            {joinButton}
          </>
        )}
      />
      {!loading && !error && statusLine}
      <div id="ai-assistant-panel" role="tabpanel" aria-label={tab === "does" ? "What it does" : "Your data"} className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <TableCard><SectionLoading rows={4} columns={2} label="Loading the assistant's status" /></TableCard>
        ) : error || !status ? (
          <TableCard>
            <ErrorState title="Couldn't load the assistant's status" detail="Check your connection and try again." action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} />
          </TableCard>
        ) : tab === "does" ? (
          <Pane className="flex-1" label="What it does" bodyClassName="p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {FEATURES.map((feature) => (
                <article key={feature.key} className={cn(box, "flex min-w-0 flex-col gap-2 p-4")}>
                  <div className="flex items-center gap-2.5">
                    <span aria-hidden className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--primary-soft)] text-xs font-semibold text-[var(--accent-ink)]">{feature.mark}</span>
                    <h3 className="m-0 min-w-0 flex-1 text-sm font-semibold text-[var(--ink)]">{feature.title}</h3>
                    {feature.first && <StatusChip tone="info" dot={false}>First to arrive</StatusChip>}
                  </div>
                  <p className="m-0 text-sm leading-[1.5] text-[var(--body)]">{feature.body}</p>
                  <div className="rounded-md bg-[var(--surface-alt)] px-3 py-2 text-sm leading-[1.5] text-[var(--body)]">
                    <span className="block text-xs text-[var(--muted)]">Example</span>
                    {feature.example}
                  </div>
                  <p className="m-0 mt-auto text-xs text-[var(--muted)]">{feature.where}</p>
                </article>
              ))}
              <article className="flex min-w-0 flex-col gap-2 rounded-lg border border-dashed border-[var(--border-strong)] p-4">
                <h3 className="m-0 text-base font-semibold text-[var(--ink)]">You stay in charge</h3>
                <p className="m-0 text-sm leading-[1.5] text-[var(--body)]">Nothing it writes is saved or sent to a client without an agent&apos;s click. Admins can switch each feature off.</p>
                <p className="m-0 mt-auto text-xs"><button type="button" onClick={() => setTab("data")} className={LINK}>See your data rules ›</button></p>
              </article>
            </div>

            <section aria-label="Your data" className={cn(box, "mt-3")}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
                <h3 className="m-0 text-sm font-semibold text-[var(--ink)]">Your data</h3>
                <span className="text-xs text-[var(--muted)]">Fixed in code · an owner can&apos;t add to &ldquo;sent&rdquo; or remove from &ldquo;never&rdquo;</span>
              </div>
              <DataLists />
            </section>

            <section aria-label="When it's ready" className={cn(box, "mt-3 flex flex-wrap items-center gap-3 px-4 py-3")}>
              <span aria-hidden className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--primary-soft)] text-[var(--accent-ink)]"><Check className="size-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--ink)]">When it&apos;s ready</span>
                <span className="block text-xs text-[var(--muted)]">Pick what happens the day a provider is signed. Nothing is sent until then.</span>
              </span>
              <span title={readOnly} className="inline-flex">
                <ThreeWay label="When it's ready" size="md" value={early?.whenReady ?? "email"} options={WHEN_READY} disabled={!canEdit || saving || (!sample && !view)} onChange={(key) => void pickWhenReady(key)} />
              </span>
            </section>
          </Pane>
        ) : (
          <Pane className="flex-1" label="Your data">
            <div className="border-b border-[var(--border)] px-4 py-2.5 text-xs text-[var(--muted)]">Fixed in code · an owner can&apos;t add to &ldquo;sent&rdquo; or remove from &ldquo;never&rdquo;. Income is kept on the client record, never in the interview answers.</div>
            <DataLists full />
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--border)] px-4 py-3 text-sm text-[var(--body)]">
              <span><span className="text-[var(--muted)]">Provider</span> · {status.provider ?? "Not chosen yet"}</span>
              <span><span className="text-[var(--muted)]">Processed</span> · United States only</span>
              <span><span className="text-[var(--muted)]">Medication doses</span> · {controls.sendDoses ? "sent" : "not sent"}</span>
              <span><span className="text-[var(--muted)]">Kept</span> · {KEEP_FOR.find((k) => k.key === controls.keepFor)?.label}</span>
              <span><span className="text-[var(--muted)]">Who can use it</span> · {WHO.find((w) => w.key === controls.who)?.label}</span>
              <button type="button" onClick={() => setControlsOpen(true)} className={cn("ml-auto text-sm", LINK)}>Data controls ›</button>
            </div>
          </Pane>
        )}
      </div>

      {dialog && (
        <EarlyListDialog
          open
          start={dialog.start}
          joined={joined}
          who={who}
          canEdit={canEdit}
          saving={saving}
          onCancel={() => setDialog(null)}
          onJoin={(features, whenReady) => void join(features, whenReady)}
          onLeave={() => void leave()}
        />
      )}
      {controlsOpen && (
        <DataControlsSheet start={controls} canEdit={canEdit && (sample || Boolean(view))} saving={saving} onCancel={() => setControlsOpen(false)} onSave={(next) => void saveControls(next)} />
      )}
    </div>
  );
}
