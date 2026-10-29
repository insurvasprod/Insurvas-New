"use client";

/**
 * Settings › My profile (redesign 2026-10-27, owner pick A, canvas "Settings · My profile"): the
 * person's own page, inside Settings instead of a page of its own, with Notifications folded in.
 * Four tabs — About you, Signing in, Alerts, History (plain names, settings redesign R4; the keys
 * are unchanged so every link still works). History holds two lists: the settings you changed, and
 * your sign-ins and security changes (moved from Signing in).
 *
 * "#my-profile/<tab>" opens a tab; an anchor inside one ("#my-profile/security-password",
 * "#my-profile/notify-quiet-hours") opens the tab that holds it and revealAnchor then finds it.
 * "#my-profile/security-log" is the sign-in history, so it opens History on that list.
 * The old addresses — /app/profile and "#alerts" — land here.
 */

import { useEffect, useState } from "react";

import { Callout, SettingsCard, SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { NotificationPreferences } from "@/components/app/settings/notification-preferences";
import { SettingsHistory } from "@/components/app/settings/settings-history";
import { OwnProfileForm } from "@/components/app/own-profile-form";
import { SecurityLog, SecuritySettings } from "@/components/app/profile/security-settings";
import { SectionLoading } from "@/components/ui/page-states";
import { ViewTabs } from "@/components/ui/view-tabs";
import { parseSettingsHash } from "@/lib/settings/registry";
import type { OwnProfile } from "@/lib/users/ownProfile";

type Tab = "profile" | "security" | "notifications" | "changes";
const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "profile", label: "About you" },
  { key: "security", label: "Signing in" },
  { key: "notifications", label: "Alerts" },
  { key: "changes", label: "History" },
];

type HistoryView = "settings" | "sign-ins";
const HISTORY_VIEWS: ReadonlyArray<{ key: HistoryView; label: string }> = [
  { key: "settings", label: "Settings you changed" },
  { key: "sign-ins", label: "Sign-ins and security" },
];

/** The tab an anchor lives on: a tab's own key, or the prefix of a control's id. */
function tabFor(anchor: string | null): Tab | null {
  if (!anchor) return null;
  if (TABS.some((tab) => tab.key === anchor)) return anchor as Tab;
  if (anchor === "security-log") return "changes";
  if (anchor.startsWith("security-")) return "security";
  if (anchor.startsWith("notify-")) return "notifications";
  if (anchor.startsWith("profile-")) return "profile";
  return null;
}

export function MyProfileSettings() {
  const [tab, setTab] = useState<Tab>("profile");
  const [historyView, setHistoryView] = useState<HistoryView>("settings");
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The sign-in sends a person whose role requires two-factor here with ?two_factor=required.
  const [promptTwoFactor] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("two_factor") === "required");

  useEffect(() => {
    let live = true;
    void fetch("/api/app/profile", { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok || !body?.profile) { setError(body?.error ?? "Your profile could not be loaded. Nothing has changed; reload the page to try again."); return; }
      setProfile(body.profile as OwnProfile);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const fromHash = () => {
      const { tab: section, anchor } = parseSettingsHash(window.location.hash);
      if (section !== "my-profile") return;
      const next = tabFor(anchor) ?? (promptTwoFactor ? "security" : null);
      if (next) setTab(next);
      if (anchor === "security-log") setHistoryView("sign-ins");
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [promptTwoFactor]);

  const pick = (next: Tab) => {
    setTab(next);
    // The address says which tab is open, so a reload or a shared link comes back to it.
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#my-profile/${next}`);
  };

  return (
    <SettingsStack>
      <SettingsSectionHeader />
      <ViewTabs label="My profile" tabs={TABS} value={tab} onChange={pick} controls="my-profile-panel" />
      <div id="my-profile-panel" role="tabpanel" className="flex flex-col gap-6">
        {tab === "notifications" ? <div id="notifications"><NotificationPreferences embedded /></div>
          : tab === "changes" ? (
            <div id="changes" className="flex flex-col gap-4">
              <ViewTabs label="History" tabs={HISTORY_VIEWS} value={historyView} onChange={setHistoryView} />
              {historyView === "settings" ? <SettingsHistory mine /> : <SecurityLog timeZone={profile?.displayTimezone ?? null} />}
            </div>
          )
          : error ? <Callout tone="error" title={error} />
          : !profile ? <SettingsCard><SectionLoading rows={5} columns={2} label="Loading your profile" /></SettingsCard>
          : tab === "security" ? <SecuritySettings email={profile.email} timeZone={profile.displayTimezone} promptTwoFactor={promptTwoFactor} />
          : <OwnProfileForm initial={profile} />}
      </div>
    </SettingsStack>
  );
}
