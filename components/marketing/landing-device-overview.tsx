import { ArrowRight, BookOpen, Calculator, FilePenLine, LifeBuoy, ShieldCheck, Users } from "lucide-react";

import { DashChart, DashColumns, DashHero, DashList, DashModules, DashRing, type DashItem } from "@/components/app/home/dash/dash-kit";
import { Button } from "@/components/ui/button";
import { LineSeries } from "@/components/ui/chart";
import { DeltaChip, StatStrip, StatTile } from "@/components/ui/stat";
import { ViewTabs } from "@/components/ui/view-tabs";
import styles from "@/components/marketing/landing-device.module.css";
import { money, VENDORS } from "@/components/marketing/landing-sample-data";

/**
 * The hero device's dashboard (owner, 7 Nov: "the laptop should show the design that we have inside, just
 * with good statistics"): the app's own Overview (app/app/(shell)/dashboard, components/app/home/views/
 * overview-view.tsx), drawn with the app's own cards (dash-kit, StatStrip, LineSeries), so it changes when
 * the app does. Only the data is the landing page's: illustrative figures of a healthy agency late in
 * October, agreeing with the True CPA report further down (VENDORS: the month's leads, spend, issued).
 *
 * The app's grid steps by the browser's width (lg, xl); this screen is always drawn at 1280 and scaled, so
 * it lays the same cards out on a fixed grid of its own (landing-device.module.css, `.overview`). It is a
 * picture: `inert`, so its links and buttons are never focused or clicked.
 */
const LEADS = VENDORS.reduce((sum, vendor) => sum + vendor.funnel[0], 0);
const step = (index: number) => VENDORS.reduce((sum, vendor) => sum + vendor.funnel[index], 0);
const ISSUED = step(6);
const SPEND = VENDORS.reduce((sum, vendor) => sum + vendor.spend, 0);
/** The sample first-year commission per issued policy, as the True CPA report uses. */
const EARNED = ISSUED * 132.4;
const AVERAGE_POLICY = 857;

/** Annual premium issued and submitted each month of 2026, to 29 October. */
const MONTHS = [
  ["Jan", 248_100, 296_400], ["Feb", 273_400, 318_900], ["Mar", 319_200, 371_500], ["Apr", 334_800, 392_100], ["May", 368_300, 421_700],
  ["Jun", 352_600, 418_200], ["Jul", 406_900, 469_300], ["Aug", 441_200, 503_800], ["Sep", 431_500, 512_600], ["Oct", ISSUED * AVERAGE_POLICY, 538_900],
] as const;
const YEAR_ISSUED = MONTHS.reduce((sum, month) => sum + month[1], 0);
const YEAR_SUBMITTED = MONTHS.reduce((sum, month) => sum + month[2], 0);
const BEST = MONTHS.reduce((top, month) => (month[1] > top[1] ? month : top), MONTHS[0]);
const GOAL = MONTHS[8][1];
const OCTOBER = MONTHS[9][1];
const SHARE = Math.round((OCTOBER / GOAL) * 100);

const dollars = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const pct = (part: number) => Math.round((part / LEADS) * 1000) / 10;

const NEEDS = [
  { key: "callbacks", label: "Callbacks due", value: "9", footnote: "2 overdue", tone: "danger" as const },
  { key: "pending", label: "Pending cases", value: "38", footnote: "6 waiting on the client", tone: "warning" as const },
  { key: "risk", label: "Policies at risk", value: "14", footnote: "A payment failed this week", tone: "warning" as const },
  { key: "lines", label: "Lines to check", value: "7", footnote: "Sample Carrier Life statement" },
  { key: "ready", label: "Leads ready to dial", value: "212", footnote: "Fresh in the last hour" },
];

const TODAY: DashItem[] = [
  { key: "1", mark: "☏", tone: "danger", title: "Ruth Alvarez", detail: "Callback · overdue", value: "Now", href: "#" },
  { key: "2", mark: "◷", tone: "info", title: "James Miller", detail: "Appointment · Dana K.", value: "10:30 AM", href: "#" },
  { key: "3", mark: "☏", tone: "neutral", title: "Nina Rossi", detail: "Callback", value: "11:15 AM", href: "#" },
  { key: "4", mark: "◷", tone: "info", title: "Omar Shah", detail: "Appointment · Carol T.", value: "1:00 PM", href: "#" },
  { key: "5", mark: "☏", tone: "neutral", title: "Dale Price", detail: "Callback", value: "2:45 PM", href: "#" },
  { key: "6", mark: "☏", tone: "neutral", title: "Grace Lee", detail: "Callback", value: "4:00 PM", href: "#" },
];

const MODULES = [
  { key: "leads", label: "Leads", figure: dollars(SPEND), line: `lead spend · ${dollars(SPEND / ISSUED)} per sale`, icon: <Users className="size-4" aria-hidden="true" /> },
  { key: "sales", label: "Sales", figure: "38", line: "cases pending", icon: <FilePenLine className="size-4" aria-hidden="true" /> },
  { key: "retention", label: "Retention", figure: "$4,912/mo", line: "saved this month · 61 cases", icon: <LifeBuoy className="size-4" aria-hidden="true" /> },
  { key: "book", label: "Book of business", figure: "$5,842,300", line: "a year · 6,914 in force", icon: <BookOpen className="size-4" aria-hidden="true" /> },
  { key: "accounting", label: "Accounting", figure: money(EARNED - SPEND), line: "profit · October", icon: <Calculator className="size-4" aria-hidden="true" /> },
  { key: "compliance", label: "Compliance", figure: "100%", line: "dials cleared the checks", icon: <ShieldCheck className="size-4" aria-hidden="true" /> },
].map((module) => ({ ...module, href: "#" }));

// The views a plan offers; four here, so the row fits this screen as it fits the app's.
const TABS = ["Overview", "Leads", "Retention", "Book of business"].map((label) => ({ key: label, label }));

/** The title row, as the dashboard's PageHeader draws it: the greeting and the views, the next callback and the actions. */
export function DeviceOverviewHeader() {
  return (
    <div className={styles.dashHead} inert>
      <div className={styles.dashTitle}>
        <h3>Good morning, Dana</h3>
        <ViewTabs label="Dashboard view" value="Overview" tabs={TABS} onChange={() => {}} />
      </div>
      <div className={styles.dashActions}>
        <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-[var(--surface-alt)] px-3 text-sm">
          <span className="size-2 rounded-full bg-[var(--error)]" aria-hidden="true" />
          <span className="text-muted-foreground">Next · <span className="font-semibold text-foreground">Ruth Alvarez</span></span>
          <span className="font-semibold text-[var(--error-ink)]">now</span>
          <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </span>
        {/* A picture of the action (the screen is inert), so a span in the button's dress, not a button. */}
        <Button asChild><span>Start calling</span></Button>
      </div>
    </div>
  );
}

/** The Overview's cards: Needs you; premium and the month's goal, modules and lead to policy; the money card and Today. */
export function DeviceOverview() {
  return (
    <div className={styles.overview} inert>
      <StatStrip label="Needs you" className={styles.needs}>
        {NEEDS.map((need) => <StatTile key={need.key} label={need.label} value={need.value} valueTone={need.tone} footnote={need.footnote} reserveFootnote />)}
      </StatStrip>
      <div className={styles.overviewMain}>
        <div className={styles.overviewTop}>
          <DashChart
            title="Premium · submitted and issued"
            link={{ label: "Policies", href: "#" }}
            total={dollars(YEAR_ISSUED)}
            totalLine="issued this year"
            change={<DeltaChip value={21} title="On 2025 to this day" />}
            legend={[{ label: "Issued", tone: "primary" }, { label: "Submitted", tone: "info" }]}
            legendTop
          >
            <LineSeries
              points={MONTHS.map(([label, issued]) => ({ key: label, label: `${label} 2026`, value: issued }))}
              compare={{ points: MONTHS.map(([label, , submitted]) => ({ key: label, label, value: submitted })), label: "Submitted" }}
              summary="Annual premium issued and submitted each month of 2026."
              format={(value) => `$${Math.round(value / 1000)}k`}
              unit="issued"
              minHeight={96}
            />
            <dl className={styles.premiumFacts}>
              {[
                ["Policies issued", Math.round(YEAR_ISSUED / AVERAGE_POLICY).toLocaleString("en-US")],
                ["Submitted", dollars(YEAR_SUBMITTED)],
                ["Average policy", `${dollars(AVERAGE_POLICY)}/yr`],
                ["Best month", `${BEST[0]} · $${Math.round(BEST[1] / 1000)}k`],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-xl bg-[var(--surface-alt)] px-3 py-2">
                  <dt className="truncate text-[0.6875rem] text-muted-foreground">{label}</dt>
                  <dd className="m-0 truncate text-[0.8125rem] font-semibold tabular-nums text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          </DashChart>
          <DashRing
            title="October goal"
            link={{ label: "Policies", href: "#" }}
            value={SHARE}
            center={`${SHARE}%`}
            label={`${SHARE}% of the October goal`}
            lines={[
              { label: "Issued", value: `${dollars(OCTOBER)} of ${dollars(GOAL)}` },
              { label: "Policies issued", value: ISSUED.toLocaleString("en-US") },
              { label: "Placement rate", value: "71%" },
              { label: "13-month persistency", value: "88%" },
            ]}
          />
        </div>
        <div className={styles.overviewMiddle}>
          <DashModules modules={MODULES} />
          <DashColumns
            title="Lead to policy"
            sub="Every lead in October, to an issued policy"
            rate={`${pct(ISSUED)}%`}
            link={{ label: "Open the funnel", href: "#" }}
            steps={[
              { key: "leads", label: "Leads", count: LEADS, pct: 100 },
              { key: "called", label: "Called", count: step(2), pct: pct(step(2)) },
              { key: "quoted", label: "Quoted", count: step(4), pct: pct(step(4)) },
              { key: "apps", label: "Apps", count: step(5), pct: pct(step(5)) },
              { key: "issued", label: "Issued", count: ISSUED, pct: pct(ISSUED) },
            ]}
          />
        </div>
      </div>
      <div className={styles.overviewSide}>
        <DashHero kicker="COMMISSION RECEIVED" value={money(EARNED)} line="matched to policies · October" facts={[{ label: "True CPA", value: money(SPEND / ISSUED) }, { label: "Lead spend", value: money(SPEND) }]} href="#" />
        <DashList title="Today" period="9 things" link={{ label: "Calendar", href: "#" }} items={TODAY} />
      </div>
    </div>
  );
}
