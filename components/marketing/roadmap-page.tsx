import { roadmapGroups, ROADMAP_STATUS } from "@/lib/marketing/roadmap";
import styles from "@/components/marketing/roadmap-page.module.css";

/**
 * The /roadmap page body (2026-11-04, owner): a vertical trail from Shipped to Exploring, one block
 * per status and quarter. Quarters, not dates, and the page says so. The items are draft content
 * (see lib/marketing/roadmap.ts).
 */
export function RoadmapPage() {
  const groups = roadmapGroups();
  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Roadmap</p>
        <h1 className={styles.title}>Where Insurvas is going.</h1>
        <p className={styles.lede}>What has shipped, what we are building, and what we are only exploring. Quarters, not promises: plans change when you tell us what is leaking.</p>
        <ul className={styles.legend} aria-label="What each status means">
          {(Object.keys(ROADMAP_STATUS) as (keyof typeof ROADMAP_STATUS)[]).map((status) => (
            <li key={status} data-status={status}><i aria-hidden="true" /><strong>{ROADMAP_STATUS[status].label}</strong><span>{ROADMAP_STATUS[status].blurb}</span></li>
          ))}
        </ul>
      </header>

      <ol className={styles.trail}>
        {groups.map((group) => (
          <li key={group.key} className={styles.group} data-status={group.status}>
            <div className={styles.when}>
              <i aria-hidden="true" />
              <strong>{ROADMAP_STATUS[group.status].label}</strong>
              <span>{group.when}</span>
            </div>
            <ul className={styles.items}>
              {group.items.map((item) => (
                <li key={item.id} className={styles.item}>
                  <p className={styles.itemTop}><strong>{item.title}</strong><em>{item.theme}</em></p>
                  <p className={styles.itemText}>{item.text}</p>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <p className={styles.foot}>This roadmap shows direction, not a commitment to ship by a date. Every figure in a mock on the site is sample data.</p>
    </main>
  );
}
