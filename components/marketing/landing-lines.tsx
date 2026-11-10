import { HandHeart, HeartPulse, Hospital, Hourglass, Infinity as InfinityIcon, ShieldCheck, Stethoscope, TrendingUp, type LucideIcon } from "lucide-react";

import styles from "@/components/marketing/landing-lines.module.css";

/**
 * `LandingLines`: a short band between the trust band and "What's broken today" saying the floor is
 * not only life insurance (owner, 9 Nov). Two rows of product lines drift in opposite directions,
 * life one way and health the other, after the 21st.dev "Marquee Logo Cloud" pattern (two full-bleed
 * rows, faded edges, holding still on hover). Built here in plain CSS: no dependency, no script.
 *
 * Life lines are the app's product catalogue. Health: Medicare Advantage is in the catalogue;
 * Medicare Supplement and ACA Marketplace are TO CONFIRM (owner): an Insurvas admin adds them to the
 * product list before this goes live.
 */
type Line = { name: string; Icon: LucideIcon };
const ROWS: { key: string; label: string; Icon: LucideIcon; lines: Line[]; copies: number }[] = [
  {
    key: "life", label: "Life", Icon: ShieldCheck, copies: 2,
    lines: [
      { name: "Final Expense", Icon: HandHeart },
      { name: "Term Life", Icon: Hourglass },
      { name: "Whole Life", Icon: InfinityIcon },
      { name: "Indexed Universal Life", Icon: TrendingUp },
    ],
  },
  {
    key: "health", label: "Health", Icon: HeartPulse, copies: 3,
    lines: [
      { name: "Medicare Advantage", Icon: Stethoscope },
      { name: "Medicare Supplement", Icon: HeartPulse },
      { name: "ACA Marketplace", Icon: Hospital },
    ],
  },
];

export function LandingLines() {
  return (
    <section aria-labelledby="landing-lines-heading" className={styles.band}>
      <div className={styles.inner}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>Life and health</p>
          <h2 id="landing-lines-heading" className={styles.heading}>Life insurance and health insurance, on one platform.</h2>
          <p className={styles.lede}>Your agents sell final expense and Medicare from the same workspace, with one book of business for both.</p>
        </div>
        <div className={styles.stage}>
          {ROWS.map(({ key, label, Icon, lines, copies }) => (
            <div key={key} className={styles.row} data-line={key}>
              <span className={styles.rowLabel}>
                <span className={styles.rowIcon}><Icon aria-hidden="true" size={15} strokeWidth={2.2} /></span>
                {label}
              </span>
              <div className={styles.viewport}>
                {/* Two identical halves, so the drift loops without a seam. Only the first is read out. */}
                <div className={styles.track}>
                  {[0, 1].map((half) => (
                    <ul key={half} className={styles.set} aria-hidden={half === 1 || undefined} aria-label={half === 0 ? `${label} insurance` : undefined}>
                      {Array.from({ length: copies }, (_, c) =>
                        lines.map(({ name, Icon: LineIcon }) => (
                          <li key={`${c}-${name}`} className={styles.pill} aria-hidden={c > 0 || undefined}>
                            <span className={styles.pillIcon}><LineIcon aria-hidden="true" size={15} strokeWidth={2} /></span>
                            {name}
                          </li>
                        )),
                      )}
                    </ul>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
