"use client";

/**
 * LA-3.22 · the carrier's portal account (board: "Gerber Life · portal account"). Where the agency
 * signs in, the shared username, the writing number, the MFA method and when someone last confirmed
 * it works — never a password: no field, no key, no column holds one.
 */

import { useState } from "react";

import { Field, Pill, SettingsCard, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { PORTAL_MFA_LABEL, PORTAL_MFA_TYPES } from "@/lib/salesSettings/portalSchemas";
import { PORTAL_VERIFY_NUDGE_DAYS, type PortalAccountView } from "@/lib/salesSettings/views";

import { WithReason, shortDay } from "./shared";

export type PortalDraft = { portalUrl: string; username: string; writingNumber: string; mfaType: PortalAccountView["mfaType"]; lastVerifiedOn: string };

export function draftOfPortal(p: PortalAccountView | null, fallbackUrl: string | null): PortalDraft {
  return {
    portalUrl: p?.portalUrl ?? fallbackUrl ?? "",
    username: p?.username ?? "",
    writingNumber: p?.writingNumber ?? "",
    mfaType: p?.mfaType ?? "app",
    lastVerifiedOn: p?.lastVerifiedAt ? p.lastVerifiedAt.slice(0, 10) : "",
  };
}

export const portalIsBlank = (d: PortalDraft) => !d.username.trim() && !d.writingNumber.trim() && !d.lastVerifiedOn;

const today = () => new Date().toISOString().slice(0, 10);

/** Open the portal in a new tab and put the username on the clipboard, saying exactly what was copied. */
export async function openPortal(url: string, username: string | null) {
  if (username) {
    try {
      await navigator.clipboard.writeText(username);
      notify.done(`Copied the username “${username}”`, { detail: "Paste it into the portal's sign-in. The password comes from your password manager." });
    } catch {
      notify.warn("The username could not be copied", { detail: `Type it in: ${username}` });
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function copyUsername(username: string) {
  try {
    await navigator.clipboard.writeText(username);
    notify.done(`Copied the username “${username}”`);
  } catch {
    notify.warn("The username could not be copied", { detail: `Type it in: ${username}` });
  }
}

export function VerifiedChip({ lastVerifiedAt, needsCheck }: { lastVerifiedAt: string | null; needsCheck: boolean }) {
  if (!lastVerifiedAt) return <Pill tone="warning">Not verified yet</Pill>;
  if (needsCheck) return <Pill tone="warning">Check it still works</Pill>;
  return <Pill tone="success">Verified {shortDay(lastVerifiedAt)}</Pill>;
}

export function PortalAccountCard({
  carrierName,
  account,
  draft,
  onChange,
  onVerify,
  onRemove,
  readOnly,
  verifying,
}: {
  carrierName: string;
  account: PortalAccountView | null;
  draft: PortalDraft;
  onChange: (patch: Partial<PortalDraft>) => void;
  onVerify: () => void;
  /** Opens the confirm for removing the saved account (owners only). */
  onRemove: () => void;
  readOnly: boolean;
  verifying: boolean;
}) {
  const [now] = useState(() => Date.now());
  const stale = draft.lastVerifiedOn ? now - new Date(`${draft.lastVerifiedOn}T12:00:00Z`).getTime() > PORTAL_VERIFY_NUDGE_DAYS * 86_400_000 : true;
  const openUrl = draft.portalUrl.trim() ? (/^https:\/\//i.test(draft.portalUrl.trim()) ? draft.portalUrl.trim() : `https://${draft.portalUrl.trim()}`) : null;
  const username = draft.username.trim() || null;

  return (
    <SettingsCard
      title={`${carrierName} · portal account`}
      sub="One account per carrier, held by the agency."
      action={
        <span className="flex shrink-0 flex-wrap items-center gap-2.5">
          {account ? <VerifiedChip lastVerifiedAt={account.lastVerifiedAt} needsCheck={account.needsCheck} /> : <Pill tone="neutral">Not saved yet</Pill>}
          {account && !readOnly && (
            <Button type="button" variant="outline" disabled={verifying} onClick={onVerify} title="Someone signed in today and it still works.">{verifying ? "Marking…" : "Mark verified"}</Button>
          )}
          {account && !readOnly && (
            <Button type="button" variant="outline" onClick={onRemove}>Remove account</Button>
          )}
        </span>
      }
    >
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <Field label="Portal URL" htmlFor="portal-url" hint="Where the extension expects to be when it fills this carrier's form.">
          <input id="portal-url" className={control} value={draft.portalUrl} disabled={readOnly} spellCheck={false} placeholder="agents.carrier.com/login" onChange={(e) => onChange({ portalUrl: e.target.value })} />
        </Field>
        <Field label="Username" htmlFor="portal-username" hint="Shared by the agency. There is no password field — the password stays in your password manager.">
          <input id="portal-username" className={control} value={draft.username} disabled={readOnly} autoComplete="off" spellCheck={false} onChange={(e) => onChange({ username: e.target.value })} />
        </Field>
        <Field label="Writing number" htmlFor="portal-writing" hint="Goes on every application so the commission lands on this agency.">
          <input id="portal-writing" className={control} value={draft.writingNumber} disabled={readOnly} autoComplete="off" onChange={(e) => onChange({ writingNumber: e.target.value })} />
        </Field>
        <Field label="MFA" htmlFor="portal-mfa" hint="SMS codes land on the owner's phone, which stalls an agent at 9pm.">
          <select id="portal-mfa" className={control} value={draft.mfaType} disabled={readOnly} onChange={(e) => onChange({ mfaType: e.target.value as PortalDraft["mfaType"] })}>
            {PORTAL_MFA_TYPES.map((m) => <option key={m} value={m}>{PORTAL_MFA_LABEL[m]}</option>)}
          </select>
        </Field>
        <Field
          label="Last verified"
          htmlFor="portal-verified"
          hint={draft.lastVerifiedOn
            ? stale ? `Over ${PORTAL_VERIFY_NUDGE_DAYS} days ago — sign in and check it still works.` : `Someone signed in and confirmed ${draft.writingNumber.trim() ? `the writing number still reads ${draft.writingNumber.trim()}` : "it works"}.`
            : "Not checked yet. Sign in once and mark it verified."}
        >
          <input id="portal-verified" type="date" max={today()} className={control} value={draft.lastVerifiedOn} disabled={readOnly} onChange={(e) => onChange({ lastVerifiedOn: e.target.value })} />
        </Field>
        <div className="min-w-0">
          <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Open the portal</span>
          <div className="mt-1.5 flex flex-wrap gap-2.5">
            <WithReason reason={openUrl ? null : "Add the portal URL first."}>
              <Button type="button" disabled={!openUrl} onClick={() => { if (openUrl) void openPortal(openUrl, username); }}>Open portal</Button>
            </WithReason>
            <WithReason reason={username ? null : "Add the username first."}>
              <Button type="button" variant="outline" disabled={!username} onClick={() => { if (username) void copyUsername(username); }}>Copy username</Button>
            </WithReason>
          </div>
          <span className="mt-1.5 block text-[12px] leading-[1.5] text-[var(--muted)]">Opening copies the username, so only the password has to be fetched.</span>
        </div>
      </div>
    </SettingsCard>
  );
}
