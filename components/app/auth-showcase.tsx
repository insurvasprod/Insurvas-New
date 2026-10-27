"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";

import styles from "./auth-showcase.module.css";

const SCENES = [
  {
    key: "inbound",
    eyebrow: "Inbound transfers",
    title: "Every handoff has an owner.",
    benefit: "Route incoming prospects to the right person, with the next action clear.",
    screenTitle: "Transfer queue",
    screenLabel: "New transfer",
    screenValue: "Ready for an agent",
    screenStatus: "Verified",
    next: "Claim transfer",
  },
  {
    key: "dialer",
    eyebrow: "Compliant dialing",
    title: "Know what is safe to call next.",
    benefit: "Keep call attempts, contact preferences and do-not-call checks together.",
    screenTitle: "Dialer preflight",
    screenLabel: "Contact check",
    screenValue: "Ready to dial",
    screenStatus: "Clear",
    next: "Start next call",
  },
  {
    key: "attribution",
    eyebrow: "Lead to policy",
    title: "See which leads become business.",
    benefit: "Connect source costs to issued policies so acquisition decisions use real outcomes.",
    screenTitle: "Lead attribution",
    screenLabel: "Policy status",
    screenValue: "Issued and linked",
    screenStatus: "Tracked",
    next: "View lead history",
  },
  {
    key: "commissions",
    eyebrow: "Commissions and book",
    title: "Keep the policy and its money in sync.",
    benefit: "Follow commissions from carrier statement to producer and policy record.",
    screenTitle: "Commission match",
    screenLabel: "Statement line",
    screenValue: "Matched to a policy",
    screenStatus: "Reconciled",
    next: "Review match",
  },
] as const;

function sceneForStep(step: number) {
  return step > 0 ? (step - 1) % SCENES.length : 0;
}

function subscribeToMotionPreference(onChange: () => void) {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", onChange);
  return () => preference.removeEventListener("change", onChange);
}

function getMotionPreference() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A light, illustrative slice of real workspace tasks, shared by sign-in and onboarding. */
export function AuthShowcase({ step = 0 }: { step?: number }) {
  const [index, setIndex] = useState(() => sceneForStep(step));
  const [paused, setPaused] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeToMotionPreference, getMotionPreference, () => false);
  const scene = SCENES[index];

  useEffect(() => {
    if (paused || reducedMotion || pointerInside || focusInside) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % SCENES.length), 5000);
    return () => window.clearInterval(timer);
  }, [paused, reducedMotion, pointerInside, focusInside]);

  return (
    <section
      className="mx-auto w-full max-w-[40rem]"
      aria-label="Insurvas product preview"
      onPointerEnter={() => setPointerInside(true)}
      onPointerLeave={() => setPointerInside(false)}
      onFocusCapture={() => setFocusInside(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusInside(false); }}
    >
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--nav-muted)]">Inside your workspace</p>
      <h2 className="mb-0 mt-3 max-w-[18ch] text-title-lg font-semibold leading-[1.08] tracking-[-0.035em] text-[var(--on-dark)] sm:text-headline-lg">
        {scene.title}
      </h2>
      <p className="mb-0 mt-3 max-w-[44ch] text-sm leading-relaxed text-[var(--nav-ink)]">{scene.benefit}</p>

      <div key={scene.key} className={`${styles.scene} mt-7 overflow-hidden rounded-[14px] border border-[var(--nav-line)] bg-[var(--surface)] text-[var(--ink)]`}>
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3">
          <span className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]"><span className="size-2 rounded-full bg-[var(--primary)]" aria-hidden="true" />Insurvas <span className="font-normal text-[var(--muted)]">/ {scene.screenTitle}</span></span>
          <span className="rounded-full bg-[var(--success-surface)] px-2 py-1 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--success-ink)]">Product preview</span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5">
          <div className="min-w-0">
            <p className="m-0 text-xs text-[var(--muted)]">{scene.screenLabel}</p>
            <p className="mb-0 mt-1 text-sm font-semibold text-[var(--ink)]">{scene.screenValue}</p>
            <div className="mt-3 flex items-center gap-2 text-xs text-[var(--body)]"><span className="size-1.5 rounded-full bg-[var(--success)]" aria-hidden="true" />{scene.screenStatus}<span className="text-[var(--muted)]">·</span>Workspace activity saved</div>
          </div>
          <span className="inline-flex min-h-9 items-center justify-center rounded-[8px] bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--on-primary)]">{scene.next}</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 px-4 pb-4 sm:px-5">
          {SCENES.map((item, itemIndex) => <span key={item.key} className={itemIndex === index ? "h-1 rounded-full bg-[var(--primary)]" : "h-1 rounded-full bg-[var(--border)]"} />)}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="m-0 text-xs font-medium text-[var(--nav-muted)]" aria-live="off">{scene.eyebrow} · {index + 1} of {SCENES.length}</p>
        <div className="flex items-center gap-2">
          {!reducedMotion && <button type="button" onClick={() => setPaused((value) => !value)} aria-label={paused ? "Resume preview rotation" : "Pause preview rotation"} aria-pressed={paused} className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--nav-line)] text-[var(--nav-ink)] hover:bg-[var(--nav-line)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
            {paused ? <Play className="size-3.5 fill-current" aria-hidden="true" /> : <Pause className="size-3.5 fill-current" aria-hidden="true" />}
          </button>}
          {SCENES.map((item, itemIndex) => <button key={item.key} type="button" onClick={() => setIndex(itemIndex)} aria-label={`Show ${item.eyebrow} preview`} aria-pressed={itemIndex === index} className={`size-9 rounded-full text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] ${itemIndex === index ? "bg-[var(--primary)] text-[var(--on-primary)]" : "text-[var(--nav-ink)] hover:bg-[var(--nav-line)]"}`}>
            {itemIndex + 1}
          </button>)}
        </div>
      </div>
    </section>
  );
}
