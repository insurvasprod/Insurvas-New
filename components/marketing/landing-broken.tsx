"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import styles from "@/components/marketing/landing-broken.module.css";

/**
 * "What's broken today" (2026-11-04, owner, copy from "Insurvas OS Landing.md"): seven leaks as a
 * row of photo cards you can scroll. Each card is a real photograph (public/marketing/README.md has
 * the sources and licences) and the problem in one line; choosing a card opens what Insurvas does
 * about it, and on which plan, underneath. The cards are pressed buttons, not tabs: they scroll.
 *
 * Owner, 6 Nov: no scrollbar, the arrows at the top are the controls, the edges fade, and the
 * row moves on its own, slowly, without stopping and only ever one way (owner, 6 Nov). The cards
 * are laid out three times on a track that slides left by exactly one copy and repeats, which
 * looks like one endless row. It is a Web Animations transform, so it runs on the compositor and
 * stays smooth (moving scrollLeft stepped by whole pixels). The arrows glide it a card either way
 * and a finger can drag it; it carries on afterwards. It stops only while a card has keyboard focus,
 * and never moves under reduced motion (the arrows and dragging still work there).
 */
const SPEED = 30; // pixels a second
/** The open leak moves on to the next one this often (owner, 6 Nov), and waits longer after a click. */
const LEAK_MS = 5_000;
const LEAK_HOLD_MS = 15_000;
const COPIES = [0, 1, 2];
const LEAKS = [
  {
    key: "lapse",
    tab: "Lapses",
    photo: "/marketing/leak-lapse.webp",
    broken: "One early lapse can erase the profit from 26 good sales.",
    body: "The carrier pays an advance on day one. If the policy lapses early, they take it back on a later statement. Most agents find out when that statement lands.",
    plan: "Advanced",
    fix: "You are warned before the policy dies, not after.",
    points: [
      "A save queue of at-risk policies, ranked by risk times money.",
      "Failed drafts, lapse notices and drafts that land before the deposit are flagged before the draft date.",
      "Payment repair: call, update the bank details, track the change to the carrier.",
    ],
  },
  {
    key: "draft",
    tab: "Draft dates",
    photo: "/marketing/leak-draft.webp",
    broken: "The draft hits an empty account, and the policy is dead in two months.",
    body: "Final expense customers live on Social Security. If the draft date lands before the deposit, the draft bounces, and about two months later the advance is clawed back. Nobody checks the date at the kitchen table.",
    plan: "Basic and up",
    fix: "The draft date is checked while you are still on the phone.",
    points: [
      "Enter the date of birth and Insurvas works out the Social Security deposit window.",
      "A draft date that lands before the deposit is flagged before you submit. You can override it, and the override is logged.",
      "A pre-submission check catches the gaps that make carriers bounce an application (NIGO).",
    ],
  },
  {
    key: "commission",
    tab: "Underpaid commission",
    photo: "/marketing/leak-commission.webp",
    broken: "Carriers underpay you, and nine statement formats make sure you never notice.",
    body: "Every carrier sends its own PDF. Most sit unopened. Policies that were never paid, lines paid at the wrong rate and duplicate chargebacks stay buried on line 34.",
    plan: "Every plan",
    fix: "Every statement line meets the policy you wrote.",
    points: [
      "Upload a statement or send it by email. Each line is matched to a policy, and you accept every match.",
      "A discrepancy report: missing, short-paid, mis-rated, duplicate and unexpected chargebacks.",
      "Dispute letters drafted with the policy numbers and the arithmetic.",
    ],
  },
  {
    key: "vendors",
    tab: "Vendors",
    photo: "/marketing/leak-vendors.webp",
    broken: "You pay your vendors on the honour system.",
    body: "A vendor messages on WhatsApp for last week’s 31 transfers. You count them by hand and get a different number. And the vendor that looks cheapest per sale may be the one whose customers lapse the most.",
    plan: "Basic and Advanced",
    fix: "Every dollar is traced to the lead that earned it, or didn’t.",
    points: [
      "Cost recorded on every lead, from every list and every transfer.",
      "Reject a bad transfer with the call recording. The payout reverses and a dispute opens.",
      "A lead-source scorecard with true cost per sale, lapses included.",
      "Partners sign in and see their own numbers before the argument starts.",
    ],
  },
  {
    key: "compliance",
    tab: "Compliance",
    photo: "/marketing/leak-compliance.webp",
    broken: "One bad dial can cost more than the sale.",
    body: "TCPA penalties start at $500 a call and can reach $1,500. A purchased list is exactly where Do Not Call numbers hide. When a demand letter arrives, finding the proof can take two weeks.",
    plan: "Basic and Advanced",
    fix: "Every dial is screened first. Every call has its paper trail.",
    points: [
      "Every list is scrubbed against Do Not Call before it is dialed. It is not a toggle.",
      "Consent, DNC, your suppression list and the calling window are re-checked on the server before every dial. Refusals are logged with the reason.",
      "Consent certificates and call recordings stored against each lead.",
      "A one-click litigation packet: every call, recording, certificate and scrub result for one contact.",
    ],
    note: "A screening tool, not a guarantee that every call is lawful. Compliance stays with your agency.",
  },
  {
    key: "profit",
    tab: "Profit",
    photo: "/marketing/leak-profit.webp",
    broken: "Nobody can tell you whether you made money today.",
    body: "Leads live in one tool, sales in a spreadsheet, commissions in nine portals and vendor bills in WhatsApp. At nine at night, you still cannot say if the day paid.",
    plan: "Dashboard in every plan, Accounting in Advanced",
    fix: "One ledger. Every dollar in and out, tied to a policy.",
    points: [
      "Lead cost, vendor payouts, advances, commissions and chargebacks written to one ledger.",
      "Profit and loss by month, by vendor and by policy.",
      "Cost per policy issued, beside cost per policy that stays.",
    ],
  },
  {
    key: "team",
    tab: "Your team",
    photo: "/marketing/leak-team.webp",
    broken: "The day you hire, the spreadsheet breaks.",
    body: "Your first assistant needs your leads and callbacks, not your commissions. Your bookkeeper needs the ledger, not the call recordings. A shared login and a shared sheet cannot tell the difference.",
    plan: "Team plans",
    fix: "Everyone gets a role. Nobody gets the whole keyring.",
    points: [
      "Owner, producer, assistant and bookkeeper roles, set per account.",
      "Producers see their own policies and commissions. Assistants see no money data at all.",
    ],
  },
];

export function LandingBroken() {
  const [index, setIndex] = useState(0);
  /** Ticks to skip after a click: 15 seconds is three 5-second ticks. */
  const holdTicks = useRef(0);
  const panelHover = useRef(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const choose = (i: number) => { holdTicks.current = LEAK_HOLD_MS / LEAK_MS; setIndex(i); };

  // The next leak every 5 seconds, while the section is on screen and nobody is reading the panel.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let visible = false;
    const io = new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting); }, { threshold: 0.3 });
    io.observe(section);
    const timer = window.setInterval(() => {
      if (holdTicks.current > 0) { holdTicks.current -= 1; return; }
      if (!visible || panelHover.current || document.hidden) return;
      setIndex((now) => (now + 1) % LEAKS.length);
    }, LEAK_MS);
    return () => { io.disconnect(); window.clearInterval(timer); };
  }, []);
  const leak = LEAKS[index];

  const trackRef = useRef<HTMLDivElement>(null);
  const motion = useRef<Animation | null>(null);
  /** One copy of the cards, in pixels: how far the track slides before it looks the same again. */
  const copy = useRef(0);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const dragged = useRef(false);

  const loopTime = () => (copy.current / SPEED) * 1000;
  const wrap = (time: number) => ((time % loopTime()) + loopTime()) % loopTime();

  /** Moves the loop by some pixels (+ is on, to the right) over a short ease-out, then it runs on. */
  const nudge = useCallback((pixels: number, duration = 450) => {
    const animation = motion.current;
    if (!animation || !copy.current) return;
    const from = Number(animation.currentTime ?? 0);
    const delta = (pixels / SPEED) * 1000;
    const begin = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - begin) / duration);
      const eased = 1 - (1 - t) ** 3;
      animation.currentTime = wrap(from + delta * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scroll = (by: number) => {
    const card = trackRef.current?.querySelector("button");
    if (card) nudge(by * (card.getBoundingClientRect().width + 16));
  };

  // The loop: built once the cards are laid out, rebuilt at the same point when the width changes.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const build = () => {
      const cards = track.querySelectorAll<HTMLElement>("button");
      const width = cards.length > LEAKS.length ? cards[LEAKS.length].offsetLeft - cards[0].offsetLeft : 0;
      if (!width || width === copy.current) return;
      const progress = motion.current && copy.current ? Number(motion.current.currentTime ?? 0) / loopTime() : 0;
      motion.current?.cancel();
      copy.current = width;
      const animation = track.animate(
        [{ transform: `translate3d(${-width}px, 0, 0)` }, { transform: `translate3d(${-2 * width}px, 0, 0)` }],
        { duration: loopTime(), iterations: Infinity, easing: "linear" },
      );
      animation.currentTime = progress * loopTime();
      if (reduce) animation.pause();
      motion.current = animation;
    };
    build();
    const resize = new ResizeObserver(build);
    resize.observe(track);
    // A card with keyboard focus holds still, so it can be read.
    // Only keyboard focus holds it: a card clicked with a mouse or a finger keeps focus too, and the
    // row used to stop until the visitor clicked somewhere else (owner, 6 Nov: it stops time to time).
    const hold = (event: FocusEvent) => { if ((event.target as HTMLElement).matches(":focus-visible")) motion.current?.pause(); };
    const go = () => { if (!reduce) motion.current?.play(); };
    track.addEventListener("focusin", hold);
    track.addEventListener("focusout", go);
    return () => {
      resize.disconnect();
      track.removeEventListener("focusin", hold);
      track.removeEventListener("focusout", go);
      motion.current?.cancel();
      motion.current = null;
      copy.current = 0;
    };
  }, []);

  // Dragging with a finger (or a mouse) moves the loop; a tap still chooses a card.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { x: event.clientX, moved: false };
    dragged.current = false;
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const animation = motion.current;
    if (!state || !animation || !copy.current) return;
    const dx = event.clientX - state.x;
    if (!state.moved && Math.abs(dx) < 6) return;
    if (!state.moved) {
      state.moved = true;
      dragged.current = true;
      animation.pause();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    state.x = event.clientX;
    animation.currentTime = wrap(Number(animation.currentTime ?? 0) - (dx / SPEED) * 1000);
  };
  const onPointerUp = () => {
    const moved = drag.current?.moved;
    drag.current = null;
    if (moved && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) motion.current?.play();
  };
  // A drag that ends over a card must not also choose it.
  const onClickCapture = (event: ReactMouseEvent) => {
    if (dragged.current) { event.stopPropagation(); event.preventDefault(); }
    dragged.current = false;
  };

  return (
    <div ref={sectionRef} className={styles.broken}>
      <div className={styles.controls}>
        <p className={styles.count}>{index + 1} of {LEAKS.length} · <b>{leak.tab}</b></p>
        <div className={styles.arrows}>
          <button type="button" onClick={() => scroll(-1)} aria-label="Scroll back"><ArrowLeft aria-hidden="true" /></button>
          <button type="button" onClick={() => scroll(1)} aria-label="Scroll on"><ArrowRight aria-hidden="true" /></button>
        </div>
      </div>

      <div
        className={styles.row}
        role="group"
        aria-label="What’s broken today"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
      >
        <div ref={trackRef} className={styles.track}>
        {/* Three copies for the endless loop; only the middle one is reachable by keyboard and
            screen reader, the other two are the same cards seen again. */}
        {COPIES.flatMap((copy) => LEAKS.map((item, i) => (
          <button
            key={`${copy}-${item.key}`}
            type="button"
            aria-pressed={i === index}
            aria-controls="leak-panel"
            aria-hidden={copy === 1 ? undefined : true}
            tabIndex={copy === 1 ? undefined : -1}
            className={styles.card}
            onClick={() => choose(i)}
          >
            <span className={styles.photo}>
              <Image src={item.photo} alt="" fill sizes="(max-width: 640px) 80vw, 320px" />
            </span>
            {/* Fills while the open leak waits for the next; restarts with each one. Middle copy only. */}
            {i === index && copy === 1 && <span key={index} className={styles.cardTimer} aria-hidden="true" />}
            <span className={styles.cardText}>
              <span className={styles.cardTab}>{item.tab}</span>
              <span className={styles.cardTitle}>{item.broken}</span>
            </span>
          </button>
        )))}
        </div>
      </div>

      <div id="leak-panel" className={styles.panel} aria-live="polite" key={leak.key} onPointerEnter={() => { panelHover.current = true; }} onPointerLeave={() => { panelHover.current = false; }}>
        <div className={styles.panelProblem}>
          <p className={styles.tag}>Broken today</p>
          <p className={styles.problem}>{leak.broken}</p>
          <p className={styles.body}>{leak.body}</p>
        </div>
        <div className={styles.panelFix}>
          <p className={styles.plan}>With Insurvas <b>{leak.plan}</b></p>
          <p className={styles.fix}>{leak.fix}</p>
          <ul className={styles.points}>
            {leak.points.map((point) => <li key={point}>{point}</li>)}
          </ul>
          {"note" in leak && leak.note && <p className={styles.note}>{leak.note}</p>}
        </div>
      </div>
    </div>
  );
}
