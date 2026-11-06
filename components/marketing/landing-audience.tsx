import { LandingBroken } from "@/components/marketing/landing-broken";
import styles from "@/components/marketing/landing-audience.module.css";

/**
 * "Who it's for" (2026-11-03, docs/design/landing-who-its-for-spec.md), in two parts:
 *
 * `LandingAudience`: what is broken today. The trust band above it is `LandingTrust` (landing-trust.tsx). The product
 * sells to exactly two, `individual` and `agency` in the plan catalog, so each half is a real
 * thing with a real pricing view behind it rather than a visual device.
 *
 * The whole half is the link, which is why the call to action inside it is a span and not a
 * `MarketingCta`: an anchor inside an anchor is invalid, and one big target beats a small one.
 * Nothing is hidden at rest — hover and focus only grow a half — so the section reads whole on a
 * phone, by keyboard, and under reduced motion. Every claim here is one the product enforces.
 */

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
