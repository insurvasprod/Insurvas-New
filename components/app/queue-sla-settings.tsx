"use client";

import { useCallback, useEffect, useState } from "react";
import { notify } from "@/lib/notify";

import {
  Callout,
  DraftActions,
  KeyValues,
  SettingsCard,
  SettingsSectionHeader,
  SettingsGrid,
  SettingsStack,
  btn,
  st,
} from "@/components/app/settings/primitives";
import { formatDuration, ladderStepStates, parseDuration, type LadderValues } from "@/lib/queueSla/ladder";
import { cn } from "@/lib/utils";

/**
 * LA-1.23 · the unclaimed-lead response ladder.
 *
 * Four thresholds, stored in seconds, walked by `run_unclaimed_sla`. The form is a draft: edits are
 * held here until Save changes, because a half-typed ladder ("warn after 4") would otherwise be
 * refused on every keystroke by the rule that the rungs must increase.
 *
 * Each rung is typed the way the board writes it — "45 seconds", "2 minutes", "4 hours" — and
 * parsed on the way in. The stepper under it is live: it shows how far up the ladder the
 * longest-waiting transfer is right now.
 */

type Values = LadderValues;
type Texts = Record<keyof Values, string>;
type Stats = {
  since: string;
  claimedInsideWarn: number;
  claimed: number;
  warned: number;
  escalated: number;
  partnerTold: number;
  expired: number;
  medianClaimSeconds: number | null;
  sampleCapped: boolean;
};

const MAX_SECONDS = 604_800;

const FIELDS: Array<{ key: keyof Values; label: string; help: string }> = [
  { key: "warn", label: "Warn after", help: "Amber on Agent Floor" },
  { key: "escalate", label: "Escalate after", help: "Alerts the workspace owner" },
  { key: "partner", label: "Partner notice after", help: "Tells the partner nobody claimed it" },
  { key: "expire", label: "Expire after", help: "Leaves the active queue" },
];

const textsFor = (values: Values): Texts => ({
  warn: formatDuration(values.warn),
  escalate: formatDuration(values.escalate),
  partner: formatDuration(values.partner),
  expire: formatDuration(values.expire),
});

/** 45 → `45s`, 120 → `2m`, 14400 → `4h`, 150 → `2m 30s`. */
function short(seconds: number): string {
  const parts: string[] = [];
  let rest = Math.round(seconds);
  for (const [size, suffix] of [[86400, "d"], [3600, "h"], [60, "m"], [1, "s"]] as const) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)}${suffix}`);
      rest %= size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ") || "0s";
}

function CheckIcon() {
  return (
    <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function QueueSlaSettings() {
  const [saved, setSaved] = useState<Values | null>(null);
  const [texts, setTexts] = useState<Texts | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [oldestWaiting, setOldestWaiting] = useState<number | null>(null);
  const [nurtureReady, setNurtureReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      fetch("/api/app/queue-sla-settings", { cache: "no-store" })
        .then(async (response) => {
          const body = await response.json().catch(() => null);
          if (!response.ok) throw new Error(body?.error ?? "Could not load queue SLA settings");
          const next: Values = {
            warn: body.settings.warn_after_seconds,
            escalate: body.settings.escalate_after_seconds,
            partner: body.settings.partner_notify_after_seconds,
            expire: body.settings.expire_after_seconds,
          };
          setSaved(next);
          setTexts(textsFor(next));
          setStats(body.lastSevenDays ?? null);
          setOldestWaiting(typeof body.oldestWaitingSeconds === "number" ? body.oldestWaitingSeconds : null);
          setNurtureReady(body.schema?.nurtureOnExpiry === true);
          setLoadError("");
        })
        .catch((reason: unknown) => setLoadError(reason instanceof Error ? reason.message : "Could not load queue SLA settings"))
        .then(() => setLoading(false)),
    [],
  );

  useEffect(() => { void load(); }, [load]);

  // The draft as seconds. A field that does not parse is null, and says so under itself.
  const parsed = texts
    ? (Object.fromEntries(FIELDS.map((field) => [field.key, parseDuration(texts[field.key])])) as Record<keyof Values, number | null>)
    : null;
  const complete = Boolean(parsed && FIELDS.every((field) => parsed[field.key] !== null));
  const values: Values | null = complete && parsed ? (parsed as Values) : null;
  const tooLong = Boolean(values && Object.values(values).some((value) => value > MAX_SECONDS));
  const increasing = values ? values.warn < values.escalate && values.escalate < values.partner && values.partner < values.expire : true;
  const dirty = Boolean(saved && (!values || JSON.stringify(values) !== JSON.stringify(saved)));
  const problem = !complete
    ? "Write each rung as a number and a unit, for example “45 seconds”, “2 minutes” or “4 hours”."
    : tooLong
      ? "Each rung has to fire within 7 days."
      : !increasing
        ? "Use increasing times: warn, escalate, partner notice, then expiry."
        : null;

  async function save() {
    if (!values || problem) { setError(problem ?? ""); return; }
    setError("");
    setSaving(true);
    try {
      const response = await fetch("/api/app/queue-sla-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Could not save queue SLA settings"); return; }
      notify.done("Queue SLA settings saved");
      // Re-read, so "Claimed inside …" is counted against the threshold just saved, not the old one.
      await load();
    } catch {
      setError("Could not save queue SLA settings. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const header = (
    <SettingsSectionHeader
      actions={
        texts && saved ? (
          <DraftActions
            dirty={dirty}
            saving={saving}
            disabled={Boolean(problem)}
            onDiscard={() => { setTexts(textsFor(saved)); setError(""); }}
            onSave={() => void save()}
          />
        ) : undefined
      }
    />
  );

  if (loading)
    return (
      <SettingsStack>
        {header}
        <p role="status" className="text-[14px] text-[var(--muted)]">Loading queue SLA settings…</p>
      </SettingsStack>
    );
  if (loadError || !texts || !saved)
    return (
      <SettingsStack>
        {header}
        <Callout tone="error" title="Could not load queue SLA settings">
          <span className="block">{loadError}</span>
          <button type="button" className={btn("secondary", "mt-3")} onClick={() => { setLoading(true); void load(); }}>Try again</button>
        </Callout>
      </SettingsStack>
    );

  // The stepper shows the ladder being edited, and where the longest-waiting transfer is on it.
  const shown = values ?? saved;
  const states = ladderStepStates(shown, oldestWaiting);
  const steps = [
    { label: "Claimable" },
    { label: `Warn · ${short(shown.warn)}` },
    { label: `Escalate · ${short(shown.escalate)}` },
    { label: `Partner told · ${short(shown.partner)}` },
    { label: `Expired · ${short(shown.expire)}` },
  ];

  return (
    <SettingsStack>
      {header}

      {error && <Callout tone="error" title={error} />}

      <Callout tone="info" title="Four rungs, and they must increase">
        Warn, then escalate, then tell the partner, then expire. The form refuses a set where a later step fires before an
        earlier one, because that ladder cannot be walked.
      </Callout>

      <SettingsCard title="The ladder" sub="Applied from the moment a lead becomes claimable.">
        <div className="mt-[18px] grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
          {FIELDS.map((field) => {
            const invalid = parsed?.[field.key] === null;
            return (
              <label key={field.key} htmlFor={`sla-${field.key}`} className="block min-w-0">
                <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">{field.label}</span>
                <input
                  id={`sla-${field.key}`}
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={texts[field.key]}
                  disabled={saving}
                  aria-invalid={invalid || undefined}
                  aria-describedby={`sla-${field.key}-help`}
                  onChange={(event) => setTexts((current) => (current ? { ...current, [field.key]: event.target.value } : current))}
                  onBlur={() => {
                    // Tidy "2m" into "120 seconds" once the person leaves the field, the board's own form.
                    const seconds = parsed?.[field.key];
                    if (seconds) setTexts((current) => (current ? { ...current, [field.key]: formatDuration(seconds) } : current));
                  }}
                  className={cn(
                    "mt-1.5 box-border h-11 w-full rounded-[8px] border bg-[var(--surface)] px-3 text-[16px] leading-[1.5] tracking-[-0.02em] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60",
                    invalid ? "border-[var(--error)]" : "border-[var(--border-strong)]",
                  )}
                />
                <span id={`sla-${field.key}-help`} className={cn("mt-1.5 block text-[12px] leading-[1.5] tracking-[-0.01em]", invalid ? "text-[var(--error-ink)]" : "text-[var(--muted)]")}>
                  {invalid ? "Not a duration — try “45 seconds” or “4 hours”." : field.help}
                </span>
              </label>
            );
          })}
        </div>
        {problem && complete && (
          <p role="alert" className="mt-3 mb-0 text-[12px] leading-[1.5] text-[var(--error-ink)]">{problem}</p>
        )}

        <div className="mt-[22px]">
          <ol
            aria-label={oldestWaiting === null ? "The ladder, in order. Nothing is waiting right now." : `The ladder, in order. The longest-waiting transfer has waited ${short(oldestWaiting)}.`}
            className="m-0 box-border flex list-none flex-wrap items-center gap-y-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-5 py-3.5"
          >
            {steps.map((step, index) => {
              const state = states[index];
              const nextDone = states[index + 1] === "done" || states[index + 1] === "current";
              return (
                <li key={step.label} className={cn("flex items-center", index < steps.length - 1 && "flex-1")}>
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className={cn(
                        "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] leading-[1.5] font-semibold tracking-[-0.01em]",
                        state === "done" && "bg-[var(--success)] text-[var(--on-primary)]",
                        state === "current" && "bg-[var(--primary)] text-[var(--ink)]",
                        state === "upcoming" && "bg-[var(--surface-alt)] text-[var(--muted)]",
                      )}
                    >
                      {state === "done" ? <CheckIcon /> : index + 1}
                    </span>
                    <span className={cn("text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] whitespace-nowrap", state === "upcoming" ? "text-[var(--muted)]" : "text-[var(--ink)]")}>
                      {step.label}
                      <span className="sr-only">{state === "done" ? ", passed" : state === "current" ? ", next" : ""}</span>
                    </span>
                  </span>
                  {index < steps.length - 1 && (
                    <span aria-hidden className={cn("m-track mx-3 h-0.5 min-w-4 flex-1", state === "done" && nextDone ? "bg-[var(--success)]" : "bg-[var(--border)]")} />
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </SettingsCard>

      <SettingsGrid>
        <SettingsCard title="What each rung actually does">
          <div className="overflow-x-auto">
            <table className={st.table}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={cn(st.th, "w-[130px]")}>Rung</th>
                  <th scope="col" className={cn(st.th, "w-[160px]")}>Who sees it</th>
                  <th scope="col" className={st.th}>What happens</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={st.td}>Warn</td>
                  <td className={st.td}>Every agent on the floor</td>
                  <td className={st.td}>The row turns amber and sorts to the top</td>
                </tr>
                <tr>
                  <td className={st.td}>Escalate</td>
                  <td className={st.td}>The workspace owner</td>
                  <td className={st.td}>An alert, and the lead is offered more widely</td>
                </tr>
                <tr>
                  <td className={st.td}>Partner notice</td>
                  <td className={st.td}>The submitting partner</td>
                  <td className={st.td}>Their pipeline row says nobody claimed it</td>
                </tr>
                <tr>
                  <td className={st.td}>Expire</td>
                  <td className={st.td}>Nobody, by design</td>
                  <td className={st.td}>
                    {nurtureReady
                      ? "It leaves the active queue and becomes a nurture lead"
                      : "It leaves the active queue marked expired, and can be reopened from the lead. Becoming a nurture lead needs a database update that has not been applied yet"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </SettingsCard>

        <SettingsCard title="Last seven days">
          {stats ? (
            <>
              <KeyValues
                items={[
                  { label: `Claimed inside ${short(saved.warn)}`, value: stats.claimedInsideWarn.toLocaleString() },
                  { label: "Warned", value: stats.warned.toLocaleString() },
                  { label: "Escalated", value: stats.escalated.toLocaleString() },
                  { label: "Partner told", value: stats.partnerTold.toLocaleString() },
                  { label: "Expired", value: stats.expired.toLocaleString() },
                  { label: "Median claim time", value: stats.medianClaimSeconds == null ? "—" : short(stats.medianClaimSeconds) },
                ]}
              />
              {stats.sampleCapped && (
                <p className="mt-4 mb-0 text-[12px] leading-[1.5] text-[var(--muted)]">Over the most recent 20,000 claims.</p>
              )}
              {stats.expired > 0 && (
                <Callout
                  tone="warning"
                  className="mt-4"
                  title={`${stats.expired.toLocaleString()} ${stats.expired === 1 ? "lead" : "leads"} expired unclaimed`}
                >
                  Expiry is not free. Each one reached your queue and left it before anybody claimed it.
                </Callout>
              )}
            </>
          ) : (
            <p className="m-0 text-[14px] text-[var(--muted)]">The last seven days could not be counted right now. The ladder above is unaffected.</p>
          )}
        </SettingsCard>
      </SettingsGrid>
    </SettingsStack>
  );
}
