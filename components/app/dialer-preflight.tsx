"use client";

import { useState, type FormEvent } from "react";
import { notify } from "@/lib/notify";

import { OverlayFrame } from "@/components/app/dialer-overlay-frame";
import { Callout, Pill, st } from "@/components/app/settings/primitives";
import { Button, buttonVariants } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { US_STATES } from "@/lib/appointments/constants";
import { refusalBody, type PreflightCheck } from "@/lib/compliance/preflightChecks";
import { cn } from "@/lib/utils";

/**
 * "Check a number before dialing" — an ad-hoc check for a number you were handed before a lead
 * exists, opened from the Dialer header.
 *
 * This is NOT what protects the dialer. Screening on a served lead is enforced server-side inside
 * `POST /api/app/dialer/attempt/:id/click`, which re-checks immediately before the `tel:` handoff.
 * This dialog runs every check read-only (POST /api/app/dial/preflight) so the table is true, and
 * it never dials: its Dial button is disabled on purpose, because no override path exists.
 */

type Report = {
  ok: boolean;
  code: string | null;
  error: string | null;
  checks: PreflightCheck[] | null;
  lead: { id: string; state: string | null } | null;
  state: string | null;
};

const PLACEHOLDER_ROWS = ["Your suppression list", "DNC registry", "Known litigators", "Calling window", "Consent on file"];

export function DialerPreflightDialog({ open, onOpenChange, readOnly = false }: { open: boolean; onOpenChange: (open: boolean) => void; readOnly?: boolean }) {
  const [phone, setPhone] = useState("");
  const [state, setState] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [checking, setChecking] = useState(false);

  async function check(nextState = state) {
    if (readOnly || checking || !phone.trim()) return;
    setFieldError("");
    setChecking(true);
    try {
      const response = await fetch("/api/app/dial/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, ...(nextState ? { state: nextState } : {}) }),
      });
      const body = await response.json().catch(() => null) as { error?: string; message?: string; code?: string; field?: string; checks?: PreflightCheck[]; lead?: Report["lead"]; state?: string | null } | null;
      if (response.status === 400 && body?.error) {
        setReport(null);
        setFieldError(body.error);
        notify.block(body.error);
        return;
      }
      setReport({ ok: response.ok, code: body?.code ?? null, error: response.ok ? null : body?.error ?? "The number could not be cleared. Dialing remains blocked.", checks: Array.isArray(body?.checks) ? body.checks : null, lead: body?.lead ?? null, state: body?.state ?? null });
      if (!response.ok) notify.block(body?.error ?? "DNC check failed");
      else notify.done("Every check passed");
    } catch {
      setReport({ ok: false, code: null, error: "The number could not be checked. Dialing remains blocked.", checks: null, lead: null, state: null });
      notify.fail("The number could not be checked");
    } finally {
      setChecking(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void check();
  }

  const checks = report?.checks ?? null;
  const refusal = checks ? refusalBody(checks) : null;
  // The state select lives in the Calling window row whenever the state did not come from a lead.
  const needsStatePick = Boolean(checks) && !report?.lead?.state;

  return (
    <OverlayFrame
      open={open}
      onOpenChange={onOpenChange}
      width={760}
      top={96}
      title="Check a number before dialing"
      description="The same screening the server runs, on demand. Fail closed."
      footerNote="DNC compliance is mandatory and cannot be switched off."
      footerActions={<>
        <span id="preflight-dial-reason" className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">Dial from the queue or a lead</span>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        <button type="button" disabled aria-describedby="preflight-dial-reason" className={cn(buttonVariants({ variant: "outline" }), "bg-[var(--surface-alt)] text-[var(--muted)] disabled:opacity-100")}>Dial</button>
      </>}
    >
      <form onSubmit={submit} className="flex min-w-0 flex-col gap-2.5 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="dial-phone" className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Phone number</label>
          <input
            id="dial-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(555) 123-4567"
            value={phone}
            onChange={(event) => { setPhone(event.target.value); setFieldError(""); setReport(null); }}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? "dial-phone-error" : "dial-phone-privacy"}
            className={cn(toolbarControl, "mt-1.5 w-full")}
          />
        </div>
        <Button type="submit" disabled={readOnly || checking || !phone.trim()}>{readOnly ? "Read-only account" : checking ? "Checking…" : "Check"}</Button>
      </form>
      {fieldError
        ? <p id="dial-phone-error" role="alert" className="-mt-3 mb-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--error-ink)]">{fieldError}</p>
        : <p id="dial-phone-privacy" className="-mt-3 mb-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">Your number is sent to the configured DNC vendor over HTTPS. Only a masked number is retained in provider logs.</p>}

      <div className="min-w-0 shrink-0 overflow-x-auto">
        <table className={cn(st.table, "min-w-[560px]")}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Check</th>
              <th scope="col" className={cn(st.th, "w-[170px]")}>Result</th>
              <th scope="col" className={cn(st.th, "w-[210px]")}>Source</th>
              <th scope="col" className={cn(st.th, "w-[120px]")}>Age</th>
            </tr>
          </thead>
          <tbody className="m-seq" aria-live="polite">
            {checks
              ? checks.map((row) => (
                  <tr key={row.key} className="m-row">
                    <td className={st.td}>{row.label}</td>
                    <td className={st.td}><Pill tone={row.tone}>{row.result}</Pill></td>
                    <td className={st.td}>
                      {row.key === "window" && needsStatePick ? (
                        <select
                          aria-label="Customer's state"
                          value={state}
                          disabled={readOnly || checking}
                          onChange={(event) => { setState(event.target.value); void check(event.target.value); }}
                          className="box-border h-8 w-full max-w-[190px] rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                        >
                          <option value="">Pick the customer&rsquo;s state</option>
                          {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                        </select>
                      ) : row.source}
                      {row.key === "window" && needsStatePick && row.result !== "Needs a state" && <span className={st.sub}>{row.source}</span>}
                    </td>
                    <td className={cn(st.td, "tabular-nums")}>{row.age}</td>
                  </tr>
                ))
              : PLACEHOLDER_ROWS.map((label) => (
                  <tr key={label}>
                    <td className={st.td}>{label}</td>
                    <td className={st.td}><Pill tone="neutral">Not run</Pill></td>
                    <td className={cn(st.td, "text-[var(--muted)]")}>—</td>
                    <td className={cn(st.td, "text-[var(--muted)]")}>—</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {refusal && <Callout tone="error" title="This number will not be dialled" className="m-deny">{refusal}</Callout>}
      {report && !checks && report.error && <Callout tone="error" title="This number will not be dialled" className="m-deny">{report.error}</Callout>}
      {report?.ok && checks && <Callout tone="success" title="Every check passed. Dial it from the queue or from the lead." />}
    </OverlayFrame>
  );
}
