"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Field, control } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Callout } from "@/components/app/settings/primitives";
import { formatPhone, normalizeDigits } from "@/lib/suppression/constants";
import {
  CLEARED_LIST_LABELS,
  DNC_EXEMPTION_BASIS_LABELS,
  EXEMPTION_USE_LABELS,
  RELATIONSHIP_KIND_LABELS,
  relationshipExpiry,
  type ConsentCertificateOption,
  type DncExemption,
  type DncExemptionBasis,
  type DncExemptionUse,
  type RelationshipKind,
} from "@/lib/suppression/exemptionConstants";
import { cn } from "@/lib/utils";

/**
 * LA-2.3-3 · DNC exemptions on /app/tcpa.
 *
 * "Federal/state DNC not dialable unless an explicit recorded consent / prior-relationship record
 * exists." The user's decision: an owner records one per number — written consent with a stored
 * consent certificate attached, or an existing business relationship with its date (18 months after
 * a purchase, 3 months after an inquiry). It clears federal and state DNC for that number only,
 * never the agency's own list and never a litigator, and every use is listed here (the Uses view,
 * 2026-10-06: all of them, paged, where the card used to show only the last ten under the table).
 *
 * Foundation pass (2026-11-03): recording one is a page of its own (/app/tcpa/exemptions/new, was a form
 * pop-up); revoking is a confirm with its reason; the table keeps to the card's width (the note and the
 * revoke reason are each a second line, the last use sits under the count).
 */

type Loaded = { schemaReady: boolean; exemptions: DncExemption[]; uses: DncExemptionUse[]; canEdit: boolean };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const stamp = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const PROVIDER: Record<string, string> = { trustedform: "TrustedForm", jornaya: "Jornaya", other: "Certificate" };
const STATE_CHIP: Record<DncExemption["state"], { tone: "good" | "neutral" | "warning" | "danger"; label: string }> = {
  active: { tone: "good", label: "Clears DNC" },
  expired: { tone: "neutral", label: "Expired" },
  revoked: { tone: "neutral", label: "Revoked" },
  certificate_gone: { tone: "warning", label: "Certificate not held" },
};

const th = "bg-[var(--surface-alt)] px-3 py-2 text-left text-xs font-semibold leading-[1.33] whitespace-nowrap text-muted-foreground";
const td = "border-t border-border px-3 py-2 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]";
const sub = "block max-w-[240px] truncate text-xs text-muted-foreground";
const today = () => new Date().toISOString().slice(0, 10);
const NEW_EXEMPTION = "/app/tcpa/exemptions/new";

type Draft = { phone: string; basis: DncExemptionBasis; consentArtefactId: string; relationshipKind: RelationshipKind; relationshipDate: string; note: string };
const EMPTY: Draft = { phone: "", basis: "existing_business_relationship", consentArtefactId: "", relationshipKind: "purchase", relationshipDate: "", note: "" };

export function TcpaDncExemptions({ onChanged, className, pageSize = 10 }: { onChanged?: () => void; className?: string; pageSize?: number }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<DncExemption | null>(null);
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<"exemptions" | "uses">("exemptions");

  useEffect(() => {
    let live = true;
    fetch("/api/app/suppression/exemptions", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Could not load DNC exemptions");
        if (live) { setLoaded(body as Loaded); setError(null); }
      })
      .catch((failure: unknown) => { if (live) setError(failure instanceof Error ? failure.message : "Could not load DNC exemptions"); })
      .finally(() => { if (live) setRefreshing(false); });
    return () => { live = false; };
  }, [reload]);

  const refresh = useCallback(() => { setReload((value) => value + 1); onChanged?.(); }, [onChanged]);

  async function revoke() {
    if (!revoking) return;
    setBusy(true);
    try {
      const response = await fetch("/api/app/suppression/exemptions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: revoking.id, reason }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { notify.block(body?.error ?? "Could not revoke the exemption"); return; }
      notify.done(`${formatPhone(revoking.phoneDigits)} is back on federal and state DNC`);
      setRevoking(null);
      setReason("");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const exemptions = loaded?.exemptions ?? [];
  const numberOf = new Map(exemptions.map((row) => [row.id, row.phoneDigits]));
  const query = search.replace(/\D/g, "");
  const matching = query ? exemptions.filter((row) => row.phoneDigits.includes(query)) : exemptions;
  const { current, rows: shown } = paginate(matching, page, pageSize);
  const matchingUses = query ? (loaded?.uses ?? []).filter((use) => (use.phoneDigits || numberOf.get(use.exemptionId) || "").includes(query)) : (loaded?.uses ?? []);
  const usesPage = paginate(matchingUses, page, pageSize);
  const record = <Button variant="outline" asChild><Link href={NEW_EXEMPTION}><ShieldCheck aria-hidden="true" />Record an exemption</Link></Button>;

  return (
    <TableCard
      className={className}
      toolbar={
        <DataToolbar
          actions={<>
            {loaded?.canEdit && loaded.schemaReady && record}
            {query && <ClearFiltersButton onClick={() => { setSearch(""); setPage(1); }} />}
            <RefreshButton onClick={() => { setRefreshing(true); setReload((value) => value + 1); }} refreshing={refreshing} />
          </>}
        >
          <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search numbers" label="Search exemptions by number" />
          {/* Every use of an exemption is part of its record: its own view, never cut to the last ten. */}
          <div role="radiogroup" aria-label="Exemptions or their uses" className="flex flex-wrap items-center gap-2">
            <ToggleChip role="radio" selected={view === "exemptions"} count={loaded?.schemaReady ? exemptions.length : undefined} onClick={() => { setView("exemptions"); setPage(1); }}>Exemptions</ToggleChip>
            <ToggleChip role="radio" selected={view === "uses"} count={loaded?.schemaReady ? loaded.uses.length : undefined} onClick={() => { setView("uses"); setPage(1); }}>Uses</ToggleChip>
          </div>
        </DataToolbar>
      }
      footer={loaded?.schemaReady && view === "exemptions" && matching.length > 0
        ? <Pager page={current} total={matching.length} noun={matching.length === 1 ? "exemption" : "exemptions"} onPage={setPage} pageSize={pageSize} />
        : loaded?.schemaReady && view === "uses" && matchingUses.length > 0
          ? <Pager page={usesPage.current} total={matchingUses.length} noun={matchingUses.length === 1 ? "use" : "uses"} onPage={setPage} pageSize={pageSize} suffix="newest first" />
          : undefined}
    >
      {error ? <ErrorState title="DNC exemptions did not load" detail={error} action={<Button variant="outline" onClick={() => setReload((value) => value + 1)}>Try again</Button>} />
        : !loaded ? <SectionLoading rows={2} columns={6} label="Loading DNC exemptions" />
        : !loaded.schemaReady ? <EmptyState title="DNC exemptions need a database update" hint="Until it is applied, federal and state DNC numbers cannot be cleared." />
        : view === "uses" ? (
          loaded.uses.length === 0 ? <EmptyState title="No exemption has been used yet" hint="Listed each time an exemption clears a dial or check." />
          : matchingUses.length === 0 ? <NoMatches noun="uses" onClear={() => { setSearch(""); setPage(1); }} />
          : <table className="w-full min-w-[760px] border-collapse text-left">
            <thead><tr>
              <th className={th}>When</th>
              <th className={th}>Number</th>
              <th className={th}>Used for</th>
              <th className={th}>Cleared</th>
              <th className={th}>Who</th>
              <th className={`${th} text-right`}>Lead</th>
            </tr></thead>
            <tbody>{usesPage.rows.map((use) => <tr key={use.id} className="m-row">
              <td className={`${td} whitespace-nowrap tabular-nums`}>{stamp(use.usedAt)}</td>
              <td className={`${td} whitespace-nowrap font-semibold tabular-nums text-foreground`}>{formatPhone(use.phoneDigits || numberOf.get(use.exemptionId) || "")}</td>
              <td className={td}>{EXEMPTION_USE_LABELS[use.context] ?? use.context}</td>
              <td className={td}>{use.clearedLists.map((list) => CLEARED_LIST_LABELS[list] ?? list).join(" and ") || "DNC"}</td>
              <td className={td}>{use.userName ?? "—"}</td>
              <td className={`${td} text-right`}>{use.leadId ? <a className="text-[var(--accent-ink)] hover:underline" href={`/app/leads/${use.leadId}`}>Open lead</a> : "—"}</td>
            </tr>)}</tbody>
          </table>
        )
        : exemptions.length === 0 ? <EmptyState title="No exemptions recorded" hint="Federal and state DNC numbers are refused until an owner records consent or a business relationship." action={loaded.canEdit ? record : undefined} />
        : matching.length === 0 ? <NoMatches noun="exemptions" onClear={() => { setSearch(""); setPage(1); }} />
        : <table className="w-full min-w-[860px] border-collapse text-left">
            <thead><tr>
              <th className={th}>Number</th>
              <th className={th}>Basis</th>
              <th className={th}>Expires</th>
              <th className={th}>State</th>
              <th className={`${th} text-right`}>Uses</th>
              <th className={th}>Recorded</th>
              <th className={`${th} text-right`}><span className="sr-only">Action</span></th>
            </tr></thead>
            <tbody>{shown.map((row) => <tr key={row.id} className="m-row">
              <td className={`${td} whitespace-nowrap font-semibold tabular-nums text-foreground`}>{formatPhone(row.phoneDigits)}</td>
              <td className={td}>
                <span className="whitespace-nowrap">{DNC_EXEMPTION_BASIS_LABELS[row.basis]}</span>
                <span className={sub}>
                  {row.basis === "written_consent"
                    ? <>{PROVIDER[row.certificateProvider ?? ""] ?? "Certificate"}{row.certificateUrl ? <> · <a className="text-[var(--accent-ink)] hover:underline" href={row.certificateUrl} target="_blank" rel="noreferrer">certificate</a></> : null}</>
                    : <>{row.relationshipKind ? RELATIONSHIP_KIND_LABELS[row.relationshipKind] : "Relationship"} on {day(row.relationshipDate)}</>}
                  {row.note ? <span title={row.note}> · “{row.note}”</span> : null}
                </span>
              </td>
              <td className={`${td} whitespace-nowrap tabular-nums`}>{row.basis === "written_consent" ? "No expiry" : day(row.expiresAt)}</td>
              <td className={td}>
                <StatusChip tone={STATE_CHIP[row.state].tone}>{STATE_CHIP[row.state].label}</StatusChip>
                {row.state === "revoked" && row.revokeReason ? <span className={sub} title={row.revokeReason}>{row.revokeReason}{row.revokedByName ? ` · ${row.revokedByName}` : ""}</span> : null}
              </td>
              <td className={`${td} text-right tabular-nums`}>{row.uses.toLocaleString()}{row.lastUsedAt ? <span className="block text-xs text-muted-foreground">last {stamp(row.lastUsedAt)}</span> : null}</td>
              <td className={`${td} whitespace-nowrap tabular-nums`}>{day(row.recordedAt)}{row.recordedByName ? <span className="block text-xs text-muted-foreground">{row.recordedByName}</span> : null}</td>
              <td className={`${td} text-right`}>{loaded.canEdit && row.state !== "revoked" ? <Button type="button" variant="outline" size="sm" onClick={() => { setRevoking(row); setReason(""); }}>Revoke</Button> : null}</td>
            </tr>)}</tbody>
          </table>}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(next) => { if (!next) setRevoking(null); }}
        onConfirm={() => void revoke()}
        busy={busy}
        title="Revoke this exemption?"
        description={revoking ? `${formatPhone(revoking.phoneDigits)} goes back on federal and state DNC at once. The record and its uses are kept.` : undefined}
        confirmLabel={busy ? "Revoking…" : "Revoke exemption"}
        cancelLabel="Keep it"
        confirmDisabled={!reason.trim()}
        fields={<Field label="Reason" htmlFor="revoke-reason" required>
          <input id="revoke-reason" required maxLength={500} placeholder="Customer withdrew consent by email, 24 Sep" value={reason} onChange={(event) => setReason(event.target.value)} className={control} />
        </Field>}
      />
    </TableCard>
  );
}

/**
 * /app/tcpa/exemptions/new (foundation pass 2026-11-03; was a pop-up): the number, the basis, its evidence
 * (a stored consent certificate found from the number, or the relationship and its date) and a note.
 * Discard and Record, and a leave guard. The owner only (the API's write roles).
 */
export function TcpaExemptionForm() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [certificates, setCertificates] = useState<ConsentCertificateOption[] | null>(null);
  const [certificatesFor, setCertificatesFor] = useState<string | null>(null);
  const scope = useRef<HTMLFormElement>(null);

  async function findCertificates() {
    const digits = normalizeDigits(draft.phone);
    if (!digits) { setError("Enter the ten-digit number first."); return; }
    setError(null);
    setCertificates(null);
    setCertificatesFor(digits);
    const response = await fetch(`/api/app/suppression/exemptions?certificates=${digits}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Could not load consent certificates"); setCertificatesFor(null); return; }
    const found = (body?.certificates ?? []) as ConsentCertificateOption[];
    setCertificates(found);
    const firstStored = found.find((option) => option.stored);
    setDraft((current) => ({ ...current, consentArtefactId: firstStored?.id ?? "" }));
  }

  const expiry = draft.basis === "existing_business_relationship" && draft.relationshipDate ? relationshipExpiry(draft.relationshipKind, draft.relationshipDate) : null;
  const typedDigits = normalizeDigits(draft.phone);
  const canSave = Boolean(typedDigits) && (draft.basis === "written_consent" ? Boolean(draft.consentArtefactId) && certificatesFor === typedDigits : Boolean(draft.relationshipDate));
  const dirty = Boolean(draft.phone || draft.relationshipDate || draft.note);

  const save = async (): Promise<boolean> => {
    if (!canSave) { setError(draft.basis === "written_consent" ? "Find and choose a stored consent certificate for this number." : "Enter the number and the relationship's date."); return false; }
    setBusy(true);
    setError(null);
    try {
      const payload = draft.basis === "written_consent"
        ? { basis: draft.basis, phone: draft.phone, consentArtefactId: draft.consentArtefactId, ...(draft.note.trim() ? { note: draft.note.trim() } : {}) }
        : { basis: draft.basis, phone: draft.phone, relationshipKind: draft.relationshipKind, relationshipDate: draft.relationshipDate, ...(draft.note.trim() ? { note: draft.note.trim() } : {}) };
      const response = await fetch("/api/app/suppression/exemptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Could not record the exemption"); return false; }
      const saved = body.exemption as DncExemption;
      notify.done(`${formatPhone(saved.phoneDigits)} is cleared of federal and state DNC`, { detail: saved.expiresAt ? `Until ${day(saved.expiresAt)}.` : "Until revoked." });
      setDraft(EMPTY);
      router.push("/app/tcpa?tab=exemptions");
      return true;
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void save(); };

  return (
    <form ref={scope} onSubmit={submit} className={cn(cardSurface, "flex flex-col gap-4 p-5")}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Phone number" htmlFor="exemption-phone" required hint="Clears federal and state DNC for this one number — never your own list or a litigator.">
          <input id="exemption-phone" required placeholder="(555) 123-4567" inputMode="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} className={control} />
        </Field>
        <Field label="Note" htmlFor="exemption-note">
          <input id="exemption-note" maxLength={500} placeholder="Policy 4471 bought 12 Aug, confirmed by phone" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} className={control} />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-label text-[var(--body)]">Basis</legend>
        {(Object.keys(DNC_EXEMPTION_BASIS_LABELS) as DncExemptionBasis[]).map((basis) => <label key={basis} className="flex items-start gap-2 text-sm text-[var(--body)]">
          <input type="radio" name="exemption-basis" className="mt-1 size-4 accent-[var(--primary)]" checked={draft.basis === basis} onChange={() => setDraft({ ...draft, basis })} />
          <span>{DNC_EXEMPTION_BASIS_LABELS[basis]}<span className="block text-xs text-muted-foreground">{basis === "written_consent" ? "Attach the stored consent certificate from a lead with this number. No expiry, until revoked." : "Its date: 18 months after a purchase, 3 months after an inquiry."}</span></span>
        </label>)}
      </fieldset>
      {draft.basis === "written_consent" ? <div className="grid gap-2">
        <Button type="button" variant="outline" className="justify-self-start" disabled={!typedDigits} onClick={() => void findCertificates()}>Find consent certificates</Button>
        {certificatesFor && certificatesFor !== typedDigits && <p className="m-0 text-xs text-[var(--warning-ink)]">The number changed. Find its certificates again.</p>}
        {certificates && certificates.length === 0 && <p className="m-0 text-sm text-[var(--warning-ink)]">No lead with this number has a consent certificate on file, so written consent cannot be recorded for it.</p>}
        {certificates && certificates.length > 0 && <div className="grid gap-1.5" role="radiogroup" aria-label="Consent certificate">
          {certificates.map((option) => <label key={option.id} className={`flex items-start gap-2 text-sm ${option.stored ? "text-[var(--body)]" : "text-muted-foreground"}`}>
            <input type="radio" name="exemption-certificate" className="mt-1 size-4 accent-[var(--primary)]" disabled={!option.stored} checked={draft.consentArtefactId === option.id} onChange={() => setDraft({ ...draft, consentArtefactId: option.id })} />
            <span>{PROVIDER[option.provider] ?? option.provider} · {option.leadName ?? "Lead"} · captured {day(option.capturedAt)}
              <span className="block text-xs">{option.stored ? "Claimed and stored" : `Not usable: ${option.status === "claimed" ? "the copy is not held" : `the certificate is ${option.status}`}`}</span>
            </span>
          </label>)}
        </div>}
      </div> : <div className="grid gap-4 sm:grid-cols-2 lg:max-w-[50%]">
        <Field label="Relationship" htmlFor="exemption-kind">
          <select id="exemption-kind" className={control} value={draft.relationshipKind} onChange={(event) => setDraft({ ...draft, relationshipKind: event.target.value as RelationshipKind })}>
            {(Object.keys(RELATIONSHIP_KIND_LABELS) as RelationshipKind[]).map((kind) => <option key={kind} value={kind}>{RELATIONSHIP_KIND_LABELS[kind]}</option>)}
          </select>
        </Field>
        <Field label="Date" htmlFor="exemption-date" required
          hint={expiry ? (expiry <= today() ? undefined : `Clears federal and state DNC until ${day(expiry)}.`) : undefined}
          error={expiry && expiry <= today() ? `Already expired on ${day(expiry)}, so it cannot clear DNC.` : undefined}>
          <input id="exemption-date" type="date" required max={today()} value={draft.relationshipDate} onChange={(event) => setDraft({ ...draft, relationshipDate: event.target.value })} className={control} />
        </Field>
      </div>}
      {error ? <Callout tone="error" title={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" asChild><Link href="/app/tcpa?tab=exemptions">Discard</Link></Button>
        <Button type="submit" disabled={busy || !canSave}>{busy ? "Saving…" : "Record exemption"}</Button>
      </div>
      <LeaveGuard dirty={dirty && !busy} scope={scope} onSave={save} onDiscard={() => setDraft(EMPTY)} what="this exemption" />
    </form>
  );
}
