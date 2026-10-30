"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { notify } from "@/lib/notify";

import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/admin/status-chip";
import type { FeatureModuleGroup } from "@/lib/features/constants";
import type { PlanLimits } from "@/lib/metering/constants";
import type { PlanEditorMeter } from "@/lib/plans/planSave";
import { buildAgentMenu } from "@/lib/menu/definition";
import { BILLING_CYCLE_LABELS, formatCents, formatCentsAsCurrency, monthlyEquivalentCents, parseDollarsToCents, type PlanPrices } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Blank means "this cycle isn't offered"; anything else must parse to whole cents. */
function centsFromInput(value: string): { cents: number | null; invalid: boolean } {
  if (value.trim() === "") return { cents: null, invalid: false };
  const cents = parseDollarsToCents(value);
  return { cents, invalid: cents === null };
}

const card = "min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5";
const h2 = "text-title-sm leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]";
const label = "text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]";
const input = "mt-1.5 box-border h-9 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] aria-[invalid=true]:border-[var(--error)]";
const hint = "mt-1.5 block text-xs leading-[1.5] text-[var(--muted)]";

const EDITABLE_LIMITS: Array<[keyof PlanLimits, string]> = [
  ["max_publishers", "Publishers"],
  ["max_marketing_partners", "Marketing partners"],
  ["max_affiliates", "Affiliates"],
  ["max_buffer_seats", "Buffer seats"],
  ["max_partner_users", "Partner users"],
  ["max_setter_seats", "Setter seats"],
  ["max_active_campaigns", "Active campaigns"],
  ["max_carriers", "Carriers"],
];

/** One meter's editor state: whether the plan sets its own allowance, and what it is (blank = unlimited). */
type MeterDraft = { own: boolean; included: string; hardCap: boolean };

/** "Two months free" when a longer cycle costs less than that many months at the monthly price. */
function cycleNote(cycle: "monthly" | "quarterly" | "yearly", cents: number | null, monthlyCents: number | null) {
  if (cents === null) return "Not offered — empty is not the same as $0.00, and $0.00 is a real price.";
  if (cycle === "monthly") return cents === 0 ? "Sold, free." : "Sold.";
  const months = cycle === "yearly" ? 12 : 3;
  const perMonth = `${formatCentsAsCurrency(monthlyEquivalentCents(cents, cycle))}/mo`;
  if (monthlyCents && monthlyCents > 0) {
    const free = months - cents / monthlyCents;
    if (free >= 0.5) {
      const rounded = Math.round(free * 2) / 2;
      return `Sold at ${perMonth}. ${rounded === 1 ? "One month" : rounded === 2 ? "Two months" : `${rounded} months`} free.`;
    }
  }
  return `Sold at ${perMonth}.`;
}

/**
 * The plan editor (p-adm-plan-edit): price, limits and features for one version, with the menu an
 * owner would see and what publishing does to existing subscribers.
 *
 * There are no drafts: saving a version nobody is on edits it in place, and saving one people are
 * on publishes the next version (they stay where they are). So the board's separate "Save draft"
 * and "Publish" are one action here, named for what it will actually do.
 */
export function PlanVersionEditor({
  planId,
  planName,
  planCode,
  planVersion,
  isArchived,
  groups,
  initialGranted,
  initialPrices,
  initialLimits,
  subscriberCount,
  nextVersion,
  meters,
}: {
  planId: string;
  planName: string;
  planCode: string;
  planVersion: number;
  isArchived: boolean;
  groups: FeatureModuleGroup[];
  initialGranted: string[];
  initialPrices: PlanPrices | null;
  initialLimits: PlanLimits | null;
  subscriberCount: number;
  /** What a publish would number the new version: max(version) of the code + 1, not this row + 1. */
  nextVersion: number;
  meters: PlanEditorMeter[];
}) {
  const router = useRouter();
  const [granted, setGranted] = useState<Set<string>>(new Set(initialGranted));
  const [monthly, setMonthly] = useState(initialPrices?.price_monthly_cents != null ? formatCents(initialPrices.price_monthly_cents) : "");
  const [quarterly, setQuarterly] = useState(initialPrices?.price_quarterly_cents != null ? formatCents(initialPrices.price_quarterly_cents) : "");
  const [yearly, setYearly] = useState(initialPrices?.price_yearly_cents != null ? formatCents(initialPrices.price_yearly_cents) : "");
  const [setupFee, setSetupFee] = useState(formatCents(initialPrices?.setup_fee_cents ?? 0));
  const [trialDays, setTrialDays] = useState(String(initialPrices?.trial_days ?? 0));
  const [limits, setLimits] = useState<Record<string, string>>(
    Object.fromEntries(EDITABLE_LIMITS.map(([key]) => [key, initialLimits?.[key] == null ? "" : String(initialLimits[key])])),
  );
  const [meterDrafts, setMeterDrafts] = useState<Record<string, MeterDraft>>(
    Object.fromEntries(
      meters.map((meter) => [
        meter.meter_key,
        {
          own: meter.plan !== null,
          included: meter.plan?.included_qty == null ? "" : String(meter.plan.included_qty),
          hardCap: meter.plan?.hard_cap ?? meter.default_hard_cap,
        },
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);

  // An archived feature this plan already grants stays granted (SA-2.1) and can't be offered by
  // the picker. Shown locked rather than hidden, so the ticked list matches what the plan does.
  const lockedArchived = useMemo(
    () => new Set(groups.flatMap((g) => g.features.filter((f) => f.is_archived && granted.has(f.feature_key))).map((f) => f.feature_key)),
    [groups, granted],
  );

  // Preview and the agent's real menu render from the SAME definition, so they can't drift.
  const previewMenu = useMemo(() => buildAgentMenu(granted), [granted]);

  const parsed = { monthly: centsFromInput(monthly), quarterly: centsFromInput(quarterly), yearly: centsFromInput(yearly) };
  const parsedSetup = centsFromInput(setupFee);
  const trial = Number(trialDays);
  const trialInvalid = !Number.isInteger(trial) || trial < 0 || trial > 365;
  const limitInvalid = Object.values(limits).some((value) => value.trim() !== "" && !/^\d+$/.test(value.trim()));
  const meterInvalid = Object.values(meterDrafts).some((draft) => draft.own && draft.included.trim() !== "" && !/^\d+$/.test(draft.included.trim()));
  const priceInvalid = parsed.monthly.invalid || parsed.quarterly.invalid || parsed.yearly.invalid || parsedSetup.invalid;
  const noCyclePriced = parsed.monthly.cents === null && parsed.quarterly.cents === null && parsed.yearly.cents === null;
  const grantedCount = granted.size;
  const canSave = grantedCount > 0 && !priceInvalid && !trialInvalid && !limitInvalid && !meterInvalid;
  const publishes = subscriberCount > 0;
  const actionLabel = publishes ? `Publish version ${nextVersion}` : "Save changes";

  function toggle(key: string) {
    if (lockedArchived.has(key)) return;
    setGranted((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }

  function toggleModule(group: FeatureModuleGroup) {
    const selectable = group.features.filter((f) => !f.is_archived);
    const allOn = selectable.length > 0 && selectable.every((f) => granted.has(f.feature_key));
    setGranted((prev) => { const next = new Set(prev); for (const f of selectable) { if (allOn) next.delete(f.feature_key); else next.add(f.feature_key); } return next; });
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    const res = await fetch(`/api/admin/plans/${planId}/version`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature_keys: [...granted],
        price_monthly_cents: parsed.monthly.cents,
        price_quarterly_cents: parsed.quarterly.cents,
        price_yearly_cents: parsed.yearly.cents,
        setup_fee_cents: parsedSetup.cents ?? 0,
        trial_days: trial || 0,
        limits: Object.fromEntries(Object.entries(limits).map(([key, value]) => [key, value.trim() === "" ? null : Number(value)])),
        // The full list of meters this version sets itself; the rest take the platform default.
        meters: Object.entries(meterDrafts)
          .filter(([, draft]) => draft.own)
          .map(([meter_key, draft]) => ({ meter_key, included_qty: draft.included.trim() === "" ? null : Number(draft.included), hard_cap: draft.hardCap })),
      }),
    });
    const body = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) { notify.block(body?.error ?? "Could not save"); return; }
    if (body.createdNewVersion) {
      notify.done(`Version ${body.version} published — the ${subscriberCount.toLocaleString()} existing ${subscriberCount === 1 ? "subscriber keeps" : "subscribers keep"} version ${planVersion}`);
      router.push(`/admin/plans/${body.planId}/edit`);
    } else {
      notify.done(`${planName} saved`);
    }
    router.refresh();
  }

  const saveButton = (
    <Button type="button" onClick={() => void save()} disabled={saving || !canSave}>
      {saving ? "Saving…" : actionLabel}
    </Button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <PageHeader
          title={`${planName} — version ${planVersion}`}
          breadcrumbs={[{ label: "Catalog" }, { label: "Plans", href: "/admin/plans" }, { label: `${planName} — version ${planVersion}` }]}
          actions={saveButton}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {isArchived ? <StatusChip tone="neutral">Archived</StatusChip> : <StatusChip tone="good" dot>Live</StatusChip>}
          <StatusChip tone="neutral"><code className="font-mono">{planCode}</code></StatusChip>
          <StatusChip tone={publishes ? "warning" : "neutral"}>{subscriberCount.toLocaleString()} live {subscriberCount === 1 ? "subscriber" : "subscribers"} on this version</StatusChip>
        </div>
      </div>

      <StatStrip label="This version">
        <StatTile
          label="Features granted"
          value={grantedCount.toLocaleString("en-US")}
          valueTone={grantedCount === 0 ? "danger" : undefined}
          footnote={`of ${groups.flatMap((group) => group.features.filter((feature) => !feature.is_archived)).length.toLocaleString("en-US")} in the catalog`}
        />
        <StatTile label="Monthly" value={monthly.trim() === "" ? "—" : `$${monthly}`} footnote={yearly.trim() === "" ? "no yearly price" : `$${yearly} a year`} />
        <StatTile label="Trial" value={trialInvalid ? "—" : `${trial} ${trial === 1 ? "day" : "days"}`} footnote={parsedSetup.cents ? `$${setupFee} setup fee` : "no setup fee"} />
        <StatTile label="Limits set" value={Object.values(limits).filter((value) => value.trim() !== "").length.toLocaleString("en-US")} footnote={`of ${EDITABLE_LIMITS.length} · empty means unlimited`} />
        <StatTile
          label="Subscribers"
          value={subscriberCount.toLocaleString("en-US")}
          valueTone={publishes ? "warning" : undefined}
          footnote={publishes ? "saving publishes a new version" : "on this version"}
        />
      </StatStrip>

      {publishes && (
        <Callout
          tone="warning"
          title={`Saving publishes version ${nextVersion}; the ${subscriberCount.toLocaleString()} existing ${subscriberCount === 1 ? "subscriber stays" : "subscribers stay"} on version ${planVersion}.`}
        />
      )}

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <section className={card} aria-labelledby="plan-pricing">
            <h2 id="plan-pricing" className={h2}>Pricing</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {(["monthly", "yearly", "quarterly"] as const).map((cycle) => {
                const value = cycle === "monthly" ? monthly : cycle === "yearly" ? yearly : quarterly;
                const set = cycle === "monthly" ? setMonthly : cycle === "yearly" ? setYearly : setQuarterly;
                const p = parsed[cycle];
                return (
                  <label key={cycle} className="block">
                    <span className={label}>{BILLING_CYCLE_LABELS[cycle]}</span>
                    <input className={input} inputMode="decimal" placeholder="Not offered" value={value} onChange={(e) => set(e.target.value)} aria-invalid={p.invalid || undefined} />
                    <span className={cn(hint, p.invalid && "text-[var(--error-ink)]")}>{p.invalid ? "Enter an amount like 449.99" : cycleNote(cycle, p.cents, parsed.monthly.cents)}</span>
                  </label>
                );
              })}
            </div>
            <div className="mt-4 grid gap-4 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
              <label className="block">
                <span className={label}>Setup fee (one-time)</span>
                <input className={input} inputMode="decimal" value={setupFee} onChange={(e) => setSetupFee(e.target.value)} aria-invalid={parsedSetup.invalid || undefined} />
                {parsedSetup.invalid && <span className={cn(hint, "text-[var(--error-ink)]")}>Enter an amount like 99.00</span>}
              </label>
              <label className="block">
                <span className={label}>Trial days</span>
                <input className={input} type="number" min={0} max={365} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} aria-invalid={trialInvalid || undefined} />
                <span className={cn(hint, trialInvalid && "text-[var(--error-ink)]")}>{trialInvalid ? "A whole number from 0 to 365." : "0 means no trial."}</span>
              </label>
            </div>
            {noCyclePriced && !priceInvalid && <p className="mt-3 text-xs font-semibold text-[var(--warning-ink)]">No cycle is priced — this version can be saved, but not sold.</p>}
          </section>

          <section className={card} aria-labelledby="plan-capacity">
            <h2 id="plan-capacity" className={h2}>Capacity limits</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {EDITABLE_LIMITS.map(([key, name]) => (
                <label key={key} className="block">
                  <span className={label}>{name}</span>
                  <input className={input} type="number" min={0} step={1} placeholder="Unlimited" value={limits[key]} onChange={(event) => setLimits((prev) => ({ ...prev, [key]: event.target.value }))} aria-invalid={(limits[key].trim() !== "" && !/^\d+$/.test(limits[key].trim())) || undefined} />
                </label>
              ))}
            </div>
            <p className="mt-4 border-t border-[var(--border)] pt-3 text-xs leading-normal text-[var(--muted)]">
              Seats: <strong className="font-semibold text-[var(--ink)] tabular-nums">{initialLimits?.max_seats ?? "unlimited"}</strong> (not editable here).
            </p>
          </section>

          <section className={card} aria-labelledby="plan-allowances">
            <h2 id="plan-allowances" className={h2}>Usage allowances</h2>
            <div className="mt-4 flex flex-col divide-y divide-[var(--border)]">
              {meters.map((meter) => {
                const draft = meterDrafts[meter.meter_key];
                const set = (patch: Partial<MeterDraft>) => setMeterDrafts((prev) => ({ ...prev, [meter.meter_key]: { ...prev[meter.meter_key], ...patch } }));
                const invalid = draft.own && draft.included.trim() !== "" && !/^\d+$/.test(draft.included.trim());
                return (
                  <div key={meter.meter_key} className="grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_160px_120px] sm:items-center">
                    <label className="flex min-w-0 items-start gap-2.5">
                      <input type="checkbox" checked={draft.own} onChange={(e) => set({ own: e.target.checked })} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
                      <span className="min-w-0">
                        <span className={label}>{meter.label}</span>
                        <span className={hint}>
                          {draft.own ? "Set by this plan." : `Platform default: ${meter.platform_default === null ? "unlimited" : `${meter.platform_default.toLocaleString("en-US")} ${meter.unit}s`}.`}
                        </span>
                      </span>
                    </label>
                    <input
                      className={cn(input, "mt-0")}
                      type="number"
                      min={0}
                      step={1}
                      placeholder="Unlimited"
                      aria-label={`${meter.label} included per period`}
                      disabled={!draft.own}
                      value={draft.included}
                      onChange={(e) => set({ included: e.target.value })}
                      aria-invalid={invalid || undefined}
                    />
                    <label className="flex items-center gap-2 text-sm text-[var(--body)]">
                      <input type="checkbox" checked={draft.hardCap} disabled={!draft.own} onChange={(e) => set({ hardCap: e.target.checked })} className="size-4 accent-[var(--primary)]" />
                      Hard cap
                    </label>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 border-t border-[var(--border)] pt-3 text-xs leading-normal text-[var(--muted)]">
              Per billing period. Empty means unlimited, 0 means none. A hard cap stops the action at the limit; without one, extra use is billed as overage.
            </p>
          </section>

          {groups.map((group) => {
            const selectable = group.features.filter((f) => !f.is_archived);
            const visible = group.features.filter((f) => !f.is_archived || granted.has(f.feature_key));
            const allOn = selectable.length > 0 && selectable.every((f) => granted.has(f.feature_key));
            const on = visible.filter((f) => granted.has(f.feature_key)).length;
            if (visible.length === 0) return null;
            return (
              <section key={group.module.key} className={card} aria-labelledby={`module-${group.module.key}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id={`module-${group.module.key}`} className={h2}>{group.module.label} <span className="text-sm font-normal text-[var(--muted)] tabular-nums">{on} of {visible.length}</span></h2>
                  {selectable.length > 0 && (
                    <Button type="button" variant="ghost" onClick={() => toggleModule(group)}>{allOn ? "Clear all" : "Select all"}</Button>
                  )}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {visible.map((feature) => {
                    const isLocked = lockedArchived.has(feature.feature_key);
                    const isOn = granted.has(feature.feature_key);
                    return (
                      <label key={feature.id} className={cn("flex items-start gap-2.5 rounded-[8px] border p-2.5", isOn ? "border-[var(--primary)] bg-[var(--brand-50)]" : "border-[var(--border)]", isLocked ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-[var(--surface-alt)]")}>
                        <input type="checkbox" checked={isOn} disabled={isLocked} onChange={() => toggle(feature.feature_key)} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ink)]">
                            {feature.label}
                            {isLocked && <span title="Archived, but still granted by this plan"><Lock className="size-3 text-[var(--muted)]" aria-label="Archived, still granted" /></span>}
                          </span>
                          <code className="text-xs text-[var(--muted)]">{feature.feature_key}</code>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[calc(var(--top-bar-h)+1.5rem)]">
          <section className={card} aria-labelledby="menu-preview">
            <h2 id="menu-preview" className={h2}>An owner will see</h2>
            {/* Named for the role it renders: buildAgentMenu defaults to "owner", the widest menu the plan can produce; other roles see a subset. */}
            <div className="mt-3 rounded-[8px] bg-[var(--nav-bg)] p-3">
              {previewMenu.length === 0 && <p className="text-sm text-[var(--nav-muted)]">Nothing — no feature granted.</p>}
              {previewMenu.map((section) => (
                <div key={section.id} className="mb-3 last:mb-0">
                  <p className="mb-1 text-xs font-semibold tracking-[0.02em] uppercase text-[var(--nav-muted)]">{section.label}</p>
                  {section.items.map((item) => <p key={item.key} className="py-0.5 pl-2 text-sm text-[var(--nav-ink)]">{item.label}</p>)}
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]"><span className="tabular-nums">{grantedCount} {grantedCount === 1 ? "feature" : "features"}</span>{grantedCount === 0 && <span className="font-semibold text-[var(--error-ink)]"> — at least one required</span>}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
