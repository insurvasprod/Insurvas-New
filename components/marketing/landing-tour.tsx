"use client";

import { useEffect, useRef, useState } from "react";
import { Calculator, Columns3, PhoneIncoming, PhoneOutgoing } from "lucide-react";

import { Reveal, Tilt3D, useInView, usePrefersReducedMotion } from "@/components/marketing/motion";
import { AppWindow, BoardMock, CpaMock, DialerMock, InboundMock } from "@/components/marketing/landing-mocks";
import styles from "@/components/marketing/landing.module.css";

/**
 * The board's four tabs (Inbound floor, Outbound dialer, True CPA, Pipeline) as a tour: the window
 * turns in 3D to each screen, and the tour advances on its own every few seconds while it is on
 * screen — pausing while the reader hovers, focuses a tab, or has reduced motion on. A proper
 * tablist: arrow keys move between tabs.
 */
const TABS = [
  { key: "inbound", label: "Inbound floor", icon: PhoneIncoming, url: "app.insurvas.com/app/inbound", caption: "Longest-waiting first, screening state on the row, and a claim the server settles — so two closers never think they won the same lead." },
  { key: "dialer", label: "Outbound dialer", icon: PhoneOutgoing, url: "app.insurvas.com/app/dialer", caption: "Consent, DNC, suppression and the calling window, re-checked by the server in the moment before it dials." },
  { key: "cpa", label: "True CPA", icon: Calculator, url: "app.insurvas.com/app/cpa", caption: "Cost per issued policy, traced through the campaign that paid for it. A missing figure says missing." },
  { key: "board", label: "Pipeline", icon: Columns3, url: "app.insurvas.com/app/board", caption: "Stages, board, table and list are four readings of one set of leads and one set of filters. Dragging a card is a stage change, and a stage change needs a disposition." },
] as const;

const DWELL_MS = 6500;

export function LandingTour() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = usePrefersReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.35 });
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const playing = inView && !paused && !reduced;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setActive((index) => (index + 1) % TABS.length), DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [playing, active]);

  const onKey = (event: React.KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (active + step + TABS.length) % TABS.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const tab = TABS[active];
  return (
    <section id="product" className="scroll-mt-20 bg-background px-4 py-24 sm:px-6 lg:px-16 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <Reveal className="mx-auto max-w-[760px] text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--accent-ink)]">The product</p>
          <h2 className="mt-3 text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[44px]">One workspace. One queue. One record of what happened.</h2>
          <p className="mx-auto mt-4 max-w-[60ch] text-base leading-[1.6] text-muted-foreground">Not a suite of modules bolted together — four views of the same leads, the same claims and the same outcomes.</p>
        </Reveal>

        <div ref={ref} className="mt-12" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
          <div role="tablist" aria-label="Product tour" className="mx-auto grid max-w-[880px] grid-cols-2 gap-2 sm:grid-cols-4" onKeyDown={onKey}>
            {TABS.map((item, index) => {
              const selected = index === active;
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  onClick={() => setActive(index)}
                  ref={(node) => { tabRefs.current[index] = node; }}
                  type="button"
                  role="tab"
                  id={`tour-tab-${item.key}`}
                  aria-selected={selected}
                  aria-controls="tour-panel"
                  tabIndex={selected ? 0 : -1}
                  className={`relative overflow-hidden rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))]" : "border-border bg-card hover:border-[var(--border-strong)]"}`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Icon className={`size-4 ${selected ? "text-[var(--primary)]" : "text-muted-foreground"}`} aria-hidden="true" />
                    {item.label}
                  </span>
                  {/* The autoplay clock: a bar that fills across the selected tab. */}
                  <span className="absolute inset-x-0 bottom-0 h-[3px] bg-transparent" aria-hidden="true">
                    {selected && (
                      <span key={`${active}-${playing}`} className={`block h-full bg-[var(--primary)] ${playing ? styles.progress : ""}`} style={{ animationDuration: `${DWELL_MS}ms`, transform: playing ? undefined : "scaleX(0)" }} />
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div id="tour-panel" role="tabpanel" aria-labelledby={`tour-tab-${tab.key}`} className="mx-auto mt-10 max-w-[1040px]">
            <Tilt3D max={4} perspective={1800}>
              <div key={tab.key} className={styles.flipIn} style={{ transformStyle: "preserve-3d" }}>
                <AppWindow url={tab.url}>
                  <div className="min-h-[300px]">
                    {tab.key === "inbound" && <InboundMock />}
                    {tab.key === "dialer" && <DialerMock scanClass={styles.scan} />}
                    {tab.key === "cpa" && <CpaMock />}
                    {tab.key === "board" && <BoardMock />}
                  </div>
                </AppWindow>
              </div>
            </Tilt3D>
            <p key={`caption-${tab.key}`} className={`mx-auto mt-6 max-w-[64ch] text-center text-base leading-[1.6] text-muted-foreground ${styles.flipIn}`}>{tab.caption}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
