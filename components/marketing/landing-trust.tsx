"use client";

import { useEffect, useRef } from "react";
import { animate, createTimeline, stagger } from "animejs";

import styles from "@/components/marketing/landing-trust.module.css";

/**
 * The trust band, rebuilt as an introduction (Umar, 4 Nov, A2.1: "this design is just basic … you
 * build some credibility here: it's being built by someone, used by agents, internal team running for
 * two years; once you have credibility, you come up with why this"; owner, 6 Nov: the best design
 * this place can have).
 *
 * Not a row of big numbers (the hero-metric template): a short line from the floor the product came
 * from to the people who use it today, three stops on one rule, each figure inside its sentence. The
 * rule draws in and the stops rise once, the first time the band is seen; the figures on the last
 * stop count up. Without a script, or under reduced motion, it is simply the finished line.
 *
 * TO CONFIRM (Umar): every figure and the two-year timeline. "Year one / Year two" on purpose, so no
 * calendar date is invented. Change them here and nowhere else.
 */
const STOPS = [
  { when: "Year one", text: <>We ran a final expense <b>live-transfer floor</b> on five tools that never talked to each other.</> },
  { when: "Year two", text: <>We built Insurvas to run that floor: <b>every lead, call, policy and payout</b> in one ledger.</> },
  {
    when: "Today",
    text: <><b><span data-count="2400" data-suffix="+">2,400+</span> agents</b> across <b><span data-count="180" data-suffix="+">180+</span> agencies</b> work in it, with <b>$<span data-count="48" data-suffix="M">48M</span></b> in commission matched to the leads that earned it.</>,
  },
];

export function LandingTrust() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    root.dataset.state = "waiting";
    let timeline: ReturnType<typeof createTimeline> | null = null;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || timeline) return;
      io.disconnect();
      const counts = [...root.querySelectorAll<HTMLElement>("[data-count]")];
      timeline = createTimeline({ defaults: { ease: "outQuart" }, onComplete: () => { root.dataset.state = "done"; } })
        // The rule runs across on a wide screen and down on a narrow one.
        .add(root.querySelector("[data-rule]")!, window.matchMedia("(max-width: 860px)").matches ? { scaleY: [0, 1], duration: 1100, ease: "inOutQuart" } : { scaleX: [0, 1], duration: 1100, ease: "inOutQuart" }, 0)
        .add(root.querySelectorAll("[data-stop]"), { opacity: [0, 1], translateY: [14, 0], duration: 700, delay: stagger(260) }, 120)
        .add(root.querySelectorAll("[data-dot]"), { scale: [0.3, 1], duration: 500, delay: stagger(260) }, 160);
      counts.forEach((el, i) => {
        const to = Number(el.dataset.count);
        const value = { n: 0 };
        animate(value, { n: to, duration: 1200, delay: 760 + i * 90, ease: "outQuart", onUpdate: () => { el.textContent = `${Math.round(value.n).toLocaleString("en-US")}${el.dataset.suffix ?? ""}`; } });
      });
    }, { threshold: 0.4 });
    io.observe(root);
    return () => { io.disconnect(); timeline?.revert(); root.dataset.state = "done"; };
  }, []);

  return (
    <section aria-labelledby="landing-trust-heading" className={styles.band}>
      <div ref={ref} className={styles.inner} data-state="done">
        <header className={styles.head}>
          <p className={styles.label}>Built by industry experts</p>
          <h2 id="landing-trust-heading" className={styles.title}>Made by people who sold final expense and ran live-transfer floors.</h2>
        </header>
        <ol className={styles.line}>
          <span className={styles.rule} data-rule="" aria-hidden="true" />
          {STOPS.map((stop, i) => (
            <li key={stop.when} className={styles.stop} data-stop="" data-now={i === STOPS.length - 1}>
              <span className={styles.dot} data-dot="" aria-hidden="true" />
              <span className={styles.when}>{stop.when}</span>
              <p className={styles.text}>{stop.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
