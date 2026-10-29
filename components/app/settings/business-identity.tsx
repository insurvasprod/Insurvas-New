"use client";

/**
 * Settings › Business identity (LA-8.3, Notion sprint).
 *
 * One record of who the business is, used by every document the platform produces — so the page ends
 * with those documents and what each still needs, in the words the document itself will use to refuse.
 * Owners only (the route enforces it). The tax ID is masked; Reveal shows it once and is recorded.
 *
 * Settings redesign R5 (2026-10-29): four tabs instead of six, named for the job and without the
 * field counts nobody could read (Business · Contact & address · Documents & logo · Partners & owner);
 * two-column form sections; the time zone is a dropdown; the kit's chips; removing the tax ID asks first.
 */

import { useEffect, useRef, useState } from "react";

import { Callout, control, DraftActions, Field, SettingsCard, SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { FieldRow, FormSection, FormSections } from "@/components/app/settings/patterns";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { OwnershipCard, PartnerSupportCard } from "@/components/app/settings/agency-contact";
import type { SettingsPanelContext } from "@/components/app/settings/panels";
import { Button } from "@/components/ui/button";
import { SectionLoading } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { StatusChip } from "@/components/ui/status-chip";
import { ViewTabs, type ViewTab } from "@/components/ui/view-tabs";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import { formatDay } from "@/lib/carriers/contracts";
import { BUSINESS_DOCUMENTS, BUSINESS_FIELD_LABELS, DOCUMENT_REQUIREMENTS, missingFor } from "@/lib/agencyProfile/requirements";
import { ENTITY_TYPE_LABELS, maskTaxId, normalizeTaxId, npnHint, WORKSPACE_TIMEZONES, type AgencyProfileResponse, type AgencyProfileView, type EntityType, type TaxIdType } from "@/lib/agencyProfile/types";
import { LeaveGuard } from "@/components/ui/leave-guard";

type Draft = {
  legalName: string; dba: string; npn: string; entityType: string; taxIdType: TaxIdType; taxId: string;
  addressLine1: string; addressLine2: string; city: string; state: string; postalCode: string;
  phone: string; email: string; website: string; timezone: string;
};

const US_STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "PR", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];
const OWNERS_ONLY = "Only owners can see and change the business identity.";

/** The page's views, one at a time (owner pick A, 2026-10-27). */
type IdentityTab = "business" | "address" | "documents" | "support";
/**
 * Settings search links to one field ("#business-identity/identity-timezone"). Each field now lives on
 * a tab, so the link opens that tab first and revealAnchor then finds the field.
 */
const ANCHOR_TABS: Record<string, IdentityTab> = {
  "identity-trading-name": "business", "identity-legal-name": "business", "identity-npn": "business",
  "identity-tax-id": "business", "identity-timezone": "business", "identity-address-line1": "address", "identity-phone": "address",
  "identity-logo": "documents", "identity-partner-support": "support", "identity-ownership": "support",
};
function tabForHash(hash: string, fallback: IdentityTab = "business"): IdentityTab {
  const anchor = hash.replace(/^#/, "").split("/")[1] ?? "";
  return ANCHOR_TABS[anchor] ?? fallback;
}
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

export function BusinessIdentitySettings({ team = null, workspace = null }: Partial<SettingsPanelContext> = {}) {
  const [response, setResponse] = useState<AgencyProfileResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<IdentityTab>(() => tabForHash(typeof window === "undefined" ? "" : window.location.hash));
  useEffect(() => {
    const follow = () => setTab((current) => tabForHash(window.location.hash, current));
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/app/agency-profile", { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (cancelled) return;
      if (!res.ok) { setLoadError(res.status === 403 ? OWNERS_ONLY : body?.error ?? "Could not load the business identity."); return; }
      setResponse(body);
      setDraft(draftFrom(body.profile));
    }).catch(() => { if (!cancelled) setLoadError("Could not load the business identity."); });
    return () => { cancelled = true; };
  }, []);

  const p = response?.profile;
  const original = p ? draftFrom(p) : null;
  const dirty = Boolean(draft && original && (Object.keys(draft) as (keyof Draft)[]).some((key) => draft[key].trim() !== original[key].trim()));
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
    if (!draft.legalName.trim()) { setSaveError("Enter the legal name."); return; }
    setSaving(true);
    setSaveError(null);
    const body: Record<string, string | null> = {
      legalName: draft.legalName, dba: draft.dba || null, npn: draft.npn || null, entityType: draft.entityType || null, taxIdType: draft.taxIdType,
      addressLine1: draft.addressLine1 || null, addressLine2: draft.addressLine2 || null, city: draft.city || null, state: draft.state || null, postalCode: draft.postalCode || null,
      phone: draft.phone || null, email: draft.email || null, website: draft.website || null, timezone: draft.timezone || null,
    };
    // The tax ID travels only when a new one is typed: re-sending would re-encrypt it and log a change that did not happen.
    if (draft.taxId.trim()) body.taxId = normalizeTaxId(draft.taxId, draft.taxIdType);
    try {
      const res = await fetch("/api/app/agency-profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await res.json().catch(() => null);
      if (!res.ok) { setSaveError(result?.error ?? "Could not save the business identity."); return; }
      adopt(result.profile as AgencyProfileView);
      setRevealed(null);
      notify.done("Business identity saved");
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
      const res = await fetch("/api/app/agency-profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draftBody(original ?? draft), taxId: null }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) { notify.fail(body?.error ?? "The tax ID could not be removed"); return; }
      adopt(body.profile);
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

  if (loadError) return <SettingsStack><SettingsSectionHeader /><Callout tone={loadError === OWNERS_ONLY ? "info" : "error"} title={loadError} /></SettingsStack>;
  if (!draft || !p || !response) return <SettingsStack><SettingsSectionHeader /><SettingsCard><SectionLoading rows={6} columns={2} label="Loading the business identity" /></SettingsCard></SettingsStack>;

  // The checklist reads the saved record: it is what a document generated now would see.
  const facts = { tradingName: p.dba, legalName: p.legalName, npn: p.npn, addressLine1: p.addressLine1, city: p.city, state: p.state, postalCode: p.postalCode, phone: p.phone, hasTaxId: p.hasTaxId };
  const timezoneOptions = draft.timezone && !(WORKSPACE_TIMEZONES as readonly string[]).includes(draft.timezone) ? [draft.timezone, ...WORKSPACE_TIMEZONES] : [...WORKSPACE_TIMEZONES];
  const tradingName = draft.dba.trim() || p.dba || "";

  const docs = BUSINESS_DOCUMENTS.map((doc) => ({ doc, missing: missingFor(facts, doc), label: DOCUMENT_REQUIREMENTS[doc].label }));
  const ready = docs.filter((item) => item.missing.length === 0).length;
  const notReady = docs.length - ready;
  // Named for the job; a number only where something needs you (documents that cannot be made yet).
  const tabs: Array<ViewTab<IdentityTab>> = [
    { key: "business", label: "Business" },
    { key: "address", label: "Contact & address" },
    { key: "documents", label: "Documents & logo", count: notReady || null },
    { key: "support", label: "Partners & owner" },
  ];
  const cityLine = [draft.city, [draft.state, draft.postalCode].filter(Boolean).join(" ")].filter((part) => part.trim()).join(", ");
  const discard = () => { if (original) setDraft(original); setSaveError(null); };

  return (
    <SettingsStack>
      <SettingsSectionHeader />
      {!response.schemaReady && <Callout tone="warning" title="Saving the business identity needs a database update." />}

      <ViewTabs label="Business identity" tabs={tabs} value={tab} onChange={setTab} idPrefix="identity-tab" controls="identity-panel" />

      <div id="identity-panel" role="tabpanel" aria-labelledby={`identity-tab-${tab}`} className="flex flex-col gap-6">
        {tab === "business" && (
          <FormSections>
            <FormSection title="Names and licence" info="Clients see the trading name on the welcome pack, statements and letters. Tax forms and regulators use the legal name.">
              <FieldRow>
                <Field label="Trading name" htmlFor="identity-trading-name">
                  <input id="identity-trading-name" type="text" className={control} value={draft.dba} onChange={set("dba")} placeholder="Power Policies" />
                </Field>
                <Field label="Legal name" htmlFor="identity-legal-name" required>
                  <input id="identity-legal-name" type="text" className={control} value={draft.legalName} onChange={set("legalName")} autoComplete="organization" required placeholder="Masood Insurance Services LLC" />
                </Field>
              </FieldRow>
              <div className="flex flex-col gap-1.5">
                <span className="text-label text-[var(--body)]">Entity Type</span>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Entity type">
                  {(Object.keys(ENTITY_TYPE_LABELS) as EntityType[]).map((key) => (
                    <ToggleChip key={key} role="radio" selected={draft.entityType === key} onClick={() => pick("entityType", draft.entityType === key ? "" : key)}>{ENTITY_TYPE_LABELS[key]}</ToggleChip>
                  ))}
                </div>
              </div>
              <FieldRow>
                <Field label="National producer number (NPN)" htmlFor="identity-npn" hint={npnHint(p, draft.npn, response.niprConfigured === true, formatDay)}>
                  <input id="identity-npn" type="text" inputMode="numeric" className={cn(control, "font-mono tabular-nums")} value={draft.npn} onChange={set("npn")} />
                </Field>
              </FieldRow>
            </FormSection>

            <FormSection title="Tax ID" info="Stored encrypted and shown masked; each reveal is recorded. A sole proprietor without an EIN uses their Social Security number." aside={p.hasTaxId ? <StatusChip tone="good">On file</StatusChip> : <StatusChip tone="warning">Not added</StatusChip>}>
              <div className="flex flex-col gap-1.5">
                <span className="text-label text-[var(--body)]">Type</span>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tax ID type">
                  <ToggleChip role="radio" selected={draft.taxIdType === "ein"} onClick={() => pick("taxIdType", "ein")}>EIN</ToggleChip>
                  <ToggleChip role="radio" selected={draft.taxIdType === "ssn"} onClick={() => pick("taxIdType", "ssn")}>Social Security number</ToggleChip>
                </div>
              </div>
              {p.hasTaxId && (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-[var(--body)]">On file: <span className="font-mono font-semibold tabular-nums text-[var(--ink)]">{revealed ?? maskTaxId(p.taxIdType, p.taxIdLast4)}</span></span>
                  {revealed
                    ? <Button type="button" variant="outline" size="sm" onClick={() => setRevealed(null)}>Hide</Button>
                    : p.taxIdReadable && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void reveal()}>Reveal</Button>}
                  <Button type="button" variant="ghost" size="sm" disabled={busy} className="text-[var(--error-ink)]" onClick={() => void clearTaxId()}>Remove</Button>
                </div>
              )}
              <Field
                label={p.hasTaxId ? "Replace the tax ID" : "Tax ID"}
                htmlFor="identity-tax-id"
                hint={p.hasTaxId && !p.taxIdReadable ? `One ending ${p.taxIdLast4 ?? "····"} is stored, but this server has no key to show it. Typing a new one replaces it.` : undefined}
              >
                <input id="identity-tax-id" type="text" inputMode="numeric" autoComplete="off" className={cn(control, "block max-w-[260px] font-mono tabular-nums")} value={draft.taxId} onChange={set("taxId")} placeholder={draft.taxIdType === "ssn" ? "123-45-6789" : "12-3456789"} />
              </Field>
            </FormSection>

            <FormSection title="Time zone" info="How times show for your team, and when daily summaries arrive. It does not set calling hours: those always follow each customer’s own state.">
              <Field label="Business time zone" htmlFor="identity-timezone">
                <select id="identity-timezone" className={cn(control, "block max-w-sm")} value={draft.timezone} onChange={set("timezone")}>
                  <option value="">Not set</option>
                  {timezoneOptions.map((zone) => <option key={zone} value={zone}>{ZONE_NAMES[zone] ?? zone}</option>)}
                </select>
              </Field>
            </FormSection>
          </FormSections>
        )}

        {tab === "address" && (
          <FormSections>
            <FormSection title="Address" info="Your agency’s own address, as clients and carriers see it. Letters and statements print it.">
              <FieldRow>
                <Field label="Address" htmlFor="identity-address-line1">
                  <input id="identity-address-line1" type="text" className={control} value={draft.addressLine1} onChange={set("addressLine1")} autoComplete="address-line1" />
                </Field>
                <Field label="Address line 2" htmlFor="identity-address-line2">
                  <input id="identity-address-line2" type="text" className={control} value={draft.addressLine2} onChange={set("addressLine2")} autoComplete="address-line2" placeholder="Suite, floor (optional)" />
                </Field>
              </FieldRow>
              <FieldRow cols={3}>
                <Field label="City" htmlFor="identity-city">
                  <input id="identity-city" type="text" className={control} value={draft.city} onChange={set("city")} autoComplete="address-level2" />
                </Field>
                <Field label="State" htmlFor="identity-state">
                  <select id="identity-state" className={control} value={draft.state} onChange={set("state")}>
                    <option value="">Choose…</option>
                    {US_STATES.map((code) => <option key={code} value={code}>{code}</option>)}
                  </select>
                </Field>
                <Field label="ZIP code" htmlFor="identity-postal-code">
                  <input id="identity-postal-code" type="text" inputMode="numeric" className={cn(control, "tabular-nums")} value={draft.postalCode} onChange={set("postalCode")} autoComplete="postal-code" />
                </Field>
              </FieldRow>
            </FormSection>
            <FormSection title="Contact" info="How clients and carriers reach the agency. Your own phone is on My profile.">
              <FieldRow>
                <Field label="Business phone" htmlFor="identity-phone">
                  <input id="identity-phone" type="tel" className={control} value={draft.phone} onChange={set("phone")} autoComplete="tel" placeholder="(312) 555-0100" />
                </Field>
                <Field label="Business email" htmlFor="identity-email">
                  <input id="identity-email" type="email" className={control} value={draft.email} onChange={set("email")} autoComplete="email" />
                </Field>
              </FieldRow>
              <Field label="Website" htmlFor="identity-website">
                <input id="identity-website" type="url" className={control} value={draft.website} onChange={set("website")} placeholder="https://" />
              </Field>
            </FormSection>
          </FormSections>
        )}

        {tab === "documents" && (
          <FormSections>
            <FormSection title="Logo" info="Without a logo, documents print your trading name as text.">
              <div className="flex flex-wrap items-center gap-4">
                <div id="identity-logo" className="flex h-16 min-w-40 items-center justify-center rounded-[8px] border border-dashed border-[var(--border-strong)] m-glass-inset px-4">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL from private storage */}
                  {p.logoUrl ? <img src={p.logoUrl} alt="Business logo" className="max-h-12 max-w-48 object-contain" />
                    : <span className="text-base font-semibold">{tradingName || "Your trading name"}</span>}
                </div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" aria-label="Choose a logo" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }} />
                <Button type="button" variant="outline" disabled={busy || !p.updatedAt} onClick={() => fileRef.current?.click()}>{p.logoUrl ? "Replace" : "Upload logo"}</Button>
                {p.logoUrl && <Button type="button" variant="ghost" disabled={busy} onClick={() => void removeLogo()}>Remove</Button>}
                <span className="text-xs text-[var(--muted)]">PNG or JPEG, up to 512 KB</span>
              </div>
              {!p.updatedAt && <p className="m-0 text-sm text-[var(--muted)]">Save the business identity first, then add a logo.</p>}
            </FormSection>

            <FormSection
              title="Documents that use it"
              info="Each document checks these details before it is made, and says which one is missing."
              aside={<StatusChip tone={notReady ? "warning" : "good"}>{ready} of {docs.length} ready</StatusChip>}
            >
              <ul className="m-0 flex list-none flex-col p-0">
                {docs.map(({ doc, missing, label }) => (
                  <li key={doc} className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] py-2.5 text-sm first:border-t-0 first:pt-0 last:pb-0">
                    <span className="min-w-0 flex-1 font-medium text-[var(--ink)]">{label.charAt(0).toUpperCase() + label.slice(1)}</span>
                    {missing.length
                      ? <StatusChip tone="warning">Needs {missing.map((f) => BUSINESS_FIELD_LABELS[f]).join(", ")}</StatusChip>
                      : <StatusChip tone="good">Ready</StatusChip>}
                  </li>
                ))}
              </ul>
            </FormSection>

            {/* How a letter prints with what is on screen now (owner, 2026-10-27: keep the letterhead from B). */}
            <FormSection title="How it prints" info="A letter’s head and foot, from what is on screen now. It changes as you type.">
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
            </FormSection>
          </FormSections>
        )}

        {tab === "support" && (
          <FormSections>
            <PartnerSupportCard />
            <OwnershipCard team={team} workspace={workspace} />
          </FormSections>
        )}
      </div>

      {saveError && <Callout tone="error" title={saveError} />}
      <LeaveGuard dirty={dirty} onDiscard={discard} what="the business identity" />
      <SettingsSaveBar visible={dirty} note="Unsaved changes to the business identity">
        <DraftActions dirty={dirty} saving={saving} onDiscard={discard} onSave={() => void save()} />
      </SettingsSaveBar>
    </SettingsStack>
  );
}

/** The saved values as a PUT body, for a change that touches only the tax ID. */
function draftBody(d: Draft) {
  return {
    legalName: d.legalName, dba: d.dba || null, npn: d.npn || null, entityType: d.entityType || null, taxIdType: d.taxIdType,
    addressLine1: d.addressLine1 || null, addressLine2: d.addressLine2 || null, city: d.city || null, state: d.state || null, postalCode: d.postalCode || null,
    phone: d.phone || null, email: d.email || null, website: d.website || null, timezone: d.timezone || null,
  };
}
