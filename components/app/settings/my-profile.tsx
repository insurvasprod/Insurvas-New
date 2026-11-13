"use client";

/**
 * Settings › My profile — the person's own page, inside Settings.
 *
 * Settings round 8, board A (owner pick 2026-11-12: "my profile, same thing" as Business identity — one
 * page, the form scrolling inside its card, not the page): Profile · Producer record (a producer's own) ·
 * Sign-in & security · Alerts as four sections of one card, a section index on the left with a mark per
 * section, and ONE save bar for everything that is a setting — the profile fields, the photo and every
 * alert. Email, password and two-step keep their own confirm dialogs (they are not settings: each one
 * checks who you are). History opens as a right sheet with a filter, instead of tabs inside a tab.
 *
 * Old links still land: "#my-profile/<tab>" scrolls to that section ("notifications" is Alerts), an
 * anchor inside one ("#my-profile/security-password", "#my-profile/notify-quiet-hours") is found by the
 * settings frame, and "#my-profile/changes" / "#my-profile/security-log" open History (the second on
 * sign-ins). /app/profile and "#alerts" land here too.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

import { FormBlock, IndexedFormCard, InlineAction, SaveFoot, scrollToSection, Seg, StatusLine, type IndexEntry, type LineTone } from "@/components/app/settings/business/indexed-form";
import { AlertsSection, useAlertsDraft } from "@/components/app/settings/notification-preferences";
import { SettingsCard, SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { SettingsHistory } from "@/components/app/settings/settings-history";
import { OwnProfileFields, profileChangeWord, useOwnProfileDraft } from "@/components/app/own-profile-form";
import { SecurityLog, SecuritySettings, type SecurityStatus } from "@/components/app/profile/security-settings";
import { Button } from "@/components/ui/button";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { SectionLoading } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { notify } from "@/lib/notify";
import { parseSettingsHash } from "@/lib/settings/registry";
import type { OwnProfile } from "@/lib/users/ownProfile";

const SECTIONS = { profile: "my-profile-profile", producer: "my-profile-producer", security: "my-profile-security", notifications: "my-profile-alerts" } as const;

type HistoryView = "settings" | "sign-ins";

/** Scroll the card's form to a section. */
const goToSection = (id: string) => scrollToSection(document.getElementById(id)?.closest<HTMLElement>(".overflow-y-auto") ?? null, id);

export function MyProfileSettings() {
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A producer's own record (AG-1.1): licences, carriers and what still blocks them. Since the Team group went
  // (2026-11-03) it is under Home › Agency, which a producer does not open, so their way in is here.
  const [recordId, setRecordId] = useState<string | null>(null);
  // The sign-in sends a person whose role requires two-factor here with ?two_factor=required.
  const [promptTwoFactor] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("two_factor") === "required");
  const [history, setHistory] = useState<HistoryView | null>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/app/profile", { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok || !body?.profile) { setError(body?.error ?? "Your profile could not be loaded. Nothing has changed; reload the page to try again."); return; }
      setProfile(body.profile as OwnProfile);
      setRecordId(typeof body.producerRecordId === "string" ? body.producerRecordId : null);
    }).catch(() => { if (live) setError("Your profile could not be loaded. Check your connection and reload the page."); });
    return () => { live = false; };
  }, []);

  // An old tab link scrolls to its section; History's links open the sheet.
  const loaded = Boolean(profile);
  useEffect(() => {
    if (!loaded) return;
    const fromHash = () => {
      const { tab: section, anchor } = parseSettingsHash(window.location.hash);
      if (section !== "my-profile") return;
      if (anchor === "changes") { setHistory("settings"); return; }
      if (anchor === "security-log") { setHistory("sign-ins"); return; }
      const target = anchor && anchor in SECTIONS ? SECTIONS[anchor as keyof typeof SECTIONS] : !anchor && promptTwoFactor ? SECTIONS.security : null;
      if (target) window.setTimeout(() => goToSection(target), 50);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [loaded, promptTwoFactor]);

  const actions = (
    <>
      <Button type="button" variant="ghost" onClick={() => setHistory("settings")}>History</Button>
      {recordId ? <Button asChild variant="outline"><Link href={`/app/producers/${recordId}`}>Open my producer record</Link></Button> : null}
    </>
  );

  return (
    <SettingsStack className="min-h-0 flex-1 gap-3">
      <SettingsSectionHeader actions={actions} />
      {error ? (
        <StatusLine tone="danger">{error} · <InlineAction tone="danger" onClick={() => window.location.reload()}>Reload</InlineAction></StatusLine>
      ) : !profile ? (
        <>
          <StatusLine tone="neutral">Loading your profile</StatusLine>
          <SettingsCard><SectionLoading rows={5} columns={2} label="Loading your profile" /></SettingsCard>
        </>
      ) : (
        <ProfilePage profile={profile} recordId={recordId} promptTwoFactor={promptTwoFactor} />
      )}

      {history && (
        <Sheet
          title="Your history"
          subtitle="What you changed, and how your account was signed in to"
          onClose={() => setHistory(null)}
          className="lg:w-[880px]"
          bodyClassName="flex min-h-0 flex-1 flex-col gap-3 p-4"
        >
          <Seg<HistoryView>
            label="Which history"
            value={history}
            onChange={setHistory}
            className="self-start"
            options={[{ key: "settings", label: "Settings you changed" }, { key: "sign-ins", label: "Sign-ins and security" }]}
          />
          <div id="changes" className="flex min-h-0 flex-1 flex-col">
            {history === "settings" ? <SettingsHistory mine /> : <SecurityLog timeZone={profile?.displayTimezone ?? null} />}
          </div>
        </Sheet>
      )}
    </SettingsStack>
  );
}

function ProfilePage({ profile, recordId, promptTwoFactor }: { profile: OwnProfile; recordId: string | null; promptTwoFactor: boolean }) {
  const form = useOwnProfileDraft(profile);
  const alerts = useAlertsDraft();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [security, setSecurity] = useState<SecurityStatus>({ twoFactorOn: null, twoFactorRequired: false });
  const onSecurity = useCallback((status: SecurityStatus) => setSecurity(status), []);

  const words = [...form.changes.map(profileChangeWord), ...(alerts.count ? [`${alerts.count === 1 ? "an alert" : `${alerts.count} alerts`}`] : [])];
  const count = form.changes.length + alerts.count;
  const dirty = count > 0;
  const recordHref = recordId ? `/app/producers/${recordId}` : null;

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const problems = [...(form.changes.length ? await form.save() : []), ...(alerts.count ? await alerts.save() : [])];
      if (problems.length) setSaveError(problems.join(" "));
      else notify.done("Profile saved");
    } finally {
      setSaving(false);
    }
  }
  const discard = () => { form.discard(); alerts.discard(); setSaveError(null); };

  // The index: a mark per section (board A).
  const profileGaps = [!form.profile.name.trim(), !form.profile.phone].filter(Boolean).length;
  const index: IndexEntry[] = [
    { id: SECTIONS.profile, label: "Profile", mark: profileGaps ? { tone: "warn", text: `${profileGaps} to add` } : { tone: "ok", text: "✓" } },
    ...(recordId ? [{ id: SECTIONS.producer, label: "Producer record" }] : []),
    { id: SECTIONS.security, label: "Sign-in & security", mark: security.twoFactorOn === false ? { tone: "warn", text: "1 to do" } : security.twoFactorOn ? { tone: "ok", text: "✓" } : null },
    { id: SECTIONS.notifications, label: "Alerts", mark: alerts.switchedOff ? { tone: "muted", text: `${alerts.switchedOff} off` } : alerts.view ? { tone: "ok", text: "✓" } : null },
  ];

  // The status line.
  const turnOn = <>two-step verification is off — <InlineAction onClick={() => goToSection(SECTIONS.security)}>turn it on</InlineAction></>;
  const notes: ReactNode[] = [...form.notes, ...alerts.notes];
  let tone: LineTone = notes.length || security.twoFactorOn === false ? "warning" : "good";
  let lead: ReactNode;
  if (saveError) {
    tone = "danger";
    lead = <>Couldn&apos;t save: {saveError} · <InlineAction tone="danger" onClick={() => void save()}>Retry</InlineAction></>;
  } else if (dirty) {
    tone = "warning";
    lead = `${count} unsaved ${count === 1 ? "change" : "changes"}`;
  } else lead = "Saved";
  const status = [lead, security.twoFactorOn === false ? turnOn : null, ...notes].filter(Boolean) as ReactNode[];

  return (
    <>
      <StatusLine tone={tone}>{status.map((part, at) => <span key={at}>{at > 0 ? " · " : ""}{part}</span>)}</StatusLine>
      <IndexedFormCard
        label="My profile"
        sections={index}
        foot="Email, password and two-step have their own confirm. Everything else saves with the bar."
        footer={<SaveFoot count={count} what={words.slice(0, 3).join(", ") + (words.length > 3 ? "…" : "")} saving={saving} onDiscard={discard} onSave={() => void save()} />}
      >
        <FormBlock id={SECTIONS.profile} title="Profile" sub="How clients and teammates see you.">
          <OwnProfileFields form={form} saving={saving} recordHref={recordHref} />
        </FormBlock>

        {recordId && (
          <FormBlock id={SECTIONS.producer} title="Producer record" sub="What the agency holds about you as a producer.">
            <dl className="m-0 grid grid-cols-[170px_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5 text-sm max-sm:grid-cols-1">
              <dt className="text-xs text-[var(--muted)]">Role</dt>
              <dd className="m-0 text-[var(--ink)]">{form.profile.roleLabel}</dd>
              <dt className="text-xs text-[var(--muted)]">Agency</dt>
              <dd className="m-0 text-[var(--ink)]">{form.profile.workspaceName}</dd>
              <dt className="text-xs text-[var(--muted)]">Carriers and writing numbers</dt>
              <dd className="m-0 flex items-center gap-2 text-[var(--ink)]">
                Your appointments, and anything that still stops you submitting
                <Link href={`/app/producers/${recordId}`} className="text-xs font-medium text-[var(--accent-ink)] underline-offset-2 hover:underline">Open my record ›</Link>
              </dd>
            </dl>
          </FormBlock>
        )}

        <FormBlock id={SECTIONS.security} title="Sign-in & security" sub="Each of these asks you to confirm in its own window.">
          <SecuritySettings email={form.profile.email} timeZone={form.profile.displayTimezone} promptTwoFactor={promptTwoFactor} onStatus={onSecurity} />
        </FormBlock>

        <FormBlock id={SECTIONS.notifications} title="Alerts" sub="Where each alert reaches you. Alerts marked Always on can't be switched off: missing one causes harm that can't be undone.">
          <div id="notifications"><AlertsSection alerts={alerts} disabled={saving} /></div>
        </FormBlock>
      </IndexedFormCard>
      <LeaveGuard dirty={dirty} what="your profile" onDiscard={discard} />
    </>
  );
}
