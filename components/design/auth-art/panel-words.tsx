import type { ReactNode } from "react";

import styles from "@/components/design/auth-art/art.module.css";

/**
 * Four ways to set the words on the sign-in panel (owner, 12 Nov: "the text on the left doesn't
 * look that good"). Development only.
 *
 * **What is wrong with the one that ships.** Four voices stacked in a descending ladder — a caps
 * kicker, the headline, a paragraph, a rule and a footnote — which is a wall, not a hierarchy. The
 * kicker is fifty-two characters of tracked uppercase, which the eye reads as a grey bar rather
 * than as a sentence. The paragraph says the headline again in weaker words. The rule above the
 * last line makes a footer inside a panel that has no footer. And all of it sits low and left,
 * exactly where the picture behind it is busiest.
 *
 * Every treatment below uses **only the words already there**, cut or re-ordered. None of them
 * invents a claim.
 */

export type Words = "today" | "one" | "above" | "top";

const KICKER = "The operating system for life insurance sales teams";
const HEADLINE = "Know what every lead cost you.";
const BLURB = "Leads, calls, applications and commissions, connected in one workspace.";
const FLOOR = "Built by people who ran the floor.";

/**
 * The headline with one word in the accent serif — the landing page's own move (BRAND.md
 * interpretation 9), which is why it belongs here: it ties the door to the page it came from.
 */
function Headline({ plain = false }: { plain?: boolean }): ReactNode {
  if (plain) return HEADLINE;
  return (
    <>
      Know what every <em className={styles.em}>lead</em> cost you.
    </>
  );
}

export function PanelWords({ words }: { words: Words }) {
  if (words === "today") {
    return (
      <div className={styles.copy}>
        <p className="auth-photo-kicker">{KICKER}</p>
        <p className="auth-photo-title">Know what every<br />lead cost you.</p>
        <p className={styles.foot}>{BLURB}</p>
        <p className="auth-photo-caption">{FLOOR}</p>
      </div>
    );
  }

  // One sentence. The kicker and the paragraph go; what is left is the claim and the one line
  // that makes it credible. Two voices instead of four.
  if (words === "one") {
    return (
      <div className={styles.copy} data-words="one">
        <p className={styles.title}><Headline /></p>
        <p className={styles.proof}>{FLOOR}</p>
      </div>
    );
  }

  // The lead line above. The same information, inverted: the small line first, the claim under it,
  // and nothing below it at all. The kicker keeps its words but loses the caps.
  if (words === "above") {
    return (
      <div className={styles.copy} data-words="above">
        <p className={styles.lede}>{KICKER}</p>
        <p className={styles.title}><Headline /></p>
      </div>
    );
  }

  // Top set. The words move up under the logo and the picture takes the whole lower half, so the
  // two stop competing for the same ground. The paragraph survives as one quiet line at the foot.
  return (
    <>
      <div className={styles.copy} data-words="top">
        <p className={styles.lede}>{KICKER}</p>
        <p className={styles.title}><Headline /></p>
      </div>
      {/* Outside the copy block on purpose: it is positioned against the panel's foot. */}
      <p className={styles.foot}>{BLURB}</p>
    </>
  );
}
