"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Building2,
  ScrollText,
  UserRound,
  Activity,
  ToggleRight,
  Package,
  Repeat,
  Puzzle,
} from "lucide-react";

// Icon components (functions with methods) can't cross the server->client boundary as props —
// the layout (a Server Component) passes a key instead, resolved to a component here.
const ICONS = {
  dashboard: LayoutDashboard,
  tenants: Building2,
  users: UserRound,
  activity: Activity,
  features: ToggleRight,
  plans: Package,
  subscriptions: Repeat,
  addons: Puzzle,
  admins: Users,
  "audit-log": ScrollText,
} as const;

export type SidebarIconKey = keyof typeof ICONS;

export type SidebarNavItem = {
  href: string;
  label: string;
  icon: SidebarIconKey;
};

// Matches the Insurvas CRM sidebar's active/hover treatment (components/dashboard/DashboardLayout.tsx):
// active items get a lighter navy gradient pill with an inset highlight; hover gets a faint
// translucent overlay. Both use the same 14px rounded pill shape.
export function SidebarNav({ items }: { items: SidebarNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const isActive = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = ICONS[item.icon];

        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 rounded-[14px] border px-4 py-3 text-[15px] transition-all"
            style={{
              borderColor: isActive ? "rgba(255,255,255,0.22)" : "transparent",
              background: isActive
                ? "linear-gradient(180deg, #00539c 0%, #003468 100%)"
                : "transparent",
              boxShadow: isActive ? "inset 0 1px 0 rgba(255,255,255,0.22), 0 8px 22px rgba(0,31,63,0.45)" : "none",
              fontWeight: isActive ? 700 : 600,
              color: "#ffffff",
            }}
            onMouseEnter={(e) => {
              if (isActive) return;
              e.currentTarget.style.background =
                "linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.06) 100%)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.22)";
            }}
            onMouseLeave={(e) => {
              if (isActive) return;
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "transparent";
            }}
          >
            <Icon size={20} strokeWidth={1.8} className="shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
