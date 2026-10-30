"use client";

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { InsurvasLogo } from "@/components/shared/insurvas-logo";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
export type RailLink = { key: string; label: string; href: string; icon: Icon };
export type RailGroup = { key: string; label: string; icon: Icon; items: RailLink[] };
export type RailNode = RailLink | RailGroup;

type Fly =
  | { kind: "card"; key: string; label: string; top: number }
  | { kind: "tip"; key: string; label: string; top: number };

/**
 * Desktop navigation for staff and partner shells. Each shell keeps its ordered menu data and
 * active-route rules; partner can opt into the agent sidebar presentation while staff keeps the
 * compact-rail treatment. Mobile keeps each shell's own drawer; partner Overview matches only itself.
 */
export function NavRail({
  label,
  homeHref,
  items,
  foot,
  card,
  isActive,
  sidebarPresentation = false,
}: {
  label: string;
  homeHref: string;
  items: RailNode[];
  foot: RailLink[];
  card?: { label: string; icon: Icon; body: ReactNode };
  isActive: (href: string, pathname: string) => boolean;
  /** Use the agent shell's full sidebar geometry and left-aligned top-bar search. */
  sidebarPresentation?: boolean;
}) {
  const pathname = usePathname();
  const [fly, setFly] = useState<Fly | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const activeGroup = items.find((entry): entry is RailGroup =>
    "items" in entry && entry.items.some((item) => isActive(item.href, pathname)),
  );
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(() => activeGroup?.key ?? null);
  const [seenPath, setSeenPath] = useState(pathname);
  const closeTimer = useRef<number | null>(null);
  const idPrefix = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-rail`;
  const panelId = `${idPrefix}-panel`;
  const navId = `${idPrefix}-navigation`;

  // A navigation closes transient panels and opens the group containing the current route.
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setFly(null);
    if (activeGroup) setOpenGroupKey(activeGroup.key);
  }

  // Keep consecutive standalone links together, like Home and Settings in the agent sidebar.
  const blocks: (RailLink[] | RailGroup)[] = [];
  for (const item of items) {
    if ("items" in item) blocks.push(item);
    else if (Array.isArray(blocks.at(-1))) (blocks.at(-1) as RailLink[]).push(item);
    else blocks.push([item]);
  }

  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }, []);

  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  // A short grace, so the pointer can cross the gap between the rail and the panel.
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setFly(null), 160);
  };
  const place = (element: HTMLElement, rows: number) => {
    const rect = element.getBoundingClientRect();
    const height = 56 + rows * 40;
    return Math.max(8, Math.min(rect.top - 8, window.innerHeight - height - 12));
  };
  const openTip = (key: string, text: string, element: HTMLElement) => {
    cancelClose();
    const rect = element.getBoundingClientRect();
    setFly({ kind: "tip", key, label: text, top: rect.top + rect.height / 2 - 16 });
  };
  const openCard = (element: HTMLElement) => {
    if (!card) return;
    cancelClose();
    setFly({ kind: "card", key: "card", label: card.label, top: place(element, 2) });
  };

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Escape" || !fly) return;
    const key = fly.key;
    setFly(null);
    document.querySelector<HTMLElement>(`[data-rail-key="${CSS.escape(key)}"]`)?.focus();
  }

  const link = (item: RailLink) => {
    const active = isActive(item.href, pathname);
    const ItemIcon = item.icon;
    return (
      <li key={item.key}>
        <Link
          href={item.href}
          data-rail-key={item.key}
          aria-label={item.label}
          aria-current={active ? "page" : undefined}
          title={item.label}
          className={`portal-agent-nav-link ${active ? "is-active" : ""}`}
          onPointerEnter={(event) => openTip(item.key, item.label, event.currentTarget)}
          onPointerLeave={closeSoon}
          onFocus={(event) => openTip(item.key, item.label, event.currentTarget)}
          onBlur={closeSoon}
        >
          <span className="portal-agent-nav-link-copy">
            <ItemIcon className="portal-agent-nav-icon" aria-hidden />
            <span className="portal-agent-nav-label">{item.label}</span>
          </span>
        </Link>
      </li>
    );
  };
  const group = (entry: RailGroup) => {
    const GroupIcon = entry.icon;
    const open = openGroupKey === entry.key;
    const active = entry.items.some((item) => isActive(item.href, pathname));
    const sectionId = `${navId}-${entry.key.replace(/[^a-z0-9]+/gi, "-")}`;
    return (
      <section key={entry.key} className={`portal-agent-nav-section ${active ? "is-active" : ""}`}>
        <button
          type="button"
          data-rail-key={entry.key}
          title={entry.label}
          aria-expanded={open && !isCollapsed}
          aria-controls={open && !isCollapsed ? sectionId : undefined}
          className="portal-agent-nav-disclosure"
          onClick={() => {
            if (isCollapsed) {
              setFly(null);
              setIsCollapsed(false);
              setOpenGroupKey(entry.key);
              return;
            }
            setOpenGroupKey((current) => current === entry.key ? null : entry.key);
          }}
        >
          <span className="portal-agent-nav-disclosure-copy">
            <GroupIcon className="portal-agent-nav-icon" aria-hidden />
            <span>{entry.label}</span>
          </span>
          <ChevronDown className={`portal-agent-nav-chevron ${open && !isCollapsed ? "is-open" : ""}`} aria-hidden="true" />
        </button>
        {open && !isCollapsed && (
          <ul id={sectionId} className="portal-agent-nav-sublist">
            {entry.items.map((child) => {
              const ChildIcon = child.icon;
              const childActive = isActive(child.href, pathname);
              return (
                <li key={child.key}>
                  <Link
                    href={child.href}
                    aria-label={child.label}
                    aria-current={childActive ? "page" : undefined}
                    title={child.label}
                    className={`portal-agent-nav-link portal-agent-nav-link-nested ${childActive ? "is-active" : ""}`}
                  >
                    <span className="portal-agent-nav-link-copy">
                      <ChildIcon className="portal-agent-nav-icon" aria-hidden />
                      <span className="portal-agent-nav-label">{child.label}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  };
  const CardIcon = card?.icon;

  return (
    <aside
      data-print-hide
      className={`${sidebarPresentation ? "portal-agent-sidebar-desktop" : "portal-agent-rail"} portal-agent-rail-expanded portal-agent-desktop-nav hidden md:flex md:flex-col ${isCollapsed ? "is-collapsed" : ""}`}
      onKeyDown={onKeyDown}
    >
      <div className={sidebarPresentation ? "portal-agent-sidebar-brand" : "portal-agent-rail-brand"}>
        <Link
          href={homeHref}
          aria-label="Insurvas home"
          className={sidebarPresentation ? "portal-agent-desktop-brand-link" : undefined}
        >
          <InsurvasLogo
            size="sidebar"
            tone="dark"
            className={sidebarPresentation ? "portal-agent-desktop-brand-full" : "portal-agent-rail-brand-full"}
          />
          <InsurvasLogo
            size="compact"
            variant="symbol"
            tone="dark"
            className={sidebarPresentation ? "portal-agent-desktop-brand-compact" : "portal-agent-rail-brand-compact"}
          />
        </Link>
        <button
          type="button"
          onClick={() => { setFly(null); setIsCollapsed((collapsed) => !collapsed); }}
          aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!isCollapsed}
          aria-controls={navId}
          title={isCollapsed ? "Expand navigation" : "Collapse navigation"}
          className="portal-agent-sidebar-collapse portal-agent-rail-toggle rounded-md p-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
        >
          {isCollapsed ? <PanelLeftOpen className="size-4" aria-hidden="true" /> : <PanelLeftClose className="size-4" aria-hidden="true" />}
        </button>
      </div>
      <nav id={navId} className={`portal-agent-rail-scroll ${sidebarPresentation ? "portal-agent-sidebar-scroll" : ""}`} aria-label={label}>
        <div className={`portal-agent-nav ${isCollapsed ? "is-collapsed" : ""}`}>
          {blocks.map((block, index) => Array.isArray(block) ? (
            <ul key={`links-${index}`} className={index === 0 ? "portal-agent-nav-home" : "portal-agent-nav-settings"}>
              {block.map(link)}
            </ul>
          ) : group(block))}
        </div>
      </nav>
      <ul className="portal-agent-rail-foot">
        {foot.map(link)}
        {card && CardIcon && (
          <li>
            <button
              type="button"
              onClick={(event) => (fly?.kind === "card" ? setFly(null) : openCard(event.currentTarget))}
              data-rail-key="card"
              aria-label={card.label}
              aria-expanded={fly?.kind === "card"}
              aria-controls={fly?.kind === "card" ? panelId : undefined}
              className="portal-agent-nav-link portal-agent-rail-card"
              onPointerEnter={(event) => openCard(event.currentTarget)}
              onPointerLeave={closeSoon}
              onFocus={(event) => openCard(event.currentTarget)}
              onBlur={closeSoon}
            >
              <span className="portal-agent-nav-link-copy">
                <CardIcon className="portal-agent-nav-icon" aria-hidden />
                <span className="portal-agent-nav-label">{card.label}</span>
              </span>
            </button>
          </li>
        )}
      </ul>

      {fly && (
        <div
          id={panelId}
          className="portal-agent-rail-fly m-swap"
          data-kind={fly.kind === "card" ? "plan" : fly.kind}
          style={{ top: fly.top }}
          role={fly.kind === "tip" ? "tooltip" : "group"}
          aria-label={fly.kind === "tip" ? undefined : fly.label}
          onPointerEnter={cancelClose}
          onPointerLeave={closeSoon}
        >
          {fly.kind === "tip" && fly.label}
          {fly.kind === "card" && card?.body}
        </div>
      )}
    </aside>
  );
}
