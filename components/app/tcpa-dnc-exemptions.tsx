"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
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

/**
 * LA-2.3-3 · DNC exemptions on /app/tcpa.
 *
 * "Federal/state DNC not dialable unless an explicit recorded consent / prior-relationship record
 * exists." The user's decision: an owner records one per number — written consent with a stored
 * consent certificate attached, or an existing business relationship with its date (18 months after
 * a purchase, 3 months after an inquiry). It clears federal and state DNC for that number only,
 * never the agency's own list and never a litigator, and every use is listed here.
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

const th = "bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";
const td = "border-t border-border px-3 py-2 text-sm leading-normal tracking-[-0.02em] text-[var(--body)] align-top";
const field = "h-9 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
const today = () => new Date().toISOString().slice(0, 10);
const PAGE_SIZE = 10;

type Draft = { phone: string; basis: DncExemptionBasis; consentArtefactId: string; relationshipKind: RelationshipKind; relationshipDate: string; note: string };
const EMPTY: Draft = { phone: "", basis: "existing_business_relationship", consentArtefactId: "", relationshipKind: "purchase", relationshipDate: "", note: "" };

export function TcpaDncExemptions({ onChanged }: { onChanged?: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [certificates, setCertificates] = useState<ConsentCertificateOption[] | null>(null);
  const [certificatesFor, setCertificatesFor] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<DncExemption | null>(null);
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

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

  async function findCertificates() {
    const digits = normalizeDigits(draft.phone);
    if (!digits) { notify.block("Enter the ten-digit number first."); return; }
    setCertificates(null);
    setCertificatesFor(digits);
    const response = await fetch(`/api/app/suppression/exemptions?certificates=${digits}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { notify.block(body?.error ?? "Could not load consent certificates"); setCertificatesFor(null); return; }
    const found = (body?.certificates ?? []) as ConsentCertificateOption[];
    setCertificates(found);
    const firstStored = found.find((option) => option.stored);
    setDraft((current) => ({ ...current, consentArtefactId: firstStored?.id ?? "" }));
  }

  async function record(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = draft.basis === "written_consent"
        ? { basis: draft.basis, phone: draft.phone, consentArtefactId: draft.consentArtefactId, ...(draft.note.trim() ? { note: draft.note.trim() } : {}) }
        : { basis: draft.basis, phone: draft.phone, relationshipKind: draft.relationshipKind, relationshipDate: draft.relationshipDate, ...(draft.note.trim() ? { note: draft.note.trim() } : {}) };
      const response = await fetch("/api/app/suppression/exemptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { notify.block(body?.error ?? "Could not record the exemption"); return; }
      const saved = body.exemption as DncExemption;
      notify.done(`${formatPhone(saved.phoneDigits)} is cleared of federal and state DNC`, { detail: saved.expiresAt ? `Until ${day(saved.expiresAt)}.` : "Until revoked." });
      setOpen(false);
      setDraft(EMPTY);
      setCertificates(null);
      setCertificatesFor(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(event: React.FormEvent) {
    event.preventDefault();
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

  const expiry = draft.basis === "existing_business_relationship" && draft.relationshipDate ? relationshipExpiry(draft.relationshipKind, draft.relationshipDate) : null;
  const typedDigits = normalizeDigits(draft.phone);
  const canSave = Boolean(typedDigits) && (draft.basis === "written_consent" ? Boolean(draft.consentArtefactId) && certificatesFor === typedDigits : Boolean(draft.relationshipDate));
  const exemptions = loaded?.exemptions ?? [];
  const numberOf = new Map(exemptions.map((row) => [row.id, row.phoneDigits]));
  const query = search.replace(/\D/g, "");
  const matching = query ? exemptions.filter((row) => row.phoneDigits.includes(query)) : exemptions;
  const { current, rows: shown } = paginate(matching, page, PAGE_SIZE);

  return (
    <TableCard
      title="DNC exemptions"
      toolbar={
        <DataToolbar
          actions={<>
            {loaded?.canEdit && loaded.schemaReady && <Button variant="outline" onClick={() => setOpen(true)}><ShieldCheck aria-hidden="true" />Record an exemption</Button>}
            <RefreshButton onClick={() => { setRefreshing(true); setReload((value) => value + 1); }} refreshing={refreshing} />
          </>}
        >
          <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search numbers" label="Search exemptions by number" />
        </DataToolbar>
      }
      footer={loaded?.schemaReady && matching.length > 0 ? <Pager page={current} total={matching.length} noun={matching.length === 1 ? "exemption" : "exemptions"} onPage={setPage} pageSize={PAGE_SIZE} /> : undefined}
    >
      {error ? <ErrorState title="DNC exemptions did not load" detail={error} action={<Button variant="outline" onClick={() => setReload((value) => value + 1)}>Try again</Button>} />
        : !loaded ? <SectionLoading rows={2} columns={6} label="Loading DNC exemptions" />
        : !loaded.schemaReady ? <p className="px-4 py-3 text-sm text-[var(--warning-ink)]" role="note">DNC exemptions need a database update — until it is applied, federal and state DNC numbers cannot be cleared.</p>
        : exemptions.length === 0 ? <EmptyState title="No exemptions recorded" hint="Federal and state DNC numbers are refused until an owner records consent or a business relationship." />
        : matching.length === 0 ? <NoMatches noun="exemptions" onClear={() => { setSearch(""); setPage(1); }} />
        : <>
          <table className="w-full min-w-[900px] table-fixed border-collapse text-left">
            <thead><tr>
              <th className={`${th} w-[150px]`}>Number</th>
              <th className={th}>Basis</th>
              <th className={`${th} w-[150px]`}>State</th>
              <th className={`${th} w-[170px]`}>Recorded</th>
              <th className={`${th} w-[130px] text-right`}>Uses</th>
              <th className={`${th} w-[100px] text-right`}><span className="sr-only">Action</span></th>
            </tr></thead>
            <tbody>{shown.map((row) => <tr key={row.id} className="m-row">
              <td className={`${td} font-semibold tabular-nums text-foreground`}>{formatPhone(row.phoneDigits)}</td>
              <td className={td}>
                {DNC_EXEMPTION_BASIS_LABELS[row.basis]}
                <span className="block text-xs text-muted-foreground">
                  {row.basis === "written_consent"
                    ? <>{PROVIDER[row.certificateProvider ?? ""] ?? "Certificate"}{row.certificateUrl ? <> · <a className="text-[var(--accent-ink)] hover:underline" href={row.certificateUrl} target="_blank" rel="noreferrer">certificate</a></> : null} · no expiry</>
                    : <>{row.relationshipKind ? RELATIONSHIP_KIND_LABELS[row.relationshipKind] : "Relationship"} on {day(row.relationshipDate)} · expires {day(row.expiresAt)}</>}
                  {row.note ? ` · “${row.note}”` : ""}
                </span>
              </td>
              <td className={td}>
                <StatusChip tone={STATE_CHIP[row.state].tone}>{STATE_CHIP[row.state].label}</StatusChip>
                {row.state === "revoked" && row.revokeReason && <span className="mt-1 block text-xs text-muted-foreground">{row.revokeReason}{row.revokedByName ? ` · ${row.revokedByName}` : ""}</span>}
              </td>
              <td className={`${td} tabular-nums`}>{day(row.recordedAt)}<span className="block text-xs text-muted-foreground">{row.recordedByName ?? "—"}</span></td>
              <td className={`${td} text-right tabular-nums`}>{row.uses.toLocaleString()}{row.lastUsedAt && <span className="block text-xs text-muted-foreground">last {stamp(row.lastUsedAt)}</span>}</td>
              <td className={`${td} text-right`}>{loaded.canEdit && row.state !== "revoked" ? <Button type="button" variant="outline" size="sm" className="text-[var(--error-ink)]" onClick={() => { setRevoking(row); setReason(""); }}>Revoke</Button> : null}</td>
            </tr>)}</tbody>
          </table>
          {loaded.uses.length > 0 && <div className="border-t border-border px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Recent uses</h3>
            <ul className="mt-1.5 grid gap-1 text-sm leading-normal text-[var(--body)]">
              {loaded.uses.slice(0, 10).map((use) => <li key={use.id} className="tabular-nums">
                {stamp(use.usedAt)} · <span className="font-semibold text-foreground">{formatPhone(use.phoneDigits || numberOf.get(use.exemptionId) || "")}</span> · {EXEMPTION_USE_LABELS[use.context] ?? use.context} cleared {use.clearedLists.map((list) => CLEARED_LIST_LABELS[list] ?? list).join(" and ") || "DNC"}
                {use.userName ? ` · ${use.userName}` : ""}{use.leadId ? <> · <a className="text-[var(--accent-ink)] hover:underline" href={`/app/leads/${use.leadId}`}>lead</a></> : null}
              </li>)}
            </ul>
          </div>}
        </>}

      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setCertificates(null); setCertificatesFor(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a DNC exemption</DialogTitle>
            <DialogDescription>Clears federal and state DNC for this one number — never your own list or a litigator.</DialogDescription>
          </DialogHeader>
          <form onSubmit={record} className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-[var(--body)]">Phone number</span>
              <input required placeholder="(555) 123-4567" inputMode="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} className={field} />
            </label>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-semibold text-[var(--body)]">Basis</legend>
              {(Object.keys(DNC_EXEMPTION_BASIS_LABELS) as DncExemptionBasis[]).map((basis) => <label key={basis} className="flex items-start gap-2 text-sm text-[var(--body)]">
                <input type="radio" name="exemption-basis" className="mt-1 size-4 accent-primary" checked={draft.basis === basis} onChange={() => setDraft({ ...draft, basis })} />
                <span>{DNC_EXEMPTION_BASIS_LABELS[basis]}<span className="block text-xs text-muted-foreground">{basis === "written_consent" ? "Attach the stored consent certificate from a lead with this number. No expiry, until revoked." : "Its date: 18 months after a purchase, 3 months after an inquiry."}</span></span>
              </label>)}
            </fieldset>
            {draft.basis === "written_consent" ? <div className="grid gap-2">
              <Button type="button" variant="outline" className="justify-self-start" disabled={!typedDigits} onClick={() => void findCertificates()}>Find consent certificates</Button>
              {certificatesFor && certificatesFor !== typedDigits && <p className="text-xs text-[var(--warning-ink)]">The number changed. Find its certificates again.</p>}
              {certificates && certificates.length === 0 && <p className="text-sm text-[var(--warning-ink)]">No lead with this number has a consent certificate on file, so written consent cannot be recorded for it.</p>}
              {certificates && certificates.length > 0 && <div className="grid gap-1.5" role="radiogroup" aria-label="Consent certificate">
                {certificates.map((option) => <label key={option.id} className={`flex items-start gap-2 text-sm ${option.stored ? "text-[var(--body)]" : "text-muted-foreground"}`}>
                  <input type="radio" name="exemption-certificate" className="mt-1 size-4 accent-primary" disabled={!option.stored} checked={draft.consentArtefactId === option.id} onChange={() => setDraft({ ...draft, consentArtefactId: option.id })} />
                  <span>{PROVIDER[option.provider] ?? option.provider} · {option.leadName ?? "Lead"} · captured {day(option.capturedAt)}
                    <span className="block text-xs">{option.stored ? "Claimed and stored" : `Not usable: ${option.status === "claimed" ? "the copy is not held" : `the certificate is ${option.status}`}`}</span>
                  </span>
                </label>)}
              </div>}
            </div> : <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-[var(--body)]">Relationship</span>
                <select className={field} value={draft.relationshipKind} onChange={(event) => setDraft({ ...draft, relationshipKind: event.target.value as RelationshipKind })}>
                  {(Object.keys(RELATIONSHIP_KIND_LABELS) as RelationshipKind[]).map((kind) => <option key={kind} value={kind}>{RELATIONSHIP_KIND_LABELS[kind]}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-[var(--body)]">Date</span>
                <input type="date" required max={today()} value={draft.relationshipDate} onChange={(event) => setDraft({ ...draft, relationshipDate: event.target.value })} className={field} />
              </label>
              {expiry && <p className={`text-xs sm:col-span-2 ${expiry <= today() ? "text-[var(--error-ink)]" : "text-muted-foreground"}`}>{expiry <= today() ? `Already expired on ${day(expiry)}, so it cannot clear DNC.` : `Clears federal and state DNC until ${day(expiry)}.`}</p>}
            </div>}
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-[var(--body)]">Note</span>
              <input maxLength={500} placeholder="Policy 4471 bought 12 Aug, confirmed by phone" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} className={field} />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !canSave}>{busy ? "Saving…" : "Record exemption"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={revoking !== null} onOpenChange={(next) => { if (!next) setRevoking(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this exemption</DialogTitle>
            <DialogDescription>{revoking ? `${formatPhone(revoking.phoneDigits)} goes back on federal and state DNC at once. The record and its uses are kept.` : ""}</DialogDescription>
          </DialogHeader>
          <form onSubmit={revoke} className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-[var(--body)]">Reason</span>
              <input required maxLength={500} placeholder="Customer withdrew consent by email, 24 Sep" value={reason} onChange={(event) => setReason(event.target.value)} className={field} />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRevoking(null)}>Cancel</Button>
              <Button type="submit" disabled={busy || !reason.trim()}>{busy ? "Revoking…" : "Revoke exemption"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </TableCard>
  );
}
