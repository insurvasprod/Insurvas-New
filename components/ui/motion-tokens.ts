/**
 * The motion tokens, read from the page (app/globals.css `:root`), for the few waits a script has to time to an
 * animation: a row leaving before the refresh, a badge shrinking away, a saved note fading. The CSS stays the one
 * place a timing is set; the fallback is only for a page with no stylesheet yet.
 */
export function motionMs(token: `--t-${string}`, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return raw.endsWith("ms") ? value : raw.endsWith("s") ? value * 1000 : fallback;
}

/**
 * How long a count takes to roll to its new value (a badge, a tab count, a figure): --t-enter, so a roll lands with a
 * section, not after it. A number, not a token read, because CountUp times its frames in script and it renders on the
 * server too (where there is no stylesheet to read).
 */
export const ROLL_MS = 360;

/** The person asked for less motion: every wait finishes at once (the reduce block in globals.css stills the CSS). */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** An easing token (`--e`, `--e-out`) for a motion played in script (the FLIP glide, components/ui/use-flip.ts). */
export function motionEase(token: `--e${string}`, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;
}
