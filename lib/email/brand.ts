/**
 * The brand, for email clients: no CSS variables, no web fonts guaranteed, so literal values here.
 * One place, so every email (lib/email/templates.ts, the trial reminder, the welcome pack) matches
 * docs/design/BRAND.md. Montserrat renders where the client has it; the stack falls back cleanly.
 */
export const EMAIL_BRAND = {
  /** Deep olive: headings and the footer rule's text. 11:1 on white. */
  ink: "#0d4037",
  /** Bright green: the call-to-action fill. It carries ink text (6.2:1); white on it fails. */
  green: "#07d6a0",
  body: "#2f343c",
  muted: "#59606b",
  rule: "#d5dbe3",
  /** Brand-coloured TEXT (eyebrows, the accent word, links): the guide's green fails as text on white. */
  accentInk: "#00735a",
  /** The page ground behind the card, as on the landing page. */
  canvas: "#f1f3f7",
  /** The card's hairline and the facts panel's ground. */
  band: "#e4e8ee",
  soft: "#dcfaf0",
  /** The olive footer band, as the landing page's closing section and site footer. */
  navInk: "#eaf6f2",
  navMuted: "#9fc4b8",
  navLine: "#1d5649",
  fontStack: "Montserrat,Segoe UI,Helvetica,Arial,sans-serif",
} as const;

/** The opening wrapper every Insurvas email shares. */
export const EMAIL_WRAPPER_STYLE = `font-family:${EMAIL_BRAND.fontStack};color:${EMAIL_BRAND.body};line-height:1.6;max-width:560px`;
