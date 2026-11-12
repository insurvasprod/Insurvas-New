import type { CSSProperties } from "react";
import { Check, Clock, PhoneCall, PhoneIncoming, ShieldCheck, Star, UserRound } from "lucide-react";

import styles from "@/components/marketing/landing-device.module.css";
import { money, VENDORS } from "@/components/marketing/landing-sample-data";

/**
 * The other pages of the hero's device (owner, 6 Nov; Umar's A1.4: "it changes to Inbound and shows
 * how Inbound works, then Dialer, then Callbacks"). Each is a still, believable screen of that part
 * of the app, drawn with the dashboard's own cards and figure tiles. Sample data throughout, with
 * the same people, partners and vendors as the dashboard, so the screens agree with one another.
 *
 * Owner, 7 Nov: every section of the sidebar opens a page, not only some. The pages run in the
 * sidebar's order, and the cycle visits each.
 */
export type DevicePageKey =
  | "dashboard" | "agency" | "inbound" | "dialer" | "callbacks" | "calendar" | "leads" | "leadFlow" | "applications" | "dealFlow"
  | "book" | "sync" | "retention" | "commissions" | "accounting" | "partners" | "compliance" | "reports" | "settings";

/** `section` is the page's menu group, shown in the trail over the title, as the app shows it. */
export const DEVICE_PAGES: { key: DevicePageKey; section: string; crumb: string; title: string; sub: string }[] = [
  { key: "dashboard", section: "Home", crumb: "Dashboard", title: "Good morning, Dana", sub: "Sample Agency · sample data" },
  { key: "agency", section: "Home", crumb: "Agency", title: "Agency", sub: "Every producer, October · sample data" },
  { key: "inbound", section: "Today", crumb: "Inbound", title: "Inbound floor", sub: "Live transfers from your partners · sample data" },
  { key: "dialer", section: "Today", crumb: "Dialer", title: "Dialer", sub: "Final expense · Cobalt Media list · sample data" },
  { key: "callbacks", section: "Today", crumb: "Callbacks", title: "Callbacks", sub: "Today, in each client’s own time · sample data" },
  { key: "calendar", section: "Today", crumb: "Calendar", title: "Calendar", sub: "Today’s appointments, set by your setters · sample data" },
  { key: "leads", section: "Leads", crumb: "Lead workspace", title: "Lead workspace", sub: "Every lead you bought · sample data" },
  { key: "leadFlow", section: "Leads", crumb: "Lead flow", title: "Lead flow", sub: "Vendors and campaigns this month · sample data" },
  { key: "applications", section: "Sales", crumb: "Applications", title: "Applications", sub: "This week · sample data" },
  { key: "dealFlow", section: "Sales", crumb: "Daily deal flow", title: "Daily deal flow", sub: "Today · sample data" },
  { key: "book", section: "Book of Business", crumb: "Policies", title: "Policies", sub: "The book you already have · sample data" },
  { key: "sync", section: "Carrier Sync", crumb: "Needs you", title: "Carrier sync", sub: "Every carrier file, read and matched to its policy · sample data" },
  { key: "retention", section: "Retention", crumb: "Cases", title: "Retention cases", sub: "Every policy the carrier files flag, with what to do · sample data" },
  { key: "commissions", section: "Commissions", crumb: "Pay issues", title: "Pay issues", sub: "What the carriers paid against what they owed · sample data" },
  { key: "accounting", section: "Accounting", crumb: "Profit & loss", title: "Profit & loss", sub: "October · sample data" },
  { key: "partners", section: "Partners", crumb: "Publishers", title: "Publishers", sub: "The partners who send you live transfers · sample data" },
  { key: "compliance", section: "Compliance", crumb: "Overview", title: "Compliance", sub: "Every dial checked before it is placed · sample data" },
  { key: "reports", section: "Reports", crumb: "True CPA", title: "True CPA", sub: "What an issued policy really cost, by vendor · sample data" },
  { key: "settings", section: "Settings", crumb: "Team", title: "Settings", sub: "Sample Agency · Advanced plan · sample data" },
];

function Kpis({ items }: { items: { label: string; value: string; hint: string; accent?: boolean }[] }) {
  return (
    <div className={styles.kpis}>
      {items.map((kpi) => (
        <div key={kpi.label} className={styles.kpi} data-accent={kpi.accent ?? false}>
          <span>{kpi.label}</span>
          <b>{kpi.value}</b>
          <small>{kpi.hint}</small>
        </div>
      ))}
    </div>
  );
}

/** One cell of a table card: a line (with a muted line under it), or a status chip. */
type Cell = string | { main: string; sub?: string } | { chip: string; tone: "good" | "warn" | "bad" | "info" | "neutral" };

/** A card of rows on one grid: the first column names the row; the rest are right-aligned. */
function Table({ title, note, cols, heads, rows }: { title: string; note?: string; cols: string; heads?: readonly string[]; rows: readonly (readonly Cell[])[] }) {
  const grid = { gridTemplateColumns: cols } as CSSProperties;
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}><b>{title}</b>{note && <span>{note}</span>}</div>
      {heads && <div className={styles.tHeads} style={grid}>{heads.map((head, i) => <span key={i}>{head}</span>)}</div>}
      {rows.map((row, r) => (
        <div key={r} className={styles.tRow} style={grid}>
          {row.map((cell, c) => typeof cell === "string"
            ? <span key={c}>{cell}</span>
            : "chip" in cell
              ? <em key={c} className={styles.tChip} data-tone={cell.tone}>{cell.chip}</em>
              : <span key={c}><b>{cell.main}</b>{cell.sub && <small>{cell.sub}</small>}</span>)}
        </div>
      ))}
    </section>
  );
}

const SPEND = VENDORS.reduce((sum, vendor) => sum + vendor.spend, 0);
const ISSUED = VENDORS.reduce((sum, vendor) => sum + vendor.funnel[vendor.funnel.length - 1], 0);
/** The sample first-year commission per issued policy, as the dashboard and the True CPA report use. */
const EARNED = ISSUED * 132.4;

function Agency() {
  return (
    <>
      <Kpis items={[
        { label: "Issued premium", value: "$413,074", hint: "October · 96% of goal", accent: true },
        { label: "Producers", value: "6", hint: "all on the floor today" },
        { label: "Placement rate", value: "71%", hint: "submitted to issued" },
        { label: "Chargebacks", value: "1.8%", hint: "of issued premium" },
      ]} />
      <Table title="Producers" note="October" cols="minmax(0,1.5fr) .7fr .6fr 1fr 6rem" heads={["Producer", "Dials", "Sales", "Issued premium", "Placement"]} rows={[
        [{ main: "Dana K.", sub: "Final expense" }, "2,184", "118", "$101,126", { chip: "78%", tone: "good" }],
        [{ main: "Omar S.", sub: "Final expense · Term life" }, "2,031", "104", "$89,128", { chip: "74%", tone: "good" }],
        [{ main: "Carol T.", sub: "Inbound" }, "1,402", "96", "$82,272", { chip: "72%", tone: "good" }],
        [{ main: "James W.", sub: "Final expense" }, "1,876", "84", "$71,988", { chip: "69%", tone: "info" }],
        [{ main: "Priya N.", sub: "Medicare" }, "1,240", "80", "$68,560", { chip: "66%", tone: "info" }],
      ]} />
    </>
  );
}

function Calendar() {
  return (
    <>
      <Kpis items={[
        { label: "Appointments today", value: "8", hint: "3 this morning" },
        { label: "Booked this week", value: "41", hint: "by 2 setters" },
        { label: "Kept", value: "92%", hint: "last 30 days", accent: true },
        { label: "To close out", value: "2", hint: "how did they go?" },
      ]} />
      <Table title="Today" note="Each time is the client’s own" cols="5.5rem minmax(0,1.5fr) 1fr 6.5rem" rows={[
        [{ main: "9:00", sub: "her time, ET" }, { main: "Martha G.", sub: "Final expense review" }, "Dana K.", { chip: "Kept", tone: "good" }],
        [{ main: "10:30", sub: "his time, CT" }, { main: "James Miller", sub: "Set by Priya · Term life" }, "Dana K.", { chip: "Confirmed", tone: "info" }],
        [{ main: "1:00", sub: "his time, ET" }, { main: "Omar Shah", sub: "Set by Priya · Final expense" }, "Carol T.", { chip: "Confirmed", tone: "info" }],
        [{ main: "2:30", sub: "her time, MT" }, { main: "Grace Lee", sub: "Beneficiary change" }, "Omar S.", { chip: "Booked", tone: "neutral" }],
        [{ main: "4:15", sub: "his time, PT" }, { main: "Henry B.", sub: "Second look at the quote" }, "Dana K.", { chip: "Booked", tone: "neutral" }],
      ]} />
    </>
  );
}

function Book() {
  return (
    <>
      <Kpis items={[
        { label: "In force", value: "6,914", hint: "policies" },
        { label: "Annual premium", value: "$5,842,300", hint: "in force", accent: true },
        { label: "Issued this month", value: String(ISSUED), hint: "from 4 carriers" },
        { label: "13-month persistency", value: "88%", hint: "kept past the first year" },
      ]} />
      <Table title="Policies" note="Kept in step by the carrier files" cols="minmax(0,1.3fr) minmax(0,1.1fr) .8fr 7.5rem" heads={["Policy", "Carrier", "Premium", "Status"]} rows={[
        [{ main: "Ruth Alvarez", sub: "SAMPLE-0482 · Final expense" }, "Sample Carrier Life", "$70.00/mo", { chip: "In force", tone: "good" }],
        [{ main: "Nina Rossi", sub: "SAMPLE-0471 · Final expense" }, "Sample Mutual", "$64.10/mo", { chip: "In force", tone: "good" }],
        [{ main: "Dale Price", sub: "SAMPLE-0533 · Term life" }, "Sample Carrier Life", "$88.40/mo", { chip: "Issued", tone: "info" }],
        [{ main: "Walter K.", sub: "SAMPLE-0398 · Final expense" }, "Sample Mutual", "$52.80/mo", { chip: "Payment failed", tone: "warn" }],
        [{ main: "Edna S.", sub: "SAMPLE-0402 · Final expense" }, "Sample Carrier Life", "$71.90/mo", { chip: "In force", tone: "good" }],
      ]} />
    </>
  );
}

function Sync() {
  return (
    <>
      <Kpis items={[
        { label: "Carrier files", value: "46", hint: "this month, from 4 carriers" },
        { label: "Lines read", value: "12,408", hint: "policies and commissions" },
        { label: "Matched on their own", value: "99.4%", hint: "to a policy and a producer", accent: true },
        { label: "Needs you", value: "7", hint: "a person decides" },
      ]} />
      <Table title="Carrier files" note="Newest first" cols="minmax(0,1.7fr) .6fr .7fr 7.5rem" heads={["File", "Lines", "Matched", ""]} rows={[
        [{ main: "Sample Carrier Life · commissions", sub: "October 27 · statement" }, "1,204", "1,197", { chip: "7 need you", tone: "warn" }],
        [{ main: "Sample Mutual · policy status", sub: "October 27 · daily file" }, "3,880", "3,880", { chip: "Matched", tone: "good" }],
        [{ main: "Sample Carrier Life · policy status", sub: "October 26 · daily file" }, "4,102", "4,102", { chip: "Matched", tone: "good" }],
        [{ main: "Sample Mutual · commissions", sub: "October 24 · statement" }, "986", "986", { chip: "Paid", tone: "info" }],
      ]} />
    </>
  );
}

function Retention() {
  return (
    <>
      <Kpis items={[
        { label: "Open cases", value: "14", hint: "flagged by the carrier files" },
        { label: "Saved this month", value: "$4,912/mo", hint: "61 cases", accent: true },
        { label: "Save rate", value: "74%", hint: "cases worked in time" },
        { label: "Premium at risk", value: "$11,840", hint: "a year, open cases" },
      ]} />
      <Table title="Cases" note="At their risk point, most urgent first" cols="minmax(0,1.3fr) minmax(0,1.3fr) .55fr .7fr 7rem" rows={[
        [{ main: "Walter K.", sub: "Sample Mutual · $52.80/mo" }, { main: "Payment failed", sub: "The bank returned the draft" }, "3 days", "Dana K.", { chip: "Call today", tone: "bad" }],
        [{ main: "Frank L.", sub: "Sample Carrier Life · $58.20/mo" }, { main: "Lapse notice", sub: "Grace period ends Nov 12" }, "14 days", "Omar S.", { chip: "Working", tone: "warn" }],
        [{ main: "Martha G.", sub: "Sample Mutual · $61.30/mo" }, { main: "Draft date moved", sub: "Waiting on the carrier" }, "—", "Carol T.", { chip: "Sent", tone: "info" }],
        [{ main: "Henry B.", sub: "Sample Carrier Life · $44.90/mo" }, { main: "Payment repaired", sub: "Proved by the Oct 27 file" }, "—", "Dana K.", { chip: "Saved", tone: "good" }],
      ]} />
    </>
  );
}

function Commissions() {
  return (
    <>
      <Kpis items={[
        { label: "Expected", value: "$65,101.20", hint: "October, from your rates" },
        { label: "Received", value: money(EARNED), hint: "matched to policies", accent: true },
        { label: "Short paid", value: "$1,284.40", hint: "on 3 lines" },
        { label: "Recovered", value: "$2,310.00", hint: "after a dispute" },
      ]} />
      <Table title="Pay issues" note="Each line against its policy" cols="minmax(0,1.6fr) .8fr .8fr 7rem" heads={["Policy", "Owed", "Paid", ""]} rows={[
        [{ main: "Dale Price · SAMPLE-0533", sub: "Sample Carrier Life · paid at the wrong rate" }, "$636.48", "$212.16", { chip: "Short", tone: "bad" }],
        [{ main: "Nina Rossi · SAMPLE-0471", sub: "Sample Mutual · advance missing" }, "$461.52", "$0.00", { chip: "Short", tone: "bad" }],
        [{ main: "Edna S. · SAMPLE-0402", sub: "Sample Carrier Life · chargeback in error" }, "$0.00", "−$398.40", { chip: "Disputed", tone: "warn" }],
        [{ main: "Ruth Alvarez · SAMPLE-0482", sub: "Sample Carrier Life" }, "$504.00", "$504.00", { chip: "Paid right", tone: "good" }],
      ]} />
    </>
  );
}

function Accounting() {
  return (
    <>
      <Kpis items={[
        { label: "Commission received", value: money(EARNED), hint: "October" },
        { label: "Lead spend", value: money(SPEND), hint: "4 vendors" },
        { label: "Profit", value: money(EARNED - SPEND), hint: `${Math.round(((EARNED - SPEND) / EARNED) * 100)}% margin`, accent: true },
        { label: "Vendor returns", value: "$1,240.00", hint: "credited back" },
      ]} />
      <Table title="Profit & loss" note="October, from the carrier files and your bills" cols="minmax(0,1.6fr) 1fr" rows={[
        [{ main: "Commission received", sub: `Matched to ${ISSUED} policies` }, money(EARNED)],
        ...VENDORS.map((vendor): Cell[] => [{ main: `Lead spend · ${vendor.name}`, sub: vendor.campaign }, `−${money(vendor.spend)}`]),
        [{ main: "Profit", sub: "Before payroll and software" }, money(EARNED - SPEND)],
      ]} />
    </>
  );
}

function Partners() {
  return (
    <>
      <Kpis items={[
        { label: "Publishers", value: "3", hint: "sending live transfers" },
        { label: "Transfers", value: "842", hint: "October" },
        { label: "Billable", value: "91%", hint: "past the call length", accent: true },
        { label: "Owed to them", value: "$18,940", hint: "this month" },
      ]} />
      <Table title="Publishers" note="Each sees only its own transfers" cols="minmax(0,1.4fr) .7fr .7fr .8fr 6rem" heads={["Publisher", "Transfers", "Billable", "Per sale", ""]} rows={[
        [{ main: "Summit Data", sub: "Final expense · Term life" }, "396", "93%", "$61.20", { chip: "Top", tone: "good" }],
        [{ main: "Bayview Data", sub: "Final expense" }, "284", "90%", "$54.80", { chip: "Good", tone: "good" }],
        [{ main: "Cobalt Media", sub: "Final expense" }, "162", "86%", "$72.40", { chip: "Watch", tone: "warn" }],
      ]} />
    </>
  );
}

function Compliance() {
  return (
    <>
      <Kpis items={[
        { label: "Dials checked", value: "100%", hint: "before each call", accent: true },
        { label: "Blocked", value: "214", hint: "this month, never dialled" },
        { label: "Consent records", value: "9,812", hint: "kept with each lead" },
        { label: "Open complaints", value: "0", hint: "none this quarter" },
      ]} />
      <Table title="What every dial is checked for" note="On the server, before the call is placed" cols="minmax(0,1.6fr) .7fr 5rem" heads={["Check", "Blocked", ""]} rows={[
        [{ main: "Consent on file", sub: "The lead’s own consent record" }, "38", { chip: "On", tone: "good" }],
        [{ main: "National and state DNC lists", sub: "Refreshed every day" }, "121", { chip: "On", tone: "good" }],
        [{ main: "Your suppression list", sub: "Asked not to be called again" }, "29", { chip: "On", tone: "good" }],
        [{ main: "The client’s calling window", sub: "In their own time zone" }, "26", { chip: "On", tone: "good" }],
      ]} />
    </>
  );
}

function Reports() {
  const rows = VENDORS.map((vendor) => ({ ...vendor, issued: vendor.funnel[vendor.funnel.length - 1] }));
  return (
    <>
      <Kpis items={[
        { label: "Lead spend", value: money(SPEND), hint: "4 vendors" },
        { label: "Issued policies", value: String(ISSUED), hint: "from those leads" },
        { label: "True CPA", value: money(SPEND / ISSUED), hint: "per issued policy", accent: true },
        { label: "Commission received", value: money(EARNED), hint: "matched to policies" },
      ]} />
      <Table title="True CPA by vendor" note="Cost per issued policy" cols="minmax(0,1.6fr) .9fr .5fr 7rem" heads={["Vendor", "Spend", "Issued", "True CPA"]} rows={rows.map((row): Cell[] => [
        { main: row.name, sub: row.campaign }, money(row.spend), String(row.issued),
        row.issued ? { chip: money(row.spend / row.issued), tone: row.spend / row.issued < 50 ? "good" : "info" } : { chip: "Too early", tone: "neutral" },
      ])} />
    </>
  );
}

function SettingsPage() {
  return (
    <>
      <Kpis items={[
        { label: "Plan", value: "Advanced", hint: "every module on" },
        { label: "Seats", value: "10 of 12", hint: "2 free" },
        { label: "Carriers connected", value: "4", hint: "files arrive on their own", accent: true },
        { label: "Two-step sign-in", value: "On", hint: "for everyone" },
      ]} />
      <Table title="Team" note="Who can open what" cols="minmax(0,1.4fr) minmax(0,1.2fr) 6rem" heads={["Person", "Role", ""]} rows={[
        [{ main: "Dana K.", sub: "dana@sample-agency.test" }, "Owner", { chip: "Active", tone: "good" }],
        [{ main: "Omar S.", sub: "omar@sample-agency.test" }, "Producer", { chip: "Active", tone: "good" }],
        [{ main: "Carol T.", sub: "carol@sample-agency.test" }, "Producer · Inbound", { chip: "Active", tone: "good" }],
        [{ main: "Priya N.", sub: "priya@sample-agency.test" }, "Setter", { chip: "Active", tone: "good" }],
        [{ main: "Sam R.", sub: "sam@sample-agency.test" }, "Bookkeeper", { chip: "Invited", tone: "info" }],
      ]} />
    </>
  );
}

function Inbound() {
  const queue = [
    { name: "Carol T.", partner: "Summit Data", product: "Final expense", wait: "0:14", state: "waiting" },
    { name: "Henry B.", partner: "Bayview Data", product: "Final expense", wait: "0:06", state: "waiting" },
    { name: "James M.", partner: "Summit Data", product: "Term life", wait: "0:12", state: "Dana K." },
    { name: "Ruth A.", partner: "Cobalt Media", product: "Final expense", wait: "0:09", state: "Omar S." },
    { name: "Nina R.", partner: "Bayview Data", product: "Final expense", wait: "0:21", state: "Dana K." },
  ];
  const partners = [{ name: "Summit Data", calls: 18 }, { name: "Bayview Data", calls: 12 }, { name: "Cobalt Media", calls: 8 }];
  return (
    <>
      <Kpis items={[
        { label: "Waiting now", value: "2", hint: "longest 0:14", accent: true },
        { label: "Transfers today", value: "38", hint: "from 3 partners" },
        { label: "Average wait", value: "0:11", hint: "before a claim" },
        { label: "Claimed", value: "97%", hint: "1 left the queue" },
      ]} />
      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardHead}><b>Live transfer queue</b><span>The first claim wins</span></div>
          {queue.map((row) => (
            <div key={row.name} className={styles.queueRow} data-waiting={row.state === "waiting"}>
              <span className={styles.queueIcon}>{row.state === "waiting" ? <PhoneIncoming /> : <PhoneCall />}</span>
              <span><b>{row.name}</b><small>{row.partner} · {row.product}</small></span>
              <span className={styles.queueWait}>{row.wait}</span>
              {row.state === "waiting" ? <span className={styles.claim}>Claim</span> : <span className={styles.claimed}>{row.state}</span>}
            </div>
          ))}
        </section>
        <section className={styles.card}>
          <div className={styles.cardHead}><b>Transfers by partner</b><span>Today</span></div>
          {partners.map((p) => (
            <div key={p.name} className={styles.meterRow}>
              <span><b>{p.name}</b><small>{p.calls} transfers</small></span>
              <span className={styles.bar}><i style={{ "--w": p.calls / 18 } as CSSProperties} /></span>
            </div>
          ))}
          <p className={styles.note}>Partners see their own transfers and outcomes, never another partner’s.</p>
        </section>
      </div>
    </>
  );
}

function Dialer() {
  const checks = ["Consent on file", "Not on a DNC list", "Not on your suppression list", "Inside her calling window"];
  const next = [
    { name: "Walter K.", note: "Age 68 · Ohio", tag: "High" },
    { name: "Doris P.", note: "Age 74 · Texas", tag: "High" },
    { name: "Frank L.", note: "Age 71 · Georgia", tag: "Medium" },
    { name: "Edna S.", note: "Age 79 · Arizona", tag: "Medium" },
  ];
  return (
    <>
      <Kpis items={[
        { label: "Dials today", value: "214", hint: "all screened first" },
        { label: "Contacts", value: "61", hint: "28.5% of dials" },
        { label: "Talk time", value: "4h 12m", hint: "across 3 agents" },
        { label: "Sales", value: "7", hint: "$4,620 annual premium", accent: true },
      ]} />
      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.leadHead}>
            <span className={styles.leadAvatar}><UserRound /></span>
            <span><b>Ruth A.</b><small>Age 72 · Florida · Final expense · Cobalt Media, $17.06 a lead</small></span>
            <span className={styles.onCall}><PhoneCall />On the call · 03:41</span>
          </div>
          <div className={styles.checks}>
            {checks.map((check) => <span key={check}><ShieldCheck />{check}</span>)}
          </div>
          <div className={styles.outcomes}>
            {["Sale", "Callback", "No answer", "Not interested", "Do not call"].map((outcome, i) => (
              <span key={outcome} data-primary={i === 0}>{outcome}</span>
            ))}
          </div>
        </section>
        <section className={styles.card}>
          <div className={styles.cardHead}><b>Up next</b><span>Ranked by priority</span></div>
          {next.map((lead) => (
            <div key={lead.name} className={styles.nextRow}>
              <span><b>{lead.name}</b><small>{lead.note}</small></span>
              <em data-tag={lead.tag}>{lead.tag}</em>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

function Callbacks() {
  const rows = [
    { time: "9:30", zone: "her time, ET", name: "Doris P.", why: "Wants her daughter on the call", who: "Dana K.", state: "done" },
    { time: "10:15", zone: "his time, CT", name: "Walter K.", why: "Comparing two quotes", who: "Omar S.", state: "done" },
    { time: "11:00", zone: "her time, ET", name: "Ruth A.", why: "Confirm the draft date", who: "Dana K.", state: "now" },
    { time: "1:45", zone: "his time, MT", name: "Frank L.", why: "Bank details for the draft", who: "Omar S.", state: "later" },
    { time: "3:30", zone: "her time, PT", name: "Edna S.", why: "Second look at beneficiaries", who: "Dana K.", state: "later" },
  ];
  return (
    <>
      <Kpis items={[
        { label: "Due today", value: "14", hint: "5 this morning" },
        { label: "Done", value: "9", hint: "on time" },
        { label: "Overdue", value: "1", hint: "from yesterday" },
        { label: "Kept", value: "81%", hint: "last 30 days", accent: true },
      ]} />
      <section className={styles.card}>
        <div className={styles.cardHead}><b>Today</b><span>Each time is the client’s own</span></div>
        {rows.map((row) => (
          <div key={row.name} className={styles.callbackRow} data-state={row.state}>
            <span className={styles.cbTime}><b>{row.time}</b><small>{row.zone}</small></span>
            <span><b>{row.name}</b><small>{row.why}</small></span>
            <span className={styles.cbWho}>{row.who}</span>
            <span className={styles.cbState}>{row.state === "done" ? <><Check />Done</> : row.state === "now" ? <><Clock />Due now</> : "Later"}</span>
          </div>
        ))}
      </section>
    </>
  );
}

function Applications() {
  const columns = [
    { name: "Interview", count: 5, cards: [{ who: "Walter K.", what: "Final expense · $9,000" }, { who: "Doris P.", what: "Final expense · $12,000" }] },
    { name: "Quote", count: 4, cards: [{ who: "Frank L.", what: "$58.20 a month" }, { who: "Edna S.", what: "$71.90 a month" }] },
    { name: "Submitted", count: 6, cards: [{ who: "Ruth A.", what: "Sample Carrier Life" }, { who: "Omar S.", what: "Sample Mutual" }] },
    { name: "Issued", count: 17, cards: [{ who: "Nina R.", what: "SAMPLE-0482" }, { who: "Dale P.", what: "SAMPLE-0533" }] },
  ];
  return (
    <>
      <Kpis items={[
        { label: "Submitted this week", value: "23", hint: "0 blockers open" },
        { label: "Issued", value: "17", hint: "74% of submitted", accent: true },
        { label: "Pending", value: "6", hint: "with the carrier" },
        { label: "Average premium", value: "$68.40", hint: "a month" },
      ]} />
      <div className={styles.board}>
        {columns.map((column) => (
          <section key={column.name} className={styles.boardCol} data-stage={column.name}>
            <div className={styles.cardHead}><b>{column.name}</b><span>{column.count}</span></div>
            {column.cards.map((card) => (
              <div key={card.who} className={styles.boardCard}>
                <b>{card.who}</b><small>{card.what}</small>
                {column.name === "Issued" && <span className={styles.issued}><Star />Issued</span>}
                {column.name === "Submitted" && <span className={styles.pending}><Clock />Waiting on carrier</span>}
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

function LeadWorkspace() {
  const leads = [
    { name: "Walter K.", source: "Cobalt Media", stage: "New", touch: "Not yet called", who: "Unassigned" },
    { name: "Doris P.", source: "Summit Data", stage: "Contacted", touch: "Today, 9:30", who: "Dana K." },
    { name: "Frank L.", source: "Bayview Data", stage: "Quoted", touch: "Today, 10:05", who: "Omar S." },
    { name: "Edna S.", source: "Cobalt Media", stage: "Callback", touch: "Yesterday", who: "Dana K." },
    { name: "Henry B.", source: "Bayview Data", stage: "Applied", touch: "Today, 11:20", who: "Omar S." },
  ];
  return (
    <>
      <Kpis items={[
        { label: "Leads in work", value: "1,284", hint: "across 4 vendors" },
        { label: "New today", value: "96", hint: "from 2 lists" },
        { label: "Contacted", value: "61%", hint: "of this week’s leads" },
        { label: "Ready to dial", value: "584", hint: "screened and clean", accent: true },
      ]} />
      <section className={styles.card}>
        <div className={styles.cardHead}><b>Leads</b><span>Every lead with its source, stage and owner</span></div>
        {leads.map((lead) => (
          <div key={lead.name} className={styles.leadRow}>
            <span><b>{lead.name}</b><small>{lead.source}</small></span>
            <em data-stage={lead.stage}>{lead.stage}</em>
            <span className={styles.leadTouch}>{lead.touch}</span>
            <span className={styles.leadWho}>{lead.who}</span>
          </div>
        ))}
      </section>
    </>
  );
}

function LeadFlow() {
  const vendors = [
    { name: "Cobalt Media", campaign: "Final expense · Ohio", bought: 1200, issued: 186, cost: "$17.06" },
    { name: "Summit Data", campaign: "Final expense · Texas", bought: 900, issued: 148, cost: "$21.40" },
    { name: "Bayview Data", campaign: "Term life · Georgia", bought: 760, issued: 98, cost: "$15.90" },
    { name: "Northline Leads", campaign: "Final expense · Arizona", bought: 380, issued: 50, cost: "$19.75" },
  ];
  return (
    <>
      <Kpis items={[
        { label: "Lists this month", value: "6", hint: "from 4 vendors" },
        { label: "Leads bought", value: "3,240", hint: "$26,990.80 spent" },
        { label: "Duplicates set aside", value: "112", hint: "for a person to review" },
        { label: "Issued from them", value: "482", hint: "14.9% of leads bought", accent: true },
      ]} />
      <section className={styles.card}>
        <div className={styles.cardHead}><b>Vendors and campaigns</b><span>Bought, issued and lead cost</span></div>
        {vendors.map((v) => (
          <div key={v.name} className={styles.flowRow}>
            <span><b>{v.name}</b><small>{v.campaign}</small></span>
            <span className={styles.flowBar}><i style={{ "--w": v.bought / 1200 } as CSSProperties} /><i data-issued="" style={{ "--w": v.issued / 1200 } as CSSProperties} /></span>
            <span className={styles.flowNum}><b>{v.bought.toLocaleString("en-US")}</b><small>bought</small></span>
            <span className={styles.flowNum}><b>{v.issued}</b><small>issued</small></span>
            <span className={styles.flowNum}><b>{v.cost}</b><small>a lead</small></span>
          </div>
        ))}
      </section>
    </>
  );
}

function DealFlow() {
  const deals = [
    { time: "9:42", client: "Doris P.", carrier: "Sample Carrier Life", premium: "$64.10", who: "Dana K.", state: "Submitted" },
    { time: "10:18", client: "Walter K.", carrier: "Sample Mutual", premium: "$52.80", who: "Omar S.", state: "Submitted" },
    { time: "11:05", client: "Ruth A.", carrier: "Sample Carrier Life", premium: "$70.00", who: "Dana K.", state: "Issued" },
    { time: "11:51", client: "Frank L.", carrier: "Sample Mutual", premium: "$58.20", who: "Omar S.", state: "Pending" },
    { time: "12:34", client: "Edna S.", carrier: "Sample Carrier Life", premium: "$71.90", who: "Dana K.", state: "Submitted" },
  ];
  return (
    <>
      <Kpis items={[
        { label: "Deals today", value: "9", hint: "5 before noon" },
        { label: "Annual premium", value: "$6,204", hint: "from today’s deals", accent: true },
        { label: "Average premium", value: "$57.40", hint: "a month" },
        { label: "Top producer", value: "Dana K.", hint: "5 deals today" },
      ]} />
      <section className={styles.card}>
        <div className={styles.cardHead}><b>Today’s deals</b><span>Written today, by the hour</span></div>
        {deals.map((deal) => (
          <div key={deal.time} className={styles.dealRow}>
            <span className={styles.dealTime}>{deal.time}</span>
            <span><b>{deal.client}</b><small>{deal.carrier}</small></span>
            <span className={styles.dealPremium}>{deal.premium}<small>/mo</small></span>
            <span className={styles.leadWho}>{deal.who}</span>
            <em data-stage={deal.state}>{deal.state}</em>
          </div>
        ))}
      </section>
    </>
  );
}

export function DevicePage({ page }: { page: Exclude<DevicePageKey, "dashboard"> }) {
  if (page === "inbound") return <Inbound />;
  if (page === "dialer") return <Dialer />;
  if (page === "callbacks") return <Callbacks />;
  if (page === "leads") return <LeadWorkspace />;
  if (page === "leadFlow") return <LeadFlow />;
  if (page === "dealFlow") return <DealFlow />;
  if (page === "agency") return <Agency />;
  if (page === "calendar") return <Calendar />;
  if (page === "book") return <Book />;
  if (page === "sync") return <Sync />;
  if (page === "retention") return <Retention />;
  if (page === "commissions") return <Commissions />;
  if (page === "accounting") return <Accounting />;
  if (page === "partners") return <Partners />;
  if (page === "compliance") return <Compliance />;
  if (page === "reports") return <Reports />;
  if (page === "settings") return <SettingsPage />;
  return <Applications />;
}
