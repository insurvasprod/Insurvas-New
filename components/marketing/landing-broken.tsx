"use client";

import { useState, type ReactNode } from "react";

import { UnderlineTabs } from "@/components/ui/view-tabs";
import styles from "@/components/marketing/landing-broken.module.css";

/**
 * "What's broken today" (2026-11-04, owner, copy from "Insurvas OS Landing.md"): seven leaks, one
 * at a time. Each is the problem, what Insurvas does about it (and on which plan), and a mock of the
 * screen that does it. Every figure in a mock is sample data and says so; none is a customer result.
 */

function Mock({ title, children, foot }: { title: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className={styles.mock}>
      <div className={styles.mockHead}><strong>{title}</strong><em>Sample data</em></div>
      {children}
      {foot}
    </div>
  );
}

function SaveQueue() {
  const rows = [
    { id: "SAMPLE-0533", level: "High", text: "First draft failed. Customer not reached.", actions: ["Call", "Change draft date"], amount: "$1,240", when: "draft Nov 12" },
    { id: "SAMPLE-0391", level: "Watch", text: "Lapse notice received from the carrier.", actions: ["Call", "Update bank"], amount: "$980", when: "draft Nov 14" },
    { id: "SAMPLE-0277", level: "Watch", text: "Two contact attempts, no answer.", actions: ["Call"], amount: "$610", when: "draft Nov 20" },
  ];
  return (
    <Mock title="Save queue">
      <ul className={styles.rows}>
        {rows.map((row) => (
          <li key={row.id} className={styles.row}>
            <div>
              <p className={styles.rowTop}><span>{row.id}</span><b data-level={row.level}>{row.level}</b></p>
              <p className={styles.rowText}>{row.text}</p>
              <p className={styles.chips}>{row.actions.map((action) => <span key={action}>{action}</span>)}</p>
            </div>
            <p className={styles.amount}><strong>{row.amount}</strong><small>{row.when}</small></p>
          </li>
        ))}
      </ul>
    </Mock>
  );
}

function DraftDate() {
  return (
    <Mock title="Application · draft date">
      <p className={styles.line}><span>Customer born on the 14th</span><b>Pays: 3rd Wednesday</b></p>
      <p className={styles.line}><span>This month’s deposit</span><b>Nov 18</b></p>
      <div className={styles.option} data-tone="bad"><strong>Draft on the 3rd</strong><span>Her money arrives on the 18th. This draft would bounce.</span></div>
      <div className={styles.option} data-tone="good"><strong>Draft on the 20th</strong><span>Two days after her deposit.</span></div>
      <p className={styles.chips}><span data-primary="true">Use the 20th</span><span>Override and log it</span></p>
    </Mock>
  );
}

function Statement() {
  return (
    <Mock title="Based on your latest statement">
      <p className={styles.big}>You appear to be owed <strong>$3,412</strong></p>
      <p className={styles.line}><span>6 policies issued but never paid</span><b>$1,980</b></p>
      <p className={styles.line}><span>9 policies paid at the wrong rate</span><b>$914</b></p>
      <p className={styles.line}><span>3 duplicate chargebacks</span><b>$518</b></p>
      <p className={styles.line} data-total="true"><span>Total to dispute</span><b>$3,412</b></p>
      <p className={styles.chips}><span>See the detail</span><span data-primary="true">Draft dispute letters</span></p>
    </Mock>
  );
}

function Vendors() {
  return (
    <Mock title="Lead-source scorecard">
      <div className={styles.vendor}>
        <p className={styles.vendorHead}><strong>Vendor A</strong><span>$6,205 spend · 11 sales · 81% still paying at month 9</span></p>
        <p className={styles.pair}><span>Sticker<b>$564</b></span><span>True<b>$696</b></span></p>
      </div>
      <div className={styles.vendor}>
        <p className={styles.vendorHead}><strong>Vendor B</strong><span>$2,890 spend · 6 sales · 59% still paying at month 9</span></p>
        <p className={styles.pair}><span>Sticker<b>$482</b></span><span>True<b>$816</b></span></p>
      </div>
      <p className={styles.note}>Vendor B looks $82 cheaper per sale. It costs $120 more per sale that stays. True cost is spend divided by sales still paying at month 9.</p>
      <div className={styles.option} data-tone="bad"><strong>Transfer rejected · Dale P.</strong><span>Outside the contracted age band. Recording attached. In the dispute queue.</span><b>−$85.00 payout reversed</b></div>
    </Mock>
  );
}

function DialerGate() {
  const checks: [string, boolean][] = [["Consent on file", true], ["DNC lists", true], ["Suppression list", true], ["Calling window closed", false]];
  return (
    <Mock title="Dialer gate · Ruth A." foot={<p className={styles.note}>A screening tool, not a guarantee that every call is lawful. Compliance stays with your agency.</p>}>
      <ul className={styles.checks}>
        {checks.map(([label, ok]) => <li key={label} data-ok={ok}><i aria-hidden="true" />{label}</li>)}
      </ul>
      <div className={styles.option} data-tone="bad"><strong>Dial refused</strong><span>Logged with its reason</span></div>
      <div className={styles.option} data-tone="good"><strong>Carol T.</strong><span>Litigation packet ready: calls, recordings, consent certificate, scrub results.</span></div>
      <p className={styles.chips}><span data-primary="true">Export packet</span></p>
    </Mock>
  );
}

function Ledger() {
  return (
    <Mock title="This month">
      <p className={styles.line}><span>Net commission (advances and earned, less chargebacks)</span><b>+$18,410</b></p>
      <p className={styles.line}><span>Lead and vendor costs</span><b>−$10,845</b></p>
      <p className={styles.line}><span>Platform and tools</span><b>−$449</b></p>
      <p className={styles.line} data-total="true"><span>Net profit</span><b>$7,116</b></p>
      <p className={styles.pair}><span>Cost per policy issued<b>$627</b></span><span>Cost per policy that stays<b>$891</b></span></p>
    </Mock>
  );
}

function Roles() {
  const roles = [
    { name: "Owner", can: "Everything, including billing", cannot: "" },
    { name: "Producer", can: "Full sales workflow, own policies and commissions", cannot: "Other producers’ commissions, billing, settings" },
    { name: "Assistant", can: "Data entry, leads, calendar, callbacks", cannot: "Any commission or money data" },
    { name: "Bookkeeper", can: "Ledger, statements, payouts, P&L, exports", cannot: "Dialing, selling, call recordings" },
  ];
  return (
    <Mock title="Roles">
      <ul className={styles.rows}>
        {roles.map((role) => (
          <li key={role.name} className={styles.role}>
            <strong>{role.name}</strong>
            <span>{role.can}</span>
            {role.cannot && <span className={styles.cannot}>{role.cannot}</span>}
          </li>
        ))}
      </ul>
    </Mock>
  );
}

const LEAKS = [
  {
    key: "lapse",
    tab: "Lapses",
    broken: "One early lapse can erase the profit from 26 good sales.",
    body: "The carrier pays an advance on day one. If the policy lapses early, they take it back on a later statement. Most agents find out when that statement lands.",
    plan: "Advanced",
    fix: "You are warned before the policy dies, not after.",
    points: [
      "A save queue of at-risk policies, ranked by risk times money.",
      "Failed drafts, lapse notices and drafts that land before the deposit are flagged before the draft date.",
      "Payment repair: call, update the bank details, track the change to the carrier.",
    ],
    mock: <SaveQueue />,
  },
  {
    key: "draft",
    tab: "Draft dates",
    broken: "The draft hits an empty account, and the policy is dead in two months.",
    body: "Final expense customers live on Social Security. If the draft date lands before the deposit, the draft bounces, and about two months later the advance is clawed back. Nobody checks the date at the kitchen table.",
    plan: "Basic and up",
    fix: "The draft date is checked while you are still on the phone.",
    points: [
      "Enter the date of birth and Insurvas works out the Social Security deposit window.",
      "A draft date that lands before the deposit is flagged before you submit. You can override it, and the override is logged.",
      "A pre-submission check catches the gaps that make carriers bounce an application (NIGO).",
    ],
    mock: <DraftDate />,
  },
  {
    key: "commission",
    tab: "Underpaid commission",
    broken: "Carriers underpay you, and nine statement formats make sure you never notice.",
    body: "Every carrier sends its own PDF. Most sit unopened. Policies that were never paid, lines paid at the wrong rate and duplicate chargebacks stay buried on line 34.",
    plan: "Every plan",
    fix: "Every statement line meets the policy you wrote.",
    points: [
      "Upload a statement or send it by email. Each line is matched to a policy, and you accept every match.",
      "A discrepancy report: missing, short-paid, mis-rated, duplicate and unexpected chargebacks.",
      "Dispute letters drafted with the policy numbers and the arithmetic.",
    ],
    mock: <Statement />,
  },
  {
    key: "vendors",
    tab: "Vendors",
    broken: "You pay your vendors on the honour system.",
    body: "A vendor messages on WhatsApp for last week’s 31 transfers. You count them by hand and get a different number. And the vendor that looks cheapest per sale may be the one whose customers lapse the most.",
    plan: "Basic and Advanced",
    fix: "Every dollar is traced to the lead that earned it, or didn’t.",
    points: [
      "Cost recorded on every lead, from every list and every transfer.",
      "Reject a bad transfer with the call recording. The payout reverses and a dispute opens.",
      "A lead-source scorecard with true cost per sale, lapses included.",
      "Partners sign in and see their own numbers before the argument starts.",
    ],
    mock: <Vendors />,
  },
  {
    key: "compliance",
    tab: "Compliance",
    broken: "One bad dial can cost more than the sale.",
    body: "TCPA penalties start at $500 a call and can reach $1,500. A purchased list is exactly where Do Not Call numbers hide. When a demand letter arrives, finding the proof can take two weeks.",
    plan: "Basic and Advanced",
    fix: "Every dial is screened first. Every call has its paper trail.",
    points: [
      "Every list is scrubbed against Do Not Call before it is dialed. It is not a toggle.",
      "Consent, DNC, your suppression list and the calling window are re-checked on the server before every dial. Refusals are logged with the reason.",
      "Consent certificates and call recordings stored against each lead.",
      "A one-click litigation packet: every call, recording, certificate and scrub result for one contact.",
    ],
    mock: <DialerGate />,
  },
  {
    key: "profit",
    tab: "Profit",
    broken: "Nobody can tell you whether you made money today.",
    body: "Leads live in one tool, sales in a spreadsheet, commissions in nine portals and vendor bills in WhatsApp. At nine at night, you still cannot say if the day paid.",
    plan: "Dashboard in every plan, Accounting in Advanced",
    fix: "One ledger. Every dollar in and out, tied to a policy.",
    points: [
      "Lead cost, vendor payouts, advances, commissions and chargebacks written to one ledger.",
      "Profit and loss by month, by vendor and by policy.",
      "Cost per policy issued, beside cost per policy that stays.",
    ],
    mock: <Ledger />,
  },
  {
    key: "team",
    tab: "Your team",
    broken: "The day you hire, the spreadsheet breaks.",
    body: "Your first assistant needs your leads and callbacks, not your commissions. Your bookkeeper needs the ledger, not the call recordings. A shared login and a shared sheet cannot tell the difference.",
    plan: "Team plans",
    fix: "Everyone gets a role. Nobody gets the whole keyring.",
    points: [
      "Owner, producer, assistant and bookkeeper roles, set per account.",
      "Producers see their own policies and commissions. Assistants see no money data at all.",
    ],
    mock: <Roles />,
  },
];

export function LandingBroken() {
  const [key, setKey] = useState(LEAKS[0].key);
  const leak = LEAKS.find((item) => item.key === key) ?? LEAKS[0];

  return (
    <div className={styles.broken}>
      <UnderlineTabs
        label="What’s broken today"
        tabs={LEAKS.map((item) => ({ key: item.key, label: item.tab }))}
        value={key}
        onChange={setKey}
        idPrefix="leak-tab"
        controls="leak-panel"
      />
      <div className={styles.stage} role="tabpanel" id="leak-panel" aria-labelledby={`leak-tab-${leak.key}`} key={leak.key}>
        <div className={styles.copy}>
          <p className={styles.tag}>Broken today</p>
          <h3 className={styles.problem}>{leak.broken}</h3>
          <p className={styles.body}>{leak.body}</p>
          <p className={styles.plan}>With Insurvas <b>{leak.plan}</b></p>
          <h4 className={styles.fix}>{leak.fix}</h4>
          <ul className={styles.points}>
            {leak.points.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </div>
        <div className={styles.visual}>{leak.mock}</div>
      </div>
    </div>
  );
}
