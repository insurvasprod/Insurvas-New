"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRight, ChevronDown, PanelLeftClose, PanelLeftOpen, Search, Settings2, X,
  Building2, Calculator, CalendarDays, ClipboardList, Clock, CreditCard, FileSignature, FileText, History, KeyRound, Landmark, LayoutTemplate, LifeBuoy, ListChecks, Mail, Package, PhoneIncoming, Puzzle, RefreshCw, Repeat, Scale, Send, ShieldCheck, Sparkles, UserRound, Users, Workflow,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { SETTINGS_PANELS, type SettingsPanelContext } from "@/components/app/settings/panels";
import { LockIcon, SettingsSectionProvider } from "@/components/app/settings/primitives";
import { PageHeader } from "@/components/ui/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LoadingRows } from "@/components/ui/page-states";
import { SectionLastChanged } from "@/components/app/settings/last-changed";
import { groupSections, parseSettingsHash, searchSettings, sectionHref, visibleSections } from "@/lib/settings/registry";
import { revealAnchor } from "@/lib/settings/revealAnchor";
import type { SettingsSection } from "@/lib/settings/sections";
import type { TenantRole } from "@/lib/tenantAuth/roles";
import { cn } from "@/lib/utils";
import { titleCaseNode } from "@/components/ui/title-case";
import { titleCase } from "@/lib/format/titleCase";

/**
 * The settings shell (LA-8.1). It draws whatever lib/settings/sections.ts registers, gated and
 * grouped by lib/settings/registry.ts; it names no section of its own beyond the two rail badges.
 */
export type AgentSettingsTab = SettingsSection;

/** Sections a read-only account can still act in: Billing is how the account is reactivated. */
const READ_ONLY_EXEMPT = new Set(["billing"]);

/** One icon per Settings page, so the menu reads like the app sidebar (owner's reference, 2026-10-29). */
const SECTION_ICON: Record<string, LucideIcon> = {
  "my-profile": UserRound,
  "business-identity": Building2,
  "products": Package,
  "team-access": Users,
  "billing": CreditCard,
  "carriers": FileSignature,
  "sales-extension": Puzzle,
  "sales-underwriting": ClipboardList,
  "sales-quotation": Calculator,
  "sales-field-sets": ListChecks,
  "sales-disclosures": FileText,
  "sales-preferences": ShieldCheck,
  "sales-welcome-pack": Mail,
  "sales-ai": Sparkles,
  "sales-pipeline-sync": RefreshCw,
  "pipelines": Workflow,
  "form-templates": LayoutTemplate,
  "lead-posting": Send,
  "calendar": CalendarDays,
  "cadence": Repeat,
  "queue-sla": PhoneIncoming,
  "calling-windows": Clock,
  "accounting": Landmark,
  "retention": LifeBuoy,
  "compliance": Scale,
  "integrations": KeyRound,
  "settings-history": History,
};

/** The fold, unfold and search buttons at the menu's top. */
const RAIL_ICON_BUTTON = "inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] border-0 bg-transparent text-[var(--muted)] transition-colors hover:bg-[var(--surface-alt)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]";
/** One icon per group: the folded menu's strip. */
const GROUP_ICON: Record<string, LucideIcon> = {
  "Your account": UserRound,
  "Agency": Building2,
  "Carriers": FileSignature,
  "Sales process": ClipboardList,
  "Leads & dialing": PhoneIncoming,
  "Money & compliance": Landmark,
  "Platform": KeyRound,
};

/** The menu folded to its icons is remembered for this browser (a convenience, so storage may fail). */
const FOLD_KEY = "insurvas.settings.menuFolded";

function SectionIcon({ id }: { id: string }) {
  const Icon = SECTION_ICON[id];
  return Icon ? <Icon aria-hidden="true" className="portal-settings-item-icon size-4 shrink-0" /> : null;
}

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
  routeSection,
  children,
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
  /**
   * A section with its own route (Accounting, Retention, Compliance): it is the active one, and
   * `children` (the module's own board) is the content. Picking an in-page section from here opens it
   * on /app/settings (settings-shell plan, Task 6).
   */
  routeSection?: string;
  children?: ReactNode;
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
  const router = useRouter();
  const [activeId, setActiveId] = useState(firstAvailable);
  const [anchor, setAnchor] = useState<string | null>(null);
  // Menu items are `settings-nav-<id>`, not the section's own name: with "#products" the browser
  // would otherwise scroll the menu to the item and hide its group heading.
  // The server cannot see "#products", so it would draw the default section and then jump to the
  // linked one. Until the address has been read, the frame shows its loading look instead
  // (2026-10-29: Business Identity flashed before Products). A routed section needs no hash.
  const [hashRead, setHashRead] = useState(Boolean(routeSection));
  // The content's own scroll (the page does not scroll on a desktop): reset when a section opens.
  const contentRef = useRef<HTMLDivElement>(null);
  // The page header's action slot: a section's Save / Add buttons are drawn there, on the title's line.
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const active = useMemo(
    () => (routeSection ? visible.find((tab) => tab.id === routeSection) : undefined)
      ?? inPage.find((tab) => tab.id === activeId) ?? inPage.find((tab) => tab.id === firstAvailable),
    [activeId, firstAvailable, inPage, routeSection, visible]
  );

  // The six fixed groups, in order; a group with nothing visible in it is not drawn at all.
  const grouped = useMemo(() => groupSections(visible), [visible]);
  // One group open at a time (owner, 29 Oct: the menu scrolled, "think of everything"): the open
  // page's group, or the one last clicked. Seven group rows and the largest group's pages fit a laptop
  // screen, where all 27 pages at once never did. A closed group shows how many pages it holds.
  const groupOf = useCallback((id: string | undefined) => grouped.find((entry) => entry.items.some((item) => item.id === id))?.group ?? null, [grouped]);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // Folded, each group is one icon; its pages open beside it.
  const [flyout, setFlyout] = useState<string | null>(null);

  // The menu folds to an icon strip on a desktop (owner, 29 Oct: "collapsible to close on the left"),
  // giving the page its width. Below lg the menu stacks above the page, so it never folds there.
  const [folded, setFolded] = useState(false);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from this browser's storage
    try { setFolded(window.localStorage.getItem(FOLD_KEY) === "1"); } catch { /* storage blocked: start open */ }
    return () => query.removeEventListener("change", sync);
  }, []);
  const fold = (next: boolean) => {
    setFolded(next);
    try { window.localStorage.setItem(FOLD_KEY, next ? "1" : "0"); } catch { /* not remembered */ }
  };
  const iconsOnly = folded && desktop;

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
        // "#carriers" is also the menu item's id, so the browser jumps to it and the page header
        // (title, breadcrumb) leaves the screen. A section opens at the top; "#tab/anchor" still
        // scrolls to its setting (revealAnchor below).
        if (!target) requestAnimationFrame(() => { window.scrollTo({ top: 0 }); contentRef.current?.scrollTo({ top: 0 }); });
      }
      setHashRead(true);
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [inPage]);

  // The open section's menu item in view inside the menu (not the page), so a section low in the
  // list, like Accounting on its own route, is visibly the current one.
  // The item's group heading stays in view with it (owner, 2026-10-29: "Carriers" was cut off above
  // Contracting). Re-run after the browser's own jump to the #hash, which pins the item to the top.
  useEffect(() => {
    const place = () => {
      const nav = document.querySelector<HTMLElement>("[data-settings-rail] .portal-settings-nav");
      const item = nav?.querySelector<HTMLElement>("[aria-current=page]");
      if (!nav || !item) return;
      const group = item.closest<HTMLElement>(".portal-settings-nav-group") ?? item;
      const groupTop = group.offsetTop - nav.offsetTop;
      const itemBottom = item.offsetTop - nav.offsetTop + item.offsetHeight;
      const fits = groupTop >= nav.scrollTop && itemBottom <= nav.scrollTop + nav.clientHeight;
      if (!fits) nav.scrollTop = itemBottom - groupTop <= nav.clientHeight ? Math.max(0, groupTop - 4) : itemBottom - nav.clientHeight / 2;
    };
    place();
    const timers = [120, 450].map((ms) => window.setTimeout(place, ms));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [active?.id, hashRead]);

  // The open page's group is the open one whenever the page changes (a link, search or the hash).
  const activeGroup = groupOf(routeSection ?? active?.id);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the page that is open
  useEffect(() => { if (activeGroup) setOpenGroup(activeGroup); }, [activeGroup]);

  // After the tab has rendered (its panel may still be loading), reveal the setting search named.
  useEffect(() => (anchor ? revealAnchor(anchor) : undefined), [anchor, activeId]);

  function selectTab(id: string) {
    if (!inPage.some((item) => item.id === id)) return;
    // On a section's own route the in-page panels are not here: open the section on /app/settings.
    if (routeSection) { router.push(`/app/settings#${id}`); return; }
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

  /** One page in the menu, or in a folded group's flyout. */
  function renderItem(tab: AgentSettingsTab): ReactNode {
  if (tab.route) {
    // A section with its own route: a link to it, drawn in the same frame there
    // (components/app/settings/settings-route-frame.tsx), so it is one more menu item.
    const here = routeSection === tab.id;
    return (
      <Link
        key={tab.id}
        id={`settings-nav-${tab.id}`}
        href={sectionHref(tab)}
        aria-current={here ? "page" : undefined}
        onClick={() => setFlyout(null)}
        className={cn(
          "portal-settings-subsection flex min-h-[30px] w-full shrink-0 items-center gap-2 rounded-[8px] px-2.5 py-1 text-left text-label font-normal no-underline transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
          here ? "bg-[var(--primary-soft)] font-semibold text-[var(--ink)]" : "bg-transparent text-[var(--body)] hover:bg-[var(--surface-alt)] hover:text-[var(--ink)]"
        )}
      >
        <SectionIcon id={tab.id} />
        <span className="min-w-0 flex-grow">{titleCaseNode(tab.label)}</span>
      </Link>
    );
  }
  const isActive = hashRead && active?.id === tab.id;
  const badge = badgeFor(tab.id);
  return (
    <button
      key={tab.id}
      id={`settings-nav-${tab.id}`}
      type="button"
      aria-current={isActive ? "page" : undefined}
      aria-controls={`settings-panel-${tab.id}`}
      disabled={Boolean(tab.disabled)}
      onClick={() => { selectTab(tab.id); setFlyout(null); }}
      className={cn(
        "portal-settings-subsection flex min-h-[30px] w-full shrink-0 items-center gap-2 rounded-[8px] border-0 px-2.5 py-1 text-left text-label font-normal transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-50",
        isActive
          ? "bg-[var(--primary-soft)] font-semibold text-[var(--ink)]"
          : tab.managed
            ? "bg-transparent text-[var(--muted)] hover:bg-[var(--surface-alt)]"
            : "bg-transparent text-[var(--body)] hover:bg-[var(--surface-alt)] hover:text-[var(--ink)]"
      )}
    >
      <SectionIcon id={tab.id} />
      <span className="min-w-0 flex-grow">{titleCaseNode(tab.label)}</span>
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

  }

  // UX-4: the component for each section comes from the registry, keyed by the section's id.
  function renderActiveContent(): ReactNode {
    if (!active) return null;
    if (routeSection) return children;
    // The preview's stand-in, or undefined to render the real panel (its API answered by the preview).
    if (renderPanel) {
      const sample = renderPanel(active.id);
      if (sample !== undefined) return sample;
    }
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
    // Manager review 29 Oct (02:48): the title, the menu and the tabs stay put; only the content
    // scrolls, inside. On a desktop the frame is exactly the window under the top bar (the shell pads
    // 24px above and 32px below), so the page has no scroll of its own.
    <div className="flex min-w-0 flex-col gap-6 lg:h-[calc(100dvh-var(--top-bar-h)-3.5rem)] lg:min-h-0" data-settings-frame="">
      {active && !guiding && !hashRead && (
        <div aria-hidden="true" className="flex flex-col gap-2">
          <div className="h-3.5 w-36 m-skel rounded-full" />
          <div className="h-7 w-52 m-skel rounded-md" />
          <div className="h-3.5 w-96 max-w-full m-skel rounded-full" />
        </div>
      )}
      {active && !guiding && hashRead && (
        <PageHeader
          visible
          title={titleCase(active.label)}
          description={active.short ?? active.description}
          infoDescription
          breadcrumbs={[{ label: "Settings", href: "/app/settings" }, { label: titleCase(active.label) }]}
          // Who last changed something here (LA-8.8), under the purpose line; owners only, like the log.
          meta={role === "owner" ? <SectionLastChanged key={active.id} sectionKey={active.id} /> : undefined}
          actions={<div ref={setActionsSlot} data-settings-actions="" className="flex flex-wrap items-center gap-2.5 empty:hidden" />}
        />
      )}
      {/* In a Get set up step the menu is hidden, so the grid must drop its column too: with the
          column kept, the whole page sat in the 224px menu track (owner, 2026-10-29). */}
      <div className={cn("grid min-w-0 grid-cols-1 items-start gap-6 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)] lg:items-stretch", !guiding && (iconsOnly ? "lg:grid-cols-[52px_minmax(0,1fr)]" : "lg:grid-cols-[224px_minmax(0,1fr)] 2xl:grid-cols-[256px_minmax(0,1fr)]"), "lg:transition-[grid-template-columns] lg:duration-200")}>
      {/* The menu is a list, not a card (no surface, border or blur). Sticky under the top bar and
          only as tall as its list, capped at the window less the top bar, this header and the page's
          padding (10.5rem), so on its own it never makes the page scroll; past that the list scrolls. */}
      <div data-settings-rail="" data-folded={iconsOnly ? "" : undefined} className={cn("box-border flex w-full min-h-0 shrink-0 flex-col lg:h-full", guiding && "hidden")}>
        {iconsOnly ? (
          // Folded: open again, and search (which opens the menu with the box ready).
          <div className="flex shrink-0 flex-col items-center gap-1 pb-2">
            <button type="button" onClick={() => fold(false)} aria-label="Show the settings menu" title="Show menu" className={RAIL_ICON_BUTTON}>
              <PanelLeftOpen aria-hidden="true" className="size-4" />
            </button>
            <button type="button" onClick={() => { fold(false); requestAnimationFrame(() => searchRef.current?.focus()); }} aria-label="Search settings" title="Search settings" className={RAIL_ICON_BUTTON}>
              <Search aria-hidden="true" className="size-4" />
            </button>
            {/* The controls above, the groups below. */}
            <span aria-hidden="true" className="mt-1 h-px w-6 bg-[var(--border)]" />
          </div>
        ) : (
        <div className="flex shrink-0 items-center gap-1.5 pb-2">
          <label className="relative block min-w-0 flex-1">
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
          <button type="button" onClick={() => fold(true)} aria-label="Hide the settings menu" title="Hide menu" className={cn(RAIL_ICON_BUTTON, "hidden lg:inline-flex")}>
            <PanelLeftClose aria-hidden="true" className="size-4" />
          </button>
        </div>
        )}
        {searching && !iconsOnly ? (
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
        className="portal-settings-nav relative box-border flex min-h-0 w-full flex-col gap-0 overflow-x-hidden overflow-y-auto overscroll-contain pb-1"
      >
        {/* Keyed by position, not by the group's name (a duplicate key once aborted hydration). */}
        {grouped.map(({ group, items }, index) => {
          const groupId = `settings-group-${index}`;
          const here = items.some((item) => item.id === (routeSection ?? active?.id));
          const warn = items.some((item) => badgeFor(item.id)?.warn);
          const Icon = GROUP_ICON[group] ?? Settings2;
          const name = titleCase(group);
          if (iconsOnly) {
            // Folded: the group's icon; its pages open in a list beside the strip.
            return (
              <Popover key={`${group ?? "ungrouped"}-${index}`} open={flyout === group} onOpenChange={(open) => setFlyout(open ? group : null)}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${name}${warn ? ", needs attention" : ""}`}
                    title={name}
                    className={cn(RAIL_ICON_BUTTON, "relative mx-auto mb-1", (here || flyout === group) && "bg-[var(--primary-soft)] text-[var(--accent-ink)] hover:bg-[var(--primary-soft)] hover:text-[var(--accent-ink)]")}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    {warn && <span aria-hidden="true" className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-[var(--warning)]" />}
                  </button>
                </PopoverTrigger>
                <PopoverContent side="right" align="start" sideOffset={10} className="w-64 p-1.5">
                  <p className="m-0 px-2.5 pt-1.5 pb-1 text-sm font-semibold text-[var(--ink)]">{name}</p>
                  {items.map(renderItem)}
                </PopoverContent>
              </Popover>
            );
          }
          const open = openGroup === group;
          return (
            <section key={`${group ?? "ungrouped"}-${index}`} className="portal-settings-nav-group" aria-labelledby={`${groupId}-label`}>
              <h2 className="m-0">
                <button
                  type="button"
                  id={`${groupId}-label`}
                  aria-expanded={open}
                  aria-controls={groupId}
                  onClick={() => setOpenGroup(open ? null : group)}
                  className="portal-settings-group-label flex w-full items-center gap-2 rounded-[8px] border-0 bg-transparent text-left transition-colors hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                >
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {!open && warn && <span aria-label="needs attention" className="size-1.5 shrink-0 rounded-full bg-[var(--warning)]" />}
                  {!open && <span className="shrink-0 text-xs font-medium tabular-nums text-[var(--muted)]">{items.length}</span>}
                  <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-[var(--muted)] transition-transform", open && "rotate-180")} />
                </button>
              </h2>
              {open && (
                <div id={groupId} className="portal-settings-nav-subsections">
                  {items.map(renderItem)}
                </div>
              )}
            </section>
          );
        })}
      </nav>
        )}
      </div>
      <div ref={contentRef} data-settings-scroll="" className="min-w-0 flex-1 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1.5">
        {active && (
          <section
            id={`settings-panel-${active.id}`}
            // A size container (2026-10-29): beside the app sidebar and this menu, a 1280px screen
            // leaves the content ~650px, so its grids go side by side on its own width, not the
            // screen's (lg: was 1024px of screen, which squeezed columns to 18-110px).
            className="portal-settings-panel @container min-w-0"
            role="region"
            aria-label={titleCase(active.label)}
            tabIndex={-1}
            key={active.id}
          >
            <SettingsSectionProvider value={{ title: active.label, description: active.short ?? active.description, id: active.id, history: role === "owner", framed: !guiding, actionsSlot }}>
              {/* A routed section's board handles its own read-only state. */}
              {readOnly && !routeSection && !READ_ONLY_EXEMPT.has(active.id) ? (
                <>
                  <p role="status" className="m-0 mb-4 rounded-md bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">
                    Your account is read-only, so settings can be read but not changed. Reactivate the subscription in Billing to change them.
                  </p>
                  <fieldset disabled aria-disabled="true" className="m-0 min-w-0 border-0 p-0">{renderActiveContent()}</fieldset>
                </>
              ) : hashRead ? renderActiveContent() : (
                <div role="status" aria-live="polite" className="overflow-hidden rounded-[12px] border border-[var(--border)]">
                  <span className="sr-only">Loading</span>
                  <LoadingRows rows={6} columns={3} />
                </div>
              )}
            </SettingsSectionProvider>
          </section>
        )}
      </div>
      </div>
    </div>
  );
}
