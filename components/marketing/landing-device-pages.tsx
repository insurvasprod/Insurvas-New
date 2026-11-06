import type { CSSProperties } from "react";
import { Check, Clock, PhoneCall, PhoneIncoming, ShieldCheck, Star, UserRound } from "lucide-react";

import styles from "@/components/marketing/landing-device.module.css";

/**
 * The other pages of the hero's device (owner, 6 Nov; Umar's A1.4: "it changes to Inbound and shows
 * how Inbound works, then Dialer, then Callbacks"). Each is a still, believable screen of that part
 * of the app, drawn with the dashboard's own cards and figure tiles. Sample data throughout, with
 * the same people, partners and vendors as the dashboard, so the screens agree with one another.
 */
export type DevicePageKey = "dashboard" | "inbound" | "dialer" | "callbacks" | "leads" | "leadFlow" | "applications" | "dealFlow";

/** `section` is the page's menu group, shown in the trail over the title, as the app shows it. */
export const DEVICE_PAGES: { key: DevicePageKey; section: string; crumb: string; title: string; sub: string }[] = [
  { key: "dashboard", section: "Home", crumb: "Agency dashboard", title: "Good morning, Dana", sub: "Sample Agency · last 30 days · sample data" },
  { key: "inbound", section: "Today", crumb: "Inbound", title: "Inbound floor", sub: "Live transfers from your partners · sample data" },
  { key: "dialer", section: "Today", crumb: "Dialer", title: "Dialer", sub: "Final expense · Cobalt Media list · sample data" },
  { key: "callbacks", section: "Today", crumb: "Callbacks", title: "Callbacks", sub: "Today, in each client’s own time · sample data" },
  { key: "leads", section: "Leads", crumb: "Lead workspace", title: "Lead workspace", sub: "Every lead you bought · sample data" },
  { key: "leadFlow", section: "Leads", crumb: "Lead flow", title: "Lead flow", sub: "Vendors and campaigns this month · sample data" },
  { key: "applications", section: "Sales", crumb: "Applications", title: "Applications", sub: "This week · sample data" },
  { key: "dealFlow", section: "Sales", crumb: "Daily deal flow", title: "Daily deal flow", sub: "Today · sample data" },
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
  return <Applications />;
}
