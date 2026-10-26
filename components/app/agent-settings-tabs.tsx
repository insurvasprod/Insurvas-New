"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SETTINGS_PANELS, type SettingsPanelContext } from "@/components/app/settings/panels";
import { LockIcon, SettingsSectionProvider } from "@/components/app/settings/primitives";
import { groupSections, parseSettingsHash, sectionHref, visibleSections } from "@/lib/settings/registry";
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

  // The six fixed groups, in order; a group with nothing visible in it is not drawn at all.
  const grouped = useMemo(() => groupSections(visible), [visible]);

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
    return panel ? panel({ team, workspace }) : <p className="portal-settings-empty">This settings area is not available for the current account.</p>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start">
      {/* Max height: the window less the top bar, the page title above the rail (84px) and the page's
          bottom padding (32px), so the rail ends at the window's bottom and never makes the page scroll. */}
      <nav
        aria-label="Settings sections"
        role="tablist"
        aria-orientation="vertical"
        className="box-border flex w-full shrink-0 gap-1 overflow-x-auto rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-2 pt-1 pb-2.5 lg:sticky lg:top-[calc(var(--top-bar-h)+1rem)] lg:max-h-[calc(100dvh-var(--top-bar-h)-116px)] lg:w-[262px] lg:flex-col lg:gap-0 lg:overflow-x-visible lg:overflow-y-auto lg:overscroll-contain"
      >
        {/* Keyed by position, not by the group's name. A run is defined by where it sits in the
            caller's order, and the same name can legitimately open a second run — so the name is not
            an identity. Keying on it made React see duplicates, warn that children "may be duplicated
            and/or omitted", and then throw NotFoundError from insertBefore, which aborted hydration
            for the whole page: the settings rail stopped responding to clicks entirely. */}
        {grouped.map(({ group, items }, index) => (
          <div key={`${group ?? "ungrouped"}-${index}`} role="presentation" className="flex shrink-0 gap-1 lg:flex-col lg:gap-0">
            {group && (
              <p className="hidden px-2.5 pt-3.5 pb-1.5 text-xs leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)] lg:block">
                {group}
              </p>
            )}
            {items.map((tab) => {
              if (tab.route) {
                // Another module's own screen: opened there, never copied here. It carries a trail
                // back to Settings (components/app/settings/settings-trail.tsx).
                return (
                  <Link
                    key={tab.id}
                    href={sectionHref(tab)}
                    className={cn(
                      "mb-0.5 flex min-h-[34px] w-full shrink-0 items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-sm leading-[1.5] tracking-[-0.02em] whitespace-nowrap no-underline transition-colors lg:whitespace-normal",
                      "bg-transparent text-[var(--body)] hover:bg-[var(--surface-alt)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                    )}
                  >
                    <span className="min-w-0 flex-grow">{tab.label}</span>
                    <ArrowUpRight aria-label="Opens its own screen" className="ml-auto size-3.5 shrink-0 text-[var(--muted)]" />
                  </Link>
                );
              }
              const isActive = active?.id === tab.id;
              const badge = badgeFor(tab.id);
              return (
                <button
                  key={tab.id}
                  id={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`settings-panel-${tab.id}`}
                  disabled={Boolean(tab.disabled)}
                  onClick={() => selectTab(tab.id)}
                  className={cn(
                    "mb-0.5 flex min-h-[34px] w-full shrink-0 items-center gap-2 rounded-[8px] border-0 px-2.5 py-1.5 text-left text-sm leading-[1.5] tracking-[-0.02em] whitespace-nowrap transition-colors lg:whitespace-normal",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-50",
                    isActive
                      ? "bg-[var(--brand-50)] font-semibold text-[var(--accent-ink)] shadow-[inset_2px_0_0_var(--primary)]"
                      : tab.managed
                        ? "bg-transparent text-[var(--muted)] hover:bg-[var(--surface-alt)]"
                        : "bg-transparent text-[var(--body)] hover:bg-[var(--surface-alt)] hover:text-[var(--ink)]"
                  )}
                >
                  <span className="min-w-0 flex-grow">{tab.label}</span>
                  {badge && (
                    <span
                      className={cn(
                        "ml-auto shrink-0 text-xs leading-[1.5] font-semibold tracking-[-0.01em] tabular-nums",
                        badge.warn ? "text-[var(--warning-ink)]" : "text-[var(--muted)]"
                      )}
                    >
                      {badge.text}
                    </span>
                  )}
                  {tab.managed && (
                    <span className="ml-auto inline-flex shrink-0 text-[var(--muted)]" aria-label="Managed elsewhere">
                      <LockIcon />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        {active && (
          <section
            id={`settings-panel-${active.id}`}
            className="portal-settings-panel min-w-0"
            role="tabpanel"
            aria-labelledby={active.id}
            tabIndex={-1}
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
    </div>
  );
}
