"use client";

/**
 * Beneficiaries step (LA-3.8; board l3-ws-beneficiaries). One card: the primaries, their running
 * total, then the contingents and theirs. A tier's total is green only at exactly 100.00 — shares
 * are integer hundredths of a percent end to end (3334 = 33.34%), so an even three-way split is
 * 33.34 / 33.33 / 33.33 and never 99.99. An estate, trust or funeral home has one name and no first
 * name (the table allows exactly that); a person needs both.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Divide, HeartHandshake, Plus, X } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Field, control } from "@/components/app/settings/primitives";
import { BENEFICIARY_RELATIONSHIPS, BENEFICIARY_RELATIONSHIP_LABEL, type BeneficiaryRelationship } from "@/lib/applications/constants";
import { FULL_SHARE, checkBeneficiaries, formatShare, isEntityRelationship, parseShare, splitEvenly, tierTotal, type BeneficiaryIssue, type BeneficiaryTier } from "@/lib/applications/beneficiaries";
import type { AttemptView, BeneficiaryView, CaseView } from "@/lib/applications/types";
import { cn } from "@/lib/utils";

import { useWorkspace } from "@/components/app/applications/workspace/context";
import { SaveStatus } from "@/components/app/applications/workspace/save-status";
import { StepCard } from "@/components/app/applications/workspace/step-card";

const TIER_LABEL: Record<BeneficiaryTier, string> = { primary: "Primary", contingent: "Contingent" };
const SAVE_DELAY = 800;

const newId = () => crypto.randomUUID();
/** An estate, trust or funeral home reads back with a null first name; the editor holds "". */
const normalise = (list: BeneficiaryView[]) => (list.some((b) => b.first_name == null) ? list.map((b) => ({ ...b, first_name: b.first_name ?? "" })) : list);
const displayName = (r: BeneficiaryView) => (isEntityRelationship(r.relationship) ? r.last_name.trim() : `${r.first_name} ${r.last_name}`.trim()) || "this beneficiary";

/** The other insured on the case — the spouse when this is the primary, and the reverse. */
function otherInsured(caseView: CaseView, current: AttemptView) {
  const other = caseView.attempts.find((a) => a.insuredRole !== current.insuredRole);
  if (!other) return null;
  const first = other.values["insured.first_name"]?.value;
  const last = other.values["insured.last_name"]?.value;
  if (typeof first === "string" && first) return { first_name: first, last_name: typeof last === "string" ? last : "" };
  if (other.insuredRole === "primary") {
    const parts = caseView.clientName.split(" ");
    return { first_name: parts[0] ?? "", last_name: parts.slice(1).pop() ?? "" };
  }
  return { first_name: "", last_name: "" };
}

/** Everything the server keeps about a row, without its id: two lists with the same content are the same list. */
const content = (list: BeneficiaryView[]) => JSON.stringify(list.map((b) => [b.tier, isEntityRelationship(b.relationship) ? "" : b.first_name.trim(), b.last_name.trim(), b.relationship, b.relationship === "other" ? b.relationship_other?.trim() || null : null, b.dob || null, b.share_bp, b.phone || null]));

/** What the table accepts: a name (both halves for a person), a relationship ("other" said in words) and a share. Anything less is held on screen. */
const rowSaveable = (b: BeneficiaryView) =>
  Boolean(b.relationship)
  && Boolean(b.last_name.trim())
  && (isEntityRelationship(b.relationship) || Boolean(b.first_name.trim()))
  && (b.relationship !== "other" || Boolean(b.relationship_other?.trim()))
  && b.share_bp > 0
  && (!b.dob || /^\d{4}-\d{2}-\d{2}$/.test(b.dob));
const saveable = (list: BeneficiaryView[]) => list.every(rowSaveable);

/**
 * Persist the list: debounced after a change, at once on `saveNow` (a field losing focus) and when
 * the step goes away. Sends only a complete list that differs from the last one sent.
 */
function useBeneficiarySaver(initial: BeneficiaryView[]) {
  const { actions } = useWorkspace();
  const [touched, setTouched] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queued = useRef<BeneficiaryView[] | null>(null);
  const sent = useRef<string>(content(initial));

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const list = queued.current;
    queued.current = null;
    if (!list || !saveable(list)) return;
    const c = content(list);
    if (c === sent.current) return;
    sent.current = c;
    setTouched(true);
    // An entity's first name is never sent: it has none.
    const clean = list.map((b) => (isEntityRelationship(b.relationship) ? { ...b, first_name: "" } : b));
    // A failed save is sent again with the next change or blur.
    void actions.saveBeneficiaries(clean).then((ok) => { if (!ok) sent.current = ""; });
  }, [actions]);

  const queue = useCallback((list: BeneficiaryView[]) => {
    queued.current = list;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  }, [flush]);

  const saveNow = useCallback((list: BeneficiaryView[]) => {
    queued.current = list;
    flush();
  }, [flush]);

  // Leaving the step with a change queued: send it rather than lose it.
  useEffect(() => () => flush(), [flush]);

  return { touched, queue, saveNow };
}

/** The strip under a tier: its live total, green only at exactly 100.00, and the tier's own rule breaks. */
function TotalBar({ tier, total, issues }: { tier: BeneficiaryTier; total: number; issues: BeneficiaryIssue[] }) {
  const ok = total === FULL_SHARE;
  const blocks = issues.filter((i) => i.severity === "block" && i.code !== "BENEFICIARY_PRIMARY_TOTAL" && i.code !== "BENEFICIARY_CONTINGENT_TOTAL");
  const warns = issues.filter((i) => i.severity === "warn");
  return (
    <div
      id={`beneficiaries.${tier}_total`}
      className={cn("flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] px-[22px] py-3.5 first:border-t-0", ok ? "bg-[var(--success-surface)]" : "bg-[var(--error-surface)]")}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-[var(--body)]">{TIER_LABEL[tier]} shares must total exactly 100.00</span>
        {blocks.map((i, n) => <span key={`${i.code}-${n}`} className="text-xs text-[var(--error-ink)]">{i.message}</span>)}
        {warns.map((i, n) => <span key={`${i.code}-${n}`} className="text-xs text-[var(--warning-ink)]">{i.message}</span>)}
      </span>
      <span aria-live="polite" className={cn("text-lg font-semibold tabular-nums", ok ? "text-[var(--success-ink)]" : "text-[var(--error-ink)]")}>
        {formatShare(total)}%
        <span className="sr-only">{ok ? " — complete" : " — not 100.00, this blocks ready"}</span>
      </span>
    </div>
  );
}

function BeneficiaryRow({ r, issues, readOnly, shareText, onShareText, onShareBlur, onPatch, onRemove }: {
  r: BeneficiaryView;
  issues: BeneficiaryIssue[];
  readOnly: boolean;
  shareText: string;
  onShareText: (text: string) => void;
  onShareBlur: () => void;
  onPatch: (patch: Partial<BeneficiaryView>) => void;
  onRemove: () => void;
}) {
  const f = (k: string) => `beneficiary.${r.id}.${k}`;
  const entity = isEntityRelationship(r.relationship);
  const shareInvalid = parseShare(shareText) === null;
  const otherMissing = r.relationship === "other" && !r.relationship_other?.trim();
  const blocks = issues.filter((i) => i.severity === "block");
  const warns = issues.filter((i) => i.severity === "warn");

  return (
    <div id={`beneficiary.${r.id}`} tabIndex={-1} className="m-row flex flex-col gap-3 border-t border-[var(--border)] px-[22px] py-3.5 outline-none first:border-t-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,.9fr)_36px]">
        {entity ? (
          <Field label="Name" htmlFor={f("last_name")} required>
            <input id={f("last_name")} className={control} autoComplete="off" placeholder={`The ${BENEFICIARY_RELATIONSHIP_LABEL[r.relationship as BeneficiaryRelationship].toLowerCase()} of …`} value={r.last_name} disabled={readOnly} aria-invalid={!r.last_name.trim()} onChange={(e) => onPatch({ last_name: e.target.value })} />
          </Field>
        ) : (
          <Field label="Name" htmlFor={f("first_name")} required>
            <span className="flex gap-2">
              <input id={f("first_name")} aria-label="First name" placeholder="First" className={control} autoComplete="off" value={r.first_name} disabled={readOnly} aria-invalid={!r.first_name.trim()} onChange={(e) => onPatch({ first_name: e.target.value })} />
              <input id={f("last_name")} aria-label="Last name" placeholder="Last" className={control} autoComplete="off" value={r.last_name} disabled={readOnly} aria-invalid={!r.last_name.trim()} onChange={(e) => onPatch({ last_name: e.target.value })} />
            </span>
          </Field>
        )}
        <Field label="Relationship" htmlFor={f("relationship")} required>
          <select id={f("relationship")} className={control} value={r.relationship} disabled={readOnly} aria-invalid={!r.relationship} onChange={(e) => onPatch({ relationship: e.target.value as BeneficiaryRelationship | "" })}>
            <option value="">Choose</option>
            {BENEFICIARY_RELATIONSHIPS.map((rel) => <option key={rel} value={rel}>{BENEFICIARY_RELATIONSHIP_LABEL[rel]}</option>)}
          </select>
        </Field>
        <Field label="Share %" htmlFor={f("share")} required>
          <input
            id={f("share")}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            title="Up to two decimals, from 0.01 to 100"
            className={cn(control, "tabular-nums")}
            value={shareText}
            disabled={readOnly}
            aria-invalid={shareInvalid}
            onChange={(e) => onShareText(e.target.value)}
            onBlur={onShareBlur}
          />
        </Field>
        {readOnly ? (
          <span className="flex h-9 items-center"><StatusChip tone="neutral">{TIER_LABEL[r.tier]}</StatusChip></span>
        ) : (
          <Field label="Tier" htmlFor={f("tier")}>
            <select id={f("tier")} className={control} value={r.tier} onChange={(e) => onPatch({ tier: e.target.value as BeneficiaryTier })}>
              <option value="primary">Primary</option>
              <option value="contingent">Contingent</option>
            </select>
          </Field>
        )}
        {readOnly ? <span /> : (
          <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${displayName(r)}`} className="text-[var(--muted)]">
            <X aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {r.relationship === "other" && (
          <Field label="Relationship, in words" htmlFor={f("relationship_other")} required>
            <input id={f("relationship_other")} className={control} autoComplete="off" placeholder="Say who they are" value={r.relationship_other ?? ""} disabled={readOnly} aria-invalid={otherMissing} onChange={(e) => onPatch({ relationship_other: e.target.value })} />
          </Field>
        )}
        {!entity && (
          <Field label="Date of birth" htmlFor={f("dob")}>
            <input id={f("dob")} type="date" className={control} value={r.dob ?? ""} disabled={readOnly} onChange={(e) => onPatch({ dob: e.target.value || null })} />
          </Field>
        )}
        <Field label="Phone" htmlFor={f("phone")}>
          <input id={f("phone")} type="tel" className={cn(control, "tabular-nums")} autoComplete="off" value={r.phone ?? ""} disabled={readOnly} onChange={(e) => onPatch({ phone: e.target.value || null })} />
        </Field>
      </div>

      {(blocks.length > 0 || warns.length > 0) && (
        <ul className="flex flex-col gap-0.5 text-xs">
          {blocks.map((i, n) => <li key={`${i.code}-${n}`} className="text-[var(--error-ink)]">{i.message}</li>)}
          {warns.map((i, n) => <li key={`${i.code}-${n}`} className="text-[var(--warning-ink)]">{i.message}</li>)}
        </ul>
      )}
    </div>
  );
}

function BeneficiariesStepFor() {
  const { caseView, attempt, readOnly, updateAttempt, goTo } = useWorkspace();
  // The editor's own copy: the workspace re-reads the case after every save, and a row must not
  // remount (and lose the cursor) because the server handed back new ids for the same people.
  const [rows, setRows] = useState<BeneficiaryView[]>(() => normalise(attempt.beneficiaries));
  const [seen, setSeen] = useState(attempt.beneficiaries);
  // React keys stay put while ids change: server id → the key the row was first rendered with.
  const [keys, setKeys] = useState<Record<string, string>>({});
  // What the agent is typing in a share cell; the row holds the parsed hundredths.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const saver = useBeneficiarySaver(normalise(attempt.beneficiaries));
  const issues = checkBeneficiaries(rows);
  const hasSpouse = caseView.attempts.some((a) => a.insuredRole === "spouse");

  // The re-read case brought the same people back under new ids: adopt the ids (QA's deep links
  // point at them) and keep each row's key.
  if (seen !== attempt.beneficiaries) {
    setSeen(attempt.beneficiaries);
    const server = normalise(attempt.beneficiaries);
    if (server.length === rows.length && content(server) === content(rows) && server.some((b, i) => b.id !== rows[i].id)) {
      const nextKeys = { ...keys };
      server.forEach((b, i) => { nextKeys[b.id] = keys[rows[i].id] ?? rows[i].id; });
      setKeys(nextKeys);
      setDrafts((d) => Object.fromEntries(Object.entries(d).map(([id, text]) => [server[rows.findIndex((r) => r.id === id)]?.id ?? id, text])));
      setRows(server);
    }
  }
  const keyOf = (r: BeneficiaryView) => keys[r.id] ?? r.id;

  const save = (next: BeneficiaryView[]) => {
    setRows(next);
    updateAttempt({ beneficiaries: next }); // the QA rail reads the attempt
    saver.queue(next);
  };
  const patch = (id: string, p: Partial<BeneficiaryView>) => save(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const shareText = (r: BeneficiaryView) => drafts[r.id] ?? (r.share_bp > 0 ? formatShare(r.share_bp) : "");
  const clearDrafts = (ids: string[]) => setDrafts((d) => { const next = { ...d }; for (const id of ids) delete next[id]; return next; });

  const primaries = rows.filter((r) => r.tier === "primary");
  const contingents = rows.filter((r) => r.tier === "contingent");
  const rowIssues = (id: string) => issues.filter((i) => i.id === id);
  const tierIssues = (tier: BeneficiaryTier) => issues.filter((i) => !i.id && (i.code === "BENEFICIARY_CONTINGENT_TOTAL" ? tier === "contingent" : tier === "primary"));

  function add() {
    // A new row is a primary. It takes what the primaries have left; when they already hold the full
    // 100.00, every primary is split evenly with it (2 → 50 / 50). It used to drop into the contingent
    // tier at 100%, so two people read 100% and 100% and "Split evenly" kept them there. A contingent
    // is chosen on purpose, from the row's Tier.
    const left = FULL_SHARE - tierTotal(rows, "primary");
    const row: BeneficiaryView = { id: newId(), tier: "primary", first_name: "", last_name: "", relationship: "", dob: null, share_bp: left > 0 ? left : 0, phone: null };
    let next = [...rows, row];
    if (left <= 0) {
      const ids = next.filter((r) => r.tier === "primary").map((r) => r.id);
      const shares = splitEvenly(ids.length);
      next = next.map((r) => (r.tier === "primary" ? { ...r, share_bp: shares[ids.indexOf(r.id)] } : r));
      clearDrafts(ids);
      notify.done(`Split evenly between ${ids.length} primaries`, { detail: "Change a share if the client wants it divided differently." });
    }
    save(next);
    requestAnimationFrame(() => document.getElementById(`beneficiary.${row.id}.first_name`)?.focus());
  }

  /** Each tier divides its 100.00 evenly: 3 → 33.34 / 33.33 / 33.33. */
  function split() {
    const shareFor = new Map<string, number>();
    for (const tier of ["primary", "contingent"] as const) {
      const ids = rows.filter((r) => r.tier === tier).map((r) => r.id);
      splitEvenly(ids.length).forEach((s, i) => shareFor.set(ids[i], s));
    }
    save(rows.map((r) => ({ ...r, share_bp: shareFor.get(r.id) ?? r.share_bp })));
    clearDrafts(rows.map((r) => r.id));
  }

  function remove(r: BeneficiaryView) {
    save(rows.filter((x) => x.id !== r.id));
    clearDrafts([r.id]);
    notify.done(`Removed ${displayName(r)}`);
  }

  /** LA-3.24: each spouse names the other, then the children share the contingent tier. Every row stays editable. */
  function eachOtherThenChildren() {
    const other = otherInsured(caseView, attempt);
    if (!other) return;
    const existingSpouse = rows.find((r) => r.relationship === "spouse");
    const children = rows.filter((r) => r.relationship === "child");
    const shares = splitEvenly(children.length);
    const next: BeneficiaryView[] = [
      { ...(existingSpouse ?? { id: newId(), dob: null, phone: null, ...other }), tier: "primary", relationship: "spouse", share_bp: FULL_SHARE },
      ...children.map((c, i) => ({ ...c, tier: "contingent" as const, share_bp: shares[i] })),
    ];
    const dropped = rows.length - (existingSpouse ? 1 : 0) - children.length;
    save(next);
    setDrafts({});
    notify.done(
      "Spouse is primary, children are contingent",
      { detail: dropped > 0 ? `${dropped} other beneficiar${dropped === 1 ? "y was" : "ies were"} removed.` : children.length ? undefined : "No children are listed yet — add them as contingents." },
    );
  }

  const renderRow = (r: BeneficiaryView) => (
    <BeneficiaryRow
      key={keyOf(r)}
      r={r}
      issues={rowIssues(r.id)}
      readOnly={readOnly}
      shareText={shareText(r)}
      onShareText={(text) => { setDrafts((d) => ({ ...d, [r.id]: text })); patch(r.id, { share_bp: parseShare(text) ?? 0 }); }}
      onShareBlur={() => { if (parseShare(shareText(r)) !== null) clearDrafts([r.id]); }}
      onPatch={(p) => patch(r.id, p)}
      onRemove={() => remove(r)}
    />
  );

  return (
    <StepCard
      title="Beneficiaries"
      chips={!readOnly && (
        <>
          <SaveStatus touched={saver.touched} pendingNote={saveable(rows) ? null : "Not saved yet — each beneficiary needs a name, a relationship and a share."} className="max-w-[260px]" />
          {hasSpouse && <Button type="button" variant="outline" onClick={eachOtherThenChildren}><HeartHandshake aria-hidden="true" />Each other, then the children</Button>}
          <Button type="button" variant="outline" onClick={split} disabled={rows.length < 2} title={rows.length < 2 ? "Add a second beneficiary to split between" : "Each tier splits its 100.00 evenly: three ways is 33.34 / 33.33 / 33.33"}><Divide aria-hidden="true" />Split evenly</Button>
          <Button type="button" variant="outline" onClick={add}><Plus aria-hidden="true" />Add beneficiary</Button>
        </>
      )}
      bodyClassName="gap-0 p-0"
      actions={<>
        <Button type="button" variant="outline" onClick={() => goTo("application")}><ArrowLeft aria-hidden="true" />Back to Application</Button>
        <Button type="button" onClick={() => goTo("payment")}>Continue to Payment<ArrowRight aria-hidden="true" /></Button>
      </>}
    >
      {/* Leaving a field sends what is on screen now rather than waiting out the delay. */}
      <div className="flex flex-col" onBlur={readOnly ? undefined : () => saver.saveNow(rows)}>
        {rows.length === 0 ? (
          <EmptyState title="No beneficiaries yet" hint={readOnly ? "None were named on this attempt." : "Add who receives the benefit. Primary shares must total 100.00."} />
        ) : (
          <>
            {primaries.map(renderRow)}
            <TotalBar tier="primary" total={tierTotal(rows, "primary")} issues={tierIssues("primary")} />
            {contingents.map(renderRow)}
            {contingents.length > 0 && <TotalBar tier="contingent" total={tierTotal(rows, "contingent")} issues={tierIssues("contingent")} />}
          </>
        )}
      </div>
    </StepCard>
  );
}

export function BeneficiariesStep() {
  const { attempt } = useWorkspace();
  return <BeneficiariesStepFor key={attempt.id} />;
}
