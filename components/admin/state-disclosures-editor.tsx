"use client";

import { useState, type FormEvent } from "react";

import { DashboardUtcTime } from "@/components/admin/dashboard-utc-time";
import { Callout, Field, Pill, btn, control } from "@/components/app/settings/primitives";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatUtcDateTime } from "@/lib/adminDashboard/figures";
import { STATE_CODES, US_STATES } from "@/lib/appointments/constants";
import { formatEffectiveDate, type CoverageRow, type ScopeProduct } from "@/lib/stateDisclosures/board";
import { isPlaceholderDisclosure, type StateDisclosure } from "@/lib/stateDisclosures/constants";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

export type EditorTarget = { kind: "pair"; row: CoverageRow } | { kind: "new" };

const STATUS: Record<StateDisclosure["status"], { label: string; tone: "success" | "info" | "neutral" }> = {
  live: { label: "In force", tone: "success" },
  scheduled: { label: "Scheduled", tone: "info" },
  superseded: { label: "Superseded", tone: "neutral" },
};

const OTHER = "__other__";
const TEXT_MAX = 8000;

/**
 * One state and product pair — what the dialer serves, every stored version, and the form for the
 * next version — or, from "Add a disclosure", the same form for any product and set of states.
 *
 * With the review workflow in place (migration 20260925507000) the form files a proposal that a
 * different admin must approve; before it is applied, it publishes directly, exactly as this screen
 * always did, and says so. The wording field starts empty: the product never supplies disclosure text.
 */
export function StateDisclosureEditor({
  target,
  scope,
  reviewAvailable,
  earliest,
  onClose,
  onSaved,
}: {
  target: EditorTarget;
  scope: ScopeProduct[];
  reviewAvailable: boolean;
  earliest: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const row = target.kind === "pair" ? target.row : null;
  const [productChoice, setProductChoice] = useState(row?.productCode ?? scope[0]?.code ?? OTHER);
  const [otherCode, setOtherCode] = useState("");
  const [states, setStates] = useState<string[]>(row ? [row.state] : []);
  const [moreStates, setMoreStates] = useState(!row);
  const [effectiveFrom, setEffectiveFrom] = useState(earliest);
  const [wording, setWording] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<StateDisclosure | null>(null);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const productCode = productChoice === OTHER ? otherCode.trim() : productChoice;
  const trimmed = wording.trim();
  const placeholderText = isPlaceholderDisclosure(trimmed);
  const productOk = /^[a-z0-9_]{1,80}$/.test(productCode);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) && effectiveFrom >= earliest;
  const canSubmit = productOk && dateOk && states.length > 0 && trimmed.length > 0 && trimmed.length <= TEXT_MAX && !placeholderText;
  const blocker = !productOk
    ? "Choose a product, or type a code in lower case with underscores."
    : states.length === 0
      ? "Choose at least one state."
      : !dateOk
        ? `The effective date must be ${formatEffectiveDate(earliest)} or later.`
        : trimmed.length === 0
          ? "Paste the approved wording."
          : placeholderText
            ? "Remove the placeholder marker; this must be the approved text."
            : null;

  const reusable = row?.live && !row.placeholder ? row.live.required_text : null;
  const productLabel = scope.find((entry) => entry.code === productCode)?.name ?? productCode;

  function toggleState(code: string) {
    setStates((current) => (current.includes(code) ? current.filter((entry) => entry !== code) : [...current, code]));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const payload = { states, product_code: productCode, required_text: trimmed, effective_from: effectiveFrom };
    const response = await fetch(reviewAvailable ? "/api/admin/state-disclosures/proposals" : "/api/admin/state-disclosures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reviewAvailable ? { ...payload, note: note.trim() || undefined } : payload),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setSaving(false);
    if (!response?.ok) {
      setError(body?.error ?? "Could not reach the server. Nothing was changed.");
      return;
    }
    const count = states.length;
    notify.done(
      reviewAvailable
        ? `Sent for review: ${productLabel} in ${count} state${count === 1 ? "" : "s"}. Another admin has to approve it.`
        : `Published for ${body?.disclosures?.length ?? count} state${count === 1 ? "" : "s"}, effective ${formatEffectiveDate(effectiveFrom)}.`,
    );
    onSaved();
    onClose();
  }

  async function withdraw() {
    if (!withdrawing) return;
    setWithdrawBusy(true);
    setWithdrawError(null);
    const response = await fetch(`/api/admin/state-disclosures/${withdrawing.id}`, { method: "DELETE" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setWithdrawBusy(false);
    if (!response?.ok) {
      setWithdrawError(body?.error ?? "Could not reach the server. Nothing was changed.");
      return;
    }
    notify.done(`Withdrew the ${formatEffectiveDate(withdrawing.effective_from)} version.`);
    onSaved();
    onClose();
  }

  // What happens to dialing if the version in force is withdrawn: the next-newest arrived version
  // takes over, or the pair becomes uncovered.
  const fallback = withdrawing?.live ? row?.versions.find((version) => version.status === "superseded") ?? null : null;

  return (
    <Dialog open onOpenChange={(next) => !next && !saving && !withdrawBusy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="text-[18px] leading-[1.28] font-semibold tracking-[-0.015em]">
            {row ? `${row.stateName} · ${row.productName}` : "Add a disclosure"}
          </DialogTitle>
          <DialogDescription className="text-[14px] leading-[1.5] tracking-[-0.02em]">
            Agents see this wording on the dialer and must confirm it before the call can proceed.
          </DialogDescription>
        </DialogHeader>

        {row && (
          <section aria-label="In force today" className="flex flex-col gap-3">
            {row.live ? (
              <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">In force today</span>
                  <Pill tone="success">Since {formatEffectiveDate(row.live.effective_from)}</Pill>
                  {row.placeholder && <Pill tone="warning">Placeholder — not approved</Pill>}
                </div>
                <p className="m-0 mt-2 max-h-48 overflow-y-auto text-[14px] leading-[1.5] tracking-[-0.02em] whitespace-pre-wrap text-[var(--body)]">
                  {row.live.required_text}
                </p>
              </div>
            ) : (
              <Callout tone="error" title="Not covered: the dialer refuses these calls">
                A lead in {row.stateName} with product line <code className="font-mono">{row.productCode}</code> cannot be dialled until a
                version is in force.
              </Callout>
            )}

            {row.pending.length > 0 && (
              <Callout tone="info" title={`${row.pending.length} proposed version${row.pending.length === 1 ? "" : "s"} waiting for review`}>
                {row.pending.map((proposal) => (
                  <span key={proposal.id} className="block">
                    From {formatEffectiveDate(proposal.effective_from)}, proposed by {proposal.proposed_by_name ?? "a former admin"}. Decide it under
                    Awaiting review.
                  </span>
                ))}
              </Callout>
            )}

            {row.versions.length > 0 && (
              <div>
                <h3 className="m-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Versions</h3>
                <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                  {row.versions.map((version) => {
                    const status = STATUS[version.status];
                    const added = formatUtcDateTime(version.created_at);
                    return (
                      <li key={version.id} className="rounded-[8px] border border-[var(--border)] px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums">
                            {formatEffectiveDate(version.effective_from)}
                          </span>
                          <Pill tone={status.tone}>{status.label}</Pill>
                          {isPlaceholderDisclosure(version.required_text) && <Pill tone="warning">Placeholder</Pill>}
                          {added && (
                            <span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                              added <DashboardUtcTime iso={version.created_at} text={added} />
                            </span>
                          )}
                          <span className="grow" />
                          {version.status !== "superseded" && (
                            <button
                              type="button"
                              className={btn("danger-row")}
                              onClick={() => {
                                setWithdrawError(null);
                                setWithdrawing(version);
                              }}
                            >
                              Withdraw
                            </button>
                          )}
                        </div>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">Show wording</summary>
                          <p className="m-0 mt-1 text-[14px] leading-[1.5] tracking-[-0.02em] whitespace-pre-wrap text-[var(--body)]">
                            {version.required_text}
                          </p>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {withdrawing && (
              <div role="alertdialog" aria-label="Confirm withdrawal" className="rounded-[12px] border border-[var(--error)] bg-[var(--error-surface)] p-4">
                <p className="m-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--error-ink)]">
                  Withdraw the {formatEffectiveDate(withdrawing.effective_from)} version?
                </p>
                <p className="m-0 mt-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
                  {withdrawing.status === "scheduled"
                    ? "It has not taken effect yet, so no call has used it. It is deleted and the current wording stays in force."
                    : fallback
                      ? `The dialer goes back to the ${formatEffectiveDate(fallback.effective_from)} version${isPlaceholderDisclosure(fallback.required_text) ? ", which is placeholder wording" : ""}. The row is deleted, and with it the record of the wording agents read while it was in force.`
                      : `Nothing else is in force for this pair, so outbound dialing for ${row.stateName} / ${row.productCode} is blocked until another version is published. The row is deleted, and with it the record of the wording agents read while it was in force.`}
                </p>
                {withdrawError && (
                  <p role="alert" className="m-0 mt-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--error-ink)]">
                    {withdrawError}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <button type="button" className={btn("ghost")} onClick={() => setWithdrawing(null)} disabled={withdrawBusy}>
                    Keep it
                  </button>
                  <button
                    type="button"
                    className={cn(btn("primary"), "bg-[var(--error)] text-[var(--on-error)] hover:bg-[var(--error-ink)]")}
                    onClick={withdraw}
                    disabled={withdrawBusy}
                  >
                    {withdrawBusy ? "Withdrawing…" : "Withdraw version"}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        <form onSubmit={submit} className="flex flex-col gap-4 border-t border-[var(--border)] pt-4">
          <h3 className="m-0 text-[16px] leading-[1.4] font-semibold tracking-[-0.02em] text-[var(--ink)]">
            {reviewAvailable ? "Propose a new version" : "Publish a new version"}
          </h3>

          {!reviewAvailable && (
            <Callout tone="warning" title="Review is not switched on yet">
              This database is missing update 20260925507000, so this publishes straight to the dialer with no second
              approval, as this screen always has. Once it is applied, new wording waits for another admin to approve it.
            </Callout>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Product" htmlFor="disclosure-product" required hint={row ? "Fixed to this pair." : "Must match the lead’s product line exactly."}>
              <select
                id="disclosure-product"
                className={control}
                value={productChoice}
                disabled={Boolean(row)}
                onChange={(event) => setProductChoice(event.target.value)}
              >
                {scope.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.name} ({entry.code})
                  </option>
                ))}
                <option value={OTHER}>Another product code…</option>
              </select>
            </Field>
            <Field
              label="Effective from"
              htmlFor="disclosure-effective"
              required
              hint={`${formatEffectiveDate(earliest)} at the earliest, so it never covers a call already placed. The current wording stays in force until then.`}
            >
              <input
                id="disclosure-effective"
                type="date"
                required
                min={earliest}
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
                className={control}
              />
            </Field>
          </div>

          {productChoice === OTHER && (
            <Field label="Product code" htmlFor="disclosure-product-code" required hint="Lower case letters, digits and underscores, e.g. term_life.">
              <input
                id="disclosure-product-code"
                value={otherCode}
                onChange={(event) => setOtherCode(event.target.value)}
                className={control}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          )}

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">
                States <span className="font-normal text-[var(--muted)]">({states.length} selected)</span>
              </span>
              {row && !moreStates && (
                <button type="button" className={btn("secondary")} onClick={() => setMoreStates(true)}>
                  Apply to more states
                </button>
              )}
              {moreStates && (
                <>
                  <button type="button" className={btn("secondary")} onClick={() => setStates([...STATE_CODES])}>
                    Select all
                  </button>
                  <button type="button" className={btn("ghost", "h-8")} onClick={() => setStates(row ? [row.state] : [])}>
                    {row ? "Only this state" : "Clear"}
                  </button>
                </>
              )}
            </div>
            {moreStates ? (
              <fieldset className="m-0 mt-2 grid max-h-52 grid-cols-3 gap-1 overflow-y-auto rounded-[8px] border border-[var(--border-strong)] p-3 sm:grid-cols-6">
                <legend className="sr-only">States</legend>
                {US_STATES.map(([code, name]) => (
                  <label key={code} className="flex items-center gap-2 text-[14px] leading-[1.5] text-[var(--body)]" title={name}>
                    <input type="checkbox" checked={states.includes(code)} onChange={() => toggleState(code)} />
                    {code}
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="m-0 mt-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{row?.stateName} only.</p>
            )}
          </div>

          <Field
            label="Wording"
            htmlFor="disclosure-wording"
            required
            hint={`${trimmed.length.toLocaleString("en-US")} of 8,000 characters. Paste the text exactly as approved; agents read it aloud.`}
            error={placeholderText ? "This still carries the placeholder marker. Paste the approved text instead." : undefined}
          >
            <textarea
              id="disclosure-wording"
              required
              rows={8}
              maxLength={TEXT_MAX}
              value={wording}
              onChange={(event) => setWording(event.target.value)}
              className={cn(control, "h-auto py-2")}
            />
          </Field>
          {reusable && !wording && (
            <div>
              <button type="button" className={btn("secondary")} onClick={() => setWording(reusable)}>
                Start from the wording in force
              </button>
            </div>
          )}

          {reviewAvailable && (
            <Field label="Source or reference" htmlFor="disclosure-note" hint="For the reviewer: where this wording was approved. Optional, 2,000 characters.">
              <input
                id="disclosure-note"
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className={control}
              />
            </Field>
          )}

          {error && (
            <p role="alert" className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--error-ink)]">
              {error}
            </p>
          )}
          {!error && blocker && (trimmed.length > 0 || states.length === 0) && (
            <p className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{blocker}</p>
          )}

          <DialogFooter>
            <button type="button" className={btn("ghost")} onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className={btn("primary")} disabled={saving || !canSubmit} title={blocker ?? undefined}>
              {saving
                ? reviewAvailable
                  ? "Sending…"
                  : "Publishing…"
                : reviewAvailable
                  ? "Submit for review"
                  : `Publish for ${states.length} state${states.length === 1 ? "" : "s"}`}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
