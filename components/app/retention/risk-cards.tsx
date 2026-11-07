import Link from "next/link";

/**
 * The Retention header (owner pick 2026-11-06, round 3 "header A"): each card is heavier than the one before
 * it — a four-bar meter, the tag's colour, a stronger border — so the order of urgency reads before any
 * number does (Fixable › Act now › Last chance › Gone on Cases). A card is the step's link; the selected one
 * is ringed. Beside the ladder, quieter cards for what is not a step (Paperwork, Closed …). Shared by Cases,
 * Waiting on the carrier and Win-back. Colours are tokens only.
 */
export type RiskCard = {
  key: string;
  level: 1 | 2 | 3 | 4;
  tag: string;
  name: string;
  count: number;
  /** A short line beside the count: money at stake, "nothing to do yet". */
  line?: string;
  /** Under the count: what in it is urgent. Red when `warn`. */
  foot?: string;
  warn?: boolean;
  /** The past-due / this-week / later / no-window split, as counts. */
  split?: { over: number; week: number; later: number; none: number };
  ink: string;
  href: string;
  on?: boolean;
};
export type SideCard = { key: string; label: string; count: number; line: string; ink: string; href: string; on?: boolean };

/** The ink of each level: amber, amber-red, red, and grey for gone. */
export const LEVEL_INK = {
  1: "var(--warning-ink)",
  2: "color-mix(in oklab, var(--warning-ink) 45%, var(--error-ink))",
  3: "var(--error-ink)",
  4: "var(--muted-foreground)",
} as const;

const tint = (ink: string, pct: number) => `color-mix(in oklab, ${ink} ${pct}%, transparent)`;
/** A grey card (Gone, Cooling off) is quiet: the plain border and no tint, so it never reads as the selected one. */
const quiet = (c: RiskCard) => c.ink === "var(--muted-foreground)";

function Split({ split }: { split: NonNullable<RiskCard["split"]> }) {
  const total = split.over + split.week + split.later + split.none || 1;
  const parts: Array<[number, string, string]> = [
    [split.over, "var(--error-ink)", "past due"], [split.week, "var(--warning-ink)", "due this week"],
    [split.later, "var(--success-ink)", "later"], [split.none, "var(--border-strong)", "no carrier window"],
  ];
  return (
    <span className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]" role="img" aria-label={parts.filter(([n]) => n).map(([n, , l]) => `${n} ${l}`).join(", ")}>
      {parts.map(([n, c, l]) => (n ? <i key={l} className="block" style={{ width: `${(n / total) * 100}%`, background: c }} /> : null))}
    </span>
  );
}

export function RiskCards({ label, cards, side = [] }: { label: string; cards: RiskCard[]; side?: SideCard[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-stretch gap-2.5">
      {cards.map((c, i) => (
        <div key={c.key} className="flex min-w-[180px] flex-1 items-stretch gap-2.5">
          {i > 0 && <span aria-hidden="true" className="self-center text-lg text-muted-foreground">›</span>}
          <Link
            href={c.href}
            aria-current={c.on ? "page" : undefined}
            className="flex min-w-0 flex-1 flex-col rounded-[14px] border px-3.5 py-3 text-foreground no-underline outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
            // A flat tint, never a gradient or a glow (§17): the selected card is ringed, not lit.
            // Gone (level 4) is quiet: the plain border, no tint, so it never reads as the selected card.
            style={{ borderColor: c.on ? c.ink : quiet(c) ? "var(--border)" : tint(c.ink, 40), background: quiet(c) && !c.on ? undefined : tint(c.ink, c.on ? 14 : 6), boxShadow: c.on ? `0 0 0 1px ${c.ink}` : undefined }}
          >
            <span className="flex items-center gap-2">
              <span aria-label={`Urgency ${c.level} of 4`} role="img" className="flex items-end gap-0.5">
                {[1, 2, 3, 4].map((k) => <i key={k} className="block w-[5px] rounded-sm" style={{ height: 6 + k * 3, background: k <= c.level ? c.ink : "var(--border-strong)" }} />)}
              </span>
              <span className="text-xs font-bold" style={{ color: c.ink }}>{c.tag}</span>
            </span>
            <span className="mt-1.5 text-sm font-semibold">{c.name}</span>
            <b className="mt-0.5 text-2xl tabular-nums">{c.count.toLocaleString("en-US")}</b>
            {c.line && <span className="truncate text-xs text-muted-foreground">{c.line}</span>}
            {c.split && <Split split={c.split} />}
            {c.foot && <span className={`mt-1 truncate text-xs ${c.warn ? "font-semibold text-[var(--error-ink)]" : "text-muted-foreground"}`}>{c.foot}</span>}
          </Link>
        </div>
      ))}
      {side.length > 0 && (
        <div className="flex w-[180px] flex-none flex-col gap-2 border-l border-border pl-2.5">
          {side.map((s) => (
            <Link key={s.key} href={s.href} aria-current={s.on ? "page" : undefined} className="flex flex-1 flex-col rounded-xl border bg-[var(--surface-alt)] px-3 py-2 text-foreground no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ borderColor: s.on ? s.ink : "var(--border)" }}>
              <span className="flex items-center gap-1.5 text-xs font-bold"><i aria-hidden="true" className="block size-2 rounded-full" style={{ background: s.ink }} />{s.label}<b className="ml-auto text-sm tabular-nums">{s.count.toLocaleString("en-US")}</b></span>
              <span className="mt-0.5 text-xs leading-snug text-muted-foreground">{s.line}</span>
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
