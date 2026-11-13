"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Field, control } from "@/components/app/settings/primitives";
import { saveProduct } from "@/components/app/settings/carrier-card";
import { Avatar, SheetSection, TechnicalDetails } from "@/components/app/settings/team/parts";
import { bpToLevel, levelToBp, todayIso } from "@/lib/appointments/tickModel";
import type { TenantCarrierRow } from "@/lib/carriers/service";
import { dayMonth, dayMonthYear } from "@/lib/format/dates";
import { notify } from "@/lib/notify";
import { PORTAL_MFA_LABEL, PORTAL_MFA_TYPES } from "@/lib/salesSettings/portalSchemas";
import type { ProductLine, SalesCarrierView } from "@/lib/salesSettings/views";
import { cn } from "@/lib/utils";

import { listOut, sendJson, writersFor, type FileSummary, type RateFacts, type Writer } from "./model";

type Mfa = (typeof PORTAL_MFA_TYPES)[number];
export type CarrierHealth = { tone: StatusTone; label: string };

const firstLetter = (name: string) => name.trim()[0]?.toUpperCase() ?? "?";

/**
 * Board screen 8 · everything about one carrier in one scroll: Contract, Products you sell, Appointed
 * states and writers (writing numbers behind technical details), the carrier site the extension fills,
 * and the Commission file. One Save for the contract, the products and the portal; End contract
 * switches the carrier off (its history and money stay).
 */
export function CarrierSheet({ carrier, contract, health, switchedOff, states, pendingStates, sales, salesAvailable, productLines, canEdit, writers, lastFile, filesKnown, rates, onOpenStates, onOpenMap, onSaved, onClose, onError }: {
  carrier: { id: string; name: string };
  contract: TenantCarrierRow | null;
  health: CarrierHealth;
  switchedOff: boolean;
  states: string[];
  pendingStates: string[];
  sales: SalesCarrierView | null;
  salesAvailable: boolean;
  productLines: ProductLine[];
  canEdit: boolean;
  /** Null when the team could not be read (a producer looking). */
  writers: Writer[] | null;
  lastFile: FileSummary | null;
  /** False when Carrier files is not on the plan or not readable: the section points there instead. */
  filesKnown: boolean;
  rates: RateFacts | null;
  onOpenStates: () => void;
  onOpenMap: (() => void) | null;
  onSaved: () => Promise<void>;
  onClose: () => void;
  onError: (text: string | null, retry?: () => void) => void;
}) {
  const startLevel = contract ? String(bpToLevel(contract.contract_level_bp)) : "";
  const startFrom = contract?.effective_from ?? todayIso();
  const startWriting = contract?.writing_number ?? "";
  const [level, setLevel] = useState(startLevel);
  const [from, setFrom] = useState(startFrom);
  const [writing, setWriting] = useState(startWriting);
  const products = sales?.products ?? [];
  const lineSold = (code: string) => productLines.find((line) => line.code === code)?.sold !== false;
  const offered = products.filter((product) => product.isActive || lineSold(product.productCode));
  const [sold, setSold] = useState<Set<string>>(new Set(products.filter((product) => product.isActive).map((product) => product.id)));
  const portal = sales?.portal ?? null;
  const [portalUrl, setPortalUrl] = useState(portal?.portalUrl ?? "");
  const [username, setUsername] = useState(portal?.username ?? "");
  const [mfa, setMfa] = useState<Mfa>((portal?.mfaType as Mfa | undefined) ?? "none");
  const [verified, setVerified] = useState(portal?.lastVerifiedAt?.slice(0, 10) ?? "");
  const [saving, setSaving] = useState(false);

  const levelBad = level.trim() !== "" && levelToBp(level) === null;
  const contractChanged = level.trim() !== "" && !levelBad && (level !== startLevel || from !== startFrom || writing.trim() !== startWriting);
  const productChanges = products.filter((product) => product.isActive !== sold.has(product.id));
  const portalChanged = portalUrl.trim() !== "" && (portalUrl.trim() !== (portal?.portalUrl ?? "") || username.trim() !== (portal?.username ?? "") || mfa !== (portal?.mfaType ?? "none") || verified !== (portal?.lastVerifiedAt?.slice(0, 10) ?? ""));
  const changes = Number(contractChanged) + productChanges.length + Number(portalChanged);

  function discard() {
    setLevel(startLevel); setFrom(startFrom); setWriting(startWriting);
    setSold(new Set(products.filter((product) => product.isActive).map((product) => product.id)));
    setPortalUrl(portal?.portalUrl ?? ""); setUsername(portal?.username ?? ""); setMfa((portal?.mfaType as Mfa | undefined) ?? "none"); setVerified(portal?.lastVerifiedAt?.slice(0, 10) ?? "");
  }

  async function save() {
    setSaving(true);
    onError(null);
    const failures: string[] = [];
    if (contractChanged) {
      const bp = levelToBp(level);
      const result = await sendJson("/api/app/carrier-library/tenant-carriers", "POST", { carrier_id: carrier.id, contract_level_bp: bp, writing_number: writing.trim(), effective_from: from });
      if (!result.ok) failures.push(result.error);
    }
    for (const product of productChanges) {
      if (!(await saveProduct(product, { isActive: sold.has(product.id) }))) failures.push(`${product.name} did not save.`);
    }
    if (portalChanged) {
      const result = await sendJson("/api/app/settings/sales/portals", "PUT", { carrier_id: carrier.id, portal_url: portalUrl.trim(), username: username.trim() || null, writing_number: portal?.writingNumber ?? null, mfa_type: mfa, notes: portal?.notes ?? null, last_verified_on: verified || null });
      if (!result.ok) failures.push(result.error);
    }
    setSaving(false);
    await onSaved();
    if (failures.length) { onError(`Couldn't save ${carrier.name}. Your changes are kept. ${failures.join(" ")}`, () => void save()); return; }
    notify.done(`${carrier.name} saved`);
    onClose();
  }

  async function setContracted(on: boolean) {
    if (!on) {
      const ok = await confirmAction({
        title: `End your contract with ${carrier.name}?`,
        description: "No new quotes, applications or leads for it. Open cases stay open, and its policies and commission history stay. You can sell it again later.",
        confirmLabel: "End contract",
        cancelLabel: "Keep it",
      });
      if (!ok) return;
    }
    const result = await sendJson("/api/app/carrier-library/tenant-carriers", "PATCH", { carrier_id: carrier.id, contracted: on });
    if (!result.ok) { onError(result.error); return; }
    notify.done(on ? `${carrier.name} is on again` : `${carrier.name} is switched off: no new quotes, applications or leads`);
    await onSaved();
    if (!on) onClose();
  }

  const shownWriters = writers ? writersFor(writers, states) : null;
  const subtitle = [
    contract ? `Contracted ${dayMonthYear(`${contract.effective_from}T12:00:00Z`, "UTC")}` : "No contract details yet",
    states.length ? `appointed in ${states.length} ${states.length === 1 ? "state" : "states"}` : "no states yet",
  ].join(" · ");

  return (
    <Sheet
      title={<span className="flex min-w-0 items-center gap-2.5"><span aria-hidden="true" className="inline-grid size-8 shrink-0 place-items-center rounded-[9px] bg-[var(--primary-soft)] text-sm font-bold text-[var(--accent-ink)]">{firstLetter(carrier.name)}</span><span className="truncate">{carrier.name}</span></span>}
      subtitle={subtitle}
      status={<StatusChip tone={health.tone}>{health.label}</StatusChip>}
      onClose={onClose}
      className="lg:w-[640px]"
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (switchedOff
            ? <Button type="button" variant="outline" className="mr-auto" onClick={() => void setContracted(true)}>Sell this carrier again</Button>
            : <Button type="button" variant="outline" className="mr-auto text-[var(--error-ink)]" onClick={() => void setContracted(false)}>End contract…</Button>)}
          <Button type="button" variant="ghost" className={canEdit ? undefined : "ml-auto"} onClick={() => { discard(); onClose(); }} disabled={saving}>Cancel</Button>
          {canEdit && <Button type="button" onClick={() => void save()} disabled={saving || changes === 0 || levelBad}>{saving ? "Saving…" : "Save carrier"}</Button>}
        </div>
      }
    >
      <LeaveGuard dirty={changes > 0} onDiscard={discard} what={`${carrier.name}'s changes`} />

      <SheetSection title="Contract" help={`What ${carrier.name} pays your agency. Producer splits live in Commissions.`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First-year commission" htmlFor="carrier-level" error={levelBad ? "Write it as a number, like 110." : undefined} hint={!contract ? "Optional. It sells without this; commission figures need it." : undefined}>
            <span className="relative block">
              <input id="carrier-level" className={cn(control, "pr-8")} inputMode="decimal" disabled={!canEdit} value={level} placeholder="110" onChange={(event) => setLevel(event.target.value)} />
              <span className="pointer-events-none absolute top-1/2 right-3 mt-[3px] -translate-y-1/2 text-sm text-[var(--muted)]">%</span>
            </span>
          </Field>
          <Field label="Contracted from" htmlFor="carrier-from">
            <input id="carrier-from" type="date" className={control} disabled={!canEdit} value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
        </div>
        <p className="m-0 text-xs text-[var(--muted)]">
          {rates && (rates.renewalPct !== null || rates.advanceMonths !== null || rates.chargebackMonths !== null)
            ? [rates.renewalPct !== null ? `Renewal ${rates.renewalPct}%` : null, rates.advanceMonths !== null ? `advance ${rates.advanceMonths} months` : null, rates.chargebackMonths !== null ? `chargeback window ${rates.chargebackMonths} months` : null].filter(Boolean).join(" · ")
            : "Renewal, advance and chargeback window are not set."}
          {" "}<Link href="/app/book-setup" className="font-semibold text-[var(--accent-ink)] hover:underline">Change in Rate card</Link>
        </p>
      </SheetSection>

      {salesAvailable && (
        <SheetSection title="Products you sell" help={sales ? "Only the products you tick show when you quote." : "Products appear once the carrier is on your list."}>
          {offered.length === 0 ? <p className="m-0 text-sm text-[var(--muted)]">No products in the library for {carrier.name} yet.</p> : (
            <div className="flex flex-wrap gap-2">
              {offered.map((product) => (
                <ToggleChip key={product.id} selected={sold.has(product.id)} disabled={!canEdit} onClick={() => setSold((current) => { const next = new Set(current); if (next.has(product.id)) next.delete(product.id); else next.add(product.id); return next; })}>
                  {product.name}
                </ToggleChip>
              ))}
            </div>
          )}
        </SheetSection>
      )}

      <SheetSection title="Appointed states and writers" help={`Who may write ${carrier.name}, and where.`}>
        <p className="m-0 text-sm text-[var(--body)]">
          {states.length ? <>Appointed in {listOut(states, 12)}</> : <span className="text-[var(--muted)]">Not appointed in any state yet</span>}
          {pendingStates.length > 0 && <span className="text-[var(--muted)]"> · pending in {listOut(pendingStates, 8)}</span>}
        </p>
        {shownWriters && shownWriters.length > 0 && (
          <ul aria-label="Writers" className="m-0 flex list-none flex-col overflow-hidden rounded-[12px] border border-[var(--border)] p-0">
            <li aria-hidden="true" className="m-glass-head flex items-center gap-3 px-3 py-2 text-xs text-[var(--muted)]"><span className="flex-1">Writer</span><span className="w-[55%]">Licensed and appointed in</span></li>
            {shownWriters.map((writer) => (
              <li key={writer.id} className="flex min-h-[44px] items-center gap-3 border-t border-[var(--border)] px-3 py-2 text-sm text-[var(--body)]">
                <span className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap"><Avatar name={writer.name} size="sm" /><span className="truncate">{writer.name}</span></span>
                <span className="w-[55%] truncate whitespace-nowrap">{writer.states.length === 0 ? "Any agency state" : listOut(writer.here, 6)}</span>
              </li>
            ))}
          </ul>
        )}
        {shownWriters && shownWriters.length === 0 && states.length > 0 && <p className="m-0 text-xs text-[var(--muted)]">No writer is licensed where {carrier.name} is appointed.</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onOpenStates}>Change states</Button>
          <Link href="/app/settings#team-access" className="text-xs font-semibold text-[var(--accent-ink)] hover:underline">Add a writer in Team &amp; access</Link>
        </div>
        <TechnicalDetails label="Show technical details · writing number" rows={contract?.writing_number || portal?.writingNumber ? [{ label: "Agency writing number", value: (contract?.writing_number || portal?.writingNumber) ?? "" }] : []} />
        {canEdit && (
          <details className="text-xs">
            <summary className="cursor-pointer font-semibold text-[var(--accent-ink)]">{contract?.writing_number ? "Change the writing number" : "Add the agency's writing number"}</summary>
            <input aria-label="Agency writing number" className={cn(control, "max-w-xs")} value={writing} autoComplete="off" spellCheck={false} placeholder="e.g. TA-20914" onChange={(event) => setWriting(event.target.value)} />
            {level.trim() === "" && <span className="mt-1 block text-[var(--muted)]">Saved with the first-year commission.</span>}
          </details>
        )}
      </SheetSection>

      {salesAvailable && (
        <SheetSection title="Carrier site" help="Where your agents sign in and where the browser extension fills applications. Passwords are never stored.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Portal address" htmlFor="portal-url" className="sm:col-span-2">
              <input id="portal-url" className={control} disabled={!canEdit} value={portalUrl} placeholder="https://agents.carrier.com/login" onChange={(event) => setPortalUrl(event.target.value)} />
            </Field>
            <Field label="Agency username" htmlFor="portal-user">
              <input id="portal-user" className={control} disabled={!canEdit} value={username} autoComplete="off" onChange={(event) => setUsername(event.target.value)} />
            </Field>
            <Field label="Second sign-in step" htmlFor="portal-mfa">
              <select id="portal-mfa" className={control} disabled={!canEdit} value={mfa} onChange={(event) => setMfa(event.target.value as Mfa)}>
                {PORTAL_MFA_TYPES.map((type) => <option key={type} value={type}>{PORTAL_MFA_LABEL[type]}</option>)}
              </select>
            </Field>
            <Field label="Last checked it works" htmlFor="portal-checked">
              <input id="portal-checked" type="date" className={control} disabled={!canEdit} value={verified} onChange={(event) => setVerified(event.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-[var(--muted)]">
              Extension map: {sales?.fieldMap.status === "published" ? "ready" : sales?.fieldMap.status === "needs_review" ? "needs a check" : sales?.fieldMap.status === "draft" ? "draft" : "none yet"}
            </span>
            {onOpenMap && <Button type="button" variant="outline" size="sm" onClick={onOpenMap}>Open the field map</Button>}
          </div>
        </SheetSection>
      )}

      <SheetSection
        title="Commission file"
        help={!filesKnown ? `How we read ${carrier.name}'s statements is set up in Carrier sync.` : lastFile ? `Last file ${dayMonth(`${lastFile.date}T12:00:00Z`, "UTC")}${lastFile.rows !== null ? `, ${lastFile.rows} ${lastFile.rows === 1 ? "row" : "rows"}` : ""}.` : `No commission file from ${carrier.name} yet.`}
      >
        {filesKnown && lastFile?.needsMatching && (
          <p className="m-0 text-sm text-[var(--warning-ink)]">
            {lastFile.held > 0 ? `${lastFile.held} rows are held until their columns are matched.` : "Its columns aren't matched yet. Match them once and every file reads cleanly."}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild type="button" variant="outline" size="sm"><Link href="/app/book-setup/how-files-arrive">{lastFile?.needsMatching ? "Match the columns" : "Open the full map"}</Link></Button>
          <Button asChild type="button" variant="ghost" size="sm"><Link href="/app/carrier-files">See its files</Link></Button>
        </div>
      </SheetSection>
    </Sheet>
  );
}
