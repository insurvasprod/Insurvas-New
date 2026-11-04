"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Plus } from "lucide-react";

import styles from "@/components/marketing/landing-faq.module.css";

/**
 * Questions (2026-11-03): the objections an agency raises before a trial, answered plainly. Each
 * answer is the homepage baseline, verbatim, and describes something the product enforces. They all
 * start closed and at most one is open at a time; the answer slides open (grid-rows 0fr → 1fr), and
 * every question is a real button with aria-expanded, so it works by keyboard and screen reader.
 */
const FAQS = [
  { q: "Do you store card details?", a: "Not for your subscription: it is paid on our payment provider’s hosted page, and the card number never reaches an Insurvas server. Payment details your agents take from a client on an insurance application are a different matter — those are stored, encrypted, in your workspace so the application can be submitted." },
  { q: "Is screening really run before every dial?", a: "Yes, and on the server. The panel shows you the state, then the API re-checks consent, DNC, your suppression list and the calling window in the moment before the call is placed. If any of them fails, the dial is refused. The checks use the rules and vendors your agency configures — it is a screening tool, not a guarantee that every call is lawful, and compliance stays your agency’s responsibility." },
  { q: "What happens to my data?", a: "Your workspace’s data is kept separate from other agencies’ and is processed only to run the service for you, as our Privacy Policy describes. Leads and policies export from the app. Offboarding a partner keeps their history for audit and reporting. If you cancel, the workspace stays readable for a set period so you can export; after that, ask support to delete what remains." },
  { q: "Can partners see each other’s leads?", a: "Never. A partner signs into their own view: leads their organisation submitted, the stages those leads reached, and their channel with you. No other partner’s anything, no agent-internal notes, and no lead cost." },
  { q: "Do you charge per lead?", a: "No. You already pay your vendors by the lead; we are not going to charge you again for the same one. Pricing is per workspace, with seat and import limits stated on every plan; add-ons you choose and metered usage above your plan’s allowance (for example extra statement pages) are billed at the rates shown." },
];

/**
 * The questions mark: a small isometric stack beside the heading, back to front. It is the same
 * projection the bento's scenes use, so the page has one illustration language rather than two.
 * Decorative — no text, `aria-hidden`, and the FAQ list below carries every word that matters.
 * Positions are plane coordinates; `--z` is how far each tile stands off the plane.
 */
const TILES = [
  { tone: "flat", x: 8, y: 154, w: 144, h: 74, z: 0, d: 0 },
  { tone: "flat", x: 154, y: 176, w: 136, h: 70, z: 10, d: 120 },
  { tone: "flat", x: 18, y: 40, w: 130, h: 66, z: 34, d: 240 },
  { tone: "soft", x: 174, y: 46, w: 120, h: 64, z: 22, d: 360 },
  { tone: "mark", x: 66, y: 74, w: 180, h: 122, z: 84, d: 480 },
] as const;

/** Three lines, as the reference's piece carries them. */
const LABEL = ["Frequently", "asked", "questions"];

function QuestionsMark() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);

  // The assembly loops, so it must stop when nobody is looking: `data-run` is the only thing that
  // turns the animation on, and it is off whenever the section is out of the viewport.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const io = new IntersectionObserver(
      ([entry]) => { scene.dataset.run = String(Boolean(entry?.isIntersecting)); },
      { threshold: 0.2 },
    );
    io.observe(scene);
    return () => io.disconnect();
  }, []);

  const tilt = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || !planeRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    planeRef.current.style.setProperty("--px", `${(((event.clientX - rect.left) / rect.width) - 0.5) * 10}deg`);
    planeRef.current.style.setProperty("--py", `${(((event.clientY - rect.top) / rect.height) - 0.5) * -7}deg`);
  };
  const untilt = () => {
    planeRef.current?.style.setProperty("--px", "0deg");
    planeRef.current?.style.setProperty("--py", "0deg");
  };
  return (
    <div ref={sceneRef} className={styles.scene} aria-hidden="true" onPointerMove={tilt} onPointerLeave={untilt}>
      <div ref={planeRef} className={styles.plane}>
        {TILES.map((tile, index) => (
          <div
            key={index}
            className={styles.tile}
            data-tone={tile.tone}
            style={{ left: tile.x, top: tile.y, width: tile.w, height: tile.h, "--z": `${tile.z}px`, "--d": `${tile.d}ms` } as CSSProperties}
          >
            {tile.tone === "mark" && (
              <span className={styles.label}>{LABEL.map((line) => <span key={line}>{line}</span>)}</span>
            )}
          </div>
        ))}
        <div className={styles.badge} style={{ left: 92, top: 78, "--z": "132px", "--d": "600ms" } as CSSProperties}>?</div>
      </div>
    </div>
  );
}

export function LandingFaq() {
  // Every question starts closed (owner, 2026-11-03): the list reads as a list, not as one opened
  // answer with four headings under it.
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section id="faq" aria-labelledby="faq-title" className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.side}>
          <h2 id="faq-title" className={styles.title}>The ones people actually ask</h2>
          <QuestionsMark />
        </div>
        <ol className={styles.list}>
          {FAQS.map((item, index) => {
            const isOpen = open === index;
            return (
              <li key={item.q} className={styles.item} data-open={isOpen}>
                <h3>
                  <button type="button" aria-expanded={isOpen} aria-controls={`faq-answer-${index}`} id={`faq-question-${index}`} onClick={() => setOpen(isOpen ? null : index)}>
                    <span className={styles.num}>{String(index + 1).padStart(2, "0")}</span>
                    <span className={styles.q}>{item.q}</span>
                    <span className={styles.icon} aria-hidden="true"><Plus /></span>
                  </button>
                </h3>
                <div id={`faq-answer-${index}`} role="region" aria-labelledby={`faq-question-${index}`} className={styles.answer} inert={!isOpen}>
                  <div><p>{item.a}</p></div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
