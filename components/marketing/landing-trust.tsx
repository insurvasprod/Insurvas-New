"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { animate, createTimeline, stagger } from "animejs";

import styles from "@/components/marketing/landing-trust.module.css";

/**
 * The trust band, as an introduction (Umar, 4 Nov, A2.1: "this design is just basic … build some
 * credibility here: it's being built by someone, used by agents, internal team running for two
 * years"). Owner, 6 Nov: more visual, less text.
 *
 * Left, a photograph of someone at work, graded into the brand's deep green, with the three figures
 * along its foot: who uses it. Right, the statement and a short line from the floor it came from
 * to today: who built it and how long it has run, one sentence a stop.
 *
 * On first sight the photo opens upwards, the figures count up and the stops rise in turn. Without
 * a script, or under reduced motion, it is the finished band. The photo is CC0
 * (public/marketing/README.md).
 *
 * TO CONFIRM (Umar): every figure and the two-year line. "Year one / Year two" on purpose, so no
 * calendar date is invented. Change them here and nowhere else.
 */
const FIGURES = [
  { to: 2400, prefix: "", suffix: "+", label: "agents" },
  { to: 180, prefix: "", suffix: "+", label: "agencies" },
  { to: 48, prefix: "$", suffix: "M", label: "commission matched" },
];

const STOPS = [
  { when: "Year one", text: "We ran a live-transfer final expense floor on five tools." },
  { when: "Year two", text: "We built Insurvas to run it: one ledger for every lead, call and policy." },
  { when: "Today", text: "Agencies run their floors on it." },
];

const show = (f: (typeof FIGURES)[number], n: number) => `${f.prefix}${Math.round(n).toLocaleString("en-US")}${f.suffix}`;

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
      timeline = createTimeline({ defaults: { ease: "outQuart" }, onComplete: () => { root.dataset.state = "done"; } })
        .add(root.querySelector("[data-photo]")!, { clipPath: ["inset(100% 0 0 0 round 24px)", "inset(0% 0 0 0 round 24px)"], duration: 1100, ease: "inOutQuart" }, 0)
        .add(root.querySelectorAll("[data-figure]"), { opacity: [0, 1], translateY: [12, 0], duration: 700, delay: stagger(110) }, 650)
        .add(root.querySelectorAll("[data-stop]"), { opacity: [0, 1], translateY: [12, 0], duration: 650, delay: stagger(180) }, 300);
      root.querySelectorAll<HTMLElement>("[data-count]").forEach((el, i) => {
        const figure = FIGURES[i];
        const value = { n: 0 };
        animate(value, { n: figure.to, duration: 1300, delay: 700 + i * 110, ease: "outQuart", onUpdate: () => { el.textContent = show(figure, value.n); } });
      });
    }, { threshold: 0.35 });
    io.observe(root);
    return () => { io.disconnect(); timeline?.revert(); root.dataset.state = "done"; };
  }, []);

  return (
    <section aria-labelledby="landing-trust-heading" className={styles.band}>
      <div ref={ref} className={styles.inner} data-state="done">
        <figure className={styles.photo} data-photo="">
          <Image src="/marketing/audience-agent.webp" alt="" fill sizes="(max-width: 860px) 100vw, 46vw" className={styles.img} />
          <span className={styles.grade} aria-hidden="true" />
          <figcaption className={styles.figures}>
            {FIGURES.map((figure) => (
              <span key={figure.label} className={styles.figure} data-figure="">
                <b data-count="">{show(figure, figure.to)}</b>
                <small>{figure.label}</small>
              </span>
            ))}
          </figcaption>
        </figure>

        <div className={styles.copy}>
          <p className={styles.label}>Built by industry experts</p>
          <h2 id="landing-trust-heading" className={styles.title}>Made by people who sold final expense and ran live-transfer floors.</h2>
          <ol className={styles.line}>
            {STOPS.map((stop, i) => (
              <li key={stop.when} className={styles.stop} data-stop="" data-now={i === STOPS.length - 1}>
                <span className={styles.dot} aria-hidden="true" />
                <span className={styles.when}>{stop.when}</span>
                <p className={styles.text}>{stop.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
