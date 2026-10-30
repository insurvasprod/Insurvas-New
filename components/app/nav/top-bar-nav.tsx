"use client";

import Link from "next/link";
import { CalendarPlus, FilePenLine, Handshake, Import, ListPlus, Plus, UserPlus } from "lucide-react";

import type { MenuSection } from "@/lib/menu/definition";
import { WORKSPACE_ACTIONS } from "@/lib/search/actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * The agent top bar's own piece: the things you start most. Where you are is on the page now
 * (PageHeader's trail, owner 2026-10-30), not in the bar. (The Inbound status pill was removed 2026-10-29, owner: "remove this one"; status is
 * shown and changed on Inbound.) Each reads the same server-filtered menu as the sidebar, so
 * nothing here offers a page the person cannot open.
 */

const items = (menu: MenuSection[]) => menu.flatMap((section) => section.items);

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
