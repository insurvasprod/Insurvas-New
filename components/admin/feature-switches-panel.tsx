"use client";

import { ChevronRight } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

import { Field, control } from "@/components/app/settings/primitives";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Button } from "@/components/ui/button";
import { DataToolbar, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { NoMatches } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip } from "@/components/ui/status-chip";
import type { FeatureModuleRow } from "@/lib/features/constants";
import {
  SWITCH_STATES,
  SWITCH_STATE_HELP,
  SWITCH_STATE_LABELS,
  STANDARD_KILL_NOTICE,
  switchRefusalReason,
  OFF_MESSAGE_MAX,
  type FeatureSwitch,
  type SwitchReason,
  type SwitchState,
} from "@/lib/features/killSwitchRules";
import { cn } from "@/lib/utils";

export type SwitchableFeature = {
  featureKey: string;
  label: string;
  module: string;
  moduleLabel: string;
  isArchived: boolean;
  /** Tenants with a per-tenant override on this feature (either direction). */
  overrideCount: number;
};

type Draft = { state: SwitchState; betaIds: string; offMessage: string; reason: string };

/** Switched off first, then named-tenants, then everything that is on — the rows you came for on top. */
const STATE_RANK: Record<SwitchState, number> = { off: 0, beta: 1, on: 2 };

const REASON_MAX = 500;

/** The state as the one chip on a row: Off, Beta (named tenants only) or On. */
export function SwitchStateChip({ state }: { state: SwitchState }) {
  if (state === "off") return <StatusChip tone="danger" dot>Off</StatusChip>;
  if (state === "beta") return <StatusChip tone="info" dot>Beta</StatusChip>;
  return <StatusChip tone="good" dot>On</StatusChip>;
}

/**
 * What the customer reads and what the next admin reads. Never an invented message — with none left, it quotes the
 * standard notice the agent app really shows.
 */
export function SwitchDetail({ featureSwitch, reason }: { featureSwitch: FeatureSwitch | undefined; reason: SwitchReason | undefined }) {
  if (!featureSwitch || featureSwitch.state === "on") return <>On for everyone whose plan or add-on includes it.</>;

  const message = featureSwitch.off_message?.trim() || null;
  const named = featureSwitch.beta_tenant_ids.length;
  const lead =
    featureSwitch.state === "beta"
      ? `On for ${named} named ${named === 1 ? "tenant" : "tenants"} only. Everyone else sees`
      : "Customer sees";
  const hover = reason
    ? `Last changed ${reason.changedAtUtc}${reason.changedBy ? ` by ${reason.changedBy}` : ""}`
    : undefined;

  return (
    <>
      {message ? (
        <>
          {lead}: &ldquo;{message}&rdquo;
        </>
      ) : (
        <>
          {lead} the standard notice: &ldquo;{STANDARD_KILL_NOTICE}&rdquo;
        </>
      )}{" "}
      <span title={hover}>Internal: {reason?.reason ?? "no reason on record."}</span>
    </>
  );
}

/**
 * The switch editor (state, beta tenants, the message agents see, and why), now in the feature's sheet (admin round
 * 1, catalog.html screen 4). Super admin only; the PUT route refuses everyone else regardless. Validated with the
 * same function the API uses, so the form cannot accept what the server refuses.
 */
export function FeatureSwitchForm({ featureKey, current, onSaved, onCancel }: {
  featureKey: string;
  current: FeatureSwitch | undefined;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const ids = { beta: useId(), msg: useId(), why: useId() };
  const [draft, setDraft] = useState<Draft>({
    state: current?.state ?? "on",
    betaIds: (current?.beta_tenant_ids ?? []).join("\n"),
    offMessage: current?.off_message ?? "",
    reason: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const betaTenantIds = draft.betaIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const refusal = switchRefusalReason({
      state: draft.state,
      betaTenantIds,
      offMessage: draft.offMessage || null,
    });
    if (refusal) return setError(refusal);
    if (draft.reason.trim().length < 5) {
      return setError("Give a reason of at least 5 characters — this is what explains the change later.");
    }

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/feature-switches", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feature_key: featureKey,
          state: draft.state,
          beta_tenant_ids: betaTenantIds,
          off_message: draft.offMessage.trim() || null,
          reason: draft.reason.trim(),
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; featureSwitch?: FeatureSwitch } | null;

      if (!res.ok || !body?.featureSwitch) {
        // The draft stays on screen — a refused save must never discard what was typed.
        setError(body?.error ?? "Could not save this switch.");
        return;
      }

      notify.done(draft.state === "on" ? "Feature switched back on" : `Feature set to "${SWITCH_STATE_LABELS[draft.state]}"`);
      onSaved();
      // The switch list, the reasons and the figures are read on the server.
      router.refresh();
    } catch {
      setError("Could not reach the server. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3.5" onSubmit={(event) => void save(event)} noValidate>
      <div>
        <div role="radiogroup" aria-label={`State of ${featureKey}`} className="flex flex-wrap gap-2">
          {SWITCH_STATES.map((s) => (
            <ToggleChip key={s} role="radio" selected={draft.state === s} onClick={() => setDraft({ ...draft, state: s })}>
              {SWITCH_STATE_LABELS[s]}
            </ToggleChip>
          ))}
        </div>
        <p className="mt-1.5 mb-0 text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{SWITCH_STATE_HELP[draft.state]}</p>
      </div>

      {draft.state === "beta" && (
        <Field label="Tenant IDs, one per line" htmlFor={ids.beta} required>
          <textarea
            id={ids.beta}
            rows={3}
            className={cn(control, "h-auto min-h-[88px] py-2.5 font-mono")}
            value={draft.betaIds}
            onChange={(e) => setDraft({ ...draft, betaIds: e.target.value })}
          />
        </Field>
      )}

      {draft.state !== "on" && (
        <Field
          label="Message shown to agents"
          htmlFor={ids.msg}
          hint={<>Optional. Leave it empty and agents see the standard notice: &ldquo;{STANDARD_KILL_NOTICE}&rdquo;</>}
        >
          <input
            id={ids.msg}
            className={control}
            maxLength={OFF_MESSAGE_MAX}
            placeholder="Dialing is unavailable while we switch DNC providers."
            value={draft.offMessage}
            onChange={(e) => setDraft({ ...draft, offMessage: e.target.value })}
          />
        </Field>
      )}

      <Field label="Why" htmlFor={ids.why} required hint="Required. Written to the audit log, and shown as the internal reason.">
        <input
          id={ids.why}
          className={control}
          maxLength={REASON_MAX}
          placeholder="DNC vendor outage, incident #412"
          value={draft.reason}
          onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
        />
      </Field>

      {error && (
        <p role="alert" className="m-0 text-xs leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--error-ink)]">{error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save switch"}</Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

export type SwitchFilters = { q: string; module: string; state: "all" | SwitchState };

/**
 * The Switches tab (catalog.html screen 4): every feature with its state, the agencies holding an override, what
 * agents see and why, off and beta first. Search, module and state filter (in the address). A row opens the
 * feature's sheet, where a super admin changes the switch; platform config reads it.
 */
export function FeatureSwitchesPanel({
  features,
  switches,
  reasons,
  modules,
  canToggle,
  filters,
  onFilters,
  onOpen,
  openKey,
}: {
  features: SwitchableFeature[];
  switches: Record<string, FeatureSwitch>;
  reasons: Record<string, SwitchReason>;
  modules: FeatureModuleRow[];
  /** super_admin only — the PUT route refuses everyone else regardless. */
  canToggle: boolean;
  filters: SwitchFilters;
  onFilters: (patch: Partial<SwitchFilters>) => void;
  onOpen: (featureKey: string) => void;
  openKey: string | null;
}) {
  const stateOf = (key: string): SwitchState => switches[key]?.state ?? "on";
  const needle = filters.q.trim().toLowerCase();
  const rows = features
    .map((f, index) => ({ f, index, state: stateOf(f.featureKey) }))
    .filter(({ f, state }) => (filters.module === "all" || f.module === filters.module) && (filters.state === "all" || state === filters.state) && (!needle || f.label.toLowerCase().includes(needle) || f.featureKey.includes(needle)))
    .sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.index - b.index);
  const anyFilter = needle !== "" || filters.module !== "all" || filters.state !== "all";

  return (
    <PagedTableCard
      total={rows.length}
      noun="features"
      suffix="off and beta first"
      toolbar={
        <DataToolbar actions={canToggle ? undefined : <span className="text-xs text-muted-foreground">Read-only. Only a super admin can change a kill switch.</span>}>
          <ToolbarSearch value={filters.q} onChange={(value) => onFilters({ q: value })} placeholder="Search feature or key" label="Search features" />
          <select aria-label="Module" value={filters.module} onChange={(event) => onFilters({ module: event.target.value })} className={toolbarControl}>
            <option value="all">All modules</option>
            {modules.map((module) => <option key={module.key} value={module.key}>{module.label}</option>)}
          </select>
          <select aria-label="State" value={filters.state} onChange={(event) => onFilters({ state: event.target.value as SwitchFilters["state"] })} className={toolbarControl}>
            <option value="all">Every state</option>
            <option value="off">Off for everyone</option>
            <option value="beta">Beta, named tenants only</option>
            <option value="on">On</option>
          </select>
          {anyFilter && <Button type="button" variant="ghost" onClick={() => onFilters({ q: "", module: "all", state: "all" })}>Clear</Button>}
        </DataToolbar>
      }
    >
      {features.length === 0 && (
        <p className="m-0 px-4 py-3 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
          There are no features in the catalog yet, so there is nothing to switch off.
        </p>
      )}
      {features.length > 0 && rows.length === 0 && <NoMatches noun="features" onClear={() => onFilters({ q: "", module: "all", state: "all" })} />}
      <PagedBody as="ul" className="m-0 list-none p-0" label="Feature switches">
        {rows.map(({ f, state }) => (
          <li key={f.featureKey} className="border-t border-[var(--border)] first:border-t-0">
            <button
              type="button"
              onClick={() => onOpen(f.featureKey)}
              aria-label={`Open ${f.label}`}
              className={cn(
                "flex min-h-11 w-full cursor-pointer items-center gap-4 px-4 py-2 text-left text-sm hover:bg-[var(--hover-wash)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)]",
                openKey === f.featureKey && "bg-[var(--hover-wash)]",
              )}
            >
              <span className="flex w-[220px] min-w-0 shrink-0 items-baseline gap-2" title={f.featureKey}>
                <span className="truncate font-semibold text-[var(--ink)]">{f.label}</span>
                {f.isArchived && <span className="shrink-0 text-xs text-[var(--muted)]">archived</span>}
              </span>
              <span className="hidden w-[130px] shrink-0 truncate text-[var(--muted)] md:block">{f.moduleLabel}</span>
              <span className="hidden w-[90px] shrink-0 text-right tabular-nums text-[var(--muted)] md:block" title="Agencies with an override on this feature, either way">
                {f.overrideCount > 0 ? `${f.overrideCount} ${f.overrideCount === 1 ? "agency" : "agencies"}` : "—"}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--body)]">
                {state === "on" ? <span className="text-[var(--muted)]">—</span> : <SwitchDetail featureSwitch={switches[f.featureKey]} reason={reasons[f.featureKey]} />}
              </span>
              <SwitchStateChip state={state} />
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </PagedBody>
    </PagedTableCard>
  );
}
