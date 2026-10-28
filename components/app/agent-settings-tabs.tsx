"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, ChevronDown, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { SETTINGS_PANELS, type SettingsPanelContext } from "@/components/app/settings/panels";
import { LockIcon, SettingsSectionProvider } from "@/components/app/settings/primitives";
import { PageHeader } from "@/components/ui/page-header";
import { groupSections, parseSettingsHash, searchSettings, sectionHref, visibleSections } from "@/lib/settings/registry";
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
  renderPanel,
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
  /** The /design/settings preview only: sample content in place of the live panels, which need a session. */
  renderPanel?: (id: string) => ReactNode;
}) {
  // In a Get set up step (?guide=…) the screen shows only that task: the settings menu steps aside,
  // and "Back to setup" on the guide bar is the way out (owner, 2026-10-28).
  const guiding = useSearchParams().has("guide");
  // Sections the plan has no use for leave the list before anything else sees it.
  const tabs = useMemo(() => (hidden?.length ? registered.filter((tab) => !hidden.includes(tab.id)) : registered), [registered, hidden]);
  // Absent, not greyed out: a section this person may not open is not in the rail at all.
  const visible = useMemo(() => visibleSections(tabs, granted, role), [tabs, granted, role]);
  // Only in-page sections are tabs; a section with a route is a link to its own module's screen.
  const inPage = useMemo(() => visible.filter((tab) => !tab.route), [visible]);
  const firstAvailable = inPage.find((tab) => tab.id === initialTab)?.id ?? inPage[0]?.id ?? initialTab;
  const [activeId, setActiveId] = useState(firstAvailable);
  const [anchor, setAnchor] = useState<string | null>(null);
  // The page header's action slot: a section's Save / Add buttons are drawn there, on the title's line.
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const active = useMemo(
    () => inPage.find((tab) => tab.id === activeId) ?? inPage.find((tab) => tab.id === firstAvailable),
    [activeId, firstAvailable, inPage]
  );

  // The six fixed groups, in order; a group with nothing visible in it is not drawn at all.
  const grouped = useMemo(() => groupSections(visible), [visible]);
  // A new Settings visit starts with every group open. Users may collapse groups independently.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  const revealGroupForSection = useCallback((id: string) => {
    const parent = grouped.find((entry) => entry.items.some((item) => item.id === id));
    if (!parent) return;
    setCollapsedGroups((current) => {
      if (!current.has(parent.group)) return current;
      const next = new Set(current);
      next.delete(parent.group);
      return next;
    });
  }, [grouped]);

  function toggleGroup(group: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  // Search only the settings this person can open. Results may point to a section or to one of its
  // controls; the existing hash/reveal path handles in-page destinations.
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const searching = query.trim().length >= 2;
  const hits = useMemo(() => (searching ? searchSettings(tabs, granted, role, query, 12) : []), [searching, tabs, granted, role, query]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    const first = resultsRef.current?.querySelector<HTMLElement>("[data-hit]");
    if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
    } else if (event.key === "ArrowDown" && first) {
      event.preventDefault();
      first.focus();
    } else if (event.key === "Enter" && first) {
      event.preventDefault();
      first.click();
    }
  }

  function onResultsKey(event: KeyboardEvent<HTMLDivElement>) {
    const rows = [...(resultsRef.current?.querySelectorAll<HTMLElement>("[data-hit]") ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? at + 1 : at - 1;
      if (next < 0) searchRef.current?.focus();
      else rows[Math.min(next, rows.length - 1)]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      searchRef.current?.focus();
    }
  }

  useEffect(() => {
    const syncFromHash = () => {
      // "#tab" selects a tab; "#tab/anchor" (from search) also brings one setting into view.
      const { tab, anchor: target } = parseSettingsHash(window.location.hash.slice(1));
      if (tab && inPage.some((item) => item.id === tab)) {
        // Hash deep-links are external browser state that should select the matching tab.
        setActiveId(tab);
        setAnchor(target);
        revealGroupForSection(tab);
        // "#carriers" is also the menu item's id, so the browser jumps to it and the page header
        // (title, breadcrumb) leaves the screen. A section opens at the top; "#tab/anchor" still
        // scrolls to its setting (revealAnchor below).
        if (!target) requestAnimationFrame(() => window.scrollTo({ top: 0 }));
      }
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [inPage, revealGroupForSection]);

  // After the tab has rendered (its panel may still be loading), reveal the setting search named.
  useEffect(() => (anchor ? revealAnchor(anchor) : undefined), [anchor, activeId]);

  function selectTab(id: string) {
    if (!inPage.some((item) => item.id === id)) return;
    setActiveId(id);
    setAnchor(null);
    revealGroupForSection(id);
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
    if (renderPanel) return renderPanel(active.id);
    const panel = SETTINGS_PANELS[active.id];
    return panel ? panel({ team, workspace, granted }) : <p className="portal-settings-empty">This settings area is not available for the current account.</p>;
  }

  /*
   * One layout for every Settings page (settings-shell plan, 2026-10-28; manager review 30:24–31:05:
   * "put settings, the title of the page here and the description… so the cards start from the same
   * side"). The header row: breadcrumb, the open section's name top-left, its purpose, its actions on
   * the right. Under it, two columns that start on one line: the settings menu, a plain list only as
   * tall as itself, and the section's cards.
   */
  return (
    <div className="flex min-w-0 flex-col gap-6" data-settings-frame="">
      {active && !guiding && (
        <PageHeader
          visible
          title={active.label}
          description={active.short ?? active.description}
          breadcrumbs={[{ label: "Settings", href: "/app/settings" }, { label: active.label }]}
          actions={<div ref={setActionsSlot} data-settings-actions="" className="flex flex-wrap items-center gap-2.5 empty:hidden" />}
        />
      )}
      <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[232px_minmax(0,1fr)]">
      {/* The menu is a list, not a card (no surface, border or blur). Sticky under the top bar and
          only as tall as its list, capped at the window less the top bar, this header and the page's
          padding (10.5rem), so on its own it never makes the page scroll; past that the list scrolls. */}
      <div data-settings-rail="" className={cn("box-border flex w-full min-h-0 shrink-0 flex-col lg:sticky lg:top-[calc(var(--top-bar-h)+1.5rem)] lg:max-h-[calc(100dvh-var(--top-bar-h)-10.5rem)]", guiding && "hidden")}>
        <div className="shrink-0 pb-2">
          <label className="relative block">
            <span className="sr-only">Search settings</span>
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--muted)]" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Search settings"
              autoComplete="off"
              spellCheck={false}
              aria-controls="settings-search-results"
              className="h-9 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] pr-9 pl-9 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--muted)] focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label="Clear the search" className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-[6px] border-0 bg-transparent text-[var(--muted)] hover:bg-[var(--surface-alt)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]">
                <X aria-hidden="true" className="size-3.5" />
              </button>
            ) : (
              <kbd aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded-[4px] border border-[var(--border)] px-1.5 font-sans text-xs leading-[1.4] text-[var(--muted)] lg:block">/</kbd>
            )}
          </label>
        </div>
        {searching ? (
          <div id="settings-search-results" ref={resultsRef} onKeyDown={onResultsKey} className="flex max-h-[60dvh] min-h-0 flex-col overflow-y-auto overscroll-contain pb-2.5 lg:max-h-none">
            <p role="status" className="m-0 px-2.5 pt-2.5 pb-1.5 text-xs leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">
              {hits.length ? `${hits.length} ${hits.length === 1 ? "match" : "matches"}` : "No matches"}
            </p>
            {hits.length ? hits.map((hit) => (
              <Link key={hit.href} data-hit href={hit.href} onClick={() => setQuery("")} className="mb-0.5 flex min-h-[44px] w-full shrink-0 items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left no-underline transition-colors hover:bg-[var(--surface-alt)] focus-visible:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] lg:min-h-[40px]">
                <span className="min-w-0 flex-grow">
                  <span className="block text-sm leading-[1.4] text-[var(--ink)]">{hit.title.replace(/^Settings › [^›]+ › /, "")}</span>
                  <span className="block truncate text-xs leading-[1.4] text-[var(--muted)]">{hit.meta}</span>
                </span>
                {hit.href.startsWith("/app/") && !hit.href.startsWith("/app/settings#") && <ArrowUpRight aria-label="Opens its own screen" className="size-3.5 shrink-0 text-[var(--muted)]" />}
              </Link>
            )) : (
              <p className="m-0 px-2.5 pb-2 text-sm leading-[1.5] text-[var(--body)]">Nothing in Settings matches “{query.trim()}”. Try another word, like “invoice” or “alerts”.</p>
            )}
          </div>
        ) : (
      <nav
        aria-label="Settings navigation"
        className="portal-settings-nav box-border flex min-h-0 w-full flex-col gap-0 overflow-y-auto overscroll-contain pb-2.5"
      >
        {/* Keyed by position, not by the group's name. A run is defined by where it sits in the
            caller's order, and the same name can legitimately open a second run — so the name is not
            an identity. Keying on it made React see duplicates, warn that children "may be duplicated
            and/or omitted", and then throw NotFoundError from insertBefore, which aborted hydration
            for the whole page: the settings rail stopped responding to clicks entirely. */}
        {grouped.map(({ group, items }, index) => {
          const groupId = `settings-group-${index}`;
          const groupOpen = !collapsedGroups.has(group);
          return (
            <section key={`${group}-${index}`} className="portal-settings-nav-group">
              <button
                type="button"
                className="portal-settings-group-toggle"
                aria-expanded={groupOpen}
                aria-controls={groupId}
                onClick={() => toggleGroup(group)}
              >
                <span>{group}</span>
                <ChevronDown aria-hidden="true" className={cn("portal-settings-group-chevron", groupOpen && "is-open")} />
              </button>
              <div id={groupId} className="portal-settings-nav-subsections" hidden={!groupOpen}>
                {items.map((tab) => {
                  if (tab.route) {
                    // Another module's own screen: opened there, never copied here. It carries a trail
                    // back to Settings (components/app/settings/settings-trail.tsx).
                    return (
                      <Link
                        key={tab.id}
                        href={sectionHref(tab)}
                        onClick={() => revealGroupForSection(tab.id)}
                        className={cn(
                          "portal-settings-subsection mb-0.5 flex min-h-[34px] w-full shrink-0 items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-sm leading-[1.5] tracking-[-0.02em] no-underline transition-colors",
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
                      aria-current={isActive ? "page" : undefined}
                      aria-controls={`settings-panel-${tab.id}`}
                      disabled={Boolean(tab.disabled)}
                      onClick={() => selectTab(tab.id)}
                      className={cn(
                        "portal-settings-subsection mb-0.5 flex min-h-[34px] w-full shrink-0 items-center gap-2 rounded-[8px] border-0 px-2.5 py-1.5 text-left text-sm leading-[1.5] tracking-[-0.02em] transition-colors",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-50",
                        isActive
                          ? "bg-[var(--primary-soft)] font-semibold text-[var(--ink)]"
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
            </section>
          );
        })}
      </nav>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {active && (
          <section
            id={`settings-panel-${active.id}`}
            className="portal-settings-panel min-w-0"
            role="region"
            aria-labelledby={active.id}
            tabIndex={-1}
            key={active.id}
          >
            <SettingsSectionProvider value={{ title: active.label, description: active.short ?? active.description, id: active.id, history: role === "owner", framed: !guiding, actionsSlot }}>
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
    </div>
  );
}
