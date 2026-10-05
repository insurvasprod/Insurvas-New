"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft, Bell, BellOff, Check, ChevronDown, KeyboardIcon, LogOut, Search, SlidersHorizontal,
  TriangleAlert, UserRound,
} from "lucide-react";

import { useAgentAlertFeed, type AgentAlert } from "@/lib/agentAlerts/useAgentAlertFeed";
import { WORKSPACE_ALERT_EVENTS, type AgentAlertEvent } from "@/lib/agentAlerts/presentation";
import { AgentAlertPreferences } from "@/components/app/agent-alert-preferences";
import { KeyboardShortcutsDialog } from "@/components/app/keyboard-shortcuts-dialog";
import { allMenuItems } from "@/lib/menu/definition";
import { OPEN_ALERT_SETTINGS_EVENT } from "@/lib/agentAlerts/openAlertSettings";
import { KBD_ITEM_ATTRIBUTE, KBD_LIST_ATTRIBUTE, isTypingTarget, listKeyDirection, nextListIndex } from "@/lib/keyboard/listNavigation";
import { notify } from "@/lib/notify";

/**
 * The top bar.
 *
 * Until this component the workspace had thirty destinations in a sidebar and no way to reach a
 * lead by name, and the only thing above the page was a breadcrumb card. This is the bar: search,
 * the two things a person checks without navigating anywhere, and the way out.
 *
 * Three decisions worth keeping:
 *
 *   · ONE MENU AT A TIME. Opening the bell closes the account menu, and typing in the field closes
 *     both. Two panels overlapping is how a person loses track of which one they are reading.
 *
 *   · NOTIFICATIONS AND ALERTS ARE DIFFERENT THINGS. A handoff offered to you is addressed to you
 *     and clears when you read it. An unclaimed escalation is wrong with the queue and clears when
 *     somebody fixes it — so it carries no "mark as read", which would hide a live problem.
 *     Each shell supplies both lists from its own real sources; the bar invents neither.
 *
 *   · THE BADGE COUNTS WHAT IS UNHANDLED. Never an all-time total, and never drawn at zero.
 */

const PAGE_LABELS = new Map(allMenuItems().map((item) => [item.path, item.label]));

/**
 * What an agent alert's link opens, in words. "Open" alone makes a person click to find out where
 * they are going; the sidebar already names every page, so the alert borrows that name. A path the
 * menu does not know stays "Open" rather than guessing.
 */
function destinationLabel(link: string) {
  const path = link.split(/[?#]/)[0].replace(/\/$/, "");
  const page = PAGE_LABELS.get(path);
  if (page) return `Open ${page}`;
  if (/^\/app\/leads\/[^/]+$/.test(path)) return "Open the lead";
  return "Open";
}

type SearchHit = { group: string; title: string; meta: string; href: string };

/** Addressed to the person; clears when read. `tone` picks the dot colour. */
export type TopBarNotification = {
  id: string;
  title: string;
  body: string;
  link: string;
  created_at: string;
  tone?: "accent" | "success" | "warning" | "muted";
};

/** Wrong with the workspace; clears when fixed. Carries the one action that resolves it. */
export type TopBarAlert = {
  id: string;
  title: string;
  body: string;
  link: string;
  actionLabel: string;
  severity: "critical" | "warning";
};

/**
 * The feed the bar draws, supplied by whichever shell mounts it.
 *
 * A prop rather than a hook call inside, because the three shells have three different sources:
 * the agent polls `/api/app/notifications`, the partner `/api/partner/notifications`, staff
 * `/api/admin/notifications`. A shell that passes `null` gets a bar with search and an account
 * menu and no bell — the honest rendering of "there is nothing to notify you about here".
 */
export type TopBarFeed = {
  notifications: TopBarNotification[];
  alerts: TopBarAlert[];
  /** Marks exactly these ids read. The bar passes notification ids only — alerts are never marked read. */
  markRead: (ids: string[]) => void | Promise<void>;
  /**
   * Set when read state cannot be stored yet (a pending migration). The bar then says so in place
   * of "Mark all as read" rather than offering a button that forgets on the next check.
   */
  readStateUnavailable?: string | null;
  /** The shell's own preference controls, or null when it has none to offer. */
  preferences: ReactNode | null;
  /** The account-menu hint under "Notification preferences". */
  preferencesHint: string;
  /** The alert centre page, or null when this shell has none. */
  alertCentreHref: string | null;
  notificationsEmptyBody: string;
  alertsEmpty: { head: string; body: string };
  /**
   * LA-1.25-6: do not disturb is on (sound and browser alerts muted, the escalation email still
   * sent). The bar shows it next to the bell, so it is never on without the agent seeing it.
   */
  doNotDisturb?: boolean;
};

export type TopBarUser = {
  name: string;
  email: string;
  roleLabel: string;
  workspaceName: string;
};

type TopBarWorkspace = { tenantId: string; name: string; roleLabel: string; current: boolean };

type OpenMenu = "notifications" | "alerts" | "preferences" | "account" | null;
type PreferencesOrigin = "notifications" | "alerts" | "account";

const PREFERENCES_TITLE: Record<PreferencesOrigin, string> = {
  notifications: "Notification preferences",
  alerts: "Alert settings",
  account: "Notification preferences",
};
const PREFERENCES_BACK: Record<PreferencesOrigin, string> = {
  notifications: "Back to notifications",
  alerts: "Back to alerts",
  account: "Back to your account",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function whenLabel(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return new Date(iso).toLocaleDateString();
}

const ARROW = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
);

/**
 * J and K, applied to the page: move focus to the next or previous `data-kbd-item` inside the
 * `data-kbd-list` that already holds focus. Nothing happens when focus is outside such a list.
 */
function moveFocusInList(direction: "next" | "previous"): boolean {
  const active = document.activeElement as HTMLElement | null;
  const list = active?.closest<HTMLElement>(`[${KBD_LIST_ATTRIBUTE}]`);
  if (!active || !list) return false;
  const items = Array.from(list.querySelectorAll<HTMLElement>(`[${KBD_ITEM_ATTRIBUTE}]`));
  const current = items.findIndex((item) => item === active || item.contains(active));
  const next = nextListIndex(current, items.length, direction);
  if (next < 0 || next === current) return next >= 0;
  items[next].focus();
  items[next].scrollIntoView({ block: "nearest" });
  return true;
}

/**
 * The bar itself: presentational, and the same in every shell. The caller decides what the search
 * looks in, who the person is, and what the feed holds.
 */
export function TopBarShell({
  user,
  feed,
  searchEndpoint,
  searchPlaceholder,
  searchScope,
  profileHref,
  profileLabel,
  profileHint,
  signOutEndpoint,
  signOutRedirect,
  workspacesEndpoint,
  switchWorkspaceEndpoint,
}: {
  user: TopBarUser;
  feed: TopBarFeed | null;
  searchEndpoint: string;
  searchPlaceholder: string;
  /**
   * What an empty result means in this shell. An agent's search stops at their agency, a partner's
   * at what their organisation sent, and staff search every customer — so "a lead another agency
   * owns will never appear here" is true for one of the three and nonsense for the other two.
   */
  searchScope: string;
  /**
   * The account menu's first row, named by each shell for what its page really holds. Omit
   * `profileHref` when the shell has no page of its own for the person — the staff shell has none,
   * and a row pointing somewhere else would be a second door to that page.
   */
  profileHref?: string;
  profileLabel?: string;
  profileHint?: string;
  signOutEndpoint: string;
  signOutRedirect: string;
  /**
   * Where the list of this person's workspaces comes from, and where switching is asked for. Only
   * the agent shell has memberships in several workspaces; the row is drawn only when the server
   * says there is more than one.
   */
  workspacesEndpoint?: string;
  switchWorkspaceEndpoint?: string;
}) {
  const router = useRouter();
  const [menu, setMenu] = useState<OpenMenu>(null);
  const [preferencesOrigin, setPreferencesOrigin] = useState<PreferencesOrigin>("account");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<TopBarWorkspace[]>([]);
  const [choosingWorkspace, setChoosingWorkspace] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const notifications = feed?.notifications ?? [];
  const alerts = feed?.alerts ?? [];

  const trimmed = query.trim();
  // The panel opens on the first keystroke, as drawn. The query waits for a second character: one
  // letter would match half the workspace, so the panel says so instead of "Nothing matches".
  const searchOpen = trimmed.length >= 1;
  const tooShort = trimmed.length < 2;

  // ---- the search itself -------------------------------------------------
  useEffect(() => {
    if (trimmed.length < 2) {
      // Cleared in a callback rather than in the effect body: emptying the list is a reaction to
      // the field, not a render the field depends on, and doing it synchronously here cascades.
      const clear = window.setTimeout(() => { setHits([]); setTotal(0); setSearchError(null); setSearching(false); }, 0);
      return () => window.clearTimeout(clear);
    }
    const controller = new AbortController();
    // 180ms is long enough that a normal typist issues one request per word and short enough that
    // the list feels attached to the keyboard.
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`${searchEndpoint}?q=${encodeURIComponent(trimmed)}`, {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) { setSearchError("Search is unavailable right now."); setHits([]); return; }
        const body = (await response.json()) as { hits: SearchHit[]; total: number };
        setSearchError(null);
        setHits(body.hits);
        setTotal(body.total);
        setCursor(0);
      } catch (cause) {
        if ((cause as Error)?.name === "AbortError") return;
        setSearchError("Search is unavailable right now.");
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [trimmed, searchEndpoint]);

  // ---- this person's workspaces: read once, drawn only when there is a choice ----
  useEffect(() => {
    if (!workspacesEndpoint) return;
    const controller = new AbortController();
    fetch(workspacesEndpoint, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { workspaces?: TopBarWorkspace[] } | null) => { if (body?.workspaces) setWorkspaces(body.workspaces); })
      .catch(() => { /* No row is the honest fallback: a switch that cannot list its choices cannot switch. */ });
    return () => controller.abort();
  }, [workspacesEndpoint]);

  // ---- one menu at a time, and a click outside closes it ------------------
  const close = useCallback(() => { setMenu(null); setChoosingWorkspace(false); }, []);

  const openPreferences = useCallback((origin: PreferencesOrigin) => {
    setQuery("");
    setChoosingWorkspace(false);
    setPreferencesOrigin(origin);
    setMenu("preferences");
  }, []);

  // The Settings › Alerts page has no controls of its own — alert preferences are per person and
  // live here — so its one button asks the bar to open them rather than linking to a page.
  const hasPreferences = Boolean(feed?.preferences);
  useEffect(() => {
    if (!hasPreferences) return;
    const open = () => openPreferences("alerts");
    window.addEventListener(OPEN_ALERT_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_ALERT_SETTINGS_EVENT, open);
  }, [hasPreferences, openPreferences]);

  useEffect(() => {
    if (!menu && !searchOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        close();
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menu, searchOpen, close]);

  // ---- keyboard ----------------------------------------------------------
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = isTypingTarget(event.target as HTMLElement | null);
      if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (!typing) {
        const direction = listKeyDirection(event);
        if (direction && moveFocusInList(direction)) { event.preventDefault(); return; }
      }
      if (event.key === "Escape") { close(); setQuery(""); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!searchOpen || !hits.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setCursor((c) => (c + 1) % hits.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setCursor((c) => (c - 1 + hits.length) % hits.length); }
    else if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[cursor];
      if (hit) go(hit.href);
    }
  }

  /**
   * Open a result. A result on the page already open that differs only by `#section` is set as the
   * hash rather than pushed: the settings rail and the lead list select from `hashchange`, which a
   * router push does not fire, so the click would otherwise land and change nothing.
   */
  function go(href: string) {
    setQuery("");
    const [path, hash] = href.split("#");
    if (hash && path === window.location.pathname) window.location.hash = hash;
    else router.push(href);
  }

  function toggle(which: Exclude<OpenMenu, null | "preferences">) {
    setQuery("");
    setChoosingWorkspace(false);
    setMenu((current) => (current === which || (current === "preferences" && preferencesOrigin === which) ? null : which));
  }

  /**
   * Switching re-issues the session on the server, which checks the membership itself; the browser
   * only names the workspace it wants. A full navigation afterwards so nothing drawn from the old
   * workspace — a cached list, an open panel, a poll in flight — survives into the new one.
   */
  async function switchWorkspace(tenantId: string) {
    if (!switchWorkspaceEndpoint) return;
    setSwitchingTo(tenantId);
    try {
      const response = await fetch(switchWorkspaceEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId }),
      });
      const body = (await response.json().catch(() => null)) as { redirectTo?: string; error?: string } | null;
      if (!response.ok || !body?.redirectTo) throw new Error(body?.error ?? "That workspace could not be opened.");
      window.location.assign(body.redirectTo);
    } catch (cause) {
      notify.block(cause instanceof Error ? cause.message : "That workspace could not be opened.");
      setSwitchingTo(null);
    }
  }

  const grouped = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      if (!byGroup.has(hit.group)) { byGroup.set(hit.group, []); order.push(hit.group); }
      byGroup.get(hit.group)!.push(hit);
    }
    return order.map((group) => ({ group, rows: byGroup.get(group)! }));
  }, [hits]);

  const currentWorkspaceIndex = workspaces.findIndex((workspace) => workspace.current);
  const canSwitch = workspaces.length > 1 && currentWorkspaceIndex >= 0 && Boolean(switchWorkspaceEndpoint);

  // The bell and the triangle stay lit while their own preferences are open.
  const bellOpen = menu === "notifications" || (menu === "preferences" && preferencesOrigin === "notifications");
  const alertsOpen = menu === "alerts" || (menu === "preferences" && preferencesOrigin === "alerts");
  const accountOpen = menu === "account" || (menu === "preferences" && preferencesOrigin === "account");

  let flatIndex = -1;

  return (
    <div ref={rootRef} className="portal-top-bar" data-open={menu ?? undefined}>
      {/* ---------------------------------------------------------- search */}
      <form role="search" className="portal-top-search" onSubmit={(event) => event.preventDefault()}>
        <Search className="portal-top-search-icon size-[15px]" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          aria-label="Search this workspace"
          autoComplete="off"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setMenu(null); }}
          onKeyDown={onSearchKeyDown}
          className="portal-top-search-input"
        />
        <span className="portal-top-search-keys" aria-hidden="true"><kbd>⌘</kbd><kbd>K</kbd></span>

        {searchOpen && (
          <div className="portal-top-panel portal-top-panel-search m-swap" role="listbox" aria-label="Search results" {...{ [KBD_LIST_ATTRIBUTE]: "" }}>
            <div className="portal-top-panel-scroll">
              {grouped.map(({ group, rows }) => (
                <div key={group}>
                  <div className="portal-top-group">{group}</div>
                  {rows.map((hit) => {
                    flatIndex += 1;
                    const index = flatIndex;
                    return (
                      <button
                        key={`${hit.href}-${hit.title}`}
                        type="button"
                        role="option"
                        aria-selected={index === cursor}
                        data-active={index === cursor || undefined}
                        {...{ [KBD_ITEM_ATTRIBUTE]: "" }}
                        onMouseEnter={() => setCursor(index)}
                        onFocus={() => setCursor(index)}
                        onClick={() => go(hit.href)}
                        className="portal-top-hit m-row"
                      >
                        <span className="portal-top-hit-text">
                          <span className="portal-top-hit-title">{hit.title}</span>
                          <span className="portal-top-hit-meta">{hit.meta}</span>
                        </span>
                        <code className="portal-top-hit-path">{hit.href}</code>
                      </button>
                    );
                  })}
                </div>
              ))}

              {tooShort && (
                <div className="portal-top-empty">
                  <p className="portal-top-empty-head">Keep typing</p>
                  <p className="portal-top-empty-body">Search starts at the second letter. {searchScope}</p>
                </div>
              )}
              {!tooShort && !hits.length && !searching && !searchError && (
                <div className="portal-top-empty">
                  <p className="portal-top-empty-head">Nothing matches that</p>
                  <p className="portal-top-empty-body">{searchScope}</p>
                </div>
              )}
              {searchError && (
                <div className="portal-top-empty">
                  <p className="portal-top-empty-head">{searchError}</p>
                  <p className="portal-top-empty-body">Nothing has changed. Try the same search again in a moment.</p>
                </div>
              )}
            </div>
            <div className="portal-top-panel-foot">
              <span>
                {tooShort
                  ? "Type one more letter"
                  : searching
                  ? "Searching…"
                  : total > hits.length
                    ? `${hits.length} of ${total} results`
                    : total === 1 ? "1 result" : `${total} results`}
              </span>
              <span aria-hidden="true">↑↓ move · ↵ open · esc close</span>
            </div>
          </div>
        )}
      </form>

      {/* ------------------------------------------------------- the right */}
      <div className="portal-top-actions">
        {feed?.doNotDisturb && <span className="hidden text-[12px] leading-[1.5] font-semibold text-[var(--warning-ink)] sm:inline" title="Sound and browser alerts are muted. Escalation emails are still sent.">Do not disturb</span>}
        {feed && <button
          type="button"
          aria-label={`Notifications${notifications.length ? `, ${notifications.length} unread` : ""}${feed.doNotDisturb ? ", do not disturb is on" : ""}`}
          aria-haspopup="true"
          aria-expanded={bellOpen}
          onClick={() => toggle("notifications")}
          className="portal-top-icon"
        >
          {feed.doNotDisturb ? <BellOff className="size-4 text-[var(--warning-ink)]" aria-hidden="true" /> : <Bell className="size-4" aria-hidden="true" />}
          {notifications.length > 0 && <span className="portal-top-badge">{notifications.length}</span>}
        </button>}

        {feed && <button
          type="button"
          aria-label={`Alerts${alerts.length ? `, ${alerts.length} open` : ""}`}
          aria-haspopup="true"
          aria-expanded={alertsOpen}
          onClick={() => toggle("alerts")}
          className="portal-top-icon portal-top-icon-alert"
        >
          <TriangleAlert className="size-4" aria-hidden="true" />
          {alerts.length > 0 && <span className="portal-top-badge">{alerts.length}</span>}
        </button>}

        {feed && <span className="portal-top-divider" aria-hidden="true" />}

        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={accountOpen}
          onClick={() => toggle("account")}
          className="portal-top-account"
        >
          <span className="portal-top-avatar" aria-hidden="true">{initials(user.name)}</span>
          <span className="portal-top-account-name">{user.name.split(/\s+/)[0]}</span>
          <ChevronDown className="size-3.5 text-[var(--muted)]" aria-hidden="true" />
        </button>

        {/* ------------------------------------------- notifications panel */}
        {feed && menu === "notifications" && (
          <section aria-label="Notifications" className="portal-top-panel portal-top-panel-notif m-swap">
            <header className="portal-top-panel-head">
              <span>Notifications</span>
              <span>{notifications.length ? `${notifications.length} unread` : "Nothing unread"}</span>
            </header>
            <div className="portal-top-panel-scroll" {...{ [KBD_LIST_ATTRIBUTE]: "" }}>
              {notifications.map((item) => (
                <a
                  key={item.id}
                  href={item.link}
                  {...{ [KBD_ITEM_ATTRIBUTE]: "" }}
                  onClick={() => { if (!feed.readStateUnavailable) void feed.markRead([item.id]); }}
                  className="portal-top-notif m-row"
                >
                  <span className="portal-top-notif-dot" data-tone={item.tone ?? "accent"} aria-hidden="true" />
                  <span className="portal-top-notif-text">
                    <span className="portal-top-notif-head">
                      <span className="portal-top-notif-title">{item.title}</span>
                      <time dateTime={item.created_at}>{whenLabel(item.created_at)}</time>
                    </span>
                    <span className="portal-top-notif-body">{item.body}</span>
                  </span>
                </a>
              ))}
              {!notifications.length && (
                <div className="portal-top-empty">
                  <p className="portal-top-empty-head">Nothing addressed to you</p>
                  <p className="portal-top-empty-body">{feed.notificationsEmptyBody}</p>
                </div>
              )}
            </div>
            <div className="portal-top-panel-foot">
              {feed.readStateUnavailable
                ? <span>{feed.readStateUnavailable}</span>
                : (
                  <button type="button" onClick={() => void feed.markRead(notifications.map((item) => item.id))} disabled={!notifications.length} className="portal-top-foot-action">
                    Mark all as read
                  </button>
                )}
              {feed.preferences && (
                <button type="button" onClick={() => openPreferences("notifications")} className="portal-top-foot-link">
                  Notification preferences
                </button>
              )}
            </div>
          </section>
        )}

        {/* -------------------------------------------------- alerts panel */}
        {feed && menu === "alerts" && (
          <section aria-label="Alerts" className="portal-top-panel portal-top-panel-alerts m-swap">
            <header className="portal-top-panel-head">
              <span>Alerts</span>
              <span>Clears when fixed, not when read</span>
            </header>
            <div className="portal-top-panel-scroll" {...{ [KBD_LIST_ATTRIBUTE]: "" }}>
              {alerts.map((alert) => (
                <div key={alert.id} className="portal-top-alert" data-severity={alert.severity}>
                  <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="portal-top-alert-title">{alert.title}</span>
                    <span className="portal-top-alert-body">{alert.body}</span>
                    <a href={alert.link} {...{ [KBD_ITEM_ATTRIBUTE]: "" }} className="portal-top-alert-cta m-arrow">
                      {alert.actionLabel}
                      {ARROW}
                    </a>
                  </span>
                </div>
              ))}
              {!alerts.length && (
                <div className="portal-top-empty">
                  <p className="portal-top-empty-head">{feed.alertsEmpty.head}</p>
                  <p className="portal-top-empty-body">{feed.alertsEmpty.body}</p>
                </div>
              )}
            </div>
            <div className="portal-top-panel-foot">
              {feed.alertCentreHref && (
                <Link href={feed.alertCentreHref} onClick={close} className="portal-top-foot-action">
                  Open the alert centre
                </Link>
              )}
              {feed.preferences && (
                <button type="button" onClick={() => openPreferences("alerts")} className="portal-top-foot-link portal-top-foot-end">
                  Alert settings
                </button>
              )}
            </div>
          </section>
        )}

        {/* ---------------------------------------------- preferences panel */}
        {feed?.preferences && menu === "preferences" && (
          <section aria-label={PREFERENCES_TITLE[preferencesOrigin]} className="portal-top-panel portal-top-panel-alerts m-swap">
            <header className="portal-top-panel-head">
              <span>{PREFERENCES_TITLE[preferencesOrigin]}</span>
              <span>Only affects you</span>
            </header>
            <div className="portal-top-panel-scroll">{feed.preferences}</div>
            <div className="portal-top-panel-foot">
              <button type="button" onClick={() => setMenu(preferencesOrigin)} className="portal-top-foot-link portal-top-foot-end">
                {PREFERENCES_BACK[preferencesOrigin]}
              </button>
            </div>
          </section>
        )}

        {/* ------------------------------------------------- account menu */}
        {menu === "account" && (
          <section aria-label="Your account" className="portal-top-panel portal-top-panel-account m-swap">
            <div className="portal-top-identity">
              <span className="portal-top-avatar portal-top-avatar-lg" aria-hidden="true">{initials(user.name)}</span>
              <span>
                <span className="portal-top-identity-name">{user.name}</span>
                <span className="portal-top-identity-email">{user.email}</span>
                <span className="portal-top-identity-role">{user.roleLabel} · {user.workspaceName}</span>
              </span>
            </div>
            {choosingWorkspace && canSwitch ? (
              <div className="portal-top-menu" role="group" aria-label="Your workspaces" {...{ [KBD_LIST_ATTRIBUTE]: "" }}>
                {workspaces.map((workspace) => (
                  <button
                    key={workspace.tenantId}
                    type="button"
                    {...{ [KBD_ITEM_ATTRIBUTE]: "" }}
                    disabled={workspace.current || switchingTo !== null}
                    aria-current={workspace.current || undefined}
                    onClick={() => void switchWorkspace(workspace.tenantId)}
                    className="portal-top-menu-row m-row"
                  >
                    {workspace.current
                      ? <Check className="size-3.5" aria-hidden="true" />
                      : <ArrowRightLeft className="size-3.5" aria-hidden="true" />}
                    <span>
                      <span>{workspace.name}</span>
                      <span>
                        {switchingTo === workspace.tenantId
                          ? "Opening…"
                          : workspace.current ? `${workspace.roleLabel} · you are here` : workspace.roleLabel}
                      </span>
                    </span>
                  </button>
                ))}
                <button type="button" onClick={() => setChoosingWorkspace(false)} className="portal-top-menu-row m-row">
                  <ChevronDown className="size-3.5 rotate-90" aria-hidden="true" />
                  <span><span>Back</span><span>To your account menu</span></span>
                </button>
              </div>
            ) : (
              <div className="portal-top-menu" {...{ [KBD_LIST_ATTRIBUTE]: "" }}>
                {profileHref && (
                  <Link href={profileHref} onClick={close} {...{ [KBD_ITEM_ATTRIBUTE]: "" }} className="portal-top-menu-row m-row">
                    <UserRound className="size-3.5" aria-hidden="true" />
                    <span><span>{profileLabel}</span><span>{profileHint}</span></span>
                  </Link>
                )}
                {feed?.preferences && (
                  <button type="button" onClick={() => openPreferences("account")} {...{ [KBD_ITEM_ATTRIBUTE]: "" }} className="portal-top-menu-row m-row">
                    <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                    <span><span>Notification preferences</span><span>{feed.preferencesHint}</span></span>
                  </button>
                )}
                <button type="button" onClick={() => { close(); setShortcutsOpen(true); }} {...{ [KBD_ITEM_ATTRIBUTE]: "" }} className="portal-top-menu-row m-row">
                  <KeyboardIcon className="size-3.5" aria-hidden="true" />
                  <span><span>Keyboard shortcuts</span><span>Slash to search, J and K to move</span></span>
                </button>
                {canSwitch && (
                  <button type="button" onClick={() => setChoosingWorkspace(true)} {...{ [KBD_ITEM_ATTRIBUTE]: "" }} className="portal-top-menu-row m-row">
                    <ArrowRightLeft className="size-3.5" aria-hidden="true" />
                    <span>
                      <span>Switch workspace</span>
                      <span>{workspaces[currentWorkspaceIndex].name} · {currentWorkspaceIndex + 1} of {workspaces.length}</span>
                    </span>
                  </button>
                )}
              </div>
            )}
            <div className="portal-top-signout">
              <TopBarSignOut endpoint={signOutEndpoint} redirect={signOutRedirect} />
            </div>
          </section>
        )}
      </div>

      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

/**
 * Sign-out, in the account menu rather than as a lone icon, and it says what it ends. Its own
 * component so the sidebar's button — which is styled for a dark ground — is left alone.
 */
function TopBarSignOut({ endpoint, redirect }: { endpoint: string; redirect: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(endpoint, { method: "POST" });
      if (!response.ok) throw new Error("Sign out could not be completed");
      router.push(redirect);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign out could not be completed");
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => void signOut()} disabled={loading} aria-busy={loading} className="portal-top-menu-row portal-top-menu-signout m-row">
        <LogOut className="size-3.5" aria-hidden="true" />
        <span>
          <span>{loading ? "Signing out…" : "Log out"}</span>
          <span>Ends this session on this device only</span>
        </span>
      </button>
      {error && <p role="alert" className="portal-top-signout-error">{error}</p>}
    </>
  );
}

// ---------------------------------------------------------------- the agent

const NOTIFICATION_TONE: Partial<Record<AgentAlertEvent, TopBarNotification["tone"]>> = {
  handoff_offered: "success",
  callback_due: "warning",
  partner_message: "muted",
};

/** Splits the agent feed into what is addressed to you and what is wrong with the workspace. */
function agentFeedLists(alerts: AgentAlert[]) {
  const notifications: TopBarNotification[] = [];
  const workspace: AgentAlert[] = [];
  for (const alert of alerts) {
    if (WORKSPACE_ALERT_EVENTS.includes(alert.event_type)) workspace.push(alert);
    else notifications.push({ ...alert, tone: NOTIFICATION_TONE[alert.event_type] ?? "accent" });
  }
  // Newest first, as the board draws them ("just now", then "6m"). The feed arrives oldest first.
  notifications.sort((a, b) => b.created_at.localeCompare(a.created_at));
  // Stable, so alerts of the same severity keep the feed's order. Most severe first.
  workspace.sort((a, b) => WORKSPACE_ALERT_EVENTS.indexOf(a.event_type) - WORKSPACE_ALERT_EVENTS.indexOf(b.event_type));
  const topBarAlerts: TopBarAlert[] = workspace.map((alert) => ({
    id: alert.id,
    title: alert.title,
    body: alert.body,
    link: alert.link,
    actionLabel: destinationLabel(alert.link),
    severity: alert.event_type === "unclaimed_escalation" ? "critical" : "warning",
  }));
  return { notifications, alerts: topBarAlerts };
}

/**
 * The agent's bar. Owns the one poller for the whole page — the alert centre used to own it, and
 * mounting both would mean two requests every 2.5 seconds and two toasts per alert.
 */
export function AppTopBar({ user }: { user: TopBarUser }) {
  const source = useAgentAlertFeed();
  const lists = useMemo(() => agentFeedLists(source.alerts), [source.alerts]);
  const feed: TopBarFeed = {
    ...lists,
    markRead: source.markRead,
    preferences: <AgentAlertPreferences feed={source} />,
    preferencesHint: "Which events reach you, and how",
    alertCentreHref: "/app/alerts",
    doNotDisturb: source.settings?.do_not_disturb === true,
    notificationsEmptyBody: "Handoffs, mentions, partner messages and callbacks due appear here as they happen.",
    alertsEmpty: {
      head: "Nothing is wrong with the queue",
      body: "Unclaimed leads and escalations appear here. They are not messages — they clear when somebody claims the work, not when you read this.",
    },
  };
  return (
    <TopBarShell
      user={user}
      feed={feed}
      searchEndpoint="/api/app/search"
      searchPlaceholder="Search leads, policies, lists, partners…"
      searchScope="Search covers this workspace only. A lead another agency owns will never appear here."
      profileHref="/app/profile"
      profileLabel="Your profile"
      profileHint="Name, phone, licence numbers"
      signOutEndpoint="/api/app/auth/logout"
      signOutRedirect="/app/login"
      workspacesEndpoint="/api/app/auth/workspaces"
      switchWorkspaceEndpoint="/api/app/auth/switch-workspace"
    />
  );
}
