import { Fragment } from "react";

import { MarketingCta } from "@/components/marketing/cta";
import { LandingDevice } from "@/components/marketing/landing-device";
import { LandingHeroEntrance } from "@/components/marketing/landing-hero-entrance";
import styles from "@/components/marketing/landing-hero.module.css";

/**
 * The first viewport: the promise, and beneath it the product itself — the agency dashboard in a
 * device frame that lifts to face the reader as the page scrolls. Deep olive in both themes.
 * Copy is the homepage baseline, verbatim
 * (docs/design/landing-page-research/homepage-copy-source-snapshot.md).
 */
const HEADLINE = ["Know", "what", "every", "lead", "really", "cost", "you."];

export function LandingHero() {
  return (
    <section data-landing-hero="" className={styles.hero}>
      <div className={styles.backdrop} aria-hidden="true" />
      <div className={styles.copy}>
        <h1 className={styles.title}>
          {HEADLINE.map((word, i) => (
            <Fragment key={word}>
              <span className={styles.wordWrap}><span className={`${styles.word} ${word === "really" ? styles.really : ""}`} data-word="">{word}</span></span>
              {i < HEADLINE.length - 1 ? " " : null}
            </Fragment>
          ))}
        </h1>
        <p className={styles.description} data-enter="">Live transfers, dialing, applications and commissions in one workspace — and every issued policy traced back to the campaign that paid for it.</p>
        <div className={styles.actions} data-enter="">
          <MarketingCta href="/signup">Start your free trial</MarketingCta>
          <MarketingCta href="#features" variant="onDark" icon="down">See how it works</MarketingCta>
        </div>
      </div>
      <div className={styles.deviceWrap} data-enter="">
        <LandingDevice />
      </div>
      <LandingHeroEntrance />
    </section>
  );
}
