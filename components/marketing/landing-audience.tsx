import { LandingAudienceSlider } from "@/components/marketing/landing-audience-slider";
import styles from "@/components/marketing/landing-audience.module.css";

/**
 * "Who it's for" (2026-11-03, docs/design/landing-who-its-for-spec.md), in two parts:
 *
 * `LandingBuiltFor` — the trust band between the hero and the split (owner, 3–4 Nov). `LandingAudience` — the full-bleed split, one half per audience. The product
 * sells to exactly two, `individual` and `agency` in the plan catalog, so each half is a real
 * thing with a real pricing view behind it rather than a visual device.
 *
 * The whole half is the link, which is why the call to action inside it is a span and not a
 * `MarketingCta`: an anchor inside an anchor is invalid, and one big target beats a small one.
 * Nothing is hidden at rest — hover and focus only grow a half — so the section reads whole on a
 * phone, by keyboard, and under reduced motion. Every claim here is one the product enforces.
 */

/**
 * The trust band (2026-11-04, owner): who built it and who runs on it, as drawn in the approved
 * mockup. The counts are the owner's figures for now; swap in the real
 * numbers (and photographs, if they are supplied) here and nowhere else.
 */
const TRUST = { agents: "2,400+", agencies: "180+", matched: "$48M" };
const AVATARS = [0, 1, 2, 3];

export function LandingBuiltFor() {
  return (
    <section aria-labelledby="landing-trust-heading" className={styles.band}>
      <div className={styles.bandInner}>
        <div className={styles.trustCopy}>
          <p className={styles.bandLabel}>Built by industry experts</p>
          <h2 id="landing-trust-heading" className={styles.trustTitle}>Made by people who sold final expense and ran live-transfer floors.</h2>
          <div className={styles.trustRow}>
            <span className={styles.avatars} aria-hidden="true">
              {AVATARS.map((n) => <i key={n} />)}
            </span>
            <p className={styles.trustLine}>Trusted by {TRUST.agents} agents and {TRUST.agencies} agencies</p>
          </div>
        </div>
        <div className={styles.trustStats}>
          <div className={styles.trustStat}>
            <p className={styles.trustNumber}>{TRUST.agents}</p>
            <p className={styles.trustCaption}>agents and {TRUST.agencies} agencies run on Insurvas</p>
          </div>
          <div className={styles.trustStat}>
            <p className={styles.trustNumber}>{TRUST.matched}</p>
            <p className={styles.trustCaption}>in commission matched to the leads that earned it</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingAudience() {
  return (
    <section id="industries" aria-labelledby="audience-title" className={`scroll-mt-20 ${styles.section}`}>
      <div className={styles.inner}>
        <LandingAudienceSlider header={
          <header className={styles.head}>
          <p className={styles.eyebrow}>Who it’s for</p>
          <h2 id="audience-title" className={styles.heading}>One agent, or a whole floor.</h2>
          </header>
        } />
      </div>
    </section>
  );
}
