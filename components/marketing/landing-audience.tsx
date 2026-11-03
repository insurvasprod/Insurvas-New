import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Ban, Check, Eye, FileCheck2, Lock, ScrollText, ShieldCheck, Sigma, Users } from "lucide-react";

import styles from "@/components/marketing/landing-audience.module.css";

/**
 * "Who it's for" (2026-11-03, docs/design/landing-who-its-for-spec.md), in two parts:
 *
 * `LandingBuiltFor` — the band of businesses and guarantees, between the hero and the split
 * (owner, 3 Nov). `LandingAudience` — the full-bleed split, one half per audience. The product
 * sells to exactly two, `individual` and `agency` in the plan catalog, so each half is a real
 * thing with a real pricing view behind it rather than a visual device.
 *
 * The whole half is the link, which is why the call to action inside it is a span and not a
 * `MarketingCta`: an anchor inside an anchor is invalid, and one big target beats a small one.
 * Nothing is hidden at rest — hover and focus only grow a half — so the section reads whole on a
 * phone, by keyboard, and under reduced motion. Every claim here is one the product enforces.
 */

/** The businesses it is built for. All of them live in the band; the halves do not repeat them. */
const BUILT_FOR = [
  "Independent agents",
  "Final expense",
  "Term & whole life",
  "Medicare & health",
  "Live-transfer floors",
  "Outbound call centers",
  "IMOs & FMOs",
];

/**
 * The guarantees. Four are shown, as they always have been; the rest are kept here so the list is
 * the whole truth and a later change can surface them without hunting for the wording again.
 * No customer logos, no testimonial, no certification we cannot show — only things the product does.
 */
const TRUTHS = [
  { icon: ShieldCheck, text: "4 checks re-run by the server before every dial" },
  { icon: Sigma, text: "True CPA computed from your own linked data" },
  { icon: Ban, text: "A missing figure reads —, never $0.00" },
  { icon: Eye, text: "Partners never see each other’s leads" },
  { icon: Lock, text: "Subscription card payments are taken on the provider’s hosted page" },
  { icon: FileCheck2, text: "Consent and disclosure evidence kept per attempt" },
  { icon: ScrollText, text: "Changes to key records are kept in an audit log" },
];

export function LandingBuiltFor() {
  return (
    <section aria-label="Who Insurvas is built for, and what it does" className={styles.band}>
      <div className={styles.bandInner}>
        <p className={styles.bandRow}>
          <span className={styles.bandLabel}>Built for</span>
          {BUILT_FOR.map((name) => <span key={name} className={styles.audienceItem}>{name}</span>)}
        </p>
        <ul className={styles.truths}>
          {TRUTHS.slice(0, 4).map(({ icon: Icon, text }) => <li key={text}><Icon aria-hidden="true" />{text}</li>)}
        </ul>
      </div>
    </section>
  );
}

const PANELS = [
  {
    side: "agent",
    label: "For the individual agent",
    word: "Agent",
    body: "Your book of business, the leads you buy, the applications you write and the commissions you are owed — one workspace, priced per workspace and never per lead.",
    points: ["Your own book, carriers and commissions", "Leads, dialer and applications in one place", "See what every lead cost you"],
    cta: "See agent plans",
    href: "/pricing",
  },
  {
    side: "agency",
    label: "For the agency",
    word: "Agency",
    body: "Producers, managers and assistants all work inside one flat price, with payouts, lead routing and the agency dashboard included — never per seat or per lead.",
    points: ["Lead routing across the whole floor", "Splits, overrides and producer payouts", "One dashboard for every producer"],
    cta: "See agency pricing",
    href: "/pricing?for=agency",
  },
] as const;

/**
 * Each card is a photograph (CC0, from Unsplash via Wikimedia Commons — no attribution required;
 * sources in public/marketing/README.md), graded into the brand's deep olive, with one small piece of
 * the product floating on it. The agent: one professional at her laptop. The agency: an office tower
 * lit floor by floor at night — a whole floor of people working.
 */
function AgentScene() {
  return (
    <div className={styles.scene} aria-hidden="true">
      <Image src="/marketing/audience-agent.webp" alt="" fill sizes="(max-width: 960px) 100vw, 50vw" className={styles.photo} style={{ objectPosition: "50% 30%" }} />
      <div className={styles.float} data-pos="agent">
        <span className={styles.floatIcon}><Check /></span>
        <span><b>+$126.40</b><small>Commission matched · Ruth A.</small></span>
      </div>
    </div>
  );
}

function AgencyScene() {
  return (
    <div className={styles.scene} aria-hidden="true">
      <Image src="/marketing/audience-agency.webp" alt="" fill sizes="(max-width: 960px) 100vw, 50vw" className={styles.photo} style={{ objectPosition: "50% 40%" }} />
      <div className={styles.float} data-pos="agency">
        <span className={styles.floatIcon}><Users /></span>
        <span><b>12 producers · 7 on calls</b><small>Lead routed to Tom P.</small></span>
        <span className={styles.live}><i />Live</span>
      </div>
    </div>
  );
}

export function LandingAudience() {
  return (
    <section id="industries" aria-labelledby="audience-title" className={`scroll-mt-20 ${styles.section}`}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Who it’s for</p>
          <h2 id="audience-title" className={styles.heading}>One agent, or a whole floor.</h2>
        </header>
        <div className={styles.split}>
          {PANELS.map((panel) => (
            <Link key={panel.side} href={panel.href} className={styles.panel} data-side={panel.side}>
              {panel.side === "agent" ? <AgentScene /> : <AgencyScene />}
              <span className={styles.copy}>
                <span className={styles.label}>{panel.label}</span>
                <span className={styles.word}>{panel.word}</span>
                <span className={styles.body}>{panel.body}</span>
                <span className={styles.points}>{panel.points.map((point) => <span key={point}><Check aria-hidden="true" />{point}</span>)}</span>
                <span className={styles.cta}>{panel.cta}<ArrowRight aria-hidden="true" /></span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
