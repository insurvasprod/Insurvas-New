/**
 * A design token's colour as `#rrggbb`, for the few places a colour must be STORED rather than
 * styled — a pipeline stage's colour is a hex column (check `^#[0-9a-fA-F]{6}$`), so it cannot hold
 * `var(--muted)`. Reading the token from app/globals.css at the moment of use keeps new stages on
 * the palette instead of on a hex literal that drifts from it.
 *
 * Browser only: returns null during server rendering, or when the token is missing or not a colour
 * this can read (hex or rgb()).
 */
export function tokenHex(name: `--${string}`): string | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return cssColorToHex(raw);
}

/** `#abc`, `#aabbcc`, `rgb(1, 2, 3)` → `#aabbcc`; anything else → null. */
export function cssColorToHex(value: string): string | null {
  const text = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(text);
  if (rgb) {
    const parts = [rgb[1], rgb[2], rgb[3]].map((part) => Math.min(255, Number(part)));
    return `#${parts.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

/**
 * The colour a new stage starts with: the muted text token, falling back through the strong border
 * token. Null only when neither can be read (no browser), in which case the caller keeps whatever
 * colour its form already holds.
 */
export function defaultStageColor(): string | null {
  return tokenHex("--muted") ?? tokenHex("--border-strong");
}
