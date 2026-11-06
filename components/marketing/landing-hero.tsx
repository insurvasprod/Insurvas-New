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
// Two lines (Umar, 4 Nov): "Complete" is gone and "for life insurance sales teams" sits on the
// line below. TO CONFIRM (Umar): he asked for the wording to be reviewed, not fixed.
const HEADLINE = [["The", "operating", "system"], ["for", "life", "insurance", "sales", "teams."]];
const ACCENT = new Set(["operating", "system"]);

export function LandingHero() {
  return (
    <section data-landing-hero="" className={styles.hero}>
      <div className={styles.backdrop} aria-hidden="true" />
      <div className={styles.copy}>
        <h1 className={styles.title}>
          {HEADLINE.map((line, l) => (
            <span key={l} className={styles.line}>
              {line.map((word, i) => (
                <Fragment key={word}>
                  <span className={styles.wordWrap}><span className={`${styles.word} ${ACCENT.has(word) ? styles.really : ""}`} data-word="">{word}</span></span>
                  {i < line.length - 1 ? " " : null}
                </Fragment>
              ))}
              {l < HEADLINE.length - 1 ? " " : null}
            </span>
          ))}
        </h1>
        <p className={styles.description} data-enter="">Leads, calls, applications, commissions, chargebacks and compliance on one ledger. See every dollar while there is still time to save it.</p>
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
