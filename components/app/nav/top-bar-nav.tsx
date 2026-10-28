"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarPlus, ChevronRight, FilePenLine, Handshake, Import, ListPlus, Plus, UserPlus } from "lucide-react";

import type { MenuItem, MenuSection } from "@/lib/menu/definition";
import { WORKSPACE_ACTIONS } from "@/lib/search/actions";
import { areaOfSection } from "@/lib/menu/sidebar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNavStatus } from "@/components/app/nav/use-nav-status";

/**
 * The agent top bar's own pieces (Navigation A, owner's pick 2026-10-28): where you are, your Inbound
 * status, and the things you start most. Each reads the same server-filtered menu as the sidebar, so
 * nothing here offers a page the person cannot open.
 */

const items = (menu: MenuSection[]) => menu.flatMap((section) => section.items);

/** The page open now: the menu item with the longest path that holds the address. */
function currentItem(menu: MenuSection[], pathname: string): MenuItem | null {
  let best: MenuItem | null = null;
  for (const item of items(menu)) {
    if (pathname !== item.path && !pathname.startsWith(`${item.path}/`)) continue;
    if (!best || item.path.length > best.path.length) best = item;
  }
  return best;
}

/**
 * The step below a menu page (owner 2026-10-28: "Inbound › Verification"). The call page names its
 * step; any other page deeper than its menu item names itself by its own title, which PageHeader
 * keeps as a hidden `<h1 data-page-title>`. Re-read as the page streams in and when ?step changes.
 */
function useSubPage(pathname: string, itemPath: string | null) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!itemPath || pathname === itemPath) { setLabel(null); return; } // eslint-disable-line react-hooks/set-state-in-effect
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (pathname.startsWith("/app/inbound/call/")) {
          setLabel(new URLSearchParams(window.location.search).get("step") === "finish" ? "Finish the call" : "Verification");
          return;
        }
        setLabel(document.querySelector("main [data-page-title]")?.textContent?.trim() || null);
      });
    };
    read();
    const main = document.querySelector("main");
    if (!main) return () => cancelAnimationFrame(frame);
    const observer = new MutationObserver(read);
    observer.observe(main, { childList: true, subtree: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [pathname, itemPath]);
  return label;
}

/**
 * Area › page, and › the step when you are below the page (Inbound › Verification), the page then a
 * link back to it. Home and Settings stand alone, so they show the page alone. Always draws the nav,
 * empty when no menu page holds the address, so the search stays in the middle of the bar.
 */
export function TopBarCrumb({ menu }: { menu: MenuSection[] }) {
  const pathname = usePathname();
  const item = currentItem(menu, pathname);
  const sub = useSubPage(pathname, item?.path ?? null);
  if (!item) return <nav aria-label="Breadcrumb" className="portal-top-crumb" />;
  const page = item.navLabel ?? item.label;
  // The rail's area name (Work, Leads, Book, Money, Team, Compliance), so the bar and the rail agree.
  const area = areaOfSection(item.section);
  const group = area === page ? null : area;
  const step = sub && sub !== page ? sub : null;
  return (
    <nav aria-label="Breadcrumb" className="portal-top-crumb">
      {group && (
        <>
          <span className="portal-top-crumb-group">{group}</span>
          <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
        </>
      )}
      {step ? (
        <>
          <Link href={item.path} className="portal-top-crumb-group text-inherit no-underline hover:text-[var(--nav-ink)] hover:underline">{page}</Link>
          <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
          <span className="portal-top-crumb-page" aria-current="page">{step}</span>
        </>
      ) : (
        <span className="portal-top-crumb-page" aria-current="page">{page}</span>
      )}
    </nav>
  );
}

const PRESENCE: Record<"ready" | "on_break" | "on_call" | "off", string> = {
  ready: "Taking calls",
  on_call: "On a call",
  on_break: "On a break",
  off: "Not taking calls",
};

/** Your saved Inbound status, read-only here; it is changed on Inbound, where the pill leads. */
export function TopBarPresence() {
  const { presence } = useNavStatus();
  if (!presence) return null;
  return (
    <Link href="/app/inbound" className="portal-top-presence" data-status={presence} title="Your Inbound status. Change it on Inbound.">
      <span className="portal-top-presence-dot" aria-hidden="true" />
      {PRESENCE[presence]}
    </Link>
  );
}

/**
 * New: the everyday starts, each a workspace action (lib/search/actions.ts) that opens the screen
 * that does it. Offered only when its menu item is in this person's menu; an action with a narrower
 * role gate than its page stays in search, where that gate is checked.
 */
const NEW_ITEMS = [
  { action: "add-lead", label: "Lead", icon: UserPlus },
  { action: "start-application", label: "Application", icon: FilePenLine },
  { action: "book-callback", label: "Callback", icon: CalendarPlus },
  { action: "import-list", label: "Lead list", icon: ListPlus },
  { action: "add-partner", label: "Partner", icon: Handshake },
  { action: "import-statement", label: "Carrier statement", icon: Import },
] as const;

export function TopBarNew({ menu }: { menu: MenuSection[] }) {
  const keys = new Set(items(menu).map((item) => item.key));
  const offered = NEW_ITEMS.flatMap((entry) => {
    const action = WORKSPACE_ACTIONS.find((candidate) => candidate.key === entry.action);
    return action && !action.roles && keys.has(action.menuKey) ? [{ ...entry, href: action.href }] : [];
  });
  if (!offered.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="portal-top-new">
          <Plus className="size-4" aria-hidden="true" />
          New
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Start something new</DropdownMenuLabel>
        {offered.map(({ action, label, icon: Icon, href }) => (
          <DropdownMenuItem key={action} asChild>
            <Link href={href}>
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
