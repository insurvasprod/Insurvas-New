"use client";

/**
 * Settings › My profile (redesign 2026-10-27, owner pick A, canvas "Settings · My profile"): the
 * person's own page, inside Settings instead of a page of its own, with Notifications folded in.
 * Four tabs — About you, Signing in, Alerts, History — each the component that drew it before
 * (/app/profile and Settings › Notifications), so nothing is lost.
 *
 * The tabs are status cards (layout B, 2026-10-27): each says in one line what needs you, read
 * here before its tab is opened and kept current by the tab's own saves (lib/users/profileStatus.ts).
 *
 * History holds two lists: the settings you changed, and your sign-ins and security changes (moved
 * from Signing in, owner 2026-10-27). Its card warns about a recent run of wrong passwords.
 *
 * "#my-profile/<tab>" opens a tab; an anchor inside one ("#my-profile/security-password",
 * "#my-profile/notify-quiet-hours") opens the tab that holds it and revealAnchor then finds it.
 * "#my-profile/security-log" is the sign-in history, so it opens History on that list.
 * The old addresses — /app/profile and "#alerts" — land here. The tab keys predate the plain labels
 * and stay, so every link still works.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Callout, SettingsCard, SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { NotificationPreferences } from "@/components/app/settings/notification-preferences";
import { SettingsHistory } from "@/components/app/settings/settings-history";
import { OwnProfileForm } from "@/components/app/own-profile-form";
import { SecuritySettings } from "@/components/app/profile/security-settings";
import { StatusTabs, type StatusTab } from "@/components/app/profile/status-tabs";
import { SignInHistory } from "@/components/app/profile/security/security-log";
import type { SecurityEvent } from "@/components/app/profile/security/shared";
import { SectionLoading } from "@/components/ui/page-states";
import { ViewTabs } from "@/components/ui/view-tabs";
import { Button } from "@/components/ui/button";
import { parseSettingsHash } from "@/lib/settings/registry";
import { US_STATES } from "@/lib/signup/constants";
import type { OwnProfile } from "@/lib/users/ownProfile";
import {
  TAB_PURPOSE, aboutStatus, alertsStatus, historyStatus, signinStatus,
  type AlertFacts, type TwoStepFacts,
} from "@/lib/users/profileStatus";

type Tab = "profile" | "security" | "notifications" | "changes";
const TAB_LABELS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "profile", label: "About you" },
  { key: "security", label: "Signing in" },
  { key: "notifications", label: "Alerts" },
  { key: "changes", label: "History" },
];

type HistoryView = "settings" | "security";
const HISTORY_VIEWS: ReadonlyArray<{ key: HistoryView; label: string }> = [
  { key: "settings", label: "Settings you changed" },
  { key: "security", label: "Sign-ins and security" },
];
/** The sign-in history's anchor: it lives on History now, not on Signing in. */
const SIGN_IN_HISTORY = "security-log";

const STATE_NAMES = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));
const stateName = (code: string) => STATE_NAMES.get(code) ?? code;

/** The tab an anchor lives on: a tab's own key, or the prefix of a control's id. */
function tabFor(anchor: string | null): Tab | null {
  if (!anchor) return null;
  if (TAB_LABELS.some((tab) => tab.key === anchor)) return anchor as Tab;
  if (anchor === SIGN_IN_HISTORY) return "changes";
  if (anchor.startsWith("security-")) return "security";
  if (anchor.startsWith("notify-")) return "notifications";
  if (anchor.startsWith("profile-")) return "profile";
  return null;
}

/** A tab's panel: not mounted until first opened, then kept and only hidden while another tab is open. */
function Panel({ tab, open, opened, children }: { tab: Tab; open: Tab; opened: ReadonlySet<Tab>; children: ReactNode }) {
  if (!opened.has(tab) && open !== tab) return null;
  return (
    <div id={`my-profile-panel-${tab}`} role="tabpanel" aria-labelledby={`my-profile-tab-${tab}`} tabIndex={0} hidden={open !== tab} className="flex flex-col gap-6 outline-none">
      {children}
    </div>
  );
}

/** A status read: what came back, or that it could not be read (then the tab says what it holds). */
type Read<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed" };

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/**
 * Who this page belongs to, on the right of the header: quiet, so the title stays "My profile". Not on
 * a phone, where it squeezed the title into a column and the top bar already shows the name.
 */
function Identity({ profile }: { profile: OwnProfile }) {
  return (
    <div className="hidden items-center gap-2.5 sm:flex">
      <span className="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--primary-soft)] text-xs font-semibold text-[var(--accent-ink)]">
        {profile.avatarVersion
          // eslint-disable-next-line @next/next/no-img-element -- a session-bound redirect to a signed URL; next/image cannot optimise it
          ? <img src={`/api/app/profile/avatar?v=${encodeURIComponent(profile.avatarVersion)}`} alt="" className="size-full object-cover" />
          : <span aria-hidden="true">{initialsOf(profile.name)}</span>}
      </span>
      <span className="min-w-0 text-sm leading-[1.35]">
        <span className="block font-semibold text-[var(--ink)]">{profile.name}</span>
        <span className="block text-xs text-[var(--muted)]">{profile.roleLabel} · {profile.workspaceName}</span>
      </span>
    </div>
  );
}

export function MyProfileSettings() {
  const [tab, setTab] = useState<Tab>("profile");
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [twoStep, setTwoStep] = useState<Read<TwoStepFacts>>({ state: "loading" });
  const [alerts, setAlerts] = useState<Read<AlertFacts>>({ state: "loading" });
  const [events, setEvents] = useState<Read<SecurityEvent[] | null>>({ state: "loading" });
  const [eventReads, setEventReads] = useState(0);
  // When the log was read: "recent" wrong passwords are measured from then, not from each render.
  const [eventsReadAt, setEventsReadAt] = useState(0);
  const [historyView, setHistoryView] = useState<HistoryView>("settings");
  // "Try again" after a failed read: every status is read again, nothing is left half-loaded.
  const [reads, setReads] = useState(0);
  // About you's email "Change" opens Signing in with the email form open: a count, so each ask opens it again.
  const [emailAsks, setEmailAsks] = useState(0);
  // A tab stays mounted once opened, hidden when closed (final critique, 2026-10-27): leaving a tab
  // must not throw away spare codes on screen, unsaved About you edits or a form half filled.
  const [opened, setOpened] = useState<ReadonlySet<Tab>>(() => new Set<Tab>(["profile"]));
  // The sign-in sends a person whose role requires two-factor here with ?two_factor=required.
  const [promptTwoFactor] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("two_factor") === "required");

  useEffect(() => {
    let live = true;
    void fetch("/api/app/profile", { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok || !body?.profile) { setError(body?.error ?? "Your profile could not be loaded. Nothing has changed."); return; }
      setProfile(body.profile as OwnProfile);
    }, () => { if (live) setError("Your profile could not be loaded. Check your connection; nothing has changed."); });
    // The other two tabs' status lines are read up front, so the cards are right before either opens.
    void fetch("/api/app/profile/two-factor", { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (res.ok && body) setTwoStep({ state: "ready", value: { enabled: Boolean(body.enabled), required: Boolean(body.required) } });
      else setTwoStep(res.status === 503 ? { state: "ready", value: "unavailable" } : { state: "failed" });
    }, () => { if (live) setTwoStep({ state: "failed" }); });
    void fetch("/api/app/notification-preferences", { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      setAlerts(res.ok && body?.events ? { state: "ready", value: body as AlertFacts } : { state: "failed" });
    }, () => { if (live) setAlerts({ state: "failed" }); });
    return () => { live = false; };
  }, [reads]);
  const readAgain = () => {
    setError(null);
    setTwoStep({ state: "loading" });
    setAlerts({ state: "loading" });
    setReads((n) => n + 1);
    setEventReads((n) => n + 1);
  };

  // The sign-in history: History's list and its card's warning. Read again after Signing in changes something.
  useEffect(() => {
    let live = true;
    void fetch("/api/app/profile/security-events", { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      setEvents(res.ok && body ? { state: "ready", value: (body.events ?? null) as SecurityEvent[] | null } : { state: "failed" });
      setEventsReadAt(Date.now());
    }, () => { if (live) setEvents({ state: "failed" }); });
    return () => { live = false; };
  }, [eventReads]);
  // Read again keeping what is shown, so the History card does not flicker; a failed read shows loading.
  const readEvents = () => { setEvents((current) => (current.state === "failed" ? { state: "loading" } : current)); setEventReads((n) => n + 1); };

  useEffect(() => {
    const fromHash = () => {
      const { tab: section, anchor } = parseSettingsHash(window.location.hash);
      if (section !== "my-profile") return;
      const next = tabFor(anchor) ?? (promptTwoFactor ? "security" : null);
      if (next) { setTab(next); setOpened((current) => new Set(current).add(next)); }
      if (next === "changes") setHistoryView(anchor === SIGN_IN_HISTORY ? "security" : "settings");
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [promptTwoFactor]);

  const pick = (next: Tab, opts: { openEmail?: boolean; history?: HistoryView } = {}) => {
    setTab(next);
    setOpened((current) => (current.has(next) ? current : new Set(current).add(next)));
    if (opts.openEmail) setEmailAsks((n) => n + 1);
    if (next === "changes") setHistoryView(opts.history ?? "settings");
    // The address says which tab is open, so a reload or a shared link comes back to it. The sign-in's
    // ?two_factor=required has done its job once the reader moves on, so it is not kept.
    const search = new URLSearchParams(window.location.search);
    search.delete("two_factor");
    const where = next === "changes" && opts.history === "security" ? SIGN_IN_HISTORY : next;
    window.history.replaceState(null, "", `${window.location.pathname}${search.size ? `?${search}` : ""}#my-profile/${where}`);
  };
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: profile?.displayTimezone ?? undefined, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const tabs = useMemo<StatusTab<Tab>[]>(() => {
    const status = {
      profile: error ? TAB_PURPOSE.profile : aboutStatus(profile, stateName),
      security: twoStep.state === "failed" ? TAB_PURPOSE.security : signinStatus(twoStep.state === "ready" ? twoStep.value : null),
      notifications: alerts.state === "failed" ? TAB_PURPOSE.notifications : alertsStatus(alerts.state === "ready" ? alerts.value : null),
      changes: historyStatus(events.state === "ready" ? events.value : null, eventsReadAt, (iso) => new Date(iso).toLocaleDateString("en-US", { timeZone: profile?.displayTimezone ?? undefined, month: "short", day: "numeric" })),
    };
    return TAB_LABELS.map((item) => ({ ...item, status: status[item.key] }));
  }, [alerts, error, events, eventsReadAt, profile, twoStep]);

  return (
    <SettingsStack>
      <SettingsSectionHeader actions={profile ? <Identity profile={profile} /> : undefined} />
      <StatusTabs label="My profile" tabs={tabs} value={tab} onChange={pick} idPrefix="my-profile-tab" panelIdPrefix="my-profile-panel" />
      {/* One panel per tab, mounted on first open and then only hidden (see `opened`). */}
      <Panel tab="notifications" open={tab} opened={opened}>
        <div id="notifications"><NotificationPreferences embedded onSaved={(view) => setAlerts({ state: "ready", value: view })} /></div>
      </Panel>
      <Panel tab="changes" open={tab} opened={opened}>
        <div id="changes" className="flex flex-col gap-4">
          <ViewTabs label="History" tabs={HISTORY_VIEWS} value={historyView} onChange={(view) => pick("changes", { history: view })} idPrefix="my-profile-history" controls="my-profile-history-panel" />
          <div id="my-profile-history-panel" role="tabpanel" aria-labelledby={`my-profile-history-${historyView}`}>
            {historyView === "security"
              ? <SignInHistory events={events.state === "ready" ? events.value : undefined} failed={events.state === "failed"} onRetry={readEvents} when={when} onGoToSigningIn={() => pick("security")} />
              : <SettingsHistory mine />}
          </div>
        </div>
      </Panel>
      {(["profile", "security"] as const).map((key) => (
        <Panel key={key} tab={key} open={tab} opened={opened}>
          {error ? <Callout tone="error" title={error}><Button type="button" variant="outline" onClick={readAgain}>Try again</Button></Callout>
            : !profile ? <SettingsCard><SectionLoading rows={5} columns={2} label="Loading your profile" /></SettingsCard>
            : key === "security" ? <SecuritySettings email={profile.email} timeZone={profile.displayTimezone} promptTwoFactor={promptTwoFactor} onTwoFactor={(value) => setTwoStep({ state: "ready", value })} emailAsks={emailAsks} onChanged={readEvents} onShowHistory={() => pick("changes", { history: "security" })} />
            : <div id="profile"><OwnProfileForm initial={profile} onSaved={setProfile} onChangeEmail={() => pick("security", { openEmail: true })} /></div>}
        </Panel>
      ))}
    </SettingsStack>
  );
}
