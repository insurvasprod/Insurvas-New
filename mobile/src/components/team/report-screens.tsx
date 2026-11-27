import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { PickerSheet } from "@/components/leads/parts";
import { SegControl, SelectField, Sheet } from "@/components/leads/sheets";
import { Button, Card, Chip, Empty, F, Failed, Group, Header, Loading, Row, Screen, TextLink, Tile } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { displayName } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { activityWindow, change, comparisonName, contactsOf, dayMonth, funnelSteps, initials, keepRate, keptWeeks, lateText, leadFunnelSteps, missedThisWeek, periodName, periodOf, previousPeriod, qualityRows, rateText, type PeriodKey } from "./logic";
import { Bars, BigFigure, CardTitle, ChangeLine, MiniLine, Progress, TileGrid, openTeam } from "./parts";
import type { ActivityAnswer, CallbacksAnswer, DaysByMonth, DeclinedAnswer, FunnelLeadsAnswer, QualityAnswer, RetentionMonth, RetentionScorecard, RosterAnswer, SalesReport, ScoreLine, TeamAnswer, TrueCpaAnswer } from "./types";

/** A report's own header (I4–I4e): back to Reports, the title on the bar, an optional switch under it. */
function ReportHeader({ title, below }: { title: string; below?: ReactNode }) {
  return <Header title={title} onBack={() => router.back()} large={false} belowFull={below ? <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>{below}</View> : undefined} />;
}

// ─── I4 · Sales performance ───────────────────────────────────────────────────────────────────
const SALES_PERIODS: { key: PeriodKey; label: string }[] = [{ key: "week", label: "Week" }, { key: "month", label: "Month" }, { key: "quarter", label: "Quarter" }];
type SalesFilters = { carrier: string | null; product: string | null; producer: string | null };
const NO_FILTERS: SalesFilters = { carrier: null, product: null, producer: null };

const filterQuery = (f: SalesFilters) => `${f.carrier ? `&carrier=${f.carrier}` : ""}${f.product ? `&product=${encodeURIComponent(f.product)}` : ""}${f.producer ? `&producer=${f.producer}` : ""}`;

/**
 * Board I4 · Sales performance: the funnel "From lead to policy" as bars, each opening its list, the days from
 * application to issue with the last seven months as bars (faster is better), then why carriers declined, each
 * reason opening its applications. Every change names its comparison. No premium is drawn.
 *
 *   GET /api/app/true-cpa              Leads, Contacted, Quoted, Applied, Issued — the lead scorecard's totals, the
 *                                      web dashboard's own "Lead to policy" (owner, producer, bookkeeper; refused to a
 *                                      narrowed agency session). A bar opens GET /api/app/true-cpa/leads?stage=.
 *   GET /api/app/reports/sales         the LA-3.21 report (owner, producer, bookkeeper — in their own scope): days to
 *                                      issue, declines, and the funnel from the quote when the lead scorecard can't
 *                                      answer (refused, or a carrier or producer filter it does not have).
 *   …?days_by_month=7 / ?declined=     the monthly bars, and one decline reason's applications.
 *
 * The sliders filter by carrier, product and producer (the report's own options).
 */
export function SalesScreen() {
  const p = usePalette();
  const { api } = useSession();
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [filters, setFilters] = useState<SalesFilters>(NO_FILTERS);
  const [sheet, setSheet] = useState(false);
  const [picking, setPicking] = useState<keyof SalesFilters | null>(null);
  const now = periodOf(period);
  const was = previousPeriod(period);
  const q = filterQuery(filters);
  const leadSteps = !filters.carrier && !filters.producer;
  const load = useLoad(async () => {
    const [a, b, months, leads] = await Promise.all([
      api<{ report: SalesReport }>(`/api/app/reports/sales?from=${now.from}&to=${now.to}${q}`),
      api<{ report: SalesReport }>(`/api/app/reports/sales?from=${was.from}&to=${was.to}${q}`).catch(() => null),
      api<DaysByMonth>(`/api/app/reports/sales?to=${now.to}&days_by_month=7${q}`).catch(() => null),
      leadSteps ? api<TrueCpaAnswer>(`/api/app/true-cpa?from=${now.from}&to=${now.to}${filters.product ? `&product_code=${encodeURIComponent(filters.product)}` : ""}`).catch(() => null) : Promise.resolve(null),
    ]);
    return { a: a.report, b: b?.report ?? null, months: months?.months ?? null, leads: leads?.totals ?? null };
  }, [now.from, now.to, q]);
  const options = load.data?.a.options;
  const active = Object.values(filters).filter(Boolean).length;
  const header = (
    <Header title="Sales performance" onBack={() => router.back()} large={false}
      actions={[{ icon: "sliders", label: "Filter the report", onPress: () => setSheet(true), badge: active || undefined }]}
      belowFull={<View style={{ paddingHorizontal: 16, paddingBottom: 10 }}><SegControl items={SALES_PERIODS} value={period} onChange={(k) => setPeriod(k as PeriodKey)} /></View>} />
  );
  const span = `from=${now.from}&to=${now.to}`;

  let body;
  if (!load.data) {
    body = load.loading ? <Loading rows={5} /> : <Failed what="the sales report" message={load.error ?? "Try again."} onRetry={load.reload} />;
  } else {
    const { a, b, months, leads } = load.data;
    const fromLead = Boolean(leads && leads.leads_received > 0);
    const steps: { key: string; label: string; count: number; pct: number | null; open?: () => void }[] = leads && fromLead
      ? leadFunnelSteps(leads).map((s) => ({ ...s, open: () => openTeam(`/reports/funnel?stage=${s.key}&${span}${filters.product ? `&product=${encodeURIComponent(filters.product)}` : ""}&title=${encodeURIComponent(s.label)}`) }))
      : funnelSteps(a.funnel);
    const days = a.timing.all.submitToIssueDays.value;
    const daysBefore = b?.timing.all.submitToIssueDays.value ?? null;
    const faster = days !== null && daysBefore !== null ? change(days, daysBefore, 1) : null;
    const bars = months?.filter((m) => m.submitToIssueDays.value !== null) ?? [];
    body = (
      <View style={{ gap: 12 }}>
        <Card style={{ marginHorizontal: 16 }}>
          <CardTitle>{`${fromLead ? "From lead to policy" : "From quote to policy"} · ${periodName(period)}`}</CardTitle>
          <View style={{ gap: 12, marginTop: 12 }}>
            {steps.map((s) => {
              const bar = (
                <View accessibilityLabel={`${s.label}: ${s.count}${s.pct !== null ? `, ${s.pct}%` : ""}`}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontFamily: F.r, fontSize: 15, color: p.ink }}>{s.label}</Text>
                    <Text style={{ fontFamily: F.r, fontSize: 15, color: p.ink, fontVariant: ["tabular-nums"] }}>
                      {s.count.toLocaleString()}{s.pct !== null ? <Text style={{ fontSize: 12.5, color: p.muted }}>{` ${s.pct}%`}</Text> : null}
                    </Text>
                  </View>
                  <Progress pct={s.pct === null ? 100 : Math.max(s.pct, 2)} height={8} style={{ marginTop: 5 }} />
                </View>
              );
              return s.open
                ? <Pressable key={s.key} accessibilityRole="button" accessibilityLabel={`Open ${s.label.toLowerCase()}, ${s.count}`} onPress={s.open} testID={`funnel-${s.key}`}>{bar}</Pressable>
                : <View key={s.key}>{bar}</View>;
            })}
          </View>
        </Card>
        <Card style={{ marginHorizontal: 16 }}>
          <CardTitle>Days from application to issue</CardTitle>
          <View style={{ marginTop: 4 }}><BigFigure value={days === null ? "—" : days.toFixed(1)} unit={days === null ? undefined : "days"} /></View>
          {faster ? <ChangeLine arrow={faster.arrow} value={`${faster.text} days`} against={comparisonName(period)} note="faster is better" />
            : <MiniLine>{days === null ? "No policy issued from this period’s applications yet" : `From ${a.timing.all.submitToIssueDays.n} issued`}</MiniLine>}
          {bars.length > 1 ? (
            <View style={{ marginTop: 10 }} testID="days-by-month">
              <Bars values={bars.map((m) => m.submitToIssueDays.value ?? 0)} labels={bars.map((m) => m.label)} height={100} highlight={bars.length - 1} />
            </View>
          ) : null}
        </Card>
        <Group title={`Why carriers declined · ${a.declines.total}`}>
          {a.declines.rows.length ? a.declines.rows.map((r, i) => (
            <Row key={r.key} first={i === 0} title={r.label} right={String(r.total)}
              onPress={() => openTeam(`/reports/declines?key=${encodeURIComponent(r.key)}&${span}${q}&title=${encodeURIComponent(r.label)}`)} />
          )) : <Row first title="No declines in this period" chevron={false} />}
        </Group>
      </View>
    );
  }
  const optionItems = (k: keyof SalesFilters) => {
    const list = k === "carrier" ? (options?.carriers ?? []).map((c) => ({ key: c.id, label: c.name }))
      : k === "product" ? (options?.products ?? []).map((c) => ({ key: c.code, label: c.label }))
      : (options?.producers ?? []).map((c) => ({ key: c.id, label: displayName(c.name) }));
    return [{ key: "", label: k === "carrier" ? "Every carrier" : k === "product" ? "Every product" : "Everyone" }, ...list];
  };
  const nameOf = (k: keyof SalesFilters) => (filters[k] ? optionItems(k).find((x) => x.key === filters[k])?.label ?? null : null);
  return (
    <>
      <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>
      <Sheet visible={sheet && !picking} title="Filter" onClose={() => setSheet(false)} testID="sales-filters"
        footer={<Button label="Show the report" onPress={() => setSheet(false)} />}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <SelectField label="Carrier" value={nameOf("carrier")} placeholder="Every carrier" onPress={() => setPicking("carrier")} testID="filter-carrier" />
          <SelectField label="Product" value={nameOf("product")} placeholder="Every product" onPress={() => setPicking("product")} testID="filter-product" />
          {(options?.producers.length ?? 0) > 1 ? <SelectField label="Producer" value={nameOf("producer")} placeholder="Everyone" onPress={() => setPicking("producer")} testID="filter-producer" /> : null}
          {active ? <TextLink label="Clear the filters" onPress={() => setFilters(NO_FILTERS)} /> : null}
        </View>
      </Sheet>
      <PickerSheet title={picking === "carrier" ? "Carrier" : picking === "product" ? "Product" : "Producer"} visible={sheet && picking !== null} onClose={() => setPicking(null)}
        value={picking ? filters[picking] ?? "" : null} items={picking ? optionItems(picking) : []}
        onPick={(k) => { if (picking) setFilters((f) => ({ ...f, [picking]: k || null })); setPicking(null); }} />
    </>
  );
}

/**
 * The list behind one funnel bar (board I4: "each bar opens its list"): the leads the lead scorecard counted for that
 * figure in the period (GET /api/app/true-cpa/leads?stage=), newest first; a lead opens its record.
 */
export function FunnelListScreen({ stage, from, to, title, product }: { stage: string; from: string; to: string; title: string; product?: string }) {
  const { api } = useSession();
  const load = useLoad(() => api<FunnelLeadsAnswer>(`/api/app/true-cpa/leads?stage=${encodeURIComponent(stage)}&from=${from}&to=${to}&limit=100${product ? `&product_code=${encodeURIComponent(product)}` : ""}`), [stage, from, to, product]);
  const header = <ReportHeader title={title} />;
  let body;
  if (!load.data) {
    body = load.loading ? <Loading rows={6} /> : <Failed what="the leads" message={load.error ?? "Try again."} onRetry={load.reload} />;
  } else if (!load.data.rows.length) {
    body = <Empty icon="users" title="No leads here" body="Nobody reached this step in the period." />;
  } else {
    const total = load.data.total ?? load.data.rows.length;
    body = (
      <Group title={`${total.toLocaleString()} ${total === 1 ? "lead" : "leads"}${load.data.has_more ? ` · newest ${load.data.rows.length}` : ""}`}>
        {load.data.rows.map((r, i) => (
          <Row key={r.lead_id} first={i === 0} icon="user" title={[r.vendor_name, r.campaign_name].filter(Boolean).join(" · ") || "Lead"} meta={dayMonth(r.lead_date)} onPress={() => openTeam(`/lead/${r.lead_id}`)} />
        ))}
      </Group>
    );
  }
  return <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>;
}

/** One "Why carriers declined" reason's applications in the period (GET /api/app/reports/sales?declined=); a row opens the lead. */
export function DeclinesScreen({ reasonKey, query, title }: { reasonKey: string; query: string; title: string }) {
  const { api } = useSession();
  const load = useLoad(() => api<DeclinedAnswer>(`/api/app/reports/sales?declined=${encodeURIComponent(reasonKey)}&${query}`), [reasonKey, query]);
  const header = <ReportHeader title={title} />;
  let body;
  if (!load.data) {
    body = load.loading ? <Loading rows={5} /> : <Failed what="the declines" message={load.error ?? "Try again."} onRetry={load.reload} />;
  } else if (!load.data.applications.length) {
    body = <Empty icon="file" title="No applications" body="None declined for this reason in the period." />;
  } else {
    body = (
      <Group title={`Declined · ${load.data.applications.length}`}>
        {load.data.applications.map((a, i) => (
          <Row key={a.id} first={i === 0} icon="file" title={displayName(a.clientName)} meta={[a.carrierName, a.submittedOn ? `submitted ${dayMonth(a.submittedOn)}` : null].filter(Boolean).join(" · ")} onPress={() => openTeam(`/lead/${a.leadId}`)} />
        ))}
      </Group>
    );
  }
  return <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>;
}

// ─── I4b · Team activity ──────────────────────────────────────────────────────────────────────
const ACTIVITY_PERIODS = [{ key: "today", label: "Today" }, { key: "week", label: "Week" }, { key: "month", label: "Month" }];

/**
 * Board I4b · Team activity (GET /api/app/activity, the web's Team activity; owner, producer, setter): per person,
 * dials, contacts and applications — a setter's appointments set instead, the row labelled "(setter)" (the roles
 * from GET /api/app/team for the owner; a manager, whom that route refuses, reads them from the agency roster,
 * GET /api/app/agency/producers). The scope is the server's: a setter gets only their own row (their
 * scorecard), a manager his reports, a producer himself. Talk time is not drawn: no call lengths are recorded until
 * a phone provider is connected, so the tiles and the order are by dials.
 */
export function ActivityScreen() {
  const { api, me } = useSession();
  const owner = me?.role === "owner" && me.memberRole !== "manager";
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");
  const w = activityWindow(period);
  const load = useLoad(() => api<ActivityAnswer>(`/api/app/activity?from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}&page_size=1`), [period, w.from.slice(0, 13)]);
  const manager = me?.memberRole === "manager";
  const team = useLoad(() => (owner ? api<TeamAnswer>("/api/app/team").catch(() => null) : Promise.resolve(null)), [owner]);
  const roster = useLoad(() => (manager ? api<RosterAnswer>("/api/app/agency/producers").catch(() => null) : Promise.resolve(null)), [manager]);
  const header = <ReportHeader title="Team activity" below={<SegControl items={ACTIVITY_PERIODS} value={period} onChange={(k) => setPeriod(k as typeof period)} />} />;
  const roleOf = new Map<string, string | null>([
    ...(team.data?.members ?? []).map((m) => [m.id, m.role] as [string, string | null]),
    ...(roster.data?.rows ?? []).map((r) => [r.userId, r.role] as [string, string | null]),
  ]);

  let body;
  if (!load.data) {
    body = load.loading ? <Loading rows={4} /> : <Failed what="the activity" message={load.error ?? "Try again."} onRetry={load.reload} />;
  } else {
    const rows = load.data.scorecard.filter((r) => r.agent_user_id).sort((a, b) => b.clicked - a.clicked || (a.agent_name ?? "").localeCompare(b.agent_name ?? ""));
    const dials = rows.reduce((s, r) => s + r.clicked, 0);
    const contacts = rows.reduce((s, r) => s + contactsOf(r), 0);
    body = (
      <View>
        <TileGrid>
          <Tile label="Dials" value={dials.toLocaleString()} />
          <Tile label="Contacts" value={contacts.toLocaleString()} detail={dials ? `${Math.round((100 * contacts) / dials)}% of dials` : undefined} />
        </TileGrid>
        {rows.length ? (
          <Group title="By person · dials">
            {rows.map((r, i) => {
              const name = displayName(r.agent_name ?? "Someone");
              const setter = roleOf.get(r.agent_user_id ?? "") === "setter";
              const last = setter ? `${r.appointments_booked} set` : `${r.applications_submitted} ${r.applications_submitted === 1 ? "app" : "apps"}`;
              return <Row key={r.agent_user_id} first={i === 0} avatar={initials(name)} title={setter ? `${name} (setter)` : name} meta={`${r.clicked.toLocaleString()} dials · ${contactsOf(r)} contacts · ${last}`} chevron={false} />;
            })}
          </Group>
        ) : <Empty icon="phone" title="No dials yet" body={period === "today" ? "Nobody has dialled today yet." : "No dials in this period."} />}
      </View>
    );
  }
  return <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>;
}

// ─── I4c · Retention scorecard ────────────────────────────────────────────────────────────────
export type RetentionCardData =
  | { available: true; month: boolean; total: ScoreLine; groups: { title: string; rows: (ScoreLine & { label: string })[] }; people: (ScoreLine & { name: string })[] }
  | { available: false; message: string };

/**
 * This month's scorecard by reason (GET /api/app/scorecard?kind=retention, owner and producer). A retention rep is
 * kept to the ladder's own routes, so for them it is the ladder's scorecard (GET /api/app/retention/cases?scorecard=90):
 * the last 90 days, by step.
 */
export async function loadRetentionCard(api: <T>(path: string) => Promise<T>): Promise<RetentionCardData> {
  try {
    const m = await api<RetentionMonth>("/api/app/scorecard?kind=retention");
    return m.available ? { available: true, month: true, total: m.total, groups: { title: "Save rate by reason", rows: m.reasons }, people: m.people } : m;
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 403) throw e;
    const r = await api<RetentionScorecard>("/api/app/retention/cases?scorecard=90");
    return r.available ? { available: true, month: false, total: r.total, groups: { title: "Save rate by step", rows: r.steps }, people: r.people } : r;
  }
}

/**
 * Board I4c · Retention scorecard for this month (the ladder's cases behind the Retention module's gate): worked,
 * reached, saved and lost in counts, the save rate by the reason the case was opened for and by person. The save rate
 * is saved of saved and lost, and only over 10 decided (the counts under that). An owner sees everyone; anyone else
 * their own card. No money: the premium kept stays on the computer. (A retention rep's phone: see loadRetentionCard.)
 */
export function RetentionScoreScreen() {
  const { api } = useSession();
  const load = useLoad(() => loadRetentionCard(api), []);
  const header = <ReportHeader title="Retention scorecard" />;
  let body;
  if (!load.data) {
    body = load.loading ? <Loading rows={4} /> : <Failed what="the scorecard" message={load.error ?? "Try again."} onRetry={load.reload} />;
  } else if (!load.data.available) {
    body = <Empty icon="buoy" title="Not switched on yet" body={load.data.message} />;
  } else {
    const t = load.data.total;
    const worked = t.open + t.saved + t.lost + t.closedNoSave;
    const reached = worked - t.unreachable;
    body = (
      <View>
        <TileGrid>
          <Tile label="Worked" value={String(worked)} detail={load.data.month ? "This month" : "Last 90 days"} />
          <Tile label="Saved" value={String(t.saved)} detail={t.saved + t.lost === 0 ? "None decided yet" : t.rate === null ? rateText(t) : `${rateText(t)} save rate`} />
          <Tile label="Reached" value={String(reached)} detail={worked ? `${Math.round((100 * reached) / worked)}% contact rate` : undefined} />
          <Tile label="Lost" value={String(t.lost)} detail={`${t.open} still open`} />
        </TileGrid>
        {load.data.groups.rows.length ? (
          <Group title={load.data.groups.title}>
            {load.data.groups.rows.map((s, i) => <Row key={s.key} first={i === 0} title={s.label} right={rateText(s)} chevron={false} />)}
          </Group>
        ) : null}
        {load.data.people.length ? (
          <Group title="By person">
            {load.data.people.map((l, i) => <Row key={l.key} first={i === 0} avatar={initials(l.name)} title={displayName(l.name)} right={rateText(l)} chevron={false} />)}
          </Group>
        ) : null}
      </View>
    );
  }
  return <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>;
}

// ─── I4d · Callbacks kept ─────────────────────────────────────────────────────────────────────
/**
 * Board I4d · Callbacks kept (GET /api/app/callbacks, the calendar's own list; owner, producer, assistant in their
 * scope): kept of kept and missed over the last eight weeks, week by week, with the report's rule for what counts as
 * kept and its small-sample rule. The chip is the eight weeks against the eight before (sixteen weeks are read), in
 * points: gold when it rose. This week's missed callbacks follow, each opening its lead; none missed, no list.
 */
export function CallbacksKeptScreen() {
  const p = usePalette();
  const { api } = useSession();
  const w = activityWindow("week");
  const from = new Date(Date.parse(w.from) - 15 * 7 * 86_400_000).toISOString();
  const load = useLoad(() => api<CallbacksAnswer>(`/api/app/callbacks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(w.to)}`), [from.slice(0, 10)]);
  const header = <ReportHeader title="Callbacks kept" />;
  let body;
  if (!load.data) {
    body = load.loading ? <Loading rows={4} /> : <Failed what="the callbacks" message={load.error ?? "Try again."} onRetry={load.reload} />;
  } else {
    const sixteen = keptWeeks(load.data.callbacks, new Date(), 16);
    const weeks = sixteen.slice(8);
    const all = keepRate(weeks);
    const before = keepRate(sixteen.slice(0, 8));
    const pts = all.rate !== null && before.rate !== null ? all.rate - before.rate : null;
    const missed = missedThisWeek(load.data.callbacks);
    body = !weeks.some((x) => x.booked) ? (
      <Empty icon="calendar" title="No callbacks yet" body="Callbacks booked in the last eight weeks show here." />
    ) : (
      <View>
        <Card style={{ marginHorizontal: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>Kept on time · last 8 weeks</Text>
            {pts ? <Chip tone={pts > 0 ? "gold" : "neutral"}>{`${pts > 0 ? "↑" : "↓"} ${Math.abs(pts)} pts`}</Chip> : null}
          </View>
          <BigFigure value={all.rate === null ? `${all.kept} of ${all.decided}` : `${all.rate}%`} size={34} />
          <View style={{ marginTop: 8 }}><Bars values={weeks.map((x) => x.rate ?? 0)} labels={weeks.map((x) => x.label)} height={90} highlight={weeks.length - 1} /></View>
        </Card>
        {missed.length ? (
          <Group title={`Missed this week · ${missed.length}`}>
            {missed.map((c, i) => (
              <Row key={c.id} first={i === 0} title={displayName(c.customerName)} meta={`${displayName(c.assigneeName).split(/\s+/)[0]} · ${lateText(c)}${c.status === "missed" ? "" : ", still open"}`}
                onPress={() => openTeam(`/lead/${c.leadId}`)} />
            ))}
          </Group>
        ) : null}
      </View>
    );
  }
  return <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>;
}

// ─── I4e · Partner quality ────────────────────────────────────────────────────────────────────
/**
 * Board I4e · Partner quality (GET /api/app/partner-quality, the web's report; owner, producer, bookkeeper): the
 * cost-free view of partners — sold per 100 leads sent (a sale to a partner is a submitted application, what the
 * deal pays for), leads sent and how many the agency disqualified. Never spend, so roles that must not see it can
 * still judge quality. Every partner opens its page (I8); the agency's side of it (owed, deal, people) only for who
 * may read partner records.
 */
export function PartnerQualityScreen() {
  const { api } = useSession();
  const now = periodOf("month");
  const load = useLoad(() => api<QualityAnswer>(`/api/app/partner-quality?from=${now.from}&to=${now.to}`), [now.from]);
  const header = <ReportHeader title="Partner quality" />;
  let body;
  if (!load.data) {
    body = load.loading ? <Loading rows={4} /> : <Failed what="partner quality" message={load.error ?? "Try again."} onRetry={load.reload} />;
  } else {
    const rows = qualityRows(load.data.rows);
    body = rows.length ? (
      <Group title={`Sold per 100 leads · ${periodName("month")}`}>
        {rows.map((r, i) => (
          <Row key={r.row.partner_id} first={i === 0} icon="handshake" title={r.row.partner_name} meta={`${r.row.sent.toLocaleString()} leads · ${r.row.disqualified} disqualified`}
            chip={r.chip ? <Chip tone={r.chip.tone}>{r.chip.text}</Chip> : null} right={r.per100.toFixed(1)}
            onPress={() => openTeam(`/team/partner/${r.row.partner_id}`)} />
        ))}
      </Group>
    ) : <Empty icon="handshake" title="No partner leads this month" body="Partners appear here once they send leads." />;
  }
  return <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>;
}
