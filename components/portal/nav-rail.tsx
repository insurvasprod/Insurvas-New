"use client";

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { InsurvasLogo } from "@/components/shared/insurvas-logo";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
export type RailLink = { key: string; label: string; href: string; icon: Icon };
export type RailGroup = { key: string; label: string; icon: Icon; items: RailLink[] };

type Fly =
  | { kind: "group"; key: string; label: string; items: RailLink[]; top: number }
  | { kind: "card"; key: string; label: string; top: number }
  | { kind: "tip"; key: string; label: string; top: number };

/**
 * The desktop rail for the staff and partner shells (redesign 2026-10-25, owner: "sidebar and navbar
 * as A"). The agent shell's NavRail (components/app/agent-sidebar.tsx), class for class, with a
 * menu handed in rather than built from the agent menu: one icon per group, its pages opening beside
 * the rail when the group is pointed at, focused or clicked; single links show their name as a tip.
 * The card (who is signed in, which organisation) opens from the foot. The phone keeps each shell's
 * own drawer. `isActive` is the shell's own rule (the partner's Overview matches only itself).
 */
export function NavRail({
  label,
  homeHref,
  links,
  groups,
  foot,
  card,
  isActive,
}: {
  label: string;
  homeHref: string;
  links: RailLink[];
  groups: RailGroup[];
  foot: RailLink[];
  card?: { label: string; icon: Icon; body: ReactNode };
  isActive: (href: string, pathname: string) => boolean;
}) {
  const pathname = usePathname();
  const [fly, setFly] = useState<Fly | null>(null);
  const [seenPath, setSeenPath] = useState(pathname);
  const closeTimer = useRef<number | null>(null);
  const panelId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-rail-panel`;

  // A navigation closes the panel (derived from the path, so set during render).
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setFly(null);
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
  const openGroup = (group: RailGroup, element: HTMLElement) => {
    cancelClose();
    setFly({ kind: "group", key: group.key, label: group.label, items: group.items, top: place(element, group.items.length) });
  };
  const openTip = (key: string, text: string, element: HTMLElement) => {
    cancelClose();
    const rect = element.getBoundingClientRect();
    setFly((current) => (current?.kind === "group" && current.key === key ? current : { kind: "tip", key, label: text, top: rect.top + rect.height / 2 - 16 }));
  };
  const openCard = (element: HTMLElement) => {
    if (!card) return;
    cancelClose();
    setFly({ kind: "card", key: "card", label: card.label, top: place(element, 2) });
  };

  function onKeyDown(event: React.KeyboardEvent) {
    if ((event.key === "ArrowRight" || event.key === "ArrowDown") && fly?.kind === "group" && (event.target as HTMLElement).dataset.railKey === fly.key) {
      const first = document.querySelector<HTMLElement>(`#${panelId} a`);
      if (first) { event.preventDefault(); first.focus(); }
      return;
    }
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
          className={`portal-agent-rail-item ${active ? "is-active" : ""}`}
          onPointerEnter={(event) => openTip(item.key, item.label, event.currentTarget)}
          onPointerLeave={closeSoon}
          onFocus={(event) => openTip(item.key, item.label, event.currentTarget)}
          onBlur={closeSoon}
        >
          <ItemIcon className="size-5" aria-hidden />
        </Link>
      </li>
    );
  };
  const CardIcon = card?.icon;

  return (
    <aside data-print-hide className="portal-agent-rail hidden md:flex" onKeyDown={onKeyDown}>
      <div className="portal-agent-rail-brand">
        <Link href={homeHref} aria-label="Insurvas home">
          <InsurvasLogo size="compact" variant="symbol" tone="dark" />
        </Link>
      </div>
      <nav className="portal-agent-rail-scroll" aria-label={label}>
        <ul className="portal-agent-rail-list">
          {links.map(link)}
          {groups.map((group) => {
            const GroupIcon = group.icon;
            const open = fly?.kind === "group" && fly.key === group.key;
            const active = group.items.some((item) => isActive(item.href, pathname));
            return (
              <li key={group.key}>
                <button
                  type="button"
                  onClick={(event) => (open ? setFly(null) : openGroup(group, event.currentTarget))}
                  data-rail-key={group.key}
                  aria-label={group.label}
                  aria-expanded={open}
                  aria-controls={open ? panelId : undefined}
                  className={`portal-agent-rail-item ${active ? "is-active" : ""}`}
                  onPointerEnter={(event) => openGroup(group, event.currentTarget)}
                  onPointerLeave={closeSoon}
                  onFocus={(event) => openGroup(group, event.currentTarget)}
                >
                  <GroupIcon className="size-5" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
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
              className="portal-agent-rail-item"
              onPointerEnter={(event) => openCard(event.currentTarget)}
              onPointerLeave={closeSoon}
            >
              <CardIcon className="size-5" aria-hidden />
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
          {fly.kind === "group" && (
            <>
              <p className="portal-agent-rail-fly-head">{fly.label}</p>
              <ul>
                {fly.items.map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <li key={item.key}>
                      <Link href={item.href} aria-current={isActive(item.href, pathname) ? "page" : undefined} onClick={() => setFly(null)} onBlur={closeSoon} onFocus={cancelClose}>
                        <ItemIcon className="size-4 shrink-0" aria-hidden />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {fly.kind === "card" && card?.body}
        </div>
      )}
    </aside>
  );
}
