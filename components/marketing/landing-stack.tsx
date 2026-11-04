import { ArrowRight } from "lucide-react";

import styles from "@/components/marketing/landing-stack.module.css";

/**
 * "Sound like your agency?" (2026-11-04, owner, copy from "Insurvas OS Landing.md"): the five
 * tools an agency runs on, the founder's line about what that costs, and the one system instead.
 * Two things in the copy are still the owner's to confirm, and are marked where they sit below.
 */
const TOOLS = [
  { name: "A CRM", job: "for tracking." },
  { name: "A dialer", job: "for calls." },
  { name: "A spreadsheet", job: "for commissions." },
  { name: "Another spreadsheet", job: "for publisher payouts." },
  { name: "A prayer", job: "for compliance." },
];

const COSTS = [
  "Leads dying in handoffs.",
  "Agents doing data entry instead of selling.",
  "Commission disputes that lose top producers.",
  "Compliance gaps no one notices until it’s expensive.",
];

const INSTEAD = [
  { name: "Smart lead pipeline", text: "Tracks every opportunity from first dial to issued policy." },
  // TO CONFIRM (owner): the AI qualification claim is unverified in the source copy.
  { name: "AI qualification", text: "Filters bad leads before they burn agent hours." },
  { name: "Commission, accounting and publisher-payout automation", text: "With full transparency." },
  { name: "Compliance and data security", text: "Built into the workflow, not bolted on after." },
];

export function LandingStack() {
  return (
    <section aria-labelledby="stack-title" className={styles.section}>
      <div className={styles.inner}>
        {/* The heading and the line that explains it share one row, so the header is two lines tall
            instead of a narrow column of four with the rest of the row empty. */}
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>Sound like your agency?</p>
            <h2 id="stack-title" className={styles.heading}>Most Final Expense agencies run on five tools that don’t talk to each other.</h2>
          </div>
          <p className={styles.leak}>Every handoff between them is where leads, hours and money leak.</p>
        </header>

        <ol className={styles.tools}>
          {TOOLS.map((tool, i) => (
            <li key={tool.name} data-last={i === TOOLS.length - 1}>
              <strong>{tool.name}</strong>
              <span>{tool.job}</span>
            </li>
          ))}
        </ol>

        <div className={styles.split}>
          <figure className={styles.quote}>
            <blockquote>
              <p>I’ve watched what that chaos costs from the inside.</p>
              <ul>
                {COSTS.map((cost) => <li key={cost}>{cost}</li>)}
              </ul>
            </blockquote>
            {/* TO CONFIRM (owner): who is speaking. The source copy has only this placeholder. */}
            <figcaption>Founder name and role</figcaption>
          </figure>

          <div className={styles.instead}>
            <h3>One system instead</h3>
            <ul>
              {INSTEAD.map((item) => (
                <li key={item.name}>
                  <ArrowRight aria-hidden="true" />
                  <p><strong>{item.name}</strong><span>{item.text}</span></p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
