"use client";

/**
 * Settings › Business identity (LA-8.3, Notion sprint).
 *
 * One record of who the business is, used by every document the platform produces — so the page says
 * which documents are ready and which detail each still needs, in the words the document itself will
 * use to refuse. Owners only (the route enforces it). The tax ID is masked; Reveal shows it once and is
 * recorded.
 *
 * Settings round 8, board A (owner pick 2026-11-12: "merge business and contact & address in the same
 * page, design & logo, and partner and all — one page … an inner scroll of the form rather than an
 * outer scroll"): the four tabs are four sections of one form in one card. A section index on the left
 * marks each done or "1 to add"; the form scrolls inside the card; the documents-ready line above it
 * names the missing detail and links to its field; ONE save bar saves everything, the partner support
 * contact included (it had its own Save). The logo still saves on its own (an upload is the decision)
 * and the tax ID's Remove still asks first. Problems go on the status line under the title, never a card.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { SettingsHistory } from "@/components/app/settings/settings-history";
import { FormBlock, IndexedFormCard, InlineAction, SaveFoot, scrollToSection, Seg, StatusLine, type IndexEntry, type LineTone } from "@/components/app/settings/business/indexed-form";
import { control, Field, SettingsCard, SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { OwnershipCard, PartnerSupportCard, PartnerSupportProvider, usePartnerSupport } from "@/components/app/settings/agency-contact";
import type { SettingsPanelContext } from "@/components/app/settings/panels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionLoading } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import { load as loadResource, readResource } from "@/lib/client/resource-cache";
import { formatDay } from "@/lib/carriers/contracts";
import { BUSINESS_DOCUMENTS, BUSINESS_FIELD_ANCHORS, BUSINESS_FIELD_LABELS, DOCUMENT_REQUIREMENTS, missingFor, type BusinessField } from "@/lib/agencyProfile/requirements";
import { ENTITY_TYPE_LABELS, maskTaxId, normalizeTaxId, npnHint, WORKSPACE_TIMEZONES, type AgencyProfileResponse, type AgencyProfileView, type EntityType, type TaxIdType } from "@/lib/agencyProfile/types";
import type { SettingsAuditEntry } from "@/lib/settingsAudit/constants";
import { revealAnchor } from "@/lib/settings/revealAnchor";
import { LeaveGuard } from "@/components/ui/leave-guard";

type Draft = {
  legalName: string; dba: string; npn: string; entityType: string; taxIdType: TaxIdType; taxId: string;
  addressLine1: string; addressLine2: string; city: string; state: string; postalCode: string;
  phone: string; email: string; website: string; timezone: string;
};

/** Each draft field in the save bar's words. */
const FIELD_WORDS: Record<keyof Draft, string> = {
  legalName: "legal name", dba: "trading name", npn: "NPN", entityType: "entity type", taxIdType: "tax ID type", taxId: "tax ID",
  addressLine1: "street address", addressLine2: "address line 2", city: "city", state: "state", postalCode: "ZIP code",
  phone: "business phone", email: "business email", website: "website", timezone: "business time zone",
};

const US_STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "PR", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];
const OWNERS_ONLY = "Only owners can see and change the business identity.";

/** The form's four sections, in the index's order. Old tab links ("#business-identity/address") land on them. */
const SECTIONS = { business: "identity-business", address: "identity-contact", documents: "identity-documents", support: "identity-partners" } as const;
/** Which section fixes each document requirement. */
const FIELD_SECTION: Record<BusinessField, string> = {
  trading_name: SECTIONS.business, legal_name: SECTIONS.business, npn: SECTIONS.business, tax_id: SECTIONS.business,
  address: SECTIONS.address, phone: SECTIONS.address,
};

/** Time zones in words; the stored value stays the IANA name. */
const ZONE_NAMES: Record<string, string> = {
  "America/New_York": "Eastern (New York)", "America/Chicago": "Central (Chicago)", "America/Denver": "Mountain (Denver)", "America/Phoenix": "Arizona (Phoenix)",
  "America/Los_Angeles": "Pacific (Los Angeles)", "America/Anchorage": "Alaska (Anchorage)", "Pacific/Honolulu": "Hawaii (Honolulu)", "America/Puerto_Rico": "Atlantic (Puerto Rico)",
};

const draftFrom = (p: AgencyProfileView): Draft => ({
  legalName: p.legalName, dba: p.dba ?? "", npn: p.npn ?? "", entityType: p.entityType ?? "", taxIdType: p.taxIdType ?? "ein", taxId: "",
  addressLine1: p.addressLine1 ?? "", addressLine2: p.addressLine2 ?? "", city: p.city ?? "", state: p.state ?? "", postalCode: p.postalCode ?? "",
  phone: p.phone ?? "", email: p.email ?? "", website: p.website ?? "", timezone: p.timezone ?? "",
});

const LAST_KEY = "/api/app/settings-audit/last?section=business-identity";
const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** A field the documents need and the saved record lacks: a warning edge and the line saying which document needs it. */
const NEED = "border-[var(--warning)] shadow-[inset_3px_0_0_var(--warning)]";

export function BusinessIdentitySettings({ team = null, workspace = null }: Partial<SettingsPanelContext> = {}) {
  const [response, setResponse] = useState<AgencyProfileResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [replacingTaxId, setReplacingTaxId] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [last, setLast] = useState<SettingsAuditEntry | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const support = usePartnerSupport();

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/app/agency-profile", { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (cancelled) return;
      if (!res.ok) { setLoadError(res.status === 403 ? OWNERS_ONLY : body?.error ?? "Could not load the business identity."); return; }
      setResponse(body);
      setDraft(draftFrom(body.profile));
    }).catch(() => { if (!cancelled) setLoadError("Could not load the business identity."); });
    // Who saved last, for the status line. Optional: its absence never blocks the page.
    readResource<{ last?: SettingsAuditEntry | null }>(LAST_KEY).then((body) => { if (!cancelled) setLast(body?.last ?? null); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // A link to an old tab ("#business-identity/documents") scrolls to its section; a field's own anchor is
  // found by the settings frame (revealAnchor), now that every field is on the one page.
  const loaded = Boolean(response);
  useEffect(() => {
    if (!loaded) return;
    const follow = () => {
      const anchor = window.location.hash.replace(/^#/, "").split("/")[1] ?? "";
      const id = SECTIONS[anchor as keyof typeof SECTIONS];
      if (id) window.setTimeout(() => scrollToSection(document.getElementById(id)?.closest<HTMLElement>(".overflow-y-auto") ?? null, id), 50);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [loaded]);

  const p = response?.profile;
  const original = p ? draftFrom(p) : null;
  const identityChanges = draft && original ? (Object.keys(draft) as (keyof Draft)[]).filter((key) => draft[key].trim() !== original[key].trim()) : [];
  const changeWords = [...identityChanges.map((key) => FIELD_WORDS[key]), ...support.changes];
  const dirty = changeWords.length > 0;
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => {
    setSaveError(null);
    setDraft((current) => (current ? { ...current, [key]: event.target.value } : current));
  };
  /** A chip's value into the draft, the same way typing does. */
  const pick = (key: keyof Draft, value: string) => set(key)({ target: { value } });
  const adopt = (profile: AgencyProfileView) => {
    setResponse((current) => (current ? { ...current, profile, schemaReady: true } : { profile, schemaReady: true }));
    setDraft(draftFrom(profile));
  };

  async function save() {
    if (!draft || !original) return;
    if (!draft.legalName.trim()) { setSaveError("Enter the legal name."); revealAnchor("identity-legal-name"); return; }
    setSaving(true);
    setSaveError(null);
    const problems: string[] = [];
    try {
      if (identityChanges.length) {
        const body: Record<string, string | null> = draftBody(draft);
        // The tax ID travels only when a new one is typed: re-sending would re-encrypt it and log a change that did not happen.
        if (draft.taxId.trim()) body.taxId = normalizeTaxId(draft.taxId, draft.taxIdType);
        const res = await fetch("/api/app/agency-profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
        const result = await res?.json().catch(() => null);
        if (!res?.ok) problems.push(result?.error ?? "Could not save the business identity.");
        else {
          adopt(result.profile as AgencyProfileView);
          setRevealed(null);
          setReplacingTaxId(false);
        }
      }
      if (support.changes.length) {
        const failed = await support.save();
        if (failed) problems.push(failed);
      }
      if (problems.length) { setSaveError(problems.join(" ")); return; }
      notify.done("Business identity saved");
      loadResource<{ last?: SettingsAuditEntry | null }>(LAST_KEY).then((body) => setLast(body?.last ?? null)).catch(() => undefined);
    } finally {
      setSaving(false);
    }
  }

  async function reveal() {
    setBusy(true);
    try {
      const res = await fetch("/api/app/agency-profile/tax-id", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) { notify.fail(body?.error ?? "The tax ID could not be shown"); return; }
      setRevealed(body.taxId);
    } finally {
      setBusy(false);
    }
  }

  async function clearTaxId() {
    if (!draft) return;
    const sure = await confirmAction({ title: "Remove the tax ID?", description: "Tax summaries and 1099 exports stop until a new one is added.", confirmLabel: "Remove tax ID", cancelLabel: "Keep it" });
    if (!sure) return;
    setBusy(true);
    try {
      // Only the tax ID changes: the saved values go with it, so unsaved edits stay a draft.
      const res = await fetch("/api/app/agency-profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draftBody(original ?? draft), taxId: null }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) { notify.fail(body?.error ?? "The tax ID could not be removed"); return; }
      setResponse((current) => (current ? { ...current, profile: body.profile, schemaReady: true } : current));
      setDraft((current) => (current ? { ...current, taxId: "" } : current));
      setRevealed(null);
      notify.done("Tax ID removed");
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/app/agency-profile/logo", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) { notify.fail(body?.error ?? "The logo could not be saved"); return; }
      // Only the logo changed; keep any unsaved edits in the form.
      setResponse((current) => (current ? { ...current, profile: { ...current.profile, logoUrl: body.profile.logoUrl } } : current));
      notify.done("Logo saved");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeLogo() {
    setBusy(true);
    try {
      const res = await fetch("/api/app/agency-profile/logo", { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) { notify.fail(body?.error ?? "The logo could not be removed"); return; }
      setResponse((current) => (current ? { ...current, profile: { ...current.profile, logoUrl: null } } : current));
      notify.done("Logo removed — documents print your trading name");
    } finally {
      setBusy(false);
    }
  }

  // History opens over the page, filtered to this section (SettingsHistory reads ?history= when it mounts).
  const openHistory = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("history", "business-identity");
    window.history.replaceState(window.history.state, "", url);
    setHistoryOpen(true);
  };
  const closeHistory = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("history");
    window.history.replaceState(window.history.state, "", url);
    setHistoryOpen(false);
  };

  const actions = (
    <>
      <Button type="button" variant="ghost" onClick={openHistory} disabled={!response}>History</Button>
      <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)} disabled={!draft}>Preview a letter</Button>
    </>
  );

  if (loadError) {
    return (
      <SettingsStack className="min-h-0 flex-1 gap-3">
        <SettingsSectionHeader />
        <StatusLine tone={loadError === OWNERS_ONLY ? "neutral" : "danger"}>
          {loadError}{loadError !== OWNERS_ONLY && <> · <InlineAction tone="danger" onClick={() => window.location.reload()}>Reload</InlineAction></>}
        </StatusLine>
      </SettingsStack>
    );
  }
  if (!draft || !p || !response) {
    return (
      <SettingsStack className="min-h-0 flex-1 gap-3">
        <SettingsSectionHeader actions={actions} />
        <StatusLine tone="neutral">Loading the business identity</StatusLine>
        <SettingsCard><SectionLoading rows={6} columns={2} label="Loading the business identity" /></SettingsCard>
      </SettingsStack>
    );
  }

  // The checklist reads the saved record: it is what a document generated now would see.
  const facts = { tradingName: p.dba, legalName: p.legalName, npn: p.npn, addressLine1: p.addressLine1, city: p.city, state: p.state, postalCode: p.postalCode, phone: p.phone, hasTaxId: p.hasTaxId };
  const timezoneOptions = draft.timezone && !(WORKSPACE_TIMEZONES as readonly string[]).includes(draft.timezone) ? [draft.timezone, ...WORKSPACE_TIMEZONES] : [...WORKSPACE_TIMEZONES];
  const tradingName = draft.dba.trim() || p.dba || "";

  const docs = BUSINESS_DOCUMENTS.map((doc) => ({ doc, missing: missingFor(facts, doc), label: capital(DOCUMENT_REQUIREMENTS[doc].label) }));
  const ready = docs.filter((item) => item.missing.length === 0).length;
  const firstGap = docs.find((item) => item.missing.length > 0) ?? null;
  const missingFields = [...new Set(docs.flatMap((item) => item.missing))];
  /** Which documents still need a field: "The welcome pack needs this." */
  const needs = (field: BusinessField) => {
    const by = docs.filter((item) => item.missing.includes(field)).map((item) => DOCUMENT_REQUIREMENTS[item.doc].label);
    return by.length ? `The ${list(by)} ${by.length === 1 ? "needs" : "need"} this.` : null;
  };
  const gapsIn = (section: string) => missingFields.filter((field) => FIELD_SECTION[field] === section).length;
  const mark = (gaps: number) => (gaps ? { tone: "warn" as const, text: `${gaps} to add` } : { tone: "ok" as const, text: "✓" });
  const supportSet = Boolean(support.support?.email || support.support?.phone);
  const index: IndexEntry[] = [
    { id: SECTIONS.business, label: "Business", mark: mark(gapsIn(SECTIONS.business)) },
    { id: SECTIONS.address, label: "Contact & address", mark: mark(gapsIn(SECTIONS.address)) },
    { id: SECTIONS.documents, label: "Documents & logo", mark: p.logoUrl ? { tone: "ok", text: "✓" } : { tone: "muted", text: "No logo" } },
    { id: SECTIONS.support, label: "Partners & owner", mark: supportSet ? { tone: "ok", text: "✓" } : { tone: "muted", text: "Optional" } },
  ];
  const goTo = (field: BusinessField) => revealAnchor(BUSINESS_FIELD_ANCHORS[field]);
  const goToSection = (id: string) => scrollToSection(document.getElementById(id)?.closest<HTMLElement>(".overflow-y-auto") ?? null, id);

  /* ── the status line ── */
  const pending = [
    !response.schemaReady ? "saving the business identity needs a database update" : null,
    support.support && !support.support.schemaReady ? "the partner support contact needs a database update" : null,
    support.loadError,
  ].filter(Boolean) as string[];
  let tone: LineTone = pending.length ? "warning" : "good";
  let lead: ReactNode;
  if (saveError) {
    tone = "danger";
    lead = <>Couldn&apos;t save: {saveError} · <InlineAction tone="danger" onClick={() => void save()}>Retry</InlineAction></>;
  } else if (dirty) {
    tone = "warning";
    lead = `${changeWords.length} unsaved ${changeWords.length === 1 ? "change" : "changes"}`;
  } else {
    lead = last ? `Saved · changed by ${last.actorName ?? "someone no longer on the team"} on ${shortDay(last.occurredAt)}` : p.updatedAt ? `Saved · last saved ${formatDay(p.updatedAt)}` : "Not saved yet";
  }

  const cityLine = [draft.city, [draft.state, draft.postalCode].filter(Boolean).join(" ")].filter((part) => part.trim()).join(", ");
  const discard = () => { if (original) setDraft(original); support.discard(); setSaveError(null); setReplacingTaxId(false); };
  const taxInput = !p.hasTaxId || replacingTaxId;
  const needClass = (field: BusinessField, empty: boolean) => (missingFields.includes(field) && empty ? NEED : undefined);
  const needHint = (field: BusinessField, empty: boolean) => (missingFields.includes(field) && empty ? <span className="text-[var(--warning-ink)]">{needs(field)}</span> : undefined);

  const docLine = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--border)] px-4 py-2.5 text-xs text-[var(--body)]">
      <b className="font-semibold text-[var(--ink)]">Documents ready · {ready} of {docs.length}</b>
      <span aria-hidden="true" className="h-1.5 w-[140px] shrink-0 overflow-hidden rounded-full bg-[var(--surface-alt)] shadow-[inset_0_0_0_1px_var(--border)]">
        <span className="block h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.round((ready / docs.length) * 100)}%` }} />
      </span>
      {firstGap ? (
        <>
          <span>{firstGap.label} needs {firstGap.missing.length === 1 && firstGap.missing[0] !== "npn" ? "a " : "the "}<b className="font-semibold text-[var(--ink)]">{list(firstGap.missing.map((field) => BUSINESS_FIELD_LABELS[field]))}</b></span>
          <InlineAction onClick={() => goTo(firstGap.missing[0])}>Add it ›</InlineAction>
        </>
      ) : <span>Every document can be made.</span>}
      <span className="ml-auto"><InlineAction onClick={() => goToSection(SECTIONS.documents)}>See all documents</InlineAction></span>
    </div>
  );

  return (
    <SettingsStack className="min-h-0 flex-1 gap-3">
      <SettingsSectionHeader actions={actions} />
      <StatusLine tone={tone}>{[lead, ...pending].map((part, at) => <span key={at}>{at > 0 ? " · " : ""}{part}</span>)}</StatusLine>

      <PartnerSupportProvider value={support}>
        <IndexedFormCard
          label="Business identity"
          sections={index}
          foot="Everything here saves together with the bar below."
          top={docLine}
          footer={<SaveFoot count={changeWords.length} what={changeWords.slice(0, 3).join(", ") + (changeWords.length > 3 ? "…" : "")} saving={saving} disabled={Boolean(support.problem) || (identityChanges.length > 0 && !response.schemaReady)} onDiscard={discard} onSave={() => void save()} />}
        >
          <FormBlock id={SECTIONS.business} title="Business" sub="The names and numbers carriers and clients see.">
            <div className="grid min-w-0 gap-x-[18px] gap-y-3 @lg:grid-cols-2">
              <Field label="Trading name" htmlFor="identity-trading-name" hint={needHint("trading_name", !draft.dba.trim()) ?? "Printed on client documents."}>
                <input id="identity-trading-name" type="text" className={cn(control, needClass("trading_name", !draft.dba.trim()))} value={draft.dba} onChange={set("dba")} placeholder="Power Policies" />
              </Field>
              <Field label="Legal name" htmlFor="identity-legal-name" required hint={needHint("legal_name", !draft.legalName.trim()) ?? "Used on tax forms and carrier contracts."}>
                <input id="identity-legal-name" type="text" className={cn(control, needClass("legal_name", !draft.legalName.trim()))} value={draft.legalName} onChange={set("legalName")} autoComplete="organization" required placeholder="Masood Insurance Services LLC" />
              </Field>
              <Field label="Entity type" htmlFor="identity-entity-type">
                <select id="identity-entity-type" className={control} value={draft.entityType} onChange={(event) => pick("entityType", event.target.value as EntityType)}>
                  <option value="">Not set</option>
                  {(Object.keys(ENTITY_TYPE_LABELS) as EntityType[]).map((key) => <option key={key} value={key}>{ENTITY_TYPE_LABELS[key]}</option>)}
                </select>
              </Field>
              <Field label="National producer number (NPN)" htmlFor="identity-npn" hint={needHint("npn", !draft.npn.trim()) ?? npnHint(p, draft.npn, response.niprConfigured === true, formatDay)}>
                <span className="relative block">
                  <input id="identity-npn" type="text" inputMode="numeric" className={cn(control, "font-mono tabular-nums", p.npnVerifiedAt && draft.npn.trim() === (p.npn ?? "") && "pr-40", needClass("npn", !draft.npn.trim()))} value={draft.npn} onChange={set("npn")} />
                  {p.npnVerifiedAt && draft.npn.trim() === (p.npn ?? "") ? <StatusChip tone="good" className="absolute top-1/2 right-2 mt-[3px] -translate-y-1/2">Checked with NIPR</StatusChip> : null}
                </span>
              </Field>
              <div className="min-w-0">
                <span className="text-label text-[var(--body)]">Tax ID</span>
                <div className="mt-1.5">
                  <Seg label="Tax ID type" size="xs" value={draft.taxIdType} onChange={(key) => pick("taxIdType", key)} options={[{ key: "ein", label: "EIN" }, { key: "ssn", label: "Social Security number" }]} />
                </div>
                {taxInput ? (
                  <>
                    <label htmlFor="identity-tax-id" className="sr-only">{p.hasTaxId ? "New tax ID" : "Tax ID"}</label>
                    <input id="identity-tax-id" type="text" inputMode="numeric" autoComplete="off" className={cn(control, "mt-2 block font-mono tabular-nums", needClass("tax_id", !draft.taxId.trim()))} value={draft.taxId} onChange={set("taxId")} placeholder={draft.taxIdType === "ssn" ? "123-45-6789" : "12-3456789"} />
                    <span className="mt-1.5 block text-xs leading-[1.5] text-[var(--muted)]">
                      {needHint("tax_id", !draft.taxId.trim()) ?? (p.hasTaxId ? "Typing a new one replaces the one on file when you save." : "Stored encrypted, shown masked.")}
                      {replacingTaxId ? <> · <InlineAction onClick={() => { setReplacingTaxId(false); setDraft((current) => (current ? { ...current, taxId: "" } : current)); }}>Keep the one on file</InlineAction></> : null}
                    </span>
                  </>
                ) : (
                  <>
                    <div id="identity-tax-id" tabIndex={-1} className={cn(control, "mt-2 flex items-center gap-2 bg-[var(--surface-alt)]")}>
                      <span className="font-mono tabular-nums text-[var(--ink)]">{revealed ?? maskTaxId(p.taxIdType, p.taxIdLast4)}</span>
                      <span className="ml-auto flex items-center gap-1.5 text-xs">
                        {revealed
                          ? <InlineAction onClick={() => setRevealed(null)}>Hide</InlineAction>
                          : p.taxIdReadable && <InlineAction onClick={() => { if (!busy) void reveal(); }}>Reveal</InlineAction>}
                        {(revealed || p.taxIdReadable) && <span aria-hidden="true" className="text-[var(--muted)]">·</span>}
                        <InlineAction onClick={() => setReplacingTaxId(true)}>Replace</InlineAction>
                        <span aria-hidden="true" className="text-[var(--muted)]">·</span>
                        <InlineAction tone="danger" onClick={() => { if (!busy) void clearTaxId(); }}>Remove</InlineAction>
                      </span>
                    </div>
                    <span className="mt-1.5 block text-xs leading-[1.5] text-[var(--muted)]">
                      {p.taxIdReadable ? "Stored encrypted. Reveal shows it once and is recorded." : `One ending ${p.taxIdLast4 ?? "····"} is stored, but this server has no key to show it. Replace it to type a new one.`}
                    </span>
                  </>
                )}
              </div>
              <Field label="Business time zone" htmlFor="identity-timezone" hint="How times show for your team, and when daily summaries arrive. Your own time zone is on My profile. It does not set calling hours: those always follow each customer’s own state.">
                <select id="identity-timezone" className={control} value={draft.timezone} onChange={set("timezone")}>
                  <option value="">Not set</option>
                  {timezoneOptions.map((zone) => <option key={zone} value={zone}>{ZONE_NAMES[zone] ?? zone}</option>)}
                </select>
              </Field>
            </div>
          </FormBlock>

          <FormBlock id={SECTIONS.address} title="Contact & address" sub="Printed on letters, statements and the client portal.">
            <div className="grid min-w-0 gap-y-3">
              <Field label="Street address" htmlFor="identity-address-line1" hint={needHint("address", !draft.addressLine1.trim() || !draft.city.trim() || !draft.state || !draft.postalCode.trim())}>
                <input id="identity-address-line1" type="text" className={cn(control, needClass("address", !draft.addressLine1.trim()))} value={draft.addressLine1} onChange={set("addressLine1")} autoComplete="address-line1" />
              </Field>
              <Field label="Address line 2" htmlFor="identity-address-line2">
                <input id="identity-address-line2" type="text" className={control} value={draft.addressLine2} onChange={set("addressLine2")} autoComplete="address-line2" placeholder="Suite, floor (optional)" />
              </Field>
              <div className="grid min-w-0 gap-x-[18px] gap-y-3 @lg:grid-cols-[2fr_1fr_1fr]">
                <Field label="City" htmlFor="identity-city">
                  <input id="identity-city" type="text" className={cn(control, needClass("address", !draft.city.trim()))} value={draft.city} onChange={set("city")} autoComplete="address-level2" />
                </Field>
                <Field label="State" htmlFor="identity-state">
                  <select id="identity-state" className={cn(control, needClass("address", !draft.state))} value={draft.state} onChange={set("state")}>
                    <option value="">Choose…</option>
                    {US_STATES.map((code) => <option key={code} value={code}>{code}</option>)}
                  </select>
                </Field>
                <Field label="ZIP code" htmlFor="identity-postal-code">
                  <input id="identity-postal-code" type="text" inputMode="numeric" className={cn(control, "tabular-nums", needClass("address", !draft.postalCode.trim()))} value={draft.postalCode} onChange={set("postalCode")} autoComplete="postal-code" />
                </Field>
              </div>
              <div className="grid min-w-0 gap-x-[18px] gap-y-3 @lg:grid-cols-2">
                <Field label="Business phone" htmlFor="identity-phone" hint={needHint("phone", !draft.phone.trim()) ?? "The agency's main line. Your own number is on My profile."}>
                  <input id="identity-phone" type="tel" className={cn(control, needClass("phone", !draft.phone.trim()))} value={draft.phone} onChange={set("phone")} autoComplete="tel" placeholder="(312) 555-0100" />
                </Field>
                <Field label="Business email" htmlFor="identity-email" hint="An address clients can reply to. Printed on letters when set.">
                  <input id="identity-email" type="email" className={control} value={draft.email} onChange={set("email")} autoComplete="email" placeholder="hello@youragency.com" />
                </Field>
                <Field label="Website" htmlFor="identity-website" className="@lg:col-span-2">
                  <input id="identity-website" type="url" className={control} value={draft.website} onChange={set("website")} placeholder="https://" />
                </Field>
              </div>
            </div>
          </FormBlock>

          <FormBlock id={SECTIONS.documents} title="Documents & logo" sub="Every letter and statement checks these details before it is made.">
            <div id="identity-logo" className="flex scroll-mt-24 flex-wrap items-center gap-4">
              <span className="flex h-16 min-w-16 max-w-56 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-dashed border-[var(--border-strong)] bg-[var(--surface-alt)] px-3 text-[var(--ink)]">
                {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL from private storage */}
                {p.logoUrl ? <img src={p.logoUrl} alt="Business logo" className="max-h-12 max-w-full object-contain" />
                  : <span className="text-base font-semibold">{tradingName || "Your trading name"}</span>}
              </span>
              <div className="min-w-0">
                <b className="block text-sm font-semibold text-[var(--ink)]">{p.logoUrl ? "Your logo" : "No logo yet"}</b>
                <span className="block text-xs text-[var(--muted)]">{p.logoUrl ? "Printed at the head of every letter and statement." : "Documents print your trading name as text."}</span>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" aria-label="Choose a logo" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }} />
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={busy || !p.updatedAt} onClick={() => fileRef.current?.click()}>{p.logoUrl ? "Replace" : "Upload logo"}</Button>
                  {p.logoUrl && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void removeLogo()}>Remove</Button>}
                </div>
              </div>
              <span className="ml-auto max-w-[240px] text-xs text-[var(--muted)]">
                {p.updatedAt ? "PNG or JPEG, up to 512 KB. It saves as soon as you choose it." : "Save the business identity first, then add a logo."}
              </span>
            </div>
            <ul className="m-0 mt-3.5 flex list-none flex-col p-0">
              {docs.map(({ doc, missing, label }) => (
                <li key={doc} className="flex items-center gap-3 border-b border-[var(--border)] py-2.5 text-sm text-[var(--body)] last:border-b-0">
                  <span className="shrink-0 font-medium text-[var(--ink)]">{label}</span>
                  <span className="min-w-0 truncate text-xs text-[var(--muted)]">{DOCUMENT_REQUIREMENTS[doc].fields.map((field) => BUSINESS_FIELD_LABELS[field]).join(", ")}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    {missing.length ? (
                      <>
                        <InlineAction onClick={() => goTo(missing[0])}>Add {BUSINESS_FIELD_LABELS[missing[0]]} ›</InlineAction>
                        <StatusChip tone="warning">Needs {missing.length} {missing.length === 1 ? "detail" : "details"}</StatusChip>
                      </>
                    ) : <StatusChip tone="good">Ready</StatusChip>}
                  </span>
                </li>
              ))}
            </ul>
          </FormBlock>

          <FormBlock id={SECTIONS.support} title="Partners & owner" sub="How partners reach you about payouts and leads. Saved with everything else.">
            <PartnerSupportCard />
            <OwnershipCard team={team} workspace={workspace} />
          </FormBlock>
        </IndexedFormCard>
      </PartnerSupportProvider>

      {/* How a letter prints with what is on screen now (owner, 2026-10-27: keep the letterhead from B). */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>How a letter prints</DialogTitle>
            <DialogDescription>A letter&apos;s head and foot, from what is on screen now. It changes as you type.</DialogDescription>
          </DialogHeader>
          <div className="rounded-[8px] bg-white p-5 text-[rgb(16,32,27)] shadow-[0_10px_30px_rgba(0,0,0,.25)]">
            <div className="flex items-start justify-between gap-4 border-b-2 border-[rgb(11,94,72)] pb-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- the same signed logo URL as above */}
              {p.logoUrl ? <img src={p.logoUrl} alt="" className="max-h-9 max-w-40 object-contain" />
                : <strong className="text-base font-extrabold tracking-[-0.01em] text-[rgb(11,94,72)]">{(tradingName || "Your trading name").toUpperCase()}</strong>}
              <span className="text-right text-xs leading-[1.5] text-[rgb(68,86,79)]">
                {draft.addressLine1 || "Your address"}{draft.addressLine2 ? <><br />{draft.addressLine2}</> : null}
                <br />{cityLine || "City, ST ZIP"}
                <br />{draft.phone || "Business phone"}
                {draft.email ? <><br />{draft.email}</> : null}
              </span>
            </div>
            <p className="m-0 mt-4 text-sm">Dear client,</p>
            <p className="m-0 mt-1.5 text-xs leading-[1.6] text-[rgb(68,86,79)]">Thank you for choosing us. This letter confirms your policy and how to reach your agent.</p>
            <p className="m-0 mt-5 text-xs leading-[1.6] text-[rgb(68,86,79)]">
              {draft.legalName || "Legal name"}{draft.npn ? ` · NPN ${draft.npn}` : ""}{draft.website ? ` · ${draft.website}` : ""}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {historyOpen && (
        <Sheet title="Business identity history" subtitle="Every change to this page, newest first" onClose={closeHistory} className="lg:w-[880px]" bodyClassName="flex min-h-0 flex-1 flex-col p-4">
          <SettingsHistory />
        </Sheet>
      )}

      <LeaveGuard dirty={dirty} onDiscard={discard} what="the business identity" />
    </SettingsStack>
  );
}

/** The saved values as a PUT body. */
function draftBody(d: Draft): Record<string, string | null> {
  return {
    legalName: d.legalName, dba: d.dba || null, npn: d.npn || null, entityType: d.entityType || null, taxIdType: d.taxIdType,
    addressLine1: d.addressLine1 || null, addressLine2: d.addressLine2 || null, city: d.city || null, state: d.state || null, postalCode: d.postalCode || null,
    phone: d.phone || null, email: d.email || null, website: d.website || null, timezone: d.timezone || null,
  };
}
