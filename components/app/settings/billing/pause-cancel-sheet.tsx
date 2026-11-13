"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FactTable } from "@/components/ui/fact-table";
import { textareaControl } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { retentionEndsAt } from "@/lib/billing/selfServiceRules";
import { formatCentsAsCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

import { EXPORTS, SUPPORT_EMAIL, day, exportHref, short, type View } from "./types";

const REASONS = ["Too expensive", "Missing something", "Switching tools", "Slow season", "Closing the agency", "Other"] as const;
type Step = "why" | "offer" | "records" | "confirm";
const STEP_LABEL: Record<Step, string> = { why: "Why", offer: "Pause?", records: "Records", confirm: "Confirm" };

/** The stepped sheet's progress: done steps ticked, the current one green. */
function Steps({ steps, at }: { steps: Step[]; at: Step }) {
  const index = steps.indexOf(at);
  return (
    <ol aria-label="Steps" className="m-0 flex list-none items-center gap-2 p-0">
      {steps.map((s, i) => (
        <li key={s} aria-current={s === at ? "step" : undefined} className={cn("flex min-w-0 items-center gap-1.5 text-xs", i === index ? "font-semibold text-[var(--ink)]" : "text-[var(--muted)]", i < steps.length - 1 && "flex-1 after:h-px after:min-w-4 after:flex-1 after:bg-[var(--border)] after:content-['']")}>
          <span aria-hidden="true" className={cn("grid size-[22px] shrink-0 place-items-center rounded-full text-xs font-bold", i < index ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : i === index ? "bg-[var(--primary)] text-[var(--on-primary)]" : "bg-[var(--surface-alt)] text-[var(--muted)]")}>
            {i < index ? <Check className="size-3" /> : i + 1}
          </span>
          {STEP_LABEL[s]}
        </li>
      ))}
    </ol>
  );
}

function Choice({ on, title, sub, onClick }: { on: boolean; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick}
      className={cn("flex w-full items-center gap-3 rounded-[12px] border px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]", on ? "border-[var(--primary)] bg-[var(--primary-soft)] shadow-[inset_0_0_0_1px_var(--primary)]" : "border-[var(--border)] bg-[var(--color-card)] hover:border-[var(--border-strong)]")}>
      <span aria-hidden="true" className={cn("size-4 shrink-0 rounded-full border-[1.5px]", on ? "border-[5px] border-[var(--primary)]" : "border-[var(--border-strong)]")} />
      <span className="min-w-0">
        <strong className="block text-sm font-semibold text-[var(--ink)]">{title}</strong>
        <span className="block text-xs text-[var(--muted)]">{sub}</span>
      </span>
    </button>
  );
}

/**
 * A5/A6 · Pause or cancel, as one calm sheet. Pause first (a plain list of what happens); cancelling
 * goes reason → pause instead? (offered once, only where a pause is possible) → take your records →
 * confirm. The server owns the one-time offer: a cancel it has not offered the pause for comes back
 * `offer_pause` and is sent again once the owner has seen it here.
 */
export function PauseCancelSheet({ view, start, busy, onClose, onPause, onCancel }: {
  view: View;
  start: "choose" | "cancel";
  busy: boolean;
  onClose: () => void;
  onPause: () => Promise<boolean>;
  onCancel: (reason: string) => Promise<boolean>;
}) {
  const sub = view.subscription;
  const actions = view.actions;
  const canPause = Boolean(actions?.canPause);
  const canCancel = Boolean(actions?.canCancel);
  const [mode, setMode] = useState<"pause" | "cancel">(start === "cancel" || !canPause ? "cancel" : "pause");
  const [step, setStep] = useState<Step | null>(start === "cancel" ? "why" : null);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const ends = sub?.periodEnd ?? null;
  const readable = ends ? day(retentionEndsAt(ends, view.retention.days)) : `${view.retention.days} days after it ends`;
  const steps: Step[] = ["why", ...(canPause && actions?.offerPauseFirst ? (["offer"] as Step[]) : []), "records", "confirm"];
  const next = () => step && setStep(steps[steps.indexOf(step) + 1] ?? "confirm");
  const back = () => { if (!step) return; const i = steps.indexOf(step); if (i <= 0) { if (start === "cancel") onClose(); else setStep(null); } else setStep(steps[i - 1]); };
  const fullReason = reason ? `${reason}${note.trim() ? `: ${note.trim()}` : ""}` : "";
  const pause = () => void onPause().then((ok) => { if (ok) onClose(); });

  // The first screen: pause or cancel.
  if (!step) {
    return (
      <Sheet
        title="Pause or cancel"
        onClose={onClose}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Keep it running</Button>
            {mode === "pause"
              ? <Button type="button" disabled={busy || !view.schemaReady} onClick={pause}>Pause subscription</Button>
              : <Button type="button" variant="outline" disabled={!canCancel || !view.schemaReady} onClick={() => setStep("why")}>Continue to cancel</Button>}
          </div>
        }
      >
        <div role="radiogroup" aria-label="Pause or cancel" className="flex flex-col gap-2">
          {canPause ? <Choice on={mode === "pause"} title="Pause" sub="No charges, your book stays readable, resume when you're ready" onClick={() => setMode("pause")} /> : null}
          {canCancel ? <Choice on={mode === "cancel"} title="Cancel" sub={`Ends ${short(ends)}; records stay readable and exportable for ${view.retention.days} days`} onClick={() => setMode("cancel")} /> : null}
        </div>
        <div className="border-t border-[var(--border)] pt-3">
          {mode === "pause" ? (
            <>
              <h3 className="m-0 mb-1.5 text-sm font-semibold text-[var(--ink)]">While paused</h3>
              <ul className="m-0 flex flex-col gap-1 pl-[18px] text-sm text-[var(--body)]">
                <li>No charges from today.{sub?.renewsAt ? ` Your ${short(sub.renewsAt)} charge doesn't happen.` : ""}</li>
                <li>Your book, policies and commissions stay readable, and exports work.</li>
                <li>Dialing, new applications and lead posting stop.</li>
                <li>Partners see the portal as read-only.</li>
                <li>Resume any time; billing restarts that day.</li>
              </ul>
            </>
          ) : (
            <>
              <h3 className="m-0 mb-1.5 text-sm font-semibold text-[var(--ink)]">If you cancel</h3>
              <ul className="m-0 flex flex-col gap-1 pl-[18px] text-sm text-[var(--body)]">
                <li>Everything works until {day(ends)}.</li>
                <li>After that the workspace is read-only, and your records can be read and exported until {readable}.</li>
                <li>Then the workspace can no longer be opened.</li>
              </ul>
            </>
          )}
        </div>
      </Sheet>
    );
  }

  const footer = (() => {
    switch (step) {
      case "why":
        return <><Button type="button" variant="ghost" className="mr-auto" onClick={back}>{start === "cancel" ? "Keep my subscription" : "Back"}</Button><Button type="button" disabled={!reason} onClick={next}>Next</Button></>;
      case "offer":
        return <><Button type="button" variant="ghost" className="mr-auto" onClick={back}>Back</Button><Button type="button" variant="outline" onClick={next}>Continue to cancel</Button><Button type="button" disabled={busy || !view.schemaReady} onClick={pause}>Pause instead</Button></>;
      case "records":
        return <><Button type="button" variant="ghost" className="mr-auto" onClick={back}>Back</Button><Button type="button" onClick={next}>Next</Button></>;
      case "confirm":
        return <><Button type="button" variant="ghost" className="mr-auto" onClick={onClose}>Keep my subscription</Button><Button type="button" variant="destructive" disabled={busy || !view.schemaReady || fullReason.length < 5} onClick={() => void onCancel(fullReason).then((ok) => { if (ok) onClose(); })}>Cancel on {short(ends)}</Button></>;
    }
  })();

  return (
    <Sheet
      title="Cancel your subscription"
      status={<Steps steps={steps} at={step} />}
      onClose={onClose}
      footer={<div className="flex flex-wrap items-center justify-end gap-2">{footer}</div>}
    >
      {step === "why" ? (
        <>
          <p className="m-0 text-xs text-[var(--muted)]">Pick what fits best.</p>
          <div role="radiogroup" aria-label="Why are you cancelling?" className="flex flex-wrap gap-2">
            {REASONS.map((r) => <ToggleChip key={r} role="radio" selected={reason === r} onClick={() => setReason(r)}>{r}</ToggleChip>)}
          </div>
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-[var(--ink)]">
            Anything we should know?
            <textarea className={textareaControl} value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} />
          </label>
        </>
      ) : step === "offer" ? (
        <>
          <h3 className="m-0 text-base font-semibold text-[var(--ink)]">Would a pause do?</h3>
          <p className="m-0 text-xs text-[var(--muted)]">{note.trim() ? <>You said &ldquo;{note.trim()}&rdquo;. </> : null}A pause keeps everything as it is and costs nothing.</p>
          <FactTable labelWidth={110} rows={[
            ["Pause", `${formatCentsAsCurrency(0)} while paused · resume in one click`],
            ["Cancel", `Ends ${short(ends)} · records kept ${view.retention.days} days, then deleted`],
          ]} />
          <p className="m-0 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">We only ask once. &ldquo;Continue to cancel&rdquo; goes on to your records.</p>
        </>
      ) : step === "records" ? (
        <>
          <p className="m-0 text-xs text-[var(--muted)]">Readable and exportable for {view.retention.days} days after {short(ends)}, until {readable}.</p>
          <div className="flex flex-col">
            {EXPORTS.map((e) => (
              <div key={e.part} className="flex items-center gap-3 border-b border-[var(--border)] py-2.5 text-sm">
                <span className="font-medium text-[var(--ink)]">{e.label}</span>
                <span className="text-xs text-[var(--muted)]">{e.sub}</span>
                <Button asChild size="sm" variant="outline" className="ml-auto"><a href={exportHref(e.part)}>Export</a></Button>
              </div>
            ))}
            <div className="flex items-center gap-3 py-2.5 text-sm">
              <span className="font-medium text-[var(--ink)]">Invoices</span>
              <span className="text-xs text-[var(--muted)]">{view.invoices.length === 1 ? "1 invoice" : `${view.invoices.length} invoices`} · each opens from Invoices to save as a PDF</span>
            </div>
          </div>
        </>
      ) : (
        <>
          <FactTable labelWidth={110} rows={[
            ["Ends", day(ends)],
            ["Charges", "None after this period"],
            ["Read-only", `Until ${readable}`],
            ["Why", fullReason],
          ]} />
          <p className="m-0 text-xs text-[var(--muted)]">To change your mind before {short(ends)}, email {SUPPORT_EMAIL}.</p>
        </>
      )}
    </Sheet>
  );
}
