import { cache } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { WsPanel, WsPanelError, agoWords, settlePanel } from "@/components/admin/billing/ws-panel";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { catalogPrefixesFor, catalogStepOfAction, readCatalogAudit, type CatalogAuditItem } from "@/lib/adminCatalog/audit";
import { catalogNeeds, reviewWaiting, type CatalogNeedTone } from "@/lib/adminCatalog/needs";
import { catalogQueues } from "@/lib/adminCatalog/reads";
import { CATALOG_STEPS, catalogStepsFor } from "@/lib/adminCatalog/steps";
import { canOpenAdminHref } from "@/lib/adminDashboard/compose";
import { readCarrierUsage } from "@/lib/carriers/adminService";
import { fetchAllSwitches } from "@/lib/features/killSwitch";
import { switchCounts } from "@/lib/features/killSwitchRules";
import { fetchSubscribersByVersion } from "@/lib/plans/listReads";
import { fetchPlans } from "@/lib/plans/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { cn } from "@/lib/utils";

type Viewer = { id: string; role: AdminRole };

const n = (value: number) => value.toLocaleString("en-US");
const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;
const rowLink = "flex min-h-11 items-center gap-3 border-b border-border px-4 py-2 text-sm text-foreground no-underline last:border-b-0 hover:bg-[var(--hover-wash)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)]";
const rowPlain = "flex min-h-11 items-center gap-3 border-b border-border px-4 py-2 text-sm text-foreground last:border-b-0";
const Chevron = () => <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />;

/** The request's clock, read once beside the rows it dates. */
function readClock(): number {
  return Date.now();
}

/** One read of every queue per request: the figures and Needs review share it. */
const queuesFor = cache((id: string, role: AdminRole) => catalogQueues({ id, role }));
const switchesNow = cache(async () => [...(await fetchAllSwitches()).values()]);
const steps = (role: AdminRole) => new Set<string>(catalogStepsFor(role).map((step) => step.key));

/* ── Figures ─────────────────────────────────────────────────────────────────────────────────── */

async function planFigures() {
  const plans = await fetchPlans();
  const latest = await fetchSubscribersByVersion(plans.map((plan) => plan.id));
  const live = plans.filter((plan) => !plan.is_archived).length;
  const subscribers = plans.reduce((sum, plan) => sum + plan.subscriber_count, 0);
  const older = plans.reduce((sum, plan) => sum + Math.max(0, plan.subscriber_count - (latest[plan.id] ?? 0)), 0);
  return { live, archived: plans.length - live, subscribers, older };
}

async function featureFigures() {
  const [{ data, error }, switches] = await Promise.all([getSupabaseServiceClient().from("features").select("is_archived"), switchesNow()]);
  if (error) throw new Error(error.message);
  return { live: (data ?? []).filter((row) => !row.is_archived).length, ...switchCounts(switches) };
}

async function carrierFigures() {
  const [{ count, error }, usage] = await Promise.all([
    getSupabaseServiceClient().from("carriers").select("id", { count: "exact", head: true }).eq("is_active", true).is("organization_id", null),
    readCarrierUsage().catch(() => ({ available: false as const })),
  ]);
  if (error) throw new Error(error.message);
  return { active: count ?? 0, appointments: usage.available ? usage.totals.appointments : null };
}

/** Plans live, old versions, features, carriers and what waits — each tile only for a role that may open its page. */
export async function CatalogWsFigures({ viewer }: { viewer: Viewer }) {
  const open = steps(viewer.role);
  const [plans, features, carriers, queues] = await Promise.all([
    open.has("plans") ? settlePanel("plan figures", planFigures) : Promise.resolve(undefined),
    open.has("features") ? settlePanel("feature figures", featureFigures) : Promise.resolve(undefined),
    open.has("carriers") ? settlePanel("carrier figures", carrierFigures) : Promise.resolve(undefined),
    queuesFor(viewer.id, viewer.role),
  ]);
  const review = reviewWaiting(queues);
  const unread = "Couldn't be read";
  return (
    <StatStrip label="Catalog figures">
      {plans !== undefined && (
        <StatTile
          label="Plans live"
          value={plans ? n(plans.live) : "—"}
          footnote={plans ? `${n(plans.archived)} archived · ${plural(plans.subscribers, "subscriber")}` : unread}
          href="/admin/plans"
        />
      )}
      {plans !== undefined && (
        <StatTile
          label="On an old plan version"
          value={plans ? (plans.subscribers > 0 ? `${Math.round((plans.older / plans.subscribers) * 100)}%` : "0%") : "—"}
          footnote={plans ? plural(plans.older, "subscriber") : unread}
          labelTitle="Live subscribers on an earlier version of their plan than the latest. They keep the deal they bought."
          href="/admin/plans"
        />
      )}
      {features !== undefined && (
        <StatTile
          label="Features"
          value={features ? n(features.live) : "—"}
          footnote={features ? `${n(features.off)} off · ${n(features.beta)} in beta` : unread}
          href="/admin/features"
        />
      )}
      {carriers !== undefined && (
        <StatTile
          label="Carriers active"
          value={carriers ? n(carriers.active) : "—"}
          footnote={carriers ? (carriers.appointments === null ? "appointments not counted yet" : plural(carriers.appointments, "appointment")) : unread}
          href="/admin/carriers"
        />
      )}
      <StatTile
        label="Waiting for review"
        value={review ? n(review.total) : "—"}
        footnote={review ? (review.total > 0 ? `across ${plural(review.queues, "queue")}` : "every queue clear") : "some queues couldn't be read"}
        labelTitle="Status words, fact reports from agencies and field maps waiting on a person."
      />
    </StatStrip>
  );
}

/** A figure still on its way: a skeleton the size of a number. */
function FigureSkeleton() {
  return <span aria-hidden="true" className="m-skel inline-block h-6 w-16 rounded-md" />;
}

export function CatalogWsFiguresLoading({ role }: { role: AdminRole }) {
  const open = steps(role);
  const labels = [open.has("plans") && "Plans live", open.has("plans") && "On an old plan version", open.has("features") && "Features", open.has("carriers") && "Carriers active", "Waiting for review"].filter((label): label is string => Boolean(label));
  const pending = <FigureSkeleton />;
  return (
    <StatStrip label="Catalog figures">
      {labels.map((label) => <StatTile key={label} label={label} value={pending} reserveFootnote />)}
    </StatStrip>
  );
}

/* ── Needs review ────────────────────────────────────────────────────────────────────────────── */

const NEED_CHIP: Record<CatalogNeedTone, { tone: StatusTone; label: string }> = {
  review: { tone: "warning", label: "Review" },
  fill: { tone: "neutral", label: "Fill in" },
  unknown: { tone: "neutral", label: "Couldn't check" },
};

export async function CatalogWsNeeds({ viewer }: { viewer: Viewer }) {
  const queues = await queuesFor(viewer.id, viewer.role);
  const rows = catalogNeeds(queues, readClock()).filter((row) => canOpenAdminHref(viewer.role, row.href));
  const waiting = reviewWaiting(queues)?.total ?? null;
  return (
    <WsPanel title="Needs review" count={waiting} note="review first · each opens its page, filtered">
      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-8 text-center">
          <p className="m-0 text-sm font-semibold text-foreground">Nothing needs review</p>
          <p className="m-0 max-w-[44ch] text-xs text-muted-foreground">Status words, fact reports and field maps are clear, and every carrier, feature and template is filled in.</p>
        </div>
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.map((row) => (
            <li key={row.key}>
              <Link href={row.href} className={rowLink}>
                <span className="w-44 shrink-0 truncate font-semibold xl:w-60" title={row.title}>{row.title}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={row.detail}>{row.detail}</span>
                <StatusChip tone={NEED_CHIP[row.tone].tone}>{NEED_CHIP[row.tone].label}</StatusChip>
                <Chevron />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WsPanel>
  );
}

/* ── Switches now ────────────────────────────────────────────────────────────────────────────── */

export async function CatalogWsSwitches() {
  const read = await settlePanel("switches now", async () => {
    const switches = (await switchesNow()).filter((item) => item.state !== "on");
    if (switches.length === 0) return { switches, labels: new Map<string, string>() };
    const { data, error } = await getSupabaseServiceClient().from("features").select("feature_key, label").in("feature_key", switches.map((item) => item.feature_key));
    if (error) throw new Error(error.message);
    return { switches, labels: new Map((data ?? []).map((row) => [row.feature_key, row.label])) };
  });
  if (!read) return <WsPanelError title="Switches" />;
  const { switches, labels } = read;
  const sorted = [...switches].sort((a, b) => (a.state === b.state ? 0 : a.state === "off" ? -1 : 1));
  return (
    <WsPanel title="Switches" note="who sees what right now">
      {sorted.length === 0 ? (
        <p className="m-0 px-4 py-6 text-center text-xs text-muted-foreground">Every feature is on for everyone it is sold to.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {sorted.map((item) => (
            <li key={item.feature_key}>
              <Link href={`/admin/features?tab=switches&feature=${encodeURIComponent(item.feature_key)}`} className={rowLink}>
                <span className="w-44 shrink-0 truncate font-semibold" title={item.feature_key}>{labels.get(item.feature_key) ?? item.feature_key}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.state === "off" ? "Off for everyone" : `Beta · ${plural(item.beta_tenant_ids.length, "agency", "agencies")}`}</span>
                <StatusChip tone={item.state === "off" ? "danger" : "info"}>{item.state === "off" ? "Off" : "Beta"}</StatusChip>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WsPanel>
  );
}

/* ── Recent changes ──────────────────────────────────────────────────────────────────────────── */

type Tone = "good" | "warn" | "bad" | "info";
const DOT: Record<Tone, string> = { good: "bg-[var(--success)]", warn: "bg-[var(--warning)]", bad: "bg-[var(--error)]", info: "bg-[var(--info)]" };
const toneOf = (action: string): Tone =>
  /archived|deleted|retired|removed|discarded|declined|deactivat/.test(action) ? "bad"
    : /switch_changed|override_cleared/.test(action) ? "warn"
      : /published|approved|verified|resolved|restored|version_created/.test(action) ? "good"
        : "info";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Names for the plans, add-ons and features the rows point at, so a row reads "Agency v4", not an id. */
async function targetNames(items: CatalogAuditItem[]): Promise<Map<string, string>> {
  const ids = (type: string) => [...new Set(items.filter((item) => item.targetType === type && item.targetId).map((item) => item.targetId as string))];
  const plans = ids("plan").filter((id) => UUID.test(id));
  const addons = ids("addon").filter((id) => UUID.test(id));
  const features = ids("feature");
  const db = getSupabaseServiceClient();
  const [planRows, addonRows, featureRows] = await Promise.all([
    plans.length ? db.from("plans").select("id, name, version").in("id", plans) : Promise.resolve({ data: [] as { id: string; name: string; version: number }[] }),
    addons.length ? db.from("addons").select("id, name").in("id", addons) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    features.length
      ? db.from("features").select("id, feature_key, label").or(`feature_key.in.(${features.filter((key) => /^[a-z][a-z0-9_]*$/.test(key)).join(",") || "_"}),id.in.(${features.filter((id) => UUID.test(id)).join(",") || "00000000-0000-0000-0000-000000000000"})`)
      : Promise.resolve({ data: [] as { id: string; feature_key: string; label: string }[] }),
  ]);
  const names = new Map<string, string>();
  for (const row of planRows.data ?? []) names.set(`plan:${row.id}`, `${row.name} v${row.version}`);
  for (const row of addonRows.data ?? []) names.set(`addon:${row.id}`, row.name);
  for (const row of featureRows.data ?? []) {
    names.set(`feature:${row.id}`, row.label);
    names.set(`feature:${row.feature_key}`, row.label);
    names.set(`feature-key:${row.id}`, row.feature_key);
  }
  return names;
}

function hrefFor(item: CatalogAuditItem, names: Map<string, string>): string | null {
  const step = catalogStepOfAction(item.action);
  if (!step) return null;
  const base = CATALOG_STEPS.find((entry) => entry.key === step)?.href ?? null;
  if (!base || !item.targetId) return base;
  if (item.targetType === "plan" && UUID.test(item.targetId)) return `/admin/plans?plan=${item.targetId}`;
  if (item.targetType === "addon" && UUID.test(item.targetId)) return `/admin/addons?addon=${item.targetId}`;
  if (item.targetType === "feature") {
    const key = UUID.test(item.targetId) ? names.get(`feature-key:${item.targetId}`) : item.targetId;
    return key ? `/admin/features?feature=${encodeURIComponent(key)}` : base;
  }
  return base;
}

export async function CatalogWsRecent({ viewer }: { viewer: Viewer }) {
  const open = steps(viewer.role);
  const read = await settlePanel("recent catalog changes", async () => {
    const items = (await readCatalogAudit(viewer, { prefixes: catalogPrefixesFor(viewer.role) }, 14)).filter((item) => {
      const step = catalogStepOfAction(item.action);
      return step !== null && open.has(step);
    });
    return { items, names: await targetNames(items), now: readClock() };
  });
  if (!read) return <WsPanelError title="Recent changes" className="flex-1" />;
  const { items, names, now } = read;
  return (
    <WsPanel title="Recent changes" note={viewer.role === "super_admin" ? "from the audit log" : "yours, and what agencies and the system did"} className="min-h-0 flex-1">
      {items.length === 0 ? (
        <p className="m-0 px-4 py-6 text-center text-xs text-muted-foreground">No catalog changes on record yet.</p>
      ) : (
        <ul className="m-0 max-h-[360px] list-none overflow-y-auto p-0">
          {items.map((item) => {
            const name = item.targetType && item.targetId ? names.get(`${item.targetType}:${item.targetId}`) : undefined;
            const text = [item.label, name ? `“${name}”` : null, item.by ? `· by ${item.by}` : null].filter(Boolean).join(" ");
            const href = hrefFor(item, names);
            const body = (
              <>
                <span className={cn("size-1.5 shrink-0 rounded-full", DOT[toneOf(item.action)])} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate" title={item.reason ? `${text} — ${item.reason}` : text}>{text}</span>
                <time dateTime={item.at} className="shrink-0 text-xs text-muted-foreground" title={item.at}>{agoWords(item.at, now)}</time>
              </>
            );
            return <li key={item.id}>{href && canOpenAdminHref(viewer.role, href) ? <Link href={href} className={rowLink}>{body}</Link> : <div className={rowPlain}>{body}</div>}</li>;
          })}
        </ul>
      )}
    </WsPanel>
  );
}
