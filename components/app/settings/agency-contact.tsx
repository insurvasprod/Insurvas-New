"use client";

/**
 * Two cards that used to make up Settings › Agency profile, now at the foot of Business identity
 * (owner decision 2026-10-15: the two sections overlapped, and "Agency profile" read like a second
 * place to edit the same record). The contract counts it also showed live on Carrier library, and its
 * licence reminders on States & licences.
 *
 *   PartnerSupportCard — the support email and phone partners see (partner portal › Messages). Its own
 *                        API and its own Save, so it never mixes with the identity draft above it.
 *   OwnershipCard      — who owns the workspace, when it was created, and its id. Read-only.
 */

import { useEffect, useState } from "react";

import { Callout, control, Field, KeyValues, SettingsCard } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { SectionLoading } from "@/components/ui/page-states";
import { notify } from "@/lib/notify";
import { formatSupportPhone, SUPPORT_EMAIL_MAX, SUPPORT_PHONE_MAX, supportContactInputSchema, type SupportContact } from "@/lib/partnerSupport/contact";
import type { TeamSnapshot } from "@/lib/tenantTeam/service";
import type { WorkspaceSnapshot } from "@/lib/settings/workspaceSnapshot";

export function PartnerSupportCard() {
  const [support, setSupport] = useState<SupportContact | null>(null);
  const [draft, setDraft] = useState<{ email: string; phone: string }>({ email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/app/partner-support-contact", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { contact?: SupportContact; error?: string } | null;
        if (cancelled) return;
        if (!response.ok || !body?.contact) { setError(body?.error ?? "Could not load the support contact."); return; }
        setSupport(body.contact);
        setDraft({ email: body.contact.email ?? "", phone: body.contact.phone ?? "" });
      })
      .catch(() => { if (!cancelled) setError("Could not load the support contact."); });
    return () => { cancelled = true; };
  }, []);

  const dirty = Boolean(support?.schemaReady) && (draft.email.trim() !== (support?.email ?? "") || draft.phone.trim() !== (support?.phone ?? ""));

  async function save() {
    const parsed = supportContactInputSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Enter a valid support contact."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/app/partner-support-contact", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = (await response.json().catch(() => null)) as { contact?: SupportContact; error?: string } | null;
      if (!response.ok || !result?.contact) { setError(result?.error ?? "Could not save the support contact."); return; }
      setSupport(result.contact);
      setDraft({ email: result.contact.email ?? "", phone: result.contact.phone ?? "" });
      notify.done("Support contact saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard title="Partner support contact" sub="Partners see it in Messages. Leave a field blank to hide it.">
      <div id="identity-partner-support">
        {support === null && !error ? (
          <SectionLoading rows={1} columns={2} label="Loading the support contact" />
        ) : (
          <>
            {error && <Callout tone="error" title={error} className="mb-4" />}
            {support && !support.schemaReady && <Callout tone="warning" title="Saving the support contact needs a database update." className="mb-4" />}
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="Support email" htmlFor="agency-support-email">
                <input id="agency-support-email" type="email" autoComplete="email" className={control} maxLength={SUPPORT_EMAIL_MAX} value={draft.email}
                  disabled={!support?.schemaReady} placeholder="support@youragency.com"
                  onChange={(event) => { setError(null); setDraft((current) => ({ ...current, email: event.target.value })); }} />
              </Field>
              <Field label="Phone" htmlFor="agency-support-phone"
                hint={support?.schemaReady ? (formatSupportPhone(draft.phone) ? `Partners see it as ${formatSupportPhone(draft.phone)}.` : "No phone set.") : undefined}>
                <input id="agency-support-phone" type="tel" autoComplete="tel" className={control} maxLength={SUPPORT_PHONE_MAX} value={draft.phone}
                  disabled={!support?.schemaReady} placeholder="(312) 555-0100"
                  onChange={(event) => { setError(null); setDraft((current) => ({ ...current, phone: event.target.value })); }} />
              </Field>
            </div>
            {dirty ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save contact"}</Button>
                <Button type="button" variant="outline" disabled={saving} onClick={() => { if (support) setDraft({ email: support.email ?? "", phone: support.phone ?? "" }); setError(null); }}>Discard</Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </SettingsCard>
  );
}

export function OwnershipCard({ team, workspace }: { team: TeamSnapshot | null; workspace: WorkspaceSnapshot | null }) {
  const owners = (team?.members ?? []).filter((member) => member.role === "owner" && member.status === "active");
  return (
    <SettingsCard title="Ownership">
      <div id="identity-ownership">
        <KeyValues
          items={[
            { label: owners.length > 1 ? "Owners" : "Owner", value: owners.length ? owners.map((owner) => owner.name).join(", ") : "—" },
            { label: owners.length > 1 ? "Owner emails" : "Owner email", value: owners.length ? owners.map((owner) => owner.email).join(", ") : "—" },
            { label: "Created", value: workspace?.createdAt ? new Date(workspace.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—" },
            { label: "Workspace ID", value: workspace?.tenantId ?? "—" },
          ]}
        />
      </div>
    </SettingsCard>
  );
}
