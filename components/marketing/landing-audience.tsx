import { LandingBroken } from "@/components/marketing/landing-broken";
import styles from "@/components/marketing/landing-audience.module.css";

/**
 * "Who it's for" (2026-11-03, docs/design/landing-who-its-for-spec.md), in two parts:
 *
 * `LandingBuiltFor`: the trust band under the hero. `LandingAudience`: what is broken today. The product
 * sells to exactly two, `individual` and `agency` in the plan catalog, so each half is a real
 * thing with a real pricing view behind it rather than a visual device.
 *
 * The whole half is the link, which is why the call to action inside it is a span and not a
 * `MarketingCta`: an anchor inside an anchor is invalid, and one big target beats a small one.
 * Nothing is hidden at rest — hover and focus only grow a half — so the section reads whole on a
 * phone, by keyboard, and under reduced motion. Every claim here is one the product enforces.
 */

/**
 * The trust band. Umar's review (4 Nov, A2.1): "This design is just basic … you just build some
 * credibility here", who built it, how long it has run, who uses it, before the page says why.
 * So it is a statement, the origin in one line, and three facts. The placeholder avatar dots are
 * gone: they stood in for faces we do not have.
 *
 * TO CONFIRM (Umar): every figure here. The agent, agency and commission counts are the owner's
 * figures from 4 Nov; "two years" is from the review call. Change them here and nowhere else.
 */
const PROOF = [
  { figure: "2 years", caption: "running a live-transfer final expense floor before we built Insurvas" },
  { figure: "2,400+", caption: "agents across 180+ agencies work in it" },
  { figure: "$48M", caption: "in commission matched to the leads that earned it" },
];

export function LandingBuiltFor() {
  return (
    <section aria-labelledby="landing-trust-heading" className={styles.band}>
      <div className={styles.bandInner}>
        <div className={styles.trustCopy}>
          <p className={styles.bandLabel}>Built by industry experts</p>
          <h2 id="landing-trust-heading" className={styles.trustTitle}>Made by people who sold final expense and ran live-transfer floors.</h2>
          <p className={styles.trustLine}>Every screen started as a problem we had on our own floor: leads bought twice, drafts that missed, statements nobody could match.</p>
        </div>
        <dl className={styles.trustStats}>
          {PROOF.map((item) => (
            <div key={item.figure} className={styles.trustStat}>
              <dt className={styles.trustNumber}>{item.figure}</dt>
              <dd className={styles.trustCaption}>{item.caption}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export function LandingAudience() {
  return (
    <section id="industries" aria-labelledby="audience-title" className={`scroll-mt-20 ${styles.section}`}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>What’s broken today</p>
          <h2 id="audience-title" className={styles.heading}>Seven leaks in your business. One system closes them.</h2>
          <p className={styles.lede}>Each one costs you money every month. Each one has a fix inside the same ledger.</p>
        </header>
        <LandingBroken />
      </div>
    </section>
  );
}
