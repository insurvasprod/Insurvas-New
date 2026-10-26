import { LeadFlowMap } from "@/components/ui/lead-flow-map";
import { DashTile } from "@/components/ui/dash-tile";
import { LaunchEmpty } from "@/components/ui/launchpad";
import { SectionLoading } from "@/components/ui/page-states";
import { canOpenAdminHref, homeFigureSet, type HomeTile } from "@/lib/adminDashboard/compose";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { fetchFunnel } from "@/lib/metrics/queries";
import { pathMap, worstDrop, type MapDrop, type MapStage, type RoleMap } from "@/lib/dashboard/roleFlow";

const DAYS = 90;

/** Where each funnel step's rows are listed; a step whose page the role cannot open is shown without a link. */
const STEP_HREF: Record<string, string> = {
  "Signed up": "/admin/tenants",
  "Verified email": "/admin/users",
  "Started subscription": "/admin/subscriptions",
  "Completed setup": "/admin/tenants",
  "Active at day 30": "/admin/revenue",
};

const n = (value: number) => value.toLocaleString("en-US");

/**
 * The revenue roles' map: the platform's own funnel, sign-up to a customer still paying at day 30 —
 * the Revenue page's activation funnel (lib/metrics/queries.ts fetchFunnel), only drawn here.
 *
 * A flow can only narrow, and the funnel's steps are counted from different tables: one can read
 * lower than a step after it (on 2026-10-25: 56 verified emails, then 341 subscriptions) — drawn as a
 * flow that is 541 sign-ups "lost" that were not. So a step lower than any later step is left out of
 * the drawing and named in the map's corner; the Revenue page still lists every step.
 */
async function revenueMap(role: AdminRole): Promise<RoleMap & { skipped: string[] }> {
  const measured = (await fetchFunnel(DAYS)).filter((step) => step.measured && step.count !== null) as { label: string; count: number }[];
  const kept: typeof measured = [];
  const skipped: typeof measured = [];
  for (let index = measured.length - 1; index >= 0; index -= 1) {
    const step = measured[index];
    if (kept.length === 0 || step.count >= kept[0].count) kept.unshift(step);
    else skipped.unshift(step);
  }
  const link = (label: string) => {
    const href = STEP_HREF[label];
    return href && canOpenAdminHref(role, href) ? href : undefined;
  };
  const first = kept[0]?.count ?? 0;
  const stages: MapStage[] = kept.map((step, index) => ({
    label: step.label,
    value: n(step.count),
    count: step.count,
    note: index === 0 ? `last ${DAYS} days` : first ? `${Math.round((step.count / first) * 100)}% of sign-ups` : undefined,
    href: link(step.label),
  }));
  const drops: MapDrop[] = kept.slice(1).map((step, index) => {
    const lost = Math.max(0, kept[index].count - step.count);
    return { text: lost ? `−${n(lost)}` : "none lost", lost, href: link(kept[index].label) };
  });
  const worst = worstDrop(stages);
  const revenue = canOpenAdminHref(role, "/admin/revenue") ? "/admin/revenue" : "/admin";
  const lead = worst === null ? null : {
    title: "Biggest leak",
    big: `${Math.round((kept[worst + 1].count / kept[worst].count) * 100)}%`,
    unit: `${kept[worst].label} → ${kept[worst + 1].label}`,
    leak: true,
    rows: [
      { label: "Lost between the two", value: n(drops[worst].lost), tone: "warning" as const, href: revenue },
      { label: kept[worst].label, value: n(kept[worst].count), href: stages[worst].href },
      { label: kept[worst + 1].label, value: n(kept[worst + 1].count), tone: "good" as const, href: stages[worst + 1].href },
    ],
    cta: { label: "Open the funnel", href: revenue },
    href: revenue,
  };
  return { label: `Sign-up to paying customer · last ${DAYS} days`, mode: "flow", stages, drops, worst, hot: null, lead, skipped: skipped.map((step) => `${step.label} (${n(step.count)})`) };
}

/**
 * One map per staff role (redesign 2026-10-25: "every single role a different map"): the revenue
 * roles see the funnel above; support, who see no money, get a path through the customers'
 * day — sign-ins, failed sign-ins, invitations, tenants, the audit trail; platform_config, who see no
 * customer data at all, a path through the platform's own switches. Each path stop is a figure
 * from the role's own tiles (lib/adminDashboard/queries.ts), so no new read runs.
 */
export async function loadAdminMap(role: AdminRole, tiles: HomeTile[]): Promise<(RoleMap & { skipped?: string[] }) | null> {
  const set = homeFigureSet(role);
  if (set === "revenue") return revenueMap(role).catch(() => null);
  const tile = (key: string) => tiles.find((item) => item.key === key);
  const stop = (key: string, label: string, next: string, urgent: (t: HomeTile) => boolean) => {
    const t = tile(key);
    const count = t ? Number(t.value.replace(/[^0-9.]/g, "")) || 0 : 0;
    return { label, href: t?.href ?? null, figure: t?.value ?? null, count, urgent: t ? urgent(t) : false, note: t?.footnote ?? "", next };
  };
  const warn = (t: HomeTile) => t.tone === "warning" || t.tone === "error";
  if (set === "support") {
    return pathMap("The customers' day", [
      stop("failed", "Failed sign-ins", "check, then", warn),
      stop("signed-in", "Signed in now", "then", warn),
      stop("invites", "Invitations", "chase, then", warn),
      stop("tenants", "Tenants", "then", warn),
      stop("audit", "Audit trail", "", warn),
    ]);
  }
  return pathMap("The platform's switches", [
    stop("maintenance", "Maintenance", "then", (t) => t.value !== "Off"),
    stop("compliance", "Compliance sources", "fix, then", warn),
    stop("features", "Feature switches", "then", warn),
    stop("announcements", "Announcements", "", warn),
  ]);
}

export async function AdminMapView({ map }: { map: Promise<(RoleMap & { skipped?: string[] }) | null> }) {
  const view = await map;
  if (!view || view.stages.length < 2) return null;
  const aside = view.skipped?.length ? <span className="text-xs leading-normal text-muted-foreground">Not drawn, counted differently: {view.skipped.join(", ")}</span> : undefined;
  return <LeadFlowMap label={view.label} mode={view.mode} hot={view.hot} stages={view.stages} drops={view.drops} worst={view.worst} aside={aside} />;
}

export function AdminMapLoading() {
  return (
    <section aria-label="Your map" className="m-glass rounded-xl border border-border px-4 pb-4 pt-3.5">
      <SectionLoading rows={3} columns={5} label="Drawing your map" />
    </section>
  );
}

export async function AdminLeadTile({ map }: { map: Promise<(RoleMap & { skipped?: string[] }) | null> }) {
  const lead = (await map)?.lead;
  if (!lead) return <LaunchEmpty />;
  return <DashTile title={lead.title} href={lead.href} big={lead.big} unit={lead.unit} leak={lead.leak} rows={lead.rows} cta={lead.cta} />;
}
