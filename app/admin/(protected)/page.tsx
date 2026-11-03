import { Suspense, type ReactNode } from "react";
import {
  Activity, BadgeDollarSign, Building2, ClipboardCheck, Compass, FileText, Hourglass, KeyRound, Megaphone, ScrollText, ShieldCheck, ToggleLeft, UserCog, UserPlus, Users, Wrench,
} from "lucide-react";

import { DashTile, DashTileLoading, type TileRow, type TileTone } from "@/components/ui/dash-tile";
import { Launchpad, type LaunchCell, type LaunchSpace } from "@/components/ui/launchpad";
import { LiveStamp } from "@/components/ui/live-stamp";
import { PageHeader } from "@/components/ui/page-header";
import { DashboardRefresh } from "@/components/admin/dashboard-refresh";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { ADMIN_ROLE_LABELS, type AdminRole } from "@/lib/adminAuth/roles";
import { startStepsFor, type HomeTile, type HomeTileTone } from "@/lib/adminDashboard/compose";
import { dailyChecksFor, dailySummary, type DailyCheckStatus } from "@/lib/adminDashboard/dailyChecks";
import { fetchDailyCheckInput } from "@/lib/adminDashboard/dailyQueries";
import { activeAdminsByRole, formatUtcDateTime, plural } from "@/lib/adminDashboard/figures";
import { fetchHomeTiles } from "@/lib/adminDashboard/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * The staff home: a role-specific launchpad under a live header. Every figure is a tile opening its
 * rows (LA-4.20), the daily checks (owner,
 * 2026-10-13) are a tall tile worst-first, admins by role a tile, and "Start here" its own workspace.
 * Every figure and link stays the one the role can open (lib/adminDashboard/compose.ts).
 */

function roleLabel(role: AdminRole) {
  const label = ADMIN_ROLE_LABELS[role];
  return label.charAt(0) + label.slice(1).toLowerCase();
}

/** A server render reads the clock once per request, which is the point. */
function readClock() {
  return new Date().toISOString();
}

const TILE_TONE: Record<HomeTileTone, TileTone> = { default: "default", success: "good", warning: "warning", error: "danger" };

const TILE_ICON: Record<string, ReactNode> = {
  mrr: <BadgeDollarSign />,
  customers: <Building2 />,
  collected: <BadgeDollarSign />,
  trials: <Hourglass />,
  invoices: <FileText />,
  tenants: <Building2 />,
  "signed-in": <Users />,
  failed: <KeyRound />,
  invites: <UserPlus />,
  audit: <ScrollText />,
  maintenance: <Wrench />,
  announcements: <Megaphone />,
  features: <ToggleLeft />,
  compliance: <ShieldCheck />,
};

const CHECK_TONE: Record<DailyCheckStatus, { tone: TileTone; label: string }> = {
  failing: { tone: "danger", label: "Failing" },
  look: { tone: "warning", label: "Look" },
  unknown: { tone: "default", label: "Couldn't check" },
  info: { tone: "default", label: "FYI" },
  clear: { tone: "good", label: "Clear" },
};

/** A figure as a tile: its value, what it counts, the month-over-month change, its rows' page. */
function FigureTile({ tile }: { tile: HomeTile }) {
  const rows: TileRow[] = [{ label: tile.footnote, tone: TILE_TONE[tile.tone ?? "default"], href: tile.href }];
  if (tile.delta) {
    const up = tile.delta.value > 0;
    const good = (up && tile.delta.goodWhen === "up") || (!up && tile.delta.goodWhen === "down");
    rows.push({ label: "vs last month", value: `${up ? "+" : ""}${tile.delta.value}${tile.delta.unit}`, tone: tile.delta.value === 0 ? "default" : good ? "good" : "warning", href: tile.href });
  }
  return <DashTile title={tile.label} icon={TILE_ICON[tile.key] ?? <Activity />} href={tile.href} big={tile.value} tone={TILE_TONE[tile.tone ?? "default"]} rows={rows} />;
}

/**
 * Daily checks (owner, 2026-10-13: what an admin must check every single day): one row per check,
 * worst first, each opening the page that deals with it; only the checks this role's pages cover.
 * Streams on its own: the platform reads behind it are the slowest on the page.
 */
async function DailyChecksTile({ admin }: { admin: { id: string; role: AdminRole } }) {
  const checks = dailyChecksFor(admin.role, await fetchDailyCheckInput(admin));
  const failing = checks.filter((check) => check.status === "failing").length;
  const look = checks.filter((check) => check.status === "look").length;
  const worst = checks.find((check) => check.status === "failing" || check.status === "look") ?? checks[0];
  return (
    <DashTile
      title="Daily checks"
      icon={<ClipboardCheck />}
      href={worst?.href ?? "/admin"}
      big={String(failing + look)}
      unit={dailySummary(checks)}
      tone={failing ? "danger" : look ? "warning" : "good"}
      rows={checks.map((check) => ({ label: `${check.title} · ${check.detail}`, value: CHECK_TONE[check.status].label, tone: CHECK_TONE[check.status].tone, href: check.href }))}
      cta={worst && worst.status !== "clear" ? { label: worst.actionLabel, href: worst.href } : undefined}
      ctaAtFoot
    >
      <div className="flex justify-end"><DashboardRefresh /></div>
    </DashTile>
  );
}

export default async function AdminDashboardPage() {
  const admin = await getCurrentAdmin();
  const renderedAt = readClock();

  const supabase = getSupabaseServiceClient();
  const [{ data: rows, error }, tiles] = await Promise.all([
    supabase.from("admin_users").select("role, is_active"),
    admin ? fetchHomeTiles({ id: admin.id, role: admin.role }) : [],
  ]);

  // Without this the dashboard greets a failed query with no admins at all, which is both wrong and
  // impossible — somebody is logged in reading it.
  if (error) throw new Error(`Could not load admin counts: ${error.message}`);

  const admins = (rows ?? []) as { role: AdminRole; is_active: boolean }[];
  const byRole = activeAdminsByRole(admins);
  const deactivated = admins.filter((row) => !row.is_active).length;
  const signedIn = formatUtcDateTime(admin?.last_login_at);
  const steps = admin ? startStepsFor(admin.role) : [];

  const today: LaunchCell[] = [];
  for (const tile of tiles) today.push({ id: tile.key, title: tile.label, w: tile.key === "mrr" || tile.key === "maintenance" ? 2 : 1, h: 1, href: tile.href, node: <FigureTile tile={tile} /> });
  if (admin) today.push({ id: "checks", title: "Daily checks", w: 2, h: 2, href: "/admin", node: <Suspense fallback={<DashTileLoading title="Daily checks" />}><DailyChecksTile admin={{ id: admin.id, role: admin.role }} /></Suspense> });
  today.push({
    id: "admins",
    title: "Admins by role",
    w: 1,
    h: 1,
    href: "/admin/admins",
    node: (
      <DashTile
        title="Admins by role"
        icon={<UserCog />}
        href="/admin/admins"
        big={String(byRole.reduce((sum, item) => sum + item.count, 0))}
        unit={deactivated ? `active · ${plural(deactivated, "deactivated account is", "deactivated accounts are")} not counted` : "active"}
        rows={[
          ...byRole.map(({ role, count }) => ({ label: roleLabel(role), value: count.toLocaleString("en-US"), tone: role === "super_admin" ? ("good" as const) : ("default" as const) })),
          { label: `You · ${admin ? roleLabel(admin.role) : "—"}`, value: admin?.last_login_at && signedIn ? `signed in ${signedIn}` : "first sign-in" },
        ]}
      />
    ),
  });

  const start: LaunchCell[] = steps.map((step, index) => ({
    id: `start-${index}`,
    title: step.title,
    w: 1,
    h: 1,
    href: step.links[0]?.href ?? "/admin",
    node: <DashTile title={step.title} icon={<Compass />} href={step.links[0]?.href ?? "/admin"} rows={step.links.map((link) => ({ label: link.label, href: link.href }))} />,
  }));

  const spaces: LaunchSpace[] = [
    { key: "today", label: "Today", cells: today },
    ...(start.length ? [{ key: "start", label: "Start here", cells: start }] : []),
  ];

  return (
    <>
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <PageHeader title="Platform administration" actions={<LiveStamp updatedAt={renderedAt} />} />

        <Launchpad storageKey={`insurvas:admin-home:${admin?.id ?? "staff"}`} spaces={spaces} />
      </div>
    </>
  );
}
