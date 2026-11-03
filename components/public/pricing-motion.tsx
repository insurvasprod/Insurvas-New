"use client";

import { useState, type ReactNode } from "react";
import { BookOpen, Calculator, ChartColumn, FilePen, Handshake, Layers, LifeBuoy, PhoneIncoming, ShieldCheck, Users, type LucideIcon } from "lucide-react";

/**
 * The pricing page's motion and small shared pieces (2026-10-13 pricing redesign).
 *
 * Transforms and opacity only, except the two accordions, whose height eases through
 * grid-template-rows so nothing has to be measured. Every animation here stops under
 * prefers-reduced-motion — the reduce block at the end, on top of the global one in globals.css —
 * and content then simply appears. Colours are tokens; nothing here is a literal.
 */
export const PRICING_CSS = `
@keyframes pz-in-up { from { opacity: 0; transform: translate3d(0, 60%, 0); } to { opacity: 1; transform: none; } }
@keyframes pz-in-down { from { opacity: 0; transform: translate3d(0, -60%, 0); } to { opacity: 1; transform: none; } }
@keyframes pz-out-up { from { opacity: 1; transform: none; } to { opacity: 0; transform: translate3d(0, -60%, 0); } }
@keyframes pz-out-down { from { opacity: 1; transform: none; } to { opacity: 0; transform: translate3d(0, 60%, 0); } }
@keyframes pz-swap { from { opacity: 0; transform: translate3d(0, 8px, 0); } to { opacity: 1; transform: none; } }
@keyframes pz-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pz-spin { to { transform: rotate(360deg); } }
@keyframes pz-breathe { from { opacity: .35; } to { opacity: .7; } }
@keyframes pz-pick { 0% { opacity: 0; transform: scale(.97); } 60% { opacity: 1; transform: scale(1.01); } 100% { opacity: 1; transform: none; } }
@keyframes pz-drift { 0% { transform: translate3d(-6%, -4%, 0) scale(1); } 100% { transform: translate3d(6%, 6%, 0) scale(1.1); } }
.pz-in-up { animation: pz-in-up 460ms var(--e-out) both; }
.pz-in-down { animation: pz-in-down 460ms var(--e-out) both; }
.pz-out-up { animation: pz-out-up 360ms var(--e-out) both; }
.pz-out-down { animation: pz-out-down 360ms var(--e-out) both; }
.pz-swap { animation: pz-swap var(--t-enter) var(--e-out) both; }
.pz-fade { animation: pz-fade var(--t-enter) var(--e-out) both; }
.pz-pick { animation: pz-pick 700ms var(--e-out) both; }
.pz-ring { position: absolute; inset: -60%; background: conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--primary) 85%, transparent) 70deg, transparent 150deg, transparent 210deg, color-mix(in srgb, var(--primary) 55%, transparent) 280deg, transparent 360deg); animation: pz-spin 12s linear infinite; }
.pz-glow { position: absolute; inset: 8% 10% -6%; border-radius: 24px; background: color-mix(in srgb, var(--primary) 22%, transparent); filter: blur(36px); animation: pz-breathe 5s ease-in-out infinite alternate; pointer-events: none; }
.pz-aurora { position: absolute; width: 760px; height: 760px; border-radius: 50%; background: radial-gradient(closest-side, color-mix(in srgb, var(--primary) 24%, transparent), transparent 70%); filter: blur(24px); animation: pz-drift 16s ease-in-out infinite alternate; pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .pz-in-up, .pz-in-down, .pz-swap, .pz-fade, .pz-pick, .pz-ring, .pz-glow, .pz-aurora { animation: none !important; }
  .pz-out-up, .pz-out-down { display: none; }
  .pz-glow { opacity: .5; }
}
`;

/**
 * A value that rolls when it changes: the old one slides out, the new one slides in (up when the
 * number grows, down when it falls). `rank` orders values; the first render does not animate.
 */
export function RollingValue({ value, rank, className }: { value: string; rank: number; className?: string }) {
  const [state, setState] = useState({ current: value, rank, previous: null as string | null, up: true, turn: 0 });
  if (state.current !== value) {
    setState({ current: value, rank, previous: state.current, up: rank >= state.rank, turn: state.turn + 1 });
  }
  return (
    <span className={`relative inline-grid overflow-hidden align-bottom ${className ?? ""}`}>
      <span key={`now-${state.turn}`} className={state.turn ? (state.up ? "pz-in-up" : "pz-in-down") : undefined} style={{ gridArea: "1 / 1" }}>
        {state.current}
      </span>
      {state.previous !== null && (
        <span
          key={`was-${state.turn}`}
          aria-hidden="true"
          className={state.up ? "pz-out-up" : "pz-out-down"}
          style={{ gridArea: "1 / 1" }}
          onAnimationEnd={() => setState((now) => (now.turn === state.turn ? { ...now, previous: null } : now))}
        >
          {state.previous}
        </span>
      )}
    </span>
  );
}

/**
 * A segmented control with an indicator that slides between equal-width segments. A segment's
 * `note` (e.g. "2 months free") floats above it as a small tag, so the segments stay narrow at 375px.
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string; note?: string | null }[]; value: T; onChange: (value: T) => void }) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <div
      role="group"
      aria-label={label}
      className="relative inline-grid rounded-full border border-border bg-[var(--surface-alt)] p-[5px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="absolute top-[5px] bottom-[5px] left-[5px] rounded-full border border-border bg-[var(--surface)] shadow-[var(--shadow-rest)] transition-transform duration-500 ease-[var(--e-out)]"
        style={{ width: `calc((100% - 10px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`relative z-10 inline-flex h-11 min-w-[96px] items-center justify-center rounded-full px-4 text-sm font-semibold tracking-[-0.01em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] sm:min-w-[120px] sm:px-6 ${
            option.value === value ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
          {option.note ? (
            <span className="pointer-events-none absolute -top-3 right-1 rounded-full bg-[var(--primary)] px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-[var(--on-primary)] shadow-[var(--shadow-brand)]">
              {option.note}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** Opens and closes its content with an eased height. Closed content is inert, so it is out of the tab order. */
export function Collapse({ open, children, id }: { open: boolean; children: ReactNode; id?: string }) {
  return (
    <div
      id={id}
      className="grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--e-out)]"
      style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

const MODULE_ICONS: Record<string, LucideIcon> = {
  book: BookOpen,
  acquisition: PhoneIncoming,
  sell: FilePen,
  retention: LifeBuoy,
  insight: ChartColumn,
  partners: Handshake,
  accounting: Calculator,
  compliance: ShieldCheck,
  agency: Users,
};

/** The small icon a catalog module is shown with; a module the page does not know gets a neutral one. */
export function ModuleIcon({ module, className }: { module: string; className?: string }) {
  const Icon = MODULE_ICONS[module] ?? Layers;
  return <Icon aria-hidden="true" className={className} />;
}
