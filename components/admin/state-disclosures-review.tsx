"use client";

import { useMemo, useState } from "react";

import { DashboardUtcTime } from "@/components/admin/dashboard-utc-time";
import { Callout, Field, KeyValues, Pill, btn, control, st } from "@/components/app/settings/primitives";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatUtcDateTime } from "@/lib/adminDashboard/figures";
import { formatEffectiveDate, STATE_NAME, type CoverageRow, type ScopeProduct } from "@/lib/stateDisclosures/board";
import { ATTESTATION_MAX, ATTESTATION_MIN, type DisclosureProposal } from "@/lib/stateDisclosures/constants";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

type ProposalState = {
  available: boolean;
  pending: DisclosureProposal[];
  recent: DisclosureProposal[];
  /** Decided by the server (state_disclosure_self_approval_allowed); never worked out here. */
  selfApprovalAllowed: boolean;
  error: string | null;
};

const OUTCOME: Record<Exclude<DisclosureProposal["status"], "pending">, { label: string; tone: "success" | "error" | "neutral" }> = {
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "error" },
  cancelled: { label: "Withdrawn", tone: "neutral" },
};

function statesLabel(states: string[]): string {
  if (states.length === 51) return "All 50 states + DC";
  if (states.length <= 4) return states.map((state) => STATE_NAME[state] ?? state).join(", ");
  return `${states.slice(0, 4).join(", ")} +${states.length - 4}`;
}

function When({ iso }: { iso: string | null }) {
  const text = formatUtcDateTime(iso);
  return iso && text ? <DashboardUtcTime iso={iso} text={text} /> : <>—</>;
}

/**
 * Awaiting review: proposals no dialer reads until a second admin approves them, and the latest
 * decisions. Renders nothing until the review workflow exists and something has been proposed.
 */
export function StateDisclosuresReviewCard({
  proposals,
  rows,
  scope,
  currentAdminId,
  earliest,
  onChanged,
}: {
  proposals: ProposalState;
  rows: CoverageRow[];
  scope: ScopeProduct[];
  currentAdminId: string;
  earliest: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<DisclosureProposal | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const names = useMemo(() => new Map(scope.map((entry) => [entry.code, entry.name])), [scope]);

  if (proposals.error) {
    return <Callout tone="error" title="Proposals could not be loaded">{proposals.error}</Callout>;
  }
  if (!proposals.available || (proposals.pending.length === 0 && proposals.recent.length === 0)) return null;

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[16px] leading-[1.4] font-semibold tracking-[-0.02em] text-[var(--ink)]">
            Awaiting review <span className="text-[var(--muted)] tabular-nums">· {proposals.pending.length}</span>
          </h2>
          <p className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
            Proposed wording reaches the dialer only when an admin other than its author approves it, or its author,
            with a written attestation, when no other admin can.
          </p>
        </div>
        {proposals.recent.length > 0 && (
          <button type="button" className={btn("secondary")} onClick={() => setShowRecent((value) => !value)} aria-expanded={showRecent}>
            {showRecent ? "Hide recent decisions" : `Recent decisions (${proposals.recent.length})`}
          </button>
        )}
      </div>
      <div className="min-w-0 overflow-x-auto">
        <table className={cn(st.table, "min-w-[760px]")}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Product</th>
              <th scope="col" className={st.th}>States</th>
              <th scope="col" className={cn(st.th, "text-right")}>Effective from</th>
              <th scope="col" className={st.th}>Proposed by</th>
              <th scope="col" className={st.th}>Proposed</th>
              <th scope="col" className={cn(st.th, "text-right")}>
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {proposals.pending.length === 0 && (
              <tr>
                <td colSpan={6} className={cn(st.td, "text-[var(--muted)]")}>
                  Nothing is waiting for review.
                </td>
              </tr>
            )}
            {proposals.pending.map((proposal) => (
              <tr key={proposal.id} className="m-row">
                <td className={st.td}>
                  {names.get(proposal.product_code) ?? proposal.product_code}
                  {proposal.source === "import" && <span className={st.sub}>from an imported pack</span>}
                </td>
                <td className={st.td} title={proposal.states.join(", ")}>{statesLabel(proposal.states)}</td>
                <td className={cn(st.td, st.num)}>
                  {formatEffectiveDate(proposal.effective_from)}
                  {proposal.effective_from < earliest && <span className={cn(st.sub, "text-[var(--error-ink)]")}>date has passed</span>}
                </td>
                <td className={st.td}>
                  {proposal.proposed_by_name ?? "A former admin"}
                  {proposal.proposed_by === currentAdminId && <span className={st.sub}>you</span>}
                </td>
                <td className={cn(st.td, "whitespace-nowrap")}>
                  <When iso={proposal.proposed_at} />
                </td>
                <td className={cn(st.td, "text-right")}>
                  <button type="button" className={btn("row")} onClick={() => setOpen(proposal)}>
                    {proposal.proposed_by === currentAdminId && !proposals.selfApprovalAllowed ? "Open" : "Review"}
                  </button>
                </td>
              </tr>
            ))}
            {showRecent &&
              proposals.recent.map((proposal) => {
                const outcome = OUTCOME[proposal.status as keyof typeof OUTCOME] ?? OUTCOME.cancelled;
                return (
                  <tr key={proposal.id} className="m-row bg-[var(--canvas)]">
                    <td className={st.td}>{names.get(proposal.product_code) ?? proposal.product_code}</td>
                    <td className={st.td} title={proposal.states.join(", ")}>{statesLabel(proposal.states)}</td>
                    <td className={cn(st.td, st.num)}>{formatEffectiveDate(proposal.effective_from)}</td>
                    <td className={st.td}>{proposal.proposed_by_name ?? "A former admin"}</td>
                    <td className={cn(st.td, "whitespace-nowrap")}>
                      <Pill tone={outcome.tone}>{outcome.label}</Pill>
                      <span className={st.sub}>
                        {proposal.reviewed_by_name ?? "A former admin"}, <When iso={proposal.reviewed_at} />
                      </span>
                    </td>
                    <td className={cn(st.td, "text-right")}>
                      <button type="button" className={btn("row")} onClick={() => setOpen(proposal)}>
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {open && (
        <ReviewDialog
          key={open.id}
          proposal={open}
          rows={rows}
          productName={names.get(open.product_code) ?? open.product_code}
          currentAdminId={currentAdminId}
          selfApprovalAllowed={proposals.selfApprovalAllowed}
          earliest={earliest}
          onClose={() => setOpen(null)}
          onDone={onChanged}
        />
      )}
    </section>
  );
}

function ReviewDialog({
  proposal,
  rows,
  productName,
  currentAdminId,
  selfApprovalAllowed,
  earliest,
  onClose,
  onDone,
}: {
  proposal: DisclosureProposal;
  rows: CoverageRow[];
  productName: string;
  currentAdminId: string;
  selfApprovalAllowed: boolean;
  earliest: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [attestation, setAttestation] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<"approve" | "reject" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = proposal.status === "pending";
  const mine = proposal.proposed_by === currentAdminId;
  // The sole-eligible-admin exception, as the server reported it for this admin.
  const selfApprove = mine && selfApprovalAllowed;
  const canApprove = !mine || selfApprove;
  const datePassed = proposal.effective_from < earliest;
  const attestationLength = attestation.trim().length;
  const attestationOk = attestationLength >= ATTESTATION_MIN && attestationLength <= ATTESTATION_MAX;
  const approveBlocker = datePassed
    ? "The effective date has passed"
    : !checked
      ? "Confirm you have checked the wording"
      : selfApprove && !attestationOk
        ? `Write an attestation of ${ATTESTATION_MIN} to ${ATTESTATION_MAX} characters`
        : null;

  // What these states read today for this product, so the reviewer knows what is being replaced.
  const today = useMemo(() => {
    const byState = new Map(rows.filter((row) => row.productCode === proposal.product_code).map((row) => [row.state, row]));
    let placeholder = 0;
    let approved = 0;
    let uncovered = 0;
    for (const state of proposal.states) {
      const row = byState.get(state);
      if (!row?.live) uncovered += 1;
      else if (row.placeholder) placeholder += 1;
      else approved += 1;
    }
    return { placeholder, approved, uncovered };
  }, [rows, proposal]);

  async function decide(action: "approve" | "reject" | "cancel") {
    setBusy(action);
    setError(null);
    const response = await fetch(`/api/admin/state-disclosures/proposals/${proposal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        note: note.trim() || undefined,
        attestation: action === "approve" && selfApprove ? attestation.trim() : undefined,
      }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setBusy(null);
    if (!response?.ok) {
      setError(body?.error ?? "Could not reach the server. Nothing was changed.");
      return;
    }
    notify.done(
      action === "approve"
        ? `Approved. ${productName} wording takes effect in ${proposal.states.length} state${proposal.states.length === 1 ? "" : "s"} on ${formatEffectiveDate(proposal.effective_from)}.`
        : action === "reject"
          ? "Rejected. The author can see your reason."
          : "Proposal withdrawn.",
    );
    onDone();
    onClose();
  }

  const replaces = [
    today.placeholder ? `${today.placeholder} placeholder` : null,
    today.approved ? `${today.approved} approved wording` : null,
    today.uncovered ? `${today.uncovered} not covered` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="text-[18px] leading-[1.28] font-semibold tracking-[-0.015em]">
            {pending ? (mine ? "Your proposal" : "Review proposed wording") : "Proposal"} · {productName}
          </DialogTitle>
          <DialogDescription className="text-[14px] leading-[1.5] tracking-[-0.02em]">
            Approving publishes it to the dialer for every state listed, from the effective date. Nothing changes before then.
          </DialogDescription>
        </DialogHeader>

        <KeyValues
          items={[
            { label: "Product", value: `${productName} (${proposal.product_code})` },
            { label: "Effective from", value: formatEffectiveDate(proposal.effective_from), tone: datePassed && pending ? "error" : undefined },
            { label: "States", value: proposal.states.length === 51 ? "All 50 states + DC" : proposal.states.join(", ") },
            { label: "Replaces today", value: replaces || "—", tone: today.placeholder ? "warning" : undefined },
            { label: "Proposed by", value: proposal.proposed_by_name ?? "A former admin" },
            { label: "Proposed", value: <When iso={proposal.proposed_at} /> },
          ]}
        />

        {proposal.note && (
          <Callout tone="info" title="Source or reference, from the author">
            {proposal.note}
          </Callout>
        )}

        <div>
          <h3 className="m-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Proposed wording</h3>
          <p className="m-0 mt-2 max-h-64 overflow-y-auto rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] p-3 text-[14px] leading-[1.5] tracking-[-0.02em] whitespace-pre-wrap text-[var(--body)]">
            {proposal.required_text}
          </p>
        </div>

        {!pending && (
          <Callout
            tone={proposal.status === "approved" ? "success" : proposal.status === "rejected" ? "error" : "info"}
            title={`${OUTCOME[proposal.status as keyof typeof OUTCOME]?.label ?? "Decided"} by ${proposal.reviewed_by_name ?? "a former admin"}`}
          >
            <When iso={proposal.reviewed_at} />
            {proposal.review_note ? ` — ${proposal.review_note}` : ""}
            {proposal.self_approval_attestation && (
              <span className="mt-1 block">
                Approved by its author as the only eligible admin. Attestation: &ldquo;{proposal.self_approval_attestation}&rdquo;
              </span>
            )}
          </Callout>
        )}

        {pending && datePassed && (
          <Callout tone="error" title="Its effective date is no longer in the future">
            It can no longer be approved as it stands, because it would cover calls already placed. Reject it (or withdraw it,
            if it is yours) and propose it again with a later date.
          </Callout>
        )}

        {pending && mine && !selfApprove && (
          <Callout tone="info" title="Another admin has to approve this">
            You proposed it, so you cannot approve it. You can withdraw it while it waits.
          </Callout>
        )}
        {pending && selfApprove && (
          <Callout tone="warning" title="You are the only admin who can approve disclosures">
            No other active super admin or platform config admin exists, so you may approve your own proposal. Say in
            writing what you checked it against; the attestation is stored with the proposal and in the audit log.
          </Callout>
        )}

        {pending && (
          <>
            <Field
              label={mine ? "Note (optional)" : "Review note"}
              htmlFor="proposal-review-note"
              hint={mine ? "Recorded with your decision." : "Required to reject; optional to approve. Recorded in the audit log."}
            >
              <textarea
                id="proposal-review-note"
                rows={3}
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className={cn(control, "h-auto py-2")}
              />
            </Field>

            {selfApprove && !datePassed && (
              <Field
                label="Attestation"
                htmlFor="proposal-attestation"
                required
                hint={`${attestationLength} of ${ATTESTATION_MAX} characters, at least ${ATTESTATION_MIN}. For example: what source you checked the wording against, and its date.`}
              >
                <textarea
                  id="proposal-attestation"
                  rows={3}
                  required
                  minLength={ATTESTATION_MIN}
                  maxLength={ATTESTATION_MAX}
                  value={attestation}
                  onChange={(event) => setAttestation(event.target.value)}
                  className={cn(control, "h-auto py-2")}
                />
              </Field>
            )}

            {canApprove && !datePassed && (
              <label className="flex items-start gap-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
                <input type="checkbox" className="mt-1" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
                I have checked this wording, word for word, against the approved source, and it is right for every state listed.
              </label>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--error-ink)]">
            {error}
          </p>
        )}

        <DialogFooter>
          <button type="button" className={btn("ghost")} onClick={onClose} disabled={Boolean(busy)}>
            {pending ? "Cancel" : "Close"}
          </button>
          {pending && mine && (
            <button type="button" className={btn("secondary", "h-10")} onClick={() => decide("cancel")} disabled={Boolean(busy)}>
              {busy === "cancel" ? "Withdrawing…" : "Withdraw proposal"}
            </button>
          )}
          {pending && selfApprove && (
            <button
              type="button"
              className={btn("primary")}
              onClick={() => decide("approve")}
              disabled={Boolean(busy) || approveBlocker !== null}
              title={approveBlocker ?? undefined}
            >
              {busy === "approve" ? "Publishing…" : "Approve my own proposal"}
            </button>
          )}
          {pending && !mine && (
            <>
              <button
                type="button"
                className={btn("secondary", "h-10")}
                onClick={() => decide("reject")}
                disabled={Boolean(busy) || note.trim().length === 0}
                title={note.trim().length === 0 ? "Add a review note saying why" : undefined}
              >
                {busy === "reject" ? "Rejecting…" : "Reject"}
              </button>
              <button
                type="button"
                className={btn("primary")}
                onClick={() => decide("approve")}
                disabled={Boolean(busy) || approveBlocker !== null}
                title={approveBlocker ?? undefined}
              >
                {busy === "approve" ? "Publishing…" : "Approve and publish"}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
