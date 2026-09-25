"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

import { Field, Pill, SettingsTableCard, btn, control } from "@/components/app/settings/primitives";
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

function StatusPill({ state }: { state: SwitchState }) {
  if (state === "off") return <Pill tone="warning" dot>Switched off</Pill>;
  if (state === "beta") return <Pill tone="warning" dot>Named tenants only</Pill>;
  return <Pill tone="success" dot>Available</Pill>;
}

/**
 * The row's third column: what the customer reads and what the next admin reads. Never an invented
 * message — with none left, it quotes the standard notice the agent app really shows.
 */
function SwitchDetail({ featureSwitch, reason }: { featureSwitch: FeatureSwitch | undefined; reason: SwitchReason | undefined }) {
  if (!featureSwitch || featureSwitch.state === "on") return <>&mdash;</>;

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

export function FeatureSwitchesPanel({
  features,
  initialSwitches,
  initialReasons,
  canToggle,
}: {
  features: SwitchableFeature[];
  initialSwitches: FeatureSwitch[];
  initialReasons: Record<string, SwitchReason>;
  /** super_admin only — the PUT route refuses everyone else regardless. */
  canToggle: boolean;
}) {
  const router = useRouter();
  const ids = { beta: useId(), msg: useId(), why: useId() };
  const [live, setLive] = useState<Record<string, FeatureSwitch>>(
    Object.fromEntries(initialSwitches.map((s) => [s.feature_key, s])),
  );
  const [reasons, setReasons] = useState<Record<string, SwitchReason>>(initialReasons);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function stateOf(key: string): SwitchState {
    return live[key]?.state ?? "on";
  }

  function edit(key: string) {
    const current = live[key];
    setOpen(key);
    setError(null);
    setDraft({
      state: current?.state ?? "on",
      betaIds: (current?.beta_tenant_ids ?? []).join("\n"),
      offMessage: current?.off_message ?? "",
      reason: "",
    });
  }

  function close() {
    setOpen(null);
    setDraft(null);
    setError(null);
  }

  async function save(event: FormEvent<HTMLFormElement>, key: string) {
    event.preventDefault();
    if (!draft) return;

    const betaTenantIds = draft.betaIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    // Validated with the same function the API uses, so the form cannot accept what the server
    // refuses — or refuse what it would have taken.
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
          feature_key: key,
          state: draft.state,
          beta_tenant_ids: betaTenantIds,
          off_message: draft.offMessage.trim() || null,
          reason: draft.reason.trim(),
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; featureSwitch?: FeatureSwitch; reason?: SwitchReason | null }
        | null;

      if (!res.ok || !body?.featureSwitch) {
        // The draft stays on screen — a refused save must never discard what was typed.
        setError(body?.error ?? "Could not save this switch.");
        return;
      }

      const saved = body.featureSwitch;
      setLive((v) => ({ ...v, [key]: saved }));
      setReasons((v) => {
        const next = { ...v };
        if (body.reason) next[key] = body.reason;
        else delete next[key];
        return next;
      });
      close();
      notify.done(
        draft.state === "on" ? "Feature switched back on" : `Feature set to "${SWITCH_STATE_LABELS[draft.state]}"`,
      );
      // The headline above the tabs is counted on the server.
      router.refresh();
    } catch {
      setError("Could not reach the server. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const rows = features
    .map((f, index) => ({ f, index, state: stateOf(f.featureKey) }))
    .sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.index - b.index);

  return (
    <SettingsTableCard title="Kill switches" actions={<Pill tone="error">Super admin only</Pill>}>
      <ul className="m-0 list-none p-0">
        {rows.length === 0 && (
          <li className="px-4 py-3 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
            There are no features in the catalog yet, so there is nothing to switch off.
          </li>
        )}

        {rows.map(({ f, state }) => {
          const isOpen = open === f.featureKey;
          const notOn = state !== "on";
          return (
            <li
              key={f.featureKey}
              className={cn("border-t border-[var(--border)] first:border-t-0", notOn && "bg-[var(--warning-surface)]")}
            >
              <div className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4">
                <span className="min-w-0 md:w-[210px] md:shrink-0">
                  <span
                    title={f.label}
                    className="block break-words text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]"
                  >
                    {f.featureKey}
                  </span>
                  {f.isArchived && (
                    <Pill tone="neutral" className="mt-1">
                      Archived
                    </Pill>
                  )}
                </span>

                <span className="min-w-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] md:w-[150px] md:shrink-0">
                  {f.moduleLabel}
                  {f.overrideCount > 0 && (
                    <span className="block">
                      {f.overrideCount} tenant {f.overrideCount === 1 ? "override" : "overrides"}
                    </span>
                  )}
                </span>

                <span className="min-w-0 flex-1 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--body)]">
                  <SwitchDetail featureSwitch={live[f.featureKey]} reason={reasons[f.featureKey]} />
                </span>

                <span className="flex shrink-0 items-center gap-2">
                  <StatusPill state={state} />
                  {canToggle && (
                    <button
                      type="button"
                      className={btn("row")}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Cancel changing" : "Change"} the kill switch on ${f.featureKey}`}
                      onClick={() => (isOpen ? close() : edit(f.featureKey))}
                    >
                      {isOpen ? "Cancel" : "Change"}
                    </button>
                  )}
                </span>
              </div>

              {canToggle && isOpen && draft && (
                <form
                  className="flex flex-col gap-3.5 border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-4"
                  onSubmit={(event) => void save(event, f.featureKey)}
                  noValidate
                >
                  <div>
                    <div
                      role="radiogroup"
                      aria-label={`State of ${f.featureKey}`}
                      className="flex flex-wrap gap-2"
                    >
                      {SWITCH_STATES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          role="radio"
                          aria-checked={draft.state === s}
                          className={btn(draft.state === s ? "primary-sm" : "secondary")}
                          onClick={() => setDraft({ ...draft, state: s })}
                        >
                          {SWITCH_STATE_LABELS[s]}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 mb-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                      {SWITCH_STATE_HELP[draft.state]}
                    </p>
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

                  <Field
                    label="Why"
                    htmlFor={ids.why}
                    required
                    hint="Required. Written to the audit log, and shown on this row as the internal reason."
                  >
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
                    <p role="alert" className="m-0 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--error-ink)]">
                      {error}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className={btn("primary")} disabled={busy}>
                      {busy ? "Saving…" : "Apply"}
                    </button>
                    <button type="button" className={btn("ghost")} onClick={close} disabled={busy}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-3 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--body)]">
        Archived features are listed too &mdash; archiving only takes a feature out of the plan picker, and tenants
        who already have it keep it, so a kill switch on one still takes something away. Naming a feature and taking
        it away from every tenant do not share a permission: a non-super-admin sees this tab read-only.
      </div>
    </SettingsTableCard>
  );
}
