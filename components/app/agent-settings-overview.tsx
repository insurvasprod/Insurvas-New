"use client";

/**
 * Settings › Agency profile.
 *
 * A strip of figures on what the agency is contracted to sell, the legal identity (a real draft: the
 * save bar writes it, Discard puts it back), what needs attention, and who owns the workspace. The tiles and the attention list are derived from the carrier library and
 * the appointment vault — the same rows those sections edit — never stored twice.
 */

import type { TeamSnapshot } from "@/lib/tenantTeam/service";
import type { WorkspaceSnapshot } from "@/lib/settings/workspaceSnapshot";
import { useEffect, useMemo, useState } from "react";

import {
  Callout,
  control,
  Field,
  KeyValues,
  SettingsCard,
  SettingsGrid,
  SettingsSectionHeader,
  SettingsStack,
  Timeline,
} from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { SectionLoading } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { notify } from "@/lib/notify";
import { carriersRequiringEo, formatDay, summarizeLibrary, type LibraryLike, type LibrarySummary } from "@/lib/carriers/contracts";
import { normalizeTaxId, npnHint, WORKSPACE_TIMEZONES, type AgencyProfileResponse, type AgencyProfileView } from "@/lib/agencyProfile/types";
import { formatSupportPhone, SUPPORT_EMAIL_MAX, SUPPORT_PHONE_MAX, supportContactInputSchema, type SupportContact } from "@/lib/partnerSupport/contact";

/** The appointment-vault fields this page reads; typed locally, the vault's own types are another section's. */
type VaultSnapshot = {
  licenses: Array<{ id: string; state: string; license_number: string; expires_at: string; licence_type?: "resident" | "non_resident" | null }>;
  eoPolicies: Array<{ id: string; carrier: string; policy_number: string; expires_at: string }>;
};

type Draft = { legalName: string; dba: string; npn: string; taxId: string; principalAddress: string; timezone: string };

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

const WINDOW_DAYS = 90;
const OWNERS_ONLY = "Only owners can see and change the agency's legal identity.";
const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(isoDate: string) {
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  const target = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).getTime();
  return Number.isFinite(target) ? Math.round((target - today) / DAY_MS) : Number.NaN;
}

function whenPhrase(days: number) {
  if (days < 0) return `expired ${-days} ${-days === 1 ? "day" : "days"} ago`;
  if (days === 0) return "expires today";
  return `expires in ${days} ${days === 1 ? "day" : "days"}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const inWords = (n: number) => NUMBER_WORDS[n] ?? String(n);
const LICENCE_TYPE_LABEL = { resident: "Resident", non_resident: "Non-resident" } as const;

type AttentionItem = { key: string; title: string; sub: string; tone: "error" | "warning"; order: number };

/**
 * One item per record, not per category: each licence state inside 90 days, the E&O cover if it
 * runs out inside 90 days (or is missing), and each contracted carrier with no advance rule.
 */
function attentionItems(vault: VaultSnapshot | null, summary: LibrarySummary | null, eoCarriers: string[] | null) {
  // "· six carriers require it": only when the carrier library records it (migration 20260924220100).
  const eoRequired = eoCarriers && eoCarriers.length ? ` · ${inWords(eoCarriers.length)} carrier${eoCarriers.length === 1 ? " requires" : "s require"} it` : "";
  const items: AttentionItem[] = [];
  const counts = { eo: 0, licences: 0, rules: 0 };
  if (vault) {
    const cover = [...vault.eoPolicies].sort((a, b) => b.expires_at.localeCompare(a.expires_at))[0];
    if (!cover) {
      counts.eo += 1;
      items.push({ key: "eo-none", title: "No E&O policy on file", sub: "Add the agency's errors & omissions cover under States & licences", tone: "error", order: -1 });
    } else {
      const days = daysUntil(cover.expires_at);
      if (days <= WINDOW_DAYS) {
        counts.eo += 1;
        items.push({ key: `eo-${cover.id}`, title: `E&O policy ${whenPhrase(days)}`, sub: `${cover.carrier} · ${days < 0 ? "expired" : "expires"} ${formatDay(cover.expires_at)}${eoRequired}`, tone: "error", order: days });
      }
    }
    const latestByState = new Map<string, VaultSnapshot["licenses"][number]>();
    for (const licence of vault.licenses) {
      const current = latestByState.get(licence.state);
      if (!current || licence.expires_at > current.expires_at) latestByState.set(licence.state, licence);
    }
    for (const licence of latestByState.values()) {
      const days = daysUntil(licence.expires_at);
      if (days > WINDOW_DAYS) continue;
      counts.licences += 1;
      items.push({
        key: `licence-${licence.id}`,
        title: `${STATE_NAMES[licence.state] ?? licence.state} licence ${whenPhrase(days)}`,
        // "Resident licence 1184402" once the type is recorded (migration 20260924110000).
        sub: `${licence.licence_type ? `${LICENCE_TYPE_LABEL[licence.licence_type]} licence` : "Licence"} ${licence.license_number} · ${days < 0 ? "expired" : "expires"} ${formatDay(licence.expires_at)}`,
        tone: days < 0 ? "error" : "warning",
        order: days,
      });
    }
  }
  if (summary) {
    for (const carrier of summary.carriersWithoutAdvanceRule) {
      counts.rules += 1;
      // True as written: the ledger (lib/ledger/compute.ts) posts year one unadvanced when no rule exists.
      items.push({ key: `rule-${carrier.carrierId}`, title: `${carrier.carrierName} has no advance rule`, sub: "Commissions will post unadvanced until one exists", tone: "warning", order: WINDOW_DAYS + 1 });
    }
  }
  items.sort((a, b) => a.order - b.order);
  const parts = [
    counts.eo ? plural(counts.eo, "E&O policy", "E&O policies") : null,
    counts.licences ? plural(counts.licences, "licence", "licences") : null,
    counts.rules ? plural(counts.rules, "advance rule", "advance rules") : null,
  ].filter(Boolean);
  return { items, breakdown: parts.length ? parts.join(", ") : `Nothing due in ${WINDOW_DAYS} days` };
}

const draftFrom = (profile: AgencyProfileView): Draft => ({
  legalName: profile.legalName,
  dba: profile.dba ?? "",
  npn: profile.npn ?? "",
  taxId: profile.taxId ?? "",
  principalAddress: profile.principalAddress ?? "",
  timezone: profile.timezone ?? "",
});

async function readJson<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string | null }> {
  const response = await fetch(path, { cache: "no-store" });
  const body = await response.json().catch(() => null);
  return response.ok ? { ok: true, data: body as T } : { ok: false, status: response.status, error: body?.error ?? null };
}

export function AgentSettingsOverview({ team, workspace }: { team?: TeamSnapshot; workspace?: WorkspaceSnapshot } = {}) {
  const [library, setLibrary] = useState<LibraryLike | null>(null);
  const [vault, setVault] = useState<VaultSnapshot | null>(null);
  const [derivedLoaded, setDerivedLoaded] = useState(false);
  const [profile, setProfile] = useState<AgencyProfileResponse | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The support contact partners see (partner portal › Messages › Details). Its own API; part of
  // this section's draft, so the header's Save and Discard cover it too.
  const [support, setSupport] = useState<SupportContact | null>(null);
  const [supportDraft, setSupportDraft] = useState<{ email: string; phone: string }>({ email: "", phone: "" });
  const [supportError, setSupportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readJson<{ contact: SupportContact }>("/api/app/partner-support-contact").then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSupport(result.data.contact);
        setSupportDraft({ email: result.data.contact.email ?? "", phone: result.data.contact.phone ?? "" });
      } else {
        setSupportError(result.error ?? "Could not load the support contact.");
      }
    }).catch(() => {
      if (!cancelled) setSupportError("Could not load the support contact.");
    });
    void Promise.all([
      readJson<LibraryLike>("/api/app/carrier-library"),
      readJson<VaultSnapshot>("/api/app/appointment-vault"),
    ]).then(([carriers, appointments]) => {
      if (cancelled) return;
      setLibrary(carriers.ok ? carriers.data : null);
      setVault(appointments.ok ? appointments.data : null);
      setDerivedLoaded(true);
    }).catch(() => {
      if (!cancelled) setDerivedLoaded(true);
    });
    void readJson<AgencyProfileResponse>("/api/app/agency-profile").then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setProfile(result.data);
        setDraft(draftFrom(result.data.profile));
      } else {
        setProfileError(result.status === 403 ? OWNERS_ONLY : result.error ?? "Could not load the agency profile.");
      }
    }).catch(() => {
      if (!cancelled) setProfileError("Could not load the agency profile.");
    });
    return () => { cancelled = true; };
  }, []);

  const summary = useMemo(() => (library ? summarizeLibrary(library) : null), [library]);
  const eoCarriers = useMemo(() => (library ? carriersRequiringEo(library) : null), [library]);
  const attention = useMemo(() => attentionItems(vault, summary, eoCarriers), [vault, summary, eoCarriers]);
  const attentionKnown = derivedLoaded && (vault !== null || summary !== null);

  const original = profile ? draftFrom(profile.profile) : null;
  const profileDirty = Boolean(draft && original && (Object.keys(draft) as Array<keyof Draft>).some((key) => draft[key].trim() !== original[key].trim()));
  const supportDirty = Boolean(support?.schemaReady) && (supportDraft.email.trim() !== (support?.email ?? "") || supportDraft.phone.trim() !== (support?.phone ?? ""));
  const dirty = profileDirty || supportDirty;
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => {
    setSaveError(null);
    setDraft((current) => (current ? { ...current, [key]: event.target.value } : current));
  };

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSupportError(null);
    const savedProfile = profileDirty ? await saveProfile() : true;
    const savedSupport = supportDirty ? await saveSupport() : true;
    setSaving(false);
    if (savedProfile && savedSupport) notify.done(profileDirty && supportDirty ? "Agency profile and support contact saved" : supportDirty ? "Support contact saved" : "Agency profile saved");
  }

  async function saveSupport(): Promise<boolean> {
    const parsed = supportContactInputSchema.safeParse(supportDraft);
    if (!parsed.success) { setSupportError(parsed.error.issues[0]?.message ?? "Enter a valid support contact."); return false; }
    const response = await fetch("/api/app/partner-support-contact", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
    const result = await response.json().catch(() => null) as { contact?: SupportContact; error?: string } | null;
    if (!response.ok || !result?.contact) { setSupportError(result?.error ?? "Could not save the support contact."); return false; }
    setSupport(result.contact);
    setSupportDraft({ email: result.contact.email ?? "", phone: result.contact.phone ?? "" });
    return true;
  }

  async function saveProfile(): Promise<boolean> {
    if (!draft || !original) return true;
    if (!draft.legalName.trim()) { setSaveError("Enter the legal entity name."); return false; }
    const body: Record<string, string | null> = {
      legalName: draft.legalName,
      dba: draft.dba || null,
      npn: draft.npn || null,
      principalAddress: draft.principalAddress || null,
      timezone: draft.timezone || null,
    };
    // The tax ID travels only when it changed: re-sending an unchanged value would re-encrypt it and
    // log a change that did not happen.
    if (draft.taxId.trim() !== original.taxId.trim()) body.taxId = draft.taxId.trim() ? normalizeTaxId(draft.taxId) : null;
    const response = await fetch("/api/app/agency-profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => null);
    if (!response.ok) { setSaveError(result?.error ?? "Could not save the agency profile."); return false; }
    const next: AgencyProfileResponse = { profile: result.profile as AgencyProfileView, schemaReady: true, niprConfigured: profile?.niprConfigured };
    setProfile(next);
    setDraft(draftFrom(next.profile));
    return true;
  }

  function discard() {
    if (original) setDraft(original);
    if (support) setSupportDraft({ email: support.email ?? "", phone: support.phone ?? "" });
    setSaveError(null);
    setSupportError(null);
  }

  const owners = (team?.members ?? []).filter((member) => member.role === "owner" && member.status === "active");
  const p = profile?.profile;
  const taxHint = p && !p.taxIdReadable
    ? `A tax ID ending ${p.taxIdLast4 ?? "····"} is stored, but this server has no key to show it. Typing a new one replaces it.`
    : "Stored encrypted. Shown to owners only.";
  const timezoneOptions = draft?.timezone && !(WORKSPACE_TIMEZONES as readonly string[]).includes(draft.timezone) ? [draft.timezone, ...WORKSPACE_TIMEZONES] : [...WORKSPACE_TIMEZONES];

  const tile = (value: number | undefined) => (summary && value !== undefined ? value : "—");

  return (
    <SettingsStack>
      <SettingsSectionHeader />

      <StatStrip label="Agency contracts">
        <StatTile label="Active carriers" value={tile(summary?.activeCarriers)} footnote={summary ? `of ${summary.libraryCarriers} in the library` : undefined} reserveFootnote />
        <StatTile label="Product contracts" value={tile(summary?.productContracts)} footnote={summary ? `across ${plural(summary.contractCarriers, "carrier", "carriers")}` : undefined} reserveFootnote />
        <StatTile
          label="Commission schedules"
          value={tile(summary?.schedules)}
          footnote={summary ? (summary.schedules === summary.productContracts ? "one per contract" : `${plural(summary.productContracts - summary.schedules, "contract has", "contracts have")} none`) : undefined}
          reserveFootnote
        />
        <StatTile label="Needs attention" value={attentionKnown ? attention.items.length : "—"} valueTone={attentionKnown && attention.items.length > 0 ? "warning" : undefined} footnote={attentionKnown ? attention.breakdown : undefined} reserveFootnote />
      </StatStrip>

      {/* Effective-dated as written: every save adds a dated agency_profile_history row (20260924100000). */}
      <SettingsCard title="Legal identity">
        {profileError ? (
          <Callout tone={profileError === OWNERS_ONLY ? "info" : "error"} title={profileError} />
        ) : !draft || !p ? (
          <SectionLoading rows={3} columns={2} label="Loading the legal identity" />
        ) : (
          <>
            {saveError && <Callout tone="error" title={saveError} className="mb-4" />}
            {!profile.schemaReady && !saveError && <Callout tone="warning" title="Saving the agency profile needs a database update." className="mb-4" />}
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="Legal entity name" htmlFor="agency-legal-name" required>
                <input id="agency-legal-name" type="text" className={control} value={draft.legalName} onChange={set("legalName")} autoComplete="organization" required />
              </Field>
              <Field label="Doing business as" htmlFor="agency-dba">
                <input id="agency-dba" type="text" className={control} value={draft.dba} onChange={set("dba")} />
              </Field>
              <Field
                label="National Producer Number"
                htmlFor="agency-npn"
                hint={npnHint(p, draft.npn, profile.niprConfigured === true, formatDay)}
              >
                <input id="agency-npn" type="text" inputMode="numeric" className={control} value={draft.npn} onChange={set("npn")} />
              </Field>
              <Field label="Federal tax ID" htmlFor="agency-tax-id" hint={taxHint}>
                <input
                  id="agency-tax-id"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  className={control}
                  value={draft.taxId}
                  placeholder={p.taxIdReadable ? "12-3456789" : `Stored · ends ${p.taxIdLast4 ?? "····"}`}
                  onChange={set("taxId")}
                />
              </Field>
              <Field label="Principal address" htmlFor="agency-address">
                <input id="agency-address" type="text" className={control} value={draft.principalAddress} onChange={set("principalAddress")} autoComplete="street-address" />
              </Field>
              <Field label="Workspace timezone" htmlFor="agency-timezone" hint="Used for callbacks and reports. Calling windows follow each customer’s own timezone.">
                <select id="agency-timezone" className={control} value={draft.timezone} onChange={set("timezone")}>
                  <option value="">Not set</option>
                  {timezoneOptions.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                </select>
              </Field>
            </div>
          </>
        )}
      </SettingsCard>

      {/* Moved here from the partner-chat page: the agency's own contact details belong with its identity. */}
      <SettingsCard title="Partner support contact">
        {support === null && !supportError ? (
          <SectionLoading rows={1} columns={2} label="Loading the support contact" />
        ) : (
          <>
            {supportError && <Callout tone="error" title={supportError} className="mb-4" />}
            {support && !support.schemaReady && <Callout tone="warning" title="Saving the support contact needs a database update." className="mb-4" />}
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="Support email" htmlFor="agency-support-email" hint="Partners see it in Messages. Leave blank to hide it.">
                <input
                  id="agency-support-email"
                  type="email"
                  autoComplete="email"
                  className={control}
                  maxLength={SUPPORT_EMAIL_MAX}
                  value={supportDraft.email}
                  disabled={!support?.schemaReady}
                  placeholder="support@youragency.com"
                  onChange={(event) => { setSupportError(null); setSupportDraft((current) => ({ ...current, email: event.target.value })); }}
                />
              </Field>
              <Field
                label="Phone"
                htmlFor="agency-support-phone"
                hint={support?.schemaReady ? (formatSupportPhone(supportDraft.phone) ? `Partners see it as ${formatSupportPhone(supportDraft.phone)}.` : "No phone set.") : undefined}
              >
                <input
                  id="agency-support-phone"
                  type="tel"
                  autoComplete="tel"
                  className={control}
                  maxLength={SUPPORT_PHONE_MAX}
                  value={supportDraft.phone}
                  disabled={!support?.schemaReady}
                  placeholder="(312) 555-0100"
                  onChange={(event) => { setSupportError(null); setSupportDraft((current) => ({ ...current, phone: event.target.value })); }}
                />
              </Field>
            </div>
          </>
        )}
      </SettingsCard>

      <SettingsGrid>
        <SettingsCard title="Needs attention" bodyClassName="mt-3.5">
          {!attentionKnown ? (
            derivedLoaded ? <p className="m-0 text-[14px] text-[var(--muted)]">The appointment vault and carrier library could not be read.</p> : <SectionLoading rows={3} columns={2} label="Checking licences and advance rules" />
          ) : attention.items.length === 0 ? (
            <p className="m-0 text-[14px] leading-[1.5] text-[var(--muted)]">Nothing due in the next {WINDOW_DAYS} days.</p>
          ) : (
            <Timeline items={attention.items.map((item) => ({ title: item.title, sub: item.sub, tone: item.tone }))} />
          )}
        </SettingsCard>

        <SettingsCard title="Ownership" bodyClassName="mt-3.5">
          <KeyValues
            cols={1}
            items={[
              { label: owners.length > 1 ? "Owners" : "Owner", value: owners.length ? owners.map((owner) => owner.name).join(", ") : "—" },
              { label: owners.length > 1 ? "Owner emails" : "Owner email", value: owners.length ? owners.map((owner) => owner.email).join(", ") : "—" },
              { label: "Created", value: workspace?.createdAt ? new Date(workspace.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—" },
              { label: "Workspace ID", value: workspace?.tenantId ?? "—" },
            ]}
          />
        </SettingsCard>
      </SettingsGrid>

      <SettingsSaveBar visible={dirty} note="Unsaved changes to the agency profile">
        <Button type="button" variant="outline" onClick={discard} disabled={saving}>Discard</Button>
        <Button type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
      </SettingsSaveBar>
    </SettingsStack>
  );
}
