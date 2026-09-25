"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useId, useMemo, useState, type FormEvent } from "react";

import { Callout, Field, Pill, SettingsCard, SettingsTableCard, btn, control, st } from "@/components/app/settings/primitives";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { ADMIN_ROLE_LABELS, isAdminRole } from "@/lib/adminAuth/roles";
import {
  OVERRIDE_REASON_MAX,
  OVERRIDE_SCHEMA_PENDING_MESSAGE,
  canRemoveOverride,
  canSetOverride,
  canWriteOverrides,
  isDeviation,
  overrideRefusal,
  planLabel,
  shortName,
  type OverrideState,
  type TenantFeatureRow,
  type TenantFeatureState,
} from "@/lib/tenantFeatureOverrides/constants";
import { recordDate, recordDayMonth } from "@/lib/tenants/recordFormat";
import { cn } from "@/lib/utils";

/** Features the platform kill switch closes for this tenant: off for everyone, or beta and not listed. */
export type KillStates = Record<string, "off" | "beta">;

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const countWord = (n: number) => NUMBER_WORDS[n] ?? String(n);

/** "2 Sep", with the year only when it is not this year — the board's short date. */
function shortDate(value: string | null, dateOnly = false): string {
  if (!value) return "—";
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return "—";
  // UTC and hand-built month names (recordFormat), so the server and the browser print the same
  // text: ICU builds disagree on "Sep" / "Sept", and a local timezone could move the day.
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  const iso = date.toISOString();
  return sameYear ? recordDayMonth(iso) : recordDate(iso);
}

function StatePill({ state }: { state: OverrideState }) {
  return state === "on" ? <Pill tone="success">On</Pill> : <Pill tone="neutral">Off</Pill>;
}

function killNote(kill: "off" | "beta" | undefined): string | null {
  if (kill === "off") return "Off for everyone right now (kill switch), which wins over this.";
  if (kill === "beta") return "Limited to named tenants right now (kill switch), and this one is not listed.";
  return null;
}

export function FeaturesTabView({
  tenantId,
  role,
  state,
  kill,
}: {
  tenantId: string;
  role: AdminRole;
  state: TenantFeatureState;
  kill: KillStates;
}) {
  const cancelled = state.status === "cancelled";
  const plan = planLabel(state);
  const overrides = state.features.filter((row) => row.override);
  const deviations = overrides.filter(isDeviation).length;
  const granted = cancelled ? [] : state.features.filter((row) => row.plan_grants);

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <Callout tone="info" title="An override is a deviation, and it is listed as one">
        {state.source === "default" ? (
          <>This tenant has no subscription, so {plan} decides what it can reach. </>
        ) : state.tenantsOnPlan !== null ? (
          <>The plan is the answer for {state.tenantsOnPlan} {state.tenantsOnPlan === 1 ? "tenant" : "tenants"}. </>
        ) : null}
        {deviations === 0
          ? "Nothing is switched on or off for this one specifically."
          : `${countWord(deviations)} ${deviations === 1 ? "thing is" : "things are"} switched on or off for this one specifically — each with who did it, when, and why, so the next person does not have to guess whether it was deliberate.`}
      </Callout>

      <OverridesTable tenantId={tenantId} role={role} state={state} rows={overrides} deviations={deviations} kill={kill} plan={plan} />

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <SettingsTableCard
          title={`Everything ${plan} grants`}
          actions={<Pill tone="neutral">{granted.length === 1 ? "1 feature" : `${granted.length} features`}</Pill>}
        >
          <table className={st.table}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Feature</th>
                <th scope="col" className={cn(st.th, "w-[160px]")}>State</th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {granted.length === 0 ? (
                <tr>
                  <td colSpan={2} className={st.td}>
                    {cancelled ? "The subscription is cancelled, so nothing is granted." : `${plan} grants no features.`}
                  </td>
                </tr>
              ) : (
                granted.map((row) => (
                  <tr key={row.feature_key} className="m-row">
                    <td className={st.td}>
                      {row.label}
                      {!row.in_plan && row.addon_names.length > 0 && (
                        <span className={st.sub}>Through the {row.addon_names.join(", ")} add-on</span>
                      )}
                    </td>
                    <td className={st.td}>
                      {kill[row.feature_key] === "off" ? (
                        <Pill tone="error">Off for everyone</Pill>
                      ) : kill[row.feature_key] === "beta" ? (
                        <Pill tone="warning">Named tenants only</Pill>
                      ) : row.override?.state === "off" ? (
                        <Pill tone="warning">Overridden off</Pill>
                      ) : (
                        <Pill tone="success">On</Pill>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </SettingsTableCard>

        <div className="flex min-w-0 flex-col gap-5">
          <AddOverrideCard tenantId={tenantId} role={role} state={state} plan={plan} />

          <Callout tone="error" title="A kill switch is not an override">
            Switching a feature off for everyone is done on the{" "}
            <Link href="/admin/features" className="font-semibold text-[var(--ink)] underline">
              Features page
            </Link>{" "}
            and shows customers &ldquo;temporarily unavailable&rdquo;. An override here changes this one agency only:
            the feature leaves their menu, and opening it directly says it is not available on their account &mdash;
            no upgrade offer, and nothing in it is deleted. A kill switch still wins over an override that switches a
            feature on.
          </Callout>
        </div>
      </div>
    </div>
  );
}

/* ── overrides on this tenant ──────────────────────────────────────────── */

function OverridesTable({
  tenantId,
  role,
  state,
  rows,
  deviations,
  kill,
  plan,
}: {
  tenantId: string;
  role: AdminRole;
  state: TenantFeatureState;
  rows: TenantFeatureRow[];
  deviations: number;
  kill: KillStates;
  plan: string;
}) {
  const router = useRouter();
  const reasonId = useId();
  const [removing, setRemoving] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mayRemove = state.schemaReady && canRemoveOverride(role);
  const columns = mayRemove ? 6 : 5;

  async function remove(featureKey: string) {
    if (reason.trim().length < 5) {
      setError("Give a reason of at least 5 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/tenants/${tenantId}/feature-overrides`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature_key: featureKey, reason: reason.trim() }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "Could not remove the override.");
        return;
      }
      setRemoving(null);
      setReason("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsTableCard
      title="Overrides on this tenant"
      actions={
        deviations > 0 ? (
          <Pill tone="warning" dot>
            {deviations === 1 ? "1 deviation" : `${deviations} deviations`} from {plan}
          </Pill>
        ) : (
          <Pill tone="neutral">No deviations from {plan}</Pill>
        )
      }
    >
      <table className={cn(st.table, "min-w-[860px]")}>
        <thead>
          <tr className={st.headRow}>
            <th scope="col" className={cn(st.th, "w-[240px]")}>Feature</th>
            <th scope="col" className={cn(st.th, "w-[120px]")}>Plan says</th>
            <th scope="col" className={cn(st.th, "w-[150px]")}>This tenant</th>
            <th scope="col" className={st.th}>Why</th>
            <th scope="col" className={cn(st.th, "w-[170px]")}>Set by</th>
            {mayRemove && (
              <th scope="col" className={cn(st.th, "w-[96px]")}>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="m-seq">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns} className={st.td}>
                {state.schemaReady
                  ? `No overrides. ${plan.charAt(0).toUpperCase()}${plan.slice(1)} decides everything this tenant can reach.`
                  : `No overrides can exist yet. ${OVERRIDE_SCHEMA_PENDING_MESSAGE}`}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const override = row.override!;
              const who = shortName(override.set_by_name);
              const roleLabel = override.set_by_role && isAdminRole(override.set_by_role) ? ADMIN_ROLE_LABELS[override.set_by_role] : null;
              const note = override.state === "on" ? killNote(kill[row.feature_key]) : null;
              const open = removing === row.feature_key;
              return (
                <Fragment key={row.feature_key}>
                  <tr className="m-row">
                    <td className={st.td}>{row.label}</td>
                    <td className={st.td}>
                      <StatePill state={row.plan_grants ? "on" : "off"} />
                    </td>
                    <td className={st.td}>
                      <StatePill state={override.state} />
                      {!isDeviation(row) && <span className={cn(st.sub, "mt-1")}>The plan now says the same.</span>}
                      {note && <span className={cn(st.sub, "mt-1")}>{note}</span>}
                    </td>
                    <td className={st.td}>
                      {override.reason}
                      {override.review_on && <span className={st.sub}>Review {shortDate(override.review_on, true)}</span>}
                    </td>
                    <td className={st.td} title={[override.set_by_name, roleLabel].filter(Boolean).join(" · ") || undefined}>
                      {who ?? "A removed admin"} &middot; {shortDate(override.set_at)}
                    </td>
                    {mayRemove && (
                      <td className={cn(st.td, "text-right")}>
                        <button
                          type="button"
                          className={btn("danger-row")}
                          aria-expanded={open}
                          aria-label={`Remove the override on ${row.label}`}
                          onClick={() => {
                            setRemoving(open ? null : row.feature_key);
                            setReason("");
                            setError(null);
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={columns} className={cn(st.td, "bg-[var(--canvas)]")}>
                        <form
                          className="flex flex-wrap items-end gap-3"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void remove(row.feature_key);
                          }}
                        >
                          <Field
                            label={`Why remove it? ${row.label} goes back to ${row.plan_grants ? "on" : "off"}, as the plan says.`}
                            htmlFor={reasonId}
                            required
                            error={error}
                            hint="Required. It is written to the audit log."
                            className="min-w-[280px] flex-1"
                          >
                            <input
                              id={reasonId}
                              className={control}
                              value={reason}
                              maxLength={OVERRIDE_REASON_MAX}
                              onChange={(event) => setReason(event.target.value)}
                              autoFocus
                            />
                          </Field>
                          <div className="flex gap-2 pb-[26px]">
                            <button type="button" className={btn("ghost")} onClick={() => setRemoving(null)} disabled={busy}>
                              Cancel
                            </button>
                            <button type="submit" className={btn("primary")} disabled={busy}>
                              {busy ? "Removing…" : "Remove the override"}
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </SettingsTableCard>
  );
}

/* ── add an override ───────────────────────────────────────────────────── */

function AddOverrideCard({ tenantId, role, state, plan }: { tenantId: string; role: AdminRole; state: TenantFeatureState; plan: string }) {
  const router = useRouter();
  const ids = { feature: useId(), state: useId(), why: useId(), review: useId() };
  const [featureKey, setFeatureKey] = useState("");
  const [target, setTarget] = useState<OverrideState>("off");
  const [reason, setReason] = useState("");
  const [reviewOn, setReviewOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const choices = useMemo(() => {
    const groups = new Map<string, TenantFeatureRow[]>();
    for (const row of state.features) {
      if (row.is_archived) continue;
      if (!groups.has(row.module_label)) groups.set(row.module_label, []);
      groups.get(row.module_label)!.push(row);
    }
    return [...groups.entries()];
  }, [state.features]);
  const selected = state.features.find((row) => row.feature_key === featureKey) ?? null;
  const mayOn = canSetOverride(role, "on");

  if (!canWriteOverrides(role)) {
    return (
      <SettingsCard title="Add an override">
        <p className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
          Your role ({ADMIN_ROLE_LABELS[role]}) can see overrides but not change them. A super admin or a support agent can.
        </p>
      </SettingsCard>
    );
  }

  const closedReason = !state.schemaReady
    ? OVERRIDE_SCHEMA_PENDING_MESSAGE
    : state.status === "cancelled"
      ? "This tenant's subscription is cancelled, so nothing is granted and an override would change nothing."
      : null;

  function choose(key: string) {
    setFeatureKey(key);
    setError(null);
    setSaved(null);
    const row = state.features.find((item) => item.feature_key === key);
    // Default to the only setting that differs from the plan.
    if (row) setTarget(row.plan_grants ? "off" : "on");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(null);
    if (!selected) {
      setError("Choose a feature.");
      return;
    }
    const refusal = overrideRefusal({ role, state: target, reason, planGrants: selected.plan_grants });
    if (refusal) {
      setError(refusal);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/tenants/${tenantId}/feature-overrides`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature_key: selected.feature_key, state: target, reason: reason.trim(), review_on: reviewOn || null }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "Could not save the override.");
        return;
      }
      setSaved(`${selected.label} is now ${target} for this tenant.`);
      setFeatureKey("");
      setReason("");
      setReviewOn("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || closedReason !== null;

  return (
    <SettingsCard title="Add an override">
      <form className="flex flex-col gap-3.5" onSubmit={submit} noValidate>
        {closedReason && (
          <p role="note" className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--warning-ink)]">
            {closedReason}
          </p>
        )}

        <Field
          label="Feature"
          htmlFor={ids.feature}
          hint={
            selected
              ? `${plan.charAt(0).toUpperCase()}${plan.slice(1)} says ${selected.plan_grants ? "on" : "off"}.${selected.override ? " This tenant already has an override on it; saving replaces it." : ""}`
              : undefined
          }
        >
          <select id={ids.feature} className={control} value={featureKey} onChange={(event) => choose(event.target.value)} disabled={disabled}>
            <option value="">Choose a feature…</option>
            {choices.map(([module, rows]) => (
              <optgroup key={module} label={module}>
                {rows.map((row) => (
                  <option key={row.feature_key} value={row.feature_key}>
                    {row.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        <Field
          label="Set to"
          htmlFor={ids.state}
          hint={mayOn ? undefined : "Only a super admin can switch on a feature the plan does not include."}
        >
          <select
            id={ids.state}
            className={control}
            value={target}
            onChange={(event) => setTarget(event.target.value as OverrideState)}
            disabled={disabled}
          >
            <option value="on" disabled={!mayOn}>
              {mayOn ? "On" : "On (super admin only)"}
            </option>
            <option value="off">Off</option>
          </select>
        </Field>

        <Field label="Why" htmlFor={ids.why} required error={error} hint="Required. It appears in the table above and in the audit log.">
          <textarea
            id={ids.why}
            className={cn(control, "h-auto min-h-[88px] py-2.5")}
            rows={3}
            maxLength={OVERRIDE_REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={disabled}
          />
        </Field>

        <Field label="Review on" htmlFor={ids.review} hint="Optional. Shown next to the override; nothing happens on the date.">
          <input
            id={ids.review}
            type="date"
            className={control}
            value={reviewOn}
            onChange={(event) => setReviewOn(event.target.value)}
            disabled={disabled}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={btn("primary", "self-start")} disabled={disabled}>
            {busy ? "Saving…" : "Add the override"}
          </button>
          {saved && (
            <span role="status" className="text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--success-ink)]">
              {saved}
            </span>
          )}
        </div>
      </form>
    </SettingsCard>
  );
}
