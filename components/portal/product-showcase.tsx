"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { CalendarClock, Check, PhoneCall, PhoneIncoming, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import styles from "./product-showcase.module.css";

/**
 * The right half of sign-in and sign-up: the product, moving (manager review, 2026-10-28, 09:37–11:42).
 *
 * "The right side is doing pretty much nothing… show images and cool animations of what the software
 * is going to look like, and the features, in a slide show." It is storytelling: while someone signs up
 * they keep seeing what they are signing up for. Each sign-up step opens on the next feature, so moving
 * forward moves the story forward too; on a step the slides carry on by themselves.
 *
 * The screens are drawn, not screenshots: they stay sharp at any size, in the brand's colours, and show
 * the one thing each feature does. No data, no requests.
 */

type Scene = { key: string; eyebrow: string; title: string; body: string; screen: ReactNode };

/** One slide's time on screen. The bars under the window count it down. */
const SLIDE_MS = 6500;

/** The mock app is always the light product surface, whatever the theme: its palette is in the CSS module. */
const ink = "var(--m-ink)";
const muted = "var(--m-muted)";
const line = "var(--m-line)";
const accent = "var(--m-accent)";
const accentSoft = "var(--m-accent-soft)";
const warn = "var(--m-warn)";
const warnSoft = "var(--m-warn-soft)";

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

function Window({ path, children }: { path: string; children: ReactNode }) {
  return (
    <div className={cn(styles.window, styles.mock, "overflow-hidden rounded-xl border border-white/15 bg-[var(--m-surface)] shadow-[0_30px_80px_-20px_rgba(0,0,0,.55)]")}>
      <div className="flex items-center gap-2 border-b px-3.5 py-2.5" style={{ borderColor: line, background: "white" }}>
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-[var(--m-dot-red)]" />
          <span className="size-2.5 rounded-full bg-[var(--m-dot-amber)]" />
          <span className="size-2.5 rounded-full bg-[var(--m-dot-green)]" />
        </span>
        <span className={cn(styles.xs, "mx-auto rounded-md px-3 py-0.5")} style={{ background: "var(--m-quiet)", color: muted }}>insurvas.com/app/{path}</span>
        <span className="w-[42px]" aria-hidden="true" />
      </div>
      <div className="p-4" style={{ color: ink }}>{children}</div>
    </div>
  );
}

function Card({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cn("rounded-lg border bg-white", className)} style={{ borderColor: line, ...style }}>
      {children}
    </div>
  );
}

function Initials({ text, tone = accentSoft, color = accent }: { text: string; tone?: string; color?: string }) {
  return <span className={cn(styles.xs, "flex size-8 shrink-0 items-center justify-center rounded-full font-bold")} style={{ background: tone, color }}>{text}</span>;
}

/* ── 1. Inbound: a live transfer rings, one agent claims it ──────────────────────────────────── */
function InboundScreen() {
  return (
    <Window path="inbound">
      <div className="flex items-center justify-between">
        <span className={cn(styles.md, "font-semibold")}>Live transfers</span>
        <span className={cn(styles.xs, "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold")} style={{ background: accentSoft, color: accent }}>
          <span className="size-1.5 rounded-full" style={{ background: accent }} />Taking calls
        </span>
      </div>
      <Card className={cn(styles.rise, "mt-3 flex items-center gap-3 p-3")} style={delay(150)}>
        <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full" style={{ background: accentSoft, color: accent }}>
          <span className={styles.ring} aria-hidden="true" />
          <span className={styles.ring} style={delay(900)} aria-hidden="true" />
          <PhoneIncoming className="size-[18px]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn(styles.md, "block font-semibold")}>Maria Lopez · Final expense</span>
          <span className={cn(styles.xs, "block")} style={{ color: muted }}>From Apex Call Center · Dallas, TX</span>
        </span>
        <span className="relative h-8 w-[104px] shrink-0">
          <span className={cn(styles.sm, styles.fadeOut, "absolute inset-0 flex items-center justify-center rounded-md font-semibold text-white")} style={{ background: accent, ...delay(2000) }}>Claim call</span>
          <span className={cn(styles.sm, styles.pop, "absolute inset-0 flex items-center justify-center gap-1 rounded-md font-semibold")} style={{ background: accentSoft, color: accent, ...delay(2150) }}>
            <Check className="size-3.5 stroke-[3]" aria-hidden="true" />Yours
          </span>
        </span>
      </Card>
      <p className={cn(styles.xs, styles.fadeIn, "mt-2")} style={{ color: muted, ...delay(2500) }}>Claimed by you. The other 11 agents no longer see it.</p>
      {[
        ["JT", "James Turner · Medicare", "Waiting 0:12"],
        ["RP", "Rosa Patel · Term life", "Waiting 0:31"],
      ].map(([initials, name, wait], index) => (
        <Card key={name} className={cn(styles.rise, "mt-2 flex items-center gap-3 px-3 py-2.5")} style={delay(500 + index * 160)}>
          <Initials text={initials} tone="var(--m-quiet)" color={muted} />
          <span className={cn(styles.sm, "flex-1 font-medium")}>{name}</span>
          <span className={cn(styles.xs, "tabular-nums")} style={{ color: muted }}>{wait}</span>
        </Card>
      ))}
    </Window>
  );
}

/* ── 2. Dialer: every number checked against do-not-call before it rings ──────────────────────── */
function DialerScreen() {
  const rows = [
    { name: "Daniel Brooks", phone: "(214) 555-0148", ok: true },
    { name: "Grace Kim", phone: "(512) 555-0193", ok: true },
    { name: "Owen Price", phone: "(713) 555-0127", ok: false },
    { name: "Lena Ortiz", phone: "(469) 555-0162", ok: true },
  ];
  return (
    <Window path="dialer">
      <div className="flex items-center justify-between">
        <span className={cn(styles.md, "font-semibold")}>Power dialer</span>
        <span className={cn(styles.xs, "")} style={{ color: muted }}>4 in the queue</span>
      </div>
      <Card className="mt-3 divide-y overflow-hidden" style={{ borderColor: line }}>
        {rows.map((row, index) => (
          <div key={row.name} className={cn(styles.rise, "flex items-center gap-3 px-3 py-2.5")} style={{ borderColor: line, ...delay(120 + index * 140) }}>
            <PhoneCall className="size-4 shrink-0" style={{ color: row.ok ? accent : muted }} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className={cn(styles.sm, "block font-semibold")}>{row.name}</span>
              <span className={cn(styles.xs, "block tabular-nums")} style={{ color: muted }}>{row.phone}</span>
            </span>
            <span
              className={cn(styles.xs, styles.pop, "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold")}
              style={{ background: row.ok ? accentSoft : warnSoft, color: row.ok ? accent : warn, ...delay(900 + index * 420) }}
            >
              {row.ok ? <><ShieldCheck className="size-3" aria-hidden="true" />DNC clear</> : "On DNC · skipped"}
            </span>
          </div>
        ))}
      </Card>
      <div className={cn(styles.sm, styles.rise, "mt-3 flex items-center justify-between rounded-lg px-3 py-2.5 font-semibold text-white")} style={{ background: accent, ...delay(2700) }}>
        <span>Calling Daniel Brooks…</span>
        <span className="tabular-nums">00:04</span>
      </div>
    </Window>
  );
}

/* ── 3. Lead cost: one lead, followed to the policy it became ─────────────────────────────────── */
function LeadCostScreen() {
  const steps = [
    { label: "Lead bought", value: "$35" },
    { label: "Called", value: "2 min" },
    { label: "Application", value: "Sent" },
    { label: "Policy issued", value: "$1,240/yr" },
  ];
  return (
    <Window path="leads/maria-lopez">
      <div className="flex items-center gap-3">
        <Initials text="ML" />
        <span>
          <span className={cn(styles.md, "block font-semibold")}>Maria Lopez</span>
          <span className={cn(styles.xs, "block")} style={{ color: muted }}>Apex Call Center · Final expense</span>
        </span>
      </div>
      <Card className="mt-3 p-4">
        <div className="relative grid grid-cols-4">
          <span className="absolute left-[12.5%] right-[12.5%] top-[9px] h-[2px]" style={{ background: line }} aria-hidden="true" />
          <span className={cn(styles.draw, "absolute left-[12.5%] right-[12.5%] top-[9px] h-[2px]")} style={{ background: accent, ...delay(300) }} aria-hidden="true" />
          {steps.map((step, index) => (
            <div key={step.label} className="relative flex flex-col items-center text-center">
              <span className={cn(styles.pop, "flex size-5 items-center justify-center rounded-full text-white")} style={{ background: accent, ...delay(300 + index * 420) }}>
                <Check className="size-3 stroke-[3]" aria-hidden="true" />
              </span>
              <span className={cn(styles.xs, styles.rise, "mt-2")} style={{ color: muted, ...delay(380 + index * 420) }}>{step.label}</span>
              <span className={cn(styles.sm, styles.rise, "font-semibold tabular-nums")} style={delay(420 + index * 420)}>{step.value}</span>
            </div>
          ))}
        </div>
      </Card>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {[
          ["Cost per sale", "$142"],
          ["Return on this lead", "35×"],
        ].map(([label, value], index) => (
          <Card key={label} className={cn(styles.rise, "p-3")} style={delay(2100 + index * 160)}>
            <span className={cn(styles.xs, "block")} style={{ color: muted }}>{label}</span>
            <span className={cn(styles.xl, "mt-1 block font-semibold tabular-nums tracking-tight")} style={{ color: index ? accent : ink }}>{value}</span>
          </Card>
        ))}
      </div>
    </Window>
  );
}

/* ── 4. Callbacks: today's list, and the reminder before it is due ────────────────────────────── */
function CallbacksScreen() {
  const items = [
    ["9:30", "Anthony Reed", "Quote follow-up"],
    ["11:00", "Maria Lopez", "Sign the application"],
    ["14:15", "Priya Shah", "Medicare review"],
  ];
  return (
    <Window path="callbacks">
      <div className="flex items-center justify-between">
        <span className={cn(styles.md, "font-semibold")}>Today&rsquo;s callbacks</span>
        <span className={cn(styles.xs, "")} style={{ color: muted }}>3 due</span>
      </div>
      <div className="relative mt-3">
        {items.map(([time, name, what], index) => (
          <Card key={name} className={cn(styles.rise, "mb-2 flex items-center gap-3 px-3 py-2.5")} style={delay(120 + index * 150)}>
            <span className={cn(styles.sm, "w-11 font-semibold tabular-nums")} style={{ color: index === 1 ? accent : muted }}>{time}</span>
            <span className="h-7 w-[3px] rounded-full" style={{ background: index === 1 ? accent : line }} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className={cn(styles.sm, "block font-semibold")}>{name}</span>
              <span className={cn(styles.xs, "block")} style={{ color: muted }}>{what}</span>
            </span>
          </Card>
        ))}
        <div className={cn(styles.slideIn, "absolute -right-2 top-[38px] flex w-[230px] items-start gap-2.5 rounded-lg p-3 text-white shadow-[0_14px_30px_-10px_rgba(0,0,0,.45)]")} style={{ background: ink, ...delay(1500) }}>
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-[var(--m-toast-icon)]" aria-hidden="true" />
          <span>
            <span className={cn(styles.sm, "block font-semibold")}>In 5 minutes: Maria Lopez</span>
            <span className={cn(styles.xs, "block text-white/70")}>Her record and the quote are open.</span>
          </span>
        </div>
      </div>
    </Window>
  );
}

/* ── 5. Commissions: the carrier statement, matched line by line ──────────────────────────────── */
function CommissionsScreen() {
  const lines = [
    ["Mutual of Omaha", "POL-48211", "$412.50"],
    ["Aetna / CVS", "POL-77302", "$268.00"],
    ["Americo", "POL-10954", "$355.20"],
    ["Foresters", "POL-66018", "$190.75"],
  ];
  return (
    <Window path="book/commissions">
      <div className="flex items-center justify-between">
        <span className={cn(styles.md, "font-semibold")}>October statement</span>
        <span className={cn(styles.xs, styles.fadeIn, "rounded-full px-2 py-0.5 font-semibold")} style={{ background: accentSoft, color: accent, ...delay(2300) }}>4 of 4 matched</span>
      </div>
      <Card className="mt-3 overflow-hidden">
        {lines.map(([carrier, policy, amount], index) => (
          <div key={policy} className={cn(styles.rise, "flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0")} style={{ borderColor: line, ...delay(120 + index * 130) }}>
            <span className="min-w-0 flex-1">
              <span className={cn(styles.sm, "block font-semibold")}>{carrier}</span>
              <span className={cn(styles.xs, "block tabular-nums")} style={{ color: muted }}>{policy}</span>
            </span>
            <span className={cn(styles.sm, "font-semibold tabular-nums")}>{amount}</span>
            <span className={cn(styles.pop, "flex size-5 items-center justify-center rounded-full text-white")} style={{ background: accent, ...delay(800 + index * 380) }}>
              <Check className="size-3 stroke-[3]" aria-hidden="true" />
            </span>
          </div>
        ))}
      </Card>
      <div className="mt-3 overflow-hidden rounded-full" style={{ background: line }}>
        <span className={cn(styles.fill, "block h-1.5 rounded-full")} style={{ background: accent, ...delay(800) }} />
      </div>
      <div className={cn(styles.sm, styles.rise, "mt-2 flex justify-between")} style={delay(2300)}>
        <span style={{ color: muted }}>Paid this month</span>
        <span className="font-semibold tabular-nums">$1,226.45</span>
      </div>
    </Window>
  );
}

const SCENES: Scene[] = [
  { key: "inbound", eyebrow: "Inbound", title: "Every live transfer, claimed by one agent.", body: "No two agents on the same call. The first to claim it gets it, with the lead's record open.", screen: <InboundScreen /> },
  { key: "dialer", eyebrow: "Dialer", title: "Dial all day. Every number checked first.", body: "Each number is checked against do-not-call before it rings. The ones you can't call are skipped.", screen: <DialerScreen /> },
  { key: "cost", eyebrow: "Lead cost", title: "Know what every lead really cost you.", body: "Follow a lead from the vendor you paid to the policy it became, and see what each sale cost.", screen: <LeadCostScreen /> },
  { key: "callbacks", eyebrow: "Callbacks", title: "Callbacks and appointments that never slip.", body: "Today's callbacks in one list, with a reminder before each one and the record ready.", screen: <CallbacksScreen /> },
  { key: "commissions", eyebrow: "Commissions", title: "Every commission matched to its policy.", body: "Upload the carrier statement. Each line is matched to the policy it pays, so nothing goes missing.", screen: <CommissionsScreen /> },
];

export function ProductShowcase({ start = 0, footnote }: {
  /** The scene to open on: sign-up step N opens on scene N − 1, so each step moves the story on. */
  start?: number;
  /** One quiet line under the slides (sign-up: how payment works). */
  footnote?: ReactNode;
}) {
  const [active, setActive] = useState(() => ((start % SCENES.length) + SCENES.length) % SCENES.length);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the media query is only readable after mount
    setStill(query.matches);
    const onChange = () => setStill(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Carries on by itself; hovering or focusing the panel holds the slide (and its bar) where it is.
  useEffect(() => {
    if (paused || still) return;
    const timer = window.setTimeout(() => setActive((current) => (current + 1) % SCENES.length), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [active, paused, still]);

  const scene = SCENES[active];
  return (
    <section
      aria-roledescription="carousel"
      aria-label="What Insurvas does"
      className={cn("m-stagger mx-auto w-full max-w-[34rem] lg:pl-6 2xl:pl-10", paused && styles.paused)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      style={{ "--slide-ms": `${SLIDE_MS}ms` } as CSSProperties}
    >
      <div className={styles.stage}>
        {SCENES.map((item, index) => (
          <div key={item.key} className={styles.scene} data-active={index === active} aria-hidden={index !== active}>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--primary)]">{item.eyebrow}</p>
            <h2 className="mt-2.5 max-w-[30rem] font-[family-name:var(--font-display)] text-[clamp(1.75rem,2.6vw,2.4rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-[var(--on-dark)]">
              {item.title}
            </h2>
            {/* Short laptop screens (≈657px tall) keep the headline and the screen, not the sentence. */}
            <p className="mt-3 max-w-[28rem] text-base leading-relaxed text-[var(--nav-ink)] [@media(max-height:760px)]:hidden">{item.body}</p>
            <div className="mt-7 [@media(max-height:760px)]:mt-5">{item.screen}</div>
          </div>
        ))}
      </div>

      {/* One bar per slide: the active one fills as its time runs; any bar jumps to its slide. */}
      <div className="mt-8 flex gap-2 [@media(max-height:760px)]:mt-5" role="group" aria-label="Choose a feature">
        {SCENES.map((item, index) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setActive(index)}
            aria-label={item.eyebrow}
            aria-current={index === active ? "true" : undefined}
            className="group flex-1 py-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          >
            <span className="block h-[3px] overflow-hidden rounded-full bg-white/15 group-hover:bg-white/25">
              <span
                key={index === active ? `on-${active}` : "off"}
                className={cn(styles.bar, "block h-full rounded-full bg-[var(--primary)]")}
                data-state={index === active ? "active" : index < active ? "done" : "todo"}
              />
            </span>
          </button>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">{scene.eyebrow}: {scene.title}</p>
      {footnote && <p className="mt-4 text-sm leading-normal text-[var(--nav-muted)] [@media(max-height:760px)]:hidden">{footnote}</p>}
    </section>
  );
}
