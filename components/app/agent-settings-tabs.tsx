"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SETTINGS_PANELS, type SettingsPanelContext } from "@/components/app/settings/panels";
import { LockIcon, SettingsSectionProvider } from "@/components/app/settings/primitives";
import { parseSettingsHash, visibleSections } from "@/lib/settings/registry";
import { SettingsPageFrame } from "@/components/app/settings/settings-page-frame";
import { revealAnchor } from "@/lib/settings/revealAnchor";
import type { SettingsSection } from "@/lib/settings/sections";
import type { TenantRole } from "@/lib/tenantAuth/roles";
import { cn } from "@/lib/utils";

/**
 * The settings shell (LA-8.1). It draws whatever lib/settings/sections.ts registers, gated and
 * grouped by lib/settings/registry.ts; it names no section of its own beyond the two rail badges.
 */
export type AgentSettingsTab = SettingsSection;

/** Sections a read-only account can still act in: Billing is how the account is reactivated. */
const READ_ONLY_EXEMPT = new Set(["billing"]);

export function AgentSettingsTabs({
  tabs: registered,
  team,
  workspace,
  granted,
  role,
  initialTab = "business-identity",
  readOnly = false,
  hidden,
}: {
  tabs: AgentSettingsTab[];
  /** Owner-only panel context; null for everyone else, whose sections do not need it. */
  team: SettingsPanelContext["team"];
  workspace: SettingsPanelContext["workspace"];
  /** The features this tenant can reach right now, and this person's role: the menu's gate. */
  granted: readonly string[];
  role: TenantRole;
  initialTab?: string;
  /**
   * A read-only (suspended) account (LA-4.10): every section stays readable, and every form control
   * in it is disabled through one <fieldset disabled>, so no panel can forget to. The server refuses
   * the writes anyway; this says so before anyone tries. Billing stays usable, since that is where
   * the account is put right.
   */
  readOnly?: boolean;
  /** Sections the plan has no use for (LA-8.6: Team & access on a one-seat plan) — absent, like the rest. */
  hidden?: readonly string[];
}) {
  // Sections the plan has no use for leave the list before anything else sees it.
  const tabs = useMemo(() => (hidden?.length ? registered.filter((tab) => !hidden.includes(tab.id)) : registered), [registered, hidden]);
  // Absent, not greyed out: a section this person may not open is not in the rail at all.
  const visible = useMemo(() => visibleSections(tabs, granted, role), [tabs, granted, role]);
  // Only in-page sections are tabs; a section with a route is a link to its own module's screen.
  const inPage = useMemo(() => visible.filter((tab) => !tab.route), [visible]);
  const firstAvailable = inPage.find((tab) => tab.id === initialTab)?.id ?? inPage[0]?.id ?? initialTab;
  const [activeId, setActiveId] = useState(firstAvailable);
  const [anchor, setAnchor] = useState<string | null>(null);
  const active = useMemo(
    () => inPage.find((tab) => tab.id === activeId) ?? inPage.find((tab) => tab.id === firstAvailable),
    [activeId, firstAvailable, inPage]
  );

  useEffect(() => {
    const syncFromHash = () => {
      // "#tab" selects a tab; "#tab/anchor" (from search) also brings one setting into view.
      const { tab, anchor: target } = parseSettingsHash(window.location.hash.slice(1));
      if (tab && inPage.some((item) => item.id === tab)) {
        // Hash deep-links are external browser state that should select the matching tab.
        setActiveId(tab);
        setAnchor(target);
      }
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [inPage]);

  // After the tab has rendered (its panel may still be loading), reveal the setting search named.
  useEffect(() => (anchor ? revealAnchor(anchor) : undefined), [anchor, activeId]);

  function selectTab(id: string) {
    if (!inPage.some((item) => item.id === id)) return;
    setActiveId(id);
    setAnchor(null);
    window.history.replaceState(null, "", `#${id}`);
    // The rail scrolls on its own (2026-10-15); a section picked low in it opens at the top of the page.
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /**
   * The few rail rows that carry a figure. Only two do on the board, and both are things an owner
   * acts on from the rail: licences about to lapse, and a team with no seat left to invite into.
   * A zero is not drawn — a badge that always says something stops being read.
   */
  function badgeFor(id: string): { text: string; warn: boolean } | null {
    if (id === "carriers" && workspace && workspace.licencesExpiringSoon > 0) {
      return { text: `${workspace.licencesExpiringSoon} expiring`, warn: true };
    }
    if (id === "team-access" && team && team.seats.max !== null) {
      return { text: `${team.seats.used} / ${team.seats.max}`, warn: team.seats.used >= team.seats.max };
    }
    return null;
  }

  // UX-4: the component for each section comes from the registry, keyed by the section's id.
  function renderActiveContent(): ReactNode {
    if (!active) return null;
    const panel = SETTINGS_PANELS[active.id];
    return panel ? panel({ team, workspace, granted }) : <p className="portal-settings-empty">This settings area is not available for the current account.</p>;
  }

  return (
    <SettingsPageFrame sections={visible} activeId={active?.id} onSelect={selectTab}>
      <div className="min-w-0 flex-1">
        {active && (
          <section
            id={`settings-panel-${active.id}`}
            className="portal-settings-panel min-w-0"
            key={active.id}
          >
            <SettingsSectionProvider value={{ title: active.label, description: active.short ?? active.description, id: active.id, history: role === "owner" }}>
              {readOnly && !READ_ONLY_EXEMPT.has(active.id) ? (
                <>
                  <p role="status" className="m-0 mb-4 rounded-md bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">
                    Your account is read-only, so settings can be read but not changed. Reactivate the subscription in Billing to change them.
                  </p>
                  <fieldset disabled aria-disabled="true" className="m-0 min-w-0 border-0 p-0">{renderActiveContent()}</fieldset>
                </>
              ) : renderActiveContent()}
            </SettingsSectionProvider>
          </section>
        )}
      </div>
    </SettingsPageFrame>
  );
}
