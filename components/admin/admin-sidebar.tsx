"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgePercent,
  BookCheck,
  Boxes,
  Building2,
  ChevronDown,
  Compass,
  Flag,
  ContactRound,
  CreditCard,
  FileInput,
  FileWarning,
  Gauge,
  Hourglass,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  LibraryBig,
  ListChecks,
  LogIn,
  Mail,
  Menu,
  Package,
  PhoneOff,
  PlugZap,
  Puzzle,
  Radar,
  Receipt,
  Repeat,
  Scale,
  ScrollText,
  ServerCog,
  Settings2,
  ShieldUser,
  ShieldCheck,
  SlidersHorizontal,
  TableProperties,
  Tag,
  ToggleRight,
  TrendingUp,
  Undo2,
  UserCog,
  UserRound,
  Wallet,
  X,
} from "lucide-react";

import {
  groupIdForPath,
  isLinkActive,
  type SidebarGroup,
  type SidebarIconKey,
  type SidebarLink,
  type SidebarNode,
} from "@/lib/adminNav/types";
import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import { NavRail } from "@/components/portal/nav-rail";

// Icon components are functions with methods and cannot cross the server->client boundary as props,
// so the server sends a key and it is resolved here.
const ICONS: Record<SidebarIconKey, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  // The five groups: who we serve, what they pay, what we sell, what we watch, how it runs.
  customers: ContactRound,
  billing: Wallet,
  catalog: LibraryBig,
  monitoring: Radar,
  platform: Settings2,
  // Customers
  tenants: Building2,
  users: UserRound,
  // Billing
  "billing-workspace": LayoutGrid,
  subscriptions: Repeat,
  trials: Hourglass,
  invoices: Receipt,
  "credit-notes": Undo2,
  coupons: Tag,
  offers: BadgePercent,
  limits: Gauge,
  revenue: TrendingUp,
  "payments-setup": PlugZap,
  payments: CreditCard,
  // Catalog
  plans: Package,
  addons: Puzzle,
  features: ToggleRight,
  products: Boxes,
  carriers: Landmark,
  "field-maps": FileInput,
  "layout-maps": TableProperties,
  "status-maps": ListChecks,
  "carrier-rules": BookCheck,
  "portal-guidance": Compass,
  "fact-reports": Flag,
  templates: LayoutTemplate,
  // Monitoring
  activity: LogIn,
  "audit-log": ScrollText,
  // Platform
  compliance: ShieldCheck,
  disclosures: FileWarning,
  "calling-rules": PhoneOff,
  email: Mail,
  system: ServerCog,
  advanced: SlidersHorizontal,
  admins: UserCog,
  legal: Scale,
};


type Props = { nodes: SidebarNode[]; adminName: string; roleLabel: string; footer?: ReactNode };

/** One row, drawn with the agent rail's own classes so the two rails cannot drift apart. */
function NavItemLink({ entry, nested = false, onNavigate }: { entry: SidebarLink; nested?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = isLinkActive(entry.href, pathname);
  const Icon = ICONS[entry.icon];

  return (
    <li>
      <Link
        href={entry.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        title={entry.label}
        className={`portal-agent-nav-link ${nested ? "portal-agent-nav-link-nested" : ""} ${active ? "is-active" : ""}`}
      >
        <span className="portal-agent-nav-link-copy">
          <Icon className="portal-agent-nav-icon" aria-hidden="true" />
          <span className="portal-agent-nav-label">{entry.label}</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * The staff menu, in the agent rail's structure (owner request 2026-10-13: "exactly the same sidebar
 * and nav bar"): top-level links, then each group as a disclosure with its icon and chevron, its
 * pages listed beneath. The group holding the current page starts open, as the agent rail does.
 */
function NavList({
  nodes,
  onNavigate,
  onGroupFromCollapsed,
}: {
  nodes: SidebarNode[];
  onNavigate?: () => void;
  /** In the collapsed rail a group has no room for its pages, so choosing it opens the rail. */
  onGroupFromCollapsed?: () => void;
}) {
  const pathname = usePathname();
  const activeGroupId = groupIdForPath(nodes, pathname);
  const [openGroups, setOpenGroups] = useState<string[]>(() => (activeGroupId ? [activeGroupId] : []));

  // Consecutive top-level links share one list, as Home does on the agent rail.
  const blocks: (SidebarLink[] | SidebarGroup)[] = [];
  for (const node of nodes) {
    if (node.kind === "group") blocks.push(node);
    else if (Array.isArray(blocks.at(-1))) (blocks.at(-1) as SidebarLink[]).push(node);
    else blocks.push([node]);
  }

  return (
    <nav className="portal-agent-nav" aria-label="Admin navigation">
      {blocks.map((block, index) => {
        if (Array.isArray(block)) {
          return (
            <ul key={`links-${index}`} className={index === 0 ? "portal-agent-nav-home" : "portal-agent-nav-settings"}>
              {block.map((entry) => <NavItemLink key={entry.href} entry={entry} onNavigate={onNavigate} />)}
            </ul>
          );
        }

        const Icon = ICONS[block.icon];
        const open = openGroups.includes(block.id);
        const sectionId = `admin-nav-${block.id}`;
        return (
          <section key={block.id} className={`portal-agent-nav-section ${block.id === activeGroupId ? "is-active" : ""}`}>
            <button
              type="button"
              className="portal-agent-nav-disclosure"
              aria-expanded={open}
              aria-controls={sectionId}
              title={block.label}
              onClick={() => {
                if (onGroupFromCollapsed) {
                  // Collapsed: open the rail with this group showing, never shut it.
                  onGroupFromCollapsed();
                  setOpenGroups((current) => (current.includes(block.id) ? current : [...current, block.id]));
                  return;
                }
                setOpenGroups((current) =>
                  current.includes(block.id) ? current.filter((id) => id !== block.id) : [...current, block.id],
                );
              }}
            >
              <span className="portal-agent-nav-disclosure-copy">
                <Icon className="portal-agent-nav-icon" aria-hidden="true" />
                <span>{block.label}</span>
              </span>
              <ChevronDown className={`portal-agent-nav-chevron ${open ? "is-open" : ""}`} aria-hidden="true" />
            </button>
            {open && (
              <ul id={sectionId} className="portal-agent-nav-sublist">
                {block.links.map((entry) => <NavItemLink key={entry.href} entry={entry} nested onNavigate={onNavigate} />)}
              </ul>
            )}
          </section>
        );
      })}
    </nav>
  );
}

/**
 * The staff rail: the agent rail itself (components/app/agent-sidebar.tsx), class for class — the
 * brand row with its collapse button, the menu, the card at the foot and the theme toggle — holding
 * the staff menu and who is signed in. Only the accent differs, and that is a token
 * (app/admin/admin-plane.css), not a style here.
 */
export function AdminSidebar({ nodes, adminName, roleLabel, footer }: Props) {
  const [open, setOpen] = useState(false);

  const brandMark = (tone?: "dark") => (
    <div className="flex items-center gap-2.5">
      <InsurvasLogo size="sidebar" tone={tone} />
    </div>
  );

  // The agent rail's plan card, holding what is true for staff: who is signed in and in what role.
  // No sign-out here — it is the labelled last row of the top bar's account menu.
  const staffCard = (
    <section className="portal-agent-plan-card" aria-label="Signed in as">
      <p className="portal-agent-plan-card-label">Staff</p>
      <p className="portal-agent-plan-card-name truncate">{adminName}</p>
      <p className="portal-agent-plan-card-role">{roleLabel}</p>
    </section>
  );

  return (
    <>
      <header
        data-print-hide
        className="portal-agent-sidebar-mobile sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card px-4 py-3 text-foreground md:hidden"
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open admin menu"
          aria-expanded={open}
          className="-ml-1 rounded-md p-1.5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        {brandMark()}
      </header>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close admin menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div className="portal-agent-sidebar-mobile-drawer absolute inset-y-0 left-0 flex w-80 max-w-[88vw] flex-col overflow-y-auto p-4 text-foreground">
            <div className="min-h-0 flex-1">
              <div className="portal-agent-sidebar-brand">
                {brandMark("dark")}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close admin menu"
                  className="portal-agent-sidebar-collapse rounded-md p-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              <NavList nodes={nodes} onNavigate={() => setOpen(false)} />
            </div>
            {staffCard}
            {footer && <div className="portal-agent-sidebar-footer">{footer}</div>}
          </div>
        </div>
      )}

      {/* The desktop rail (redesign 2026-10-25, "sidebar as A"): the agent shell's icon rail with the
          staff menu; a group's pages open beside it, and the staff card opens from the foot. */}
      <NavRail
        label="Admin navigation"
        homeHref="/admin"
        links={nodes.filter((node): node is SidebarLink => node.kind !== "group").map((node) => ({ key: node.href, label: node.label, href: node.href, icon: ICONS[node.icon] }))}
        groups={nodes.filter((node): node is SidebarGroup => node.kind === "group").map((group) => ({ key: group.id, label: group.label, icon: ICONS[group.icon], items: group.links.map((entry) => ({ key: entry.href, label: entry.label, href: entry.href, icon: ICONS[entry.icon] })) }))}
        foot={[]}
        card={{ label: "Signed in as", icon: ShieldUser, body: <>{staffCard}{footer && <div className="portal-agent-sidebar-footer">{footer}</div>}</> }}
        isActive={isLinkActive}
      />
    </>
  );
}
