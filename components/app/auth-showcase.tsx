"use client";

import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { BarChart3, Check, LayoutGrid, Pause, Phone, PhoneIncoming, Play, Receipt, ShieldCheck, Users } from "lucide-react";

import styles from "./auth-showcase.module.css";

/**
 * The right-hand panel on sign-in and every sign-up step (manager review, 2026-10-28, 09:37–11:42):
 * not a checklist but what the workspace looks like, animated, one feature per step, so the person
 * keeps seeing what they are signing up for. Every name and number below is made up.
 */
const SCENES = [
  {
    key: "inbound",
    eyebrow: "Inbound transfers",
    title: "Every live transfer lands with an owner.",
    benefit: "Calls from your partners arrive verified and go to the next free agent. Nobody misses one.",
    crumb: "Inbound",
    Screen: InboundScreen,
  },
  {
    key: "dialer",
    eyebrow: "Compliant dialing",
    title: "Know it is safe before you dial.",
    benefit: "Do-not-call, calling hours and consent are checked on every number, before the phone rings.",
    crumb: "Dialer",
    Screen: DialerScreen,
  },
  {
    key: "attribution",
    eyebrow: "Lead to policy",
    title: "See which leads turn into policies.",
    benefit: "Lead cost is traced to issued premium, so you know which source to buy more of.",
    crumb: "Lead sources",
    Screen: AttributionScreen,
  },
  {
    key: "commissions",
    eyebrow: "Commissions and book",
    title: "Every commission matched to its policy.",
    benefit: "Carrier statements are read and matched line by line. Missing money shows up on its own.",
    crumb: "Commissions",
    Screen: CommissionScreen,
  },
] as const;

/** Sign-up step 1 shows scene 1, step 2 scene 2, and so on; sign-in (step 0) starts at the first. */
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

/** Staggers an element's entrance: `delay(2)` starts it 2 × 260ms after the scene opens. */
function delay(order: number): CSSProperties {
  return { animationDelay: `${order * 260}ms` };
}

/** `footnote`: one quiet line under the panel (the payment promise on sign-up). */
export function AuthShowcase({ step = 0, footnote }: { step?: number; footnote?: string }) {
  const [index, setIndex] = useState(() => sceneForStep(step));
  const [paused, setPaused] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeToMotionPreference, getMotionPreference, () => false);
  const scene = SCENES[index];
  const Screen = scene.Screen;

  useEffect(() => {
    if (paused || reducedMotion || pointerInside || focusInside) return;
    // Long enough for a scene's own animation to finish and be read.
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % SCENES.length), 7000);
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
      <div key={`copy-${scene.key}`} className={styles.copy}>
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--nav-muted)]">{scene.eyebrow}</p>
        <h2 className="mb-0 mt-3 max-w-[20ch] text-title-lg font-semibold leading-[1.08] tracking-[-0.035em] text-[var(--on-dark)] sm:text-headline-lg">
          {scene.title}
        </h2>
        <p className="mb-0 mt-3 max-w-[46ch] text-sm leading-relaxed text-[var(--nav-ink)]">{scene.benefit}</p>
      </div>

      <div className={styles.stage} aria-hidden="true">
        <div key={scene.key} className={styles.frame}>
          <AppChrome crumb={scene.crumb} active={index}>
            <Screen />
          </AppChrome>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-4">
        <div className="flex flex-1 gap-1.5" aria-hidden="true">
          {SCENES.map((item, itemIndex) => (
            <span key={item.key} className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--nav-line)]">
              {itemIndex === index && <span key={`${scene.key}-bar`} className={styles.progress} data-still={paused || reducedMotion || pointerInside || focusInside ? "" : undefined} />}
              {itemIndex < index && <span className="block h-full w-full bg-[var(--nav-muted)]" />}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {!reducedMotion && <button type="button" onClick={() => setPaused((value) => !value)} aria-label={paused ? "Resume preview rotation" : "Pause preview rotation"} aria-pressed={paused} className="inline-flex size-9 items-center justify-center rounded-full text-[var(--nav-ink)] hover:bg-[var(--nav-line)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
            {paused ? <Play className="size-3.5 fill-current" aria-hidden="true" /> : <Pause className="size-3.5 fill-current" aria-hidden="true" />}
          </button>}
          {SCENES.map((item, itemIndex) => <button key={item.key} type="button" onClick={() => setIndex(itemIndex)} aria-label={`Show ${item.eyebrow} preview`} aria-pressed={itemIndex === index} className={`size-9 rounded-full text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] ${itemIndex === index ? "bg-[var(--primary)] text-[var(--on-primary)]" : "text-[var(--nav-ink)] hover:bg-[var(--nav-line)]"}`}>
            {itemIndex + 1}
          </button>)}
        </div>
      </div>
      {footnote && <p className="mb-0 mt-5 text-sm text-[var(--nav-muted)]">{footnote}</p>}
    </section>
  );
}

/** A miniature of the workspace: the dark icon rail, the top bar with the page name, and the page. */
function AppChrome({ crumb, active, children }: { crumb: string; active: number; children: ReactNode }) {
  const rail = [PhoneIncoming, Phone, BarChart3, Receipt];
  return (
    <div className="flex overflow-hidden rounded-[14px] border border-[var(--nav-line)] bg-[var(--surface)] text-[var(--ink)] shadow-[0_30px_80px_rgba(0,0,0,.45)]">
      <div className="flex w-11 shrink-0 flex-col items-center gap-2.5 bg-[var(--nav-bg)] py-3">
        <span className="mb-1 grid size-6 place-items-center rounded-md bg-[var(--primary)] text-xs font-bold text-[var(--on-primary)]">I</span>
        <LayoutGrid className="size-4 text-[var(--nav-muted)]" />
        {rail.map((Icon, itemIndex) => (
          <span key={itemIndex} className={itemIndex === active ? "grid size-7 place-items-center rounded-md bg-[var(--nav-line)] text-[var(--on-dark)]" : "grid size-7 place-items-center text-[var(--nav-muted)]"}>
            <Icon className="size-4" />
          </span>
        ))}
        <Users className="mt-auto size-4 text-[var(--nav-muted)]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex h-9 items-center justify-between border-b border-[var(--border)] px-4">
          <span className="text-xs text-[var(--muted)]">Work <span className="px-1">›</span><span className="font-semibold text-[var(--ink)]">{crumb}</span></span>
          <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--success-ink)]"><span className={`${styles.live} size-1.5 rounded-full bg-[var(--success)]`} />Live</span>
        </div>
        <div className="h-[284px] overflow-hidden p-4">{children}</div>
      </div>
    </div>
  );
}

function Avatar({ initials, tone = 0 }: { initials: string; tone?: number }) {
  const tones = ["bg-[var(--brand-100)] text-[var(--brand-700)]", "bg-[var(--info-surface)] text-[var(--info-ink)]", "bg-[var(--warning-surface)] text-[var(--warning-ink)]"];
  return <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${tones[tone % tones.length]}`}>{initials}</span>;
}

/** 1 · Live transfers arrive, get verified and go to the next free agent. */
function InboundScreen() {
  const rows = [
    { name: "Dana Whitfield", meta: "Final expense · TX", partner: "Northline Media", agent: "JR", state: "On call", tone: 1 },
    { name: "Marcus Bell", meta: "Term life · FL", partner: "Bluepeak Leads", agent: "AK", state: "On call", tone: 2 },
  ];
  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <p className="m-0 text-xs text-[var(--muted)]">Transfers today</p>
          <p className="m-0 text-xl font-semibold tabular-nums tracking-[-0.02em]">48 <span className="text-xs font-medium text-[var(--success-ink)]">+12%</span></p>
        </div>
        <div className="flex -space-x-1.5"><Avatar initials="JR" tone={1} /><Avatar initials="AK" tone={2} /><Avatar initials="SM" /></div>
      </div>
      {/* The new call arrives first and rings. */}
      <div className={`${styles.rowIn} mt-3 flex items-center gap-3 rounded-lg border border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_8%,var(--surface))] p-2.5`} style={delay(1)}>
        <span className={`${styles.ring} grid size-8 shrink-0 place-items-center rounded-full bg-[var(--primary)] text-[var(--on-primary)]`}><PhoneIncoming className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-xs font-semibold">Linda Ortiz · incoming</p>
          <p className="m-0 truncate text-xs text-[var(--muted)]">Medicare supplement · AZ · from Harbor Calls</p>
        </div>
        <span className={`${styles.popIn} inline-flex items-center gap-1 rounded-full bg-[var(--success-surface)] px-2 py-0.5 text-xs font-semibold text-[var(--success-ink)]`} style={delay(3)}><ShieldCheck className="size-3" />Verified</span>
        <span className={`${styles.popIn} rounded-md bg-[var(--primary)] px-2.5 py-1 text-xs font-semibold text-[var(--on-primary)]`} style={delay(4)}>Claim</span>
      </div>
      <div className="mt-2 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
        {rows.map((row, rowIndex) => (
          <div key={row.name} className={`${styles.rowIn} flex items-center gap-3 p-2.5`} style={delay(rowIndex + 1.5)}>
            <Avatar initials={row.agent} tone={row.tone} />
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-xs font-semibold">{row.name}</p>
              <p className="m-0 truncate text-xs text-[var(--muted)]">{row.meta} · {row.partner}</p>
            </div>
            <span className="text-xs font-medium text-[var(--info-ink)]">{row.state}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 2 · The preflight checks tick off one by one, then the dial button wakes up. */
function DialerScreen() {
  const checks = ["National do-not-call list: clear", "Calling hours in Ohio: open until 9 pm", "Consent on file: web form, 12 Oct", "Attempts this week: 2 of 6"];
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="rounded-lg border border-[var(--border)] p-3">
        <div className="flex items-center gap-2.5"><Avatar initials="RT" tone={1} /><div className="min-w-0"><p className="m-0 truncate text-xs font-semibold">Robert Tran</p><p className="m-0 text-xs text-[var(--muted)]">Columbus, OH · 10:42 am</p></div></div>
        <p className="mb-0 mt-3 text-base font-semibold tabular-nums tracking-[-0.01em]">(614) 555-0148</p>
        <p className="m-0 text-xs text-[var(--muted)]">Final expense · aged lead, 9 days</p>
        <span className={`${styles.popIn} ${styles.glow} mt-3 flex items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] py-2 text-xs font-semibold text-[var(--on-primary)]`} style={delay(5)}><Phone className="size-3.5" />Dial now</span>
      </div>
      <div>
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">Before this call</p>
        <ul className="m-0 mt-2 list-none space-y-2 p-0">
          {checks.map((check, checkIndex) => (
            <li key={check} className={`${styles.rowIn} flex items-start gap-2 text-xs`} style={delay(checkIndex + 1)}>
              <span className={`${styles.popIn} mt-px grid size-4 shrink-0 place-items-center rounded-full bg-[var(--success)] text-white`} style={delay(checkIndex + 1.4)}><Check className="size-3 stroke-[3]" /></span>
              <span className="text-[var(--body)]">{check}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** 3 · Cost per issued policy by lead source; the bars grow to their values. */
function AttributionScreen() {
  const sources = [
    { name: "Northline Media", cost: "$212", policies: 31, width: 94 },
    { name: "Bluepeak Leads", cost: "$298", policies: 19, width: 58 },
    { name: "Facebook forms", cost: "$341", policies: 12, width: 36 },
    { name: "Aged leads", cost: "$96", policies: 9, width: 27 },
  ];
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {[["Lead spend", "$18.4k"], ["Issued premium", "$61.2k"], ["Return", "3.3×"]].map(([label, value], tileIndex) => (
          <div key={label} className={`${styles.popIn} rounded-lg border border-[var(--border)] p-2.5`} style={delay(tileIndex * 0.6)}>
            <p className="m-0 text-xs text-[var(--muted)]">{label}</p>
            <p className="m-0 text-sm font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg border border-[var(--border)] p-3">
        <div className="mb-2 flex justify-between text-xs font-semibold uppercase tracking-[0.06em] text-[var(--muted)]"><span>Source</span><span>Policies issued</span></div>
        <div className="space-y-2.5">
          {sources.map((source, sourceIndex) => (
            <div key={source.name}>
              <div className="flex justify-between text-xs"><span className="font-medium">{source.name}</span><span className="tabular-nums text-[var(--body)]"><span className="font-semibold text-[var(--ink)]">{source.policies}</span> · {source.cost} per sale</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-[var(--surface-alt)]">
                <div className={`${styles.grow} h-full rounded-full bg-[var(--primary)]`} style={{ width: `${source.width}%`, ...delay(sourceIndex + 1) }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 4 · Statement lines get matched to policies one at a time; the last one is flagged as missing. */
function CommissionScreen() {
  const lines = [
    { policy: "MOO-48213", client: "D. Whitfield", amount: "$642.00", ok: true },
    { policy: "AET-11902", client: "M. Bell", amount: "$1,180.50", ok: true },
    { policy: "AMR-30577", client: "L. Ortiz", amount: "$388.20", ok: true },
    { policy: "FOR-77410", client: "R. Tran", amount: "$0.00", ok: false },
  ];
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="m-0 text-xs text-[var(--muted)]">Mutual of Omaha · October statement</p>
          <p className="m-0 text-xl font-semibold tabular-nums tracking-[-0.02em]">$2,210.70</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-alt)] px-2 py-1 text-xs font-semibold text-[var(--body)]"><Receipt className="size-3" />3 of 4 matched</span>
      </div>
      <div className="mt-3 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
        {lines.map((line, lineIndex) => (
          <div key={line.policy} className={`${styles.rowIn} grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-1.5`} style={delay(lineIndex + 1)}>
            <div className="min-w-0"><p className="m-0 text-xs font-semibold tabular-nums">{line.policy}</p><p className="m-0 text-xs text-[var(--muted)]">{line.client}</p></div>
            <span className="text-xs tabular-nums">{line.amount}</span>
            {line.ok
              ? <span className={`${styles.popIn} inline-flex items-center gap-1 rounded-full bg-[var(--success-surface)] px-2 py-0.5 text-xs font-semibold text-[var(--success-ink)]`} style={delay(lineIndex + 1.6)}><Check className="size-3 stroke-[3]" />Matched</span>
              : <span className={`${styles.popIn} rounded-full bg-[var(--warning-surface)] px-2 py-0.5 text-xs font-semibold text-[var(--warning-ink)]`} style={delay(lineIndex + 1.6)}>Missing</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
