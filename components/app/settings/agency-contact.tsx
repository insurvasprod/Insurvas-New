"use client";

/**
 * The "Partners & owner" part of Business identity (since 2026-10-15 the old Agency profile lives here).
 *
 *   usePartnerSupport  — the support email and phone partners see (partner portal › Messages): loaded,
 *                        drafted and saved by the page's ONE save bar (settings round 8, board A — it had
 *                        its own Save button, so the page had two ways to save). Its own API still.
 *   PartnerSupportCard — those two fields, reading the draft from the page (PartnerSupportProvider).
 *   OwnershipCard      — who owns the workspace and since when; read-only. The workspace id only behind
 *                        "Show technical details" + Copy.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

import { TechnicalDetails } from "@/components/app/settings/business/indexed-form";
import { control, Field } from "@/components/app/settings/primitives";
import { SectionLoading } from "@/components/ui/page-states";
import { formatSupportPhone, SUPPORT_EMAIL_MAX, SUPPORT_PHONE_MAX, supportContactInputSchema, type SupportContact } from "@/lib/partnerSupport/contact";
import type { TeamSnapshot } from "@/lib/tenantTeam/service";
import type { WorkspaceSnapshot } from "@/lib/settings/workspaceSnapshot";

export type PartnerSupportDraft = {
  support: SupportContact | null;
  loadError: string | null;
  draft: { email: string; phone: string };
  setField: (key: "email" | "phone", value: string) => void;
  /** Field names that changed, for the save bar ("partner support email"). */
  changes: string[];
  /** Why the draft cannot be saved as it is, or null. */
  problem: string | null;
  discard: () => void;
  /** Saves when changed; resolves to an error message or null. */
  save: () => Promise<string | null>;
};

export function usePartnerSupport(): PartnerSupportDraft {
  const [support, setSupport] = useState<SupportContact | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ email: string; phone: string }>({ email: "", phone: "" });

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/app/partner-support-contact", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { contact?: SupportContact; error?: string } | null;
        if (cancelled) return;
        if (!response.ok || !body?.contact) { setLoadError(body?.error ?? "Could not load the partner support contact."); return; }
        setSupport(body.contact);
        setDraft({ email: body.contact.email ?? "", phone: body.contact.phone ?? "" });
      })
      .catch(() => { if (!cancelled) setLoadError("Could not load the partner support contact."); });
    return () => { cancelled = true; };
  }, []);

  const changes: string[] = [];
  if (support?.schemaReady) {
    if (draft.email.trim() !== (support.email ?? "")) changes.push("partner support email");
    if (draft.phone.trim() !== (support.phone ?? "")) changes.push("partner support phone");
  }
  const parsed = changes.length ? supportContactInputSchema.safeParse(draft) : null;
  const problem = parsed && !parsed.success ? parsed.error.issues[0]?.message ?? "Enter a valid partner support contact." : null;

  const setField = useCallback((key: "email" | "phone", value: string) => setDraft((current) => ({ ...current, [key]: value })), []);
  const discard = () => { if (support) setDraft({ email: support.email ?? "", phone: support.phone ?? "" }); };

  async function save(): Promise<string | null> {
    if (!changes.length) return null;
    const checked = supportContactInputSchema.safeParse(draft);
    if (!checked.success) return checked.error.issues[0]?.message ?? "Enter a valid partner support contact.";
    try {
      const response = await fetch("/api/app/partner-support-contact", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(checked.data) });
      const result = (await response.json().catch(() => null)) as { contact?: SupportContact; error?: string } | null;
      if (!response.ok || !result?.contact) return result?.error ?? "Could not save the partner support contact.";
      setSupport(result.contact);
      setDraft({ email: result.contact.email ?? "", phone: result.contact.phone ?? "" });
      return null;
    } catch {
      return "Could not save the partner support contact. Check your connection.";
    }
  }

  return { support, loadError, draft, setField, changes, problem, discard, save };
}

const PartnerSupportContext = createContext<PartnerSupportDraft | null>(null);

export function PartnerSupportProvider({ value, children }: { value: PartnerSupportDraft; children: ReactNode }) {
  return <PartnerSupportContext.Provider value={value}>{children}</PartnerSupportContext.Provider>;
}

/** Not the agency's own phone (that is under Contact & address): the help line partners see (owner, 2026-10-27). */
export function PartnerSupportCard() {
  const support = useContext(PartnerSupportContext);
  if (!support) return null;
  const { support: saved, loadError, draft, setField, problem } = support;
  const locked = !saved?.schemaReady;
  const shown = formatSupportPhone(draft.phone);
  return (
    <div id="identity-partner-support" className="scroll-mt-24">
      {saved === null && !loadError ? (
        <SectionLoading rows={1} columns={2} label="Loading the partner support contact" />
      ) : (
        <div className="grid min-w-0 gap-x-[18px] gap-y-3 @lg:grid-cols-2">
          <Field label="Partner support email" htmlFor="agency-support-email" error={problem && problem.toLowerCase().includes("email") ? problem : undefined}>
            <input id="agency-support-email" type="email" autoComplete="email" className={control} maxLength={SUPPORT_EMAIL_MAX} value={draft.email}
              disabled={locked} placeholder="support@youragency.com" onChange={(event) => setField("email", event.target.value)} />
          </Field>
          <Field
            label="Partner support phone"
            htmlFor="agency-support-phone"
            error={problem && problem.toLowerCase().includes("phone") ? problem : undefined}
            hint={`Shown in the partner portal only${saved?.schemaReady && shown ? `, as ${shown}` : ""}. Not your business phone. Leave a field blank to hide it.`}
          >
            <input id="agency-support-phone" type="tel" autoComplete="tel" className={control} maxLength={SUPPORT_PHONE_MAX} value={draft.phone}
              disabled={locked} placeholder="(312) 555-0100" onChange={(event) => setField("phone", event.target.value)} />
          </Field>
        </div>
      )}
    </div>
  );
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export function OwnershipCard({ team, workspace }: { team: TeamSnapshot | null; workspace: WorkspaceSnapshot | null }) {
  const owners = (team?.members ?? []).filter((member) => member.role === "owner" && member.status === "active");
  const row = "grid grid-cols-[170px_minmax(0,1fr)] items-center gap-x-4 max-sm:grid-cols-1 max-sm:gap-y-1";
  return (
    <div id="identity-ownership" className="mt-3.5 flex scroll-mt-24 flex-col gap-2.5 border-t border-[var(--border)] pt-3.5 text-sm">
      <div className={row}>
        <span className="text-xs text-[var(--muted)]">{owners.length > 1 ? "Owners" : "Owner"}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-[var(--ink)]">
          {owners.length ? owners.map((owner) => (
            <span key={owner.email} className="inline-flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="inline-grid size-7 shrink-0 place-items-center rounded-full bg-[var(--highlight-soft)] text-xs font-bold text-[var(--highlight-ink)]">{initialsOf(owner.name)}</span>
              <span className="min-w-0 truncate">{owner.name} <span className="text-xs text-[var(--muted)]">{owner.email}</span></span>
            </span>
          )) : "—"}
          <Link href="/app/settings#team-access" className="text-xs font-medium text-[var(--accent-ink)] underline-offset-2 hover:underline">Team &amp; access ›</Link>
        </span>
      </div>
      <div className={row}>
        <span className="text-xs text-[var(--muted)]">Agency since</span>
        <span className="text-[var(--ink)]">{workspace?.createdAt ? longDate(workspace.createdAt) : "—"}</span>
      </div>
      <div className={row}>
        <span className="text-xs text-[var(--muted)]">Plan</span>
        <span className="flex items-center gap-2 text-[var(--ink)]">
          {workspace?.planName ?? "—"}
          <Link href="/app/settings#billing" className="text-xs font-medium text-[var(--accent-ink)] underline-offset-2 hover:underline">Plan &amp; billing ›</Link>
        </span>
      </div>
      {workspace?.tenantId ? <TechnicalDetails label="Workspace" value={workspace.tenantId} /> : null}
    </div>
  );
}
