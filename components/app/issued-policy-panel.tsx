"use client";

/**
 * "Mark issued" / "Mark lapsed" on a deal — the first thing in the product that records an issued
 * policy. The vendor scorecard (True CPA) counts these rows; until something wrote them, its Issued
 * column and cost per issued policy were always "—".
 *
 * Lives inside the deal's detail card on /app/deal-flow. Owner and producer only (the route
 * enforces it; this hides the buttons for read-only access). Before migration 20260925708300 the
 * list still reads and a write answers with the "needs a database update" sentence, shown inline.
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Field, Pill, btn } from "@/components/app/settings/primitives";
import type { IssuedPoliciesResponse, IssuedPolicy } from "@/lib/issuedPolicies/types";
import { notify } from "@/lib/notify";
import { SectionLoading } from "@/components/ui/page-states";

const input40 =
  "mt-1.5 box-border h-10 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";
const label12 = "text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const small = "text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]";

/** Today in the browser's calendar, as YYYY-MM-DD. */
function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
/** The stored instant is midnight UTC of the chosen day; show that day, not the local shift of it. */
function day(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function IssuedPolicyPanel({ dealId, defaultCarrier, readOnly, onChanged }: { dealId: string; defaultCarrier: string | null; readOnly: boolean; onChanged?: () => void }) {
  const [data, setData] = useState<IssuedPoliciesResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issue, setIssue] = useState({ carrier: defaultCarrier ?? "", policy_number: "", issued_on: localToday() });
  const [lapsing, setLapsing] = useState<string | null>(null);
  const [lapsedOn, setLapsedOn] = useState(localToday());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    const response = await fetch(`/api/app/policies/issued?deal_id=${encodeURIComponent(dealId)}`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    if (!response || !response.ok) { setLoadError(body?.error ?? "Could not load this deal's policies"); return; }
    setData(body as IssuedPoliciesResponse);
  }, [dealId]);

  // A different deal is a different list; start its forms clean.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setData(null); setIssuing(false); setLapsing(null); setFormError(""); setIssue({ carrier: defaultCarrier ?? "", policy_number: "", issued_on: localToday() }); void load(); }, [dealId, defaultCarrier, load]);

  async function submitIssue(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setFormError("");
    const response = await fetch("/api/app/policies/issued", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deal_id: dealId, ...issue }) }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setSaving(false);
    if (!response || !response.ok) { setFormError(body?.error ?? "Could not record the issued policy"); return; }
    notify.done("Policy marked issued", { detail: "It now counts on True CPA for this deal's vendor and campaign." });
    setIssuing(false);
    await load();
    onChanged?.();
  }

  async function submitLapse(event: FormEvent, policy: IssuedPolicy) {
    event.preventDefault();
    setSaving(true); setFormError("");
    const response = await fetch(`/api/app/policies/issued/${encodeURIComponent(policy.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "lapse", lapsed_on: lapsedOn }) }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setSaving(false);
    if (!response || !response.ok) { setFormError(body?.error ?? "Could not mark the policy lapsed"); return; }
    notify.done("Policy marked lapsed");
    setLapsing(null);
    await load();
    onChanged?.();
  }

  const policies = data?.policies ?? [];
  const inForce = policies.some((policy) => policy.status === "issued");
  const canWrite = Boolean(data) && !readOnly && !data?.readOnly;

  return (
    <div className="mt-4 border-t border-[var(--border)] pt-4" aria-labelledby={`deal-policies-${dealId}`}>
      <div id={`deal-policies-${dealId}`} className={label12}>Issued policy</div>
      {loadError ? <p role="alert" className="mt-1 mb-0 text-[14px] leading-[1.5] text-[var(--error-ink)]">{loadError}</p>
        : !data ? <SectionLoading rows={1} columns={3} label="Loading issued policy" />
        : policies.length === 0 ? <p className="mt-1 mb-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">No policy recorded on this deal.</p>
        : <ul className="mt-1.5 flex list-none flex-col gap-2 p-0">
          {policies.map((policy) => <li key={policy.id} className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{policy.carrier}</span>
              {policy.status === "issued" ? <Pill tone="success" dot>In force</Pill> : <Pill tone="error" dot>{policy.status === "lapsed" ? "Lapsed" : "Cancelled"}</Pill>}
            </div>
            <span className={`block ${small}`}>
              {policy.policy_number ? `No. ${policy.policy_number} · ` : ""}Issued {day(policy.issued_at)}{policy.lapsed_at ? ` · lapsed ${day(policy.lapsed_at)}` : ""}
            </span>
            {policy.status === "issued" && canWrite && lapsing !== policy.id && (
              <button type="button" className={btn("secondary", "mt-1.5")} onClick={() => { setLapsing(policy.id); setLapsedOn(localToday()); setFormError(""); }}>Mark lapsed</button>
            )}
            {lapsing === policy.id && (
              <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(event) => void submitLapse(event, policy)} aria-label={`Mark ${policy.carrier} lapsed`}>
                <Field label="Lapse date" htmlFor={`lapse-${policy.id}`} className="w-[170px]"><input id={`lapse-${policy.id}`} type="date" required className={input40} value={lapsedOn} min={policy.issued_at.slice(0, 10)} max={localToday()} onChange={(event) => setLapsedOn(event.target.value)} /></Field>
                <button type="submit" className={btn("primary-sm")} disabled={saving}>{saving ? "Saving…" : "Mark lapsed"}</button>
                <button type="button" className={btn("secondary")} onClick={() => setLapsing(null)}>Cancel</button>
              </form>
            )}
          </li>)}
        </ul>}

      {canWrite && !inForce && !issuing && (
        <button type="button" className={btn("secondary", "mt-2")} onClick={() => { setIssuing(true); setFormError(""); }}>Mark issued</button>
      )}
      {issuing && (
        <form className="mt-2 grid gap-2" onSubmit={(event) => void submitIssue(event)} aria-label="Mark this deal's policy issued">
          <Field label="Carrier" htmlFor={`issue-carrier-${dealId}`} required><input id={`issue-carrier-${dealId}`} required maxLength={160} className={input40} value={issue.carrier} onChange={(event) => setIssue((current) => ({ ...current, carrier: event.target.value }))} /></Field>
          <Field label="Policy number" htmlFor={`issue-number-${dealId}`} required><input id={`issue-number-${dealId}`} required maxLength={120} className={input40} value={issue.policy_number} onChange={(event) => setIssue((current) => ({ ...current, policy_number: event.target.value }))} /></Field>
          <Field label="Issue date" htmlFor={`issue-date-${dealId}`} required><input id={`issue-date-${dealId}`} type="date" required max={localToday()} className={input40} value={issue.issued_on} onChange={(event) => setIssue((current) => ({ ...current, issued_on: event.target.value }))} /></Field>
          <div className="flex gap-2">
            <button type="submit" className={btn("primary-sm")} disabled={saving}>{saving ? "Saving…" : "Mark issued"}</button>
            <button type="button" className={btn("secondary")} onClick={() => setIssuing(false)}>Cancel</button>
          </div>
        </form>
      )}
      {formError && <p role="alert" className="mt-1.5 mb-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--error-ink)]">{formError}</p>}
      {data && !data.writable && canWrite && <span className={`mt-1.5 block ${small}`}>Recording a lapse date needs a database update that has not been applied yet.</span>}
    </div>
  );
}
