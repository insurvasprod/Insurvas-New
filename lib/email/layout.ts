// The shell every Insurvas email shares, drawn after the landing page: the grey canvas, the logo, a
// white card with a brand eyebrow and an olive headline whose one accent word is set in light italic
// green (the hero's "really"), the green pill button with an arrow, check-marked facts, and the olive
// closing band.
//
// Email-client rules, not taste: tables for layout (Outlook ignores most CSS layout), every style
// inline (Gmail strips <style> in many views), no web fonts relied on, no SVG, and a hidden preheader
// so the inbox preview line says something useful instead of "Insurvas Insurvas".
//
// Pure, so it is unit-testable and usable from the plain-Node scripts.

import { EMAIL_BRAND as B } from "./brand.ts";
import { EMAIL_LOGO_CID, EMAIL_LOGO_HEIGHT, EMAIL_LOGO_WIDTH } from "./logo.ts";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export type EmailShellOptions = {
  /** A short brand label over the headline ("Partner portal invitation"). Plain text. */
  eyebrow?: string;
  /** A phrase inside the headline to set in the accent style. Plain text, matched once. */
  accent?: string;
  /** The inbox preview line. Plain text. */
  preheader?: string;
  /** The footer's reason line. Plain text. */
  footerNote?: string;
};

const FONT = B.fontStack;
const DEFAULT_FOOTER = "You are receiving this because someone used this address to create or manage an Insurvas account.";

/**
 * `headline` and `bodyHtml` are HTML the caller has already escaped; the options are plain text and
 * escaped here.
 */
export function emailShell(headline: string, bodyHtml: string, options: EmailShellOptions = {}): string {
  const accent = options.accent ? escapeHtml(options.accent) : null;
  const headlineHtml = accent && headline.includes(accent)
    ? headline.replace(accent, `<span style="font-style:italic;font-weight:300;color:${B.accentInk}">${accent}</span>`)
    : headline;
  const preheader = options.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(options.preheader)}&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;</div>`
    : "";
  const eyebrow = options.eyebrow
    ? `<p style="margin:0 0 12px;font-size:13px;line-height:1.4;font-weight:600;color:${B.accentInk}">${escapeHtml(options.eyebrow)}</p>`
    : "";
  return [
    `<div style="margin:0;padding:0;background:${B.canvas}">`,
    preheader,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${B.canvas};font-family:${FONT}">`,
    `<tr><td align="center" style="padding:32px 16px 40px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">`,
    // The logo, on the canvas, as the landing page's header carries it.
    `<tr><td style="padding:0 4px 20px">`,
    `<img src="cid:${EMAIL_LOGO_CID}" width="${EMAIL_LOGO_WIDTH}" height="${EMAIL_LOGO_HEIGHT}" alt="Insurvas" style="display:block;border:0;outline:none;width:${EMAIL_LOGO_WIDTH}px;height:${EMAIL_LOGO_HEIGHT}px;font-family:${FONT};font-size:22px;font-weight:700;color:${B.ink}">`,
    `</td></tr>`,
    // The card.
    `<tr><td style="background:#ffffff;border:1px solid ${B.band};border-radius:16px;padding:40px 40px 36px;font-family:${FONT};font-size:15px;line-height:1.65;color:${B.body}">`,
    eyebrow,
    `<h1 style="margin:0 0 20px;font-family:${FONT};font-size:28px;line-height:1.15;font-weight:600;letter-spacing:-0.03em;color:${B.ink}">${headlineHtml}</h1>`,
    // Older templates write bare <p>; give them the shell's spacing rather than the client's 1em.
    bodyHtml.replaceAll("<p>", `<p style="margin:0 0 14px">`),
    `</td></tr>`,
    // The olive band: the landing page's closing section, small.
    `<tr><td style="padding-top:16px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${B.ink};border-radius:16px">`,
    `<tr><td style="padding:24px 32px;font-family:${FONT}">`,
    `<p style="margin:0 0 6px;font-size:15px;line-height:1.4;font-weight:600;letter-spacing:-0.01em;color:${B.navInk}">Know what every lead <span style="font-style:italic;font-weight:300;color:${B.green}">really</span> cost you.</p>`,
    `<p style="margin:0;font-size:12px;line-height:1.6;color:${B.navMuted}">${escapeHtml(options.footerNote ?? DEFAULT_FOOTER)}</p>`,
    `</td></tr></table>`,
    `</td></tr>`,
    `<tr><td align="center" style="padding:16px 4px 0;font-family:${FONT};font-size:11px;line-height:1.5;color:${B.muted}">&copy; ${new Date().getUTCFullYear()} Insurvas</td></tr>`,
    `</table>`,
    `</td></tr></table>`,
    `</div>`,
  ].join("");
}

/** The green pill with an arrow, and the raw link under it: buttons get stripped often enough. */
export function emailButton(url: string, label: string): string {
  const href = escapeHtml(url);
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px"><tr>` +
    `<td style="background:${B.green};border-radius:999px;box-shadow:0 10px 30px -10px ${B.green}">` +
    `<a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;line-height:1.2;font-weight:600;color:${B.ink};text-decoration:none;border-radius:999px">${label}&nbsp;&nbsp;&rarr;</a>` +
    `</td></tr></table>` +
    `<p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:${B.muted}">Or paste this into your browser:<br>` +
    `<a href="${href}" style="color:${B.accentInk};word-break:break-all;text-decoration:underline">${href}</a></p>`
  );
}

/** Check-marked facts in a soft panel, the way the landing hero lists what you get. Plain text in. */
export function emailFacts(rows: [label: string, value: string][]): string {
  const visible = rows.filter(([, value]) => value.trim() !== "");
  if (visible.length === 0) return "";
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px;background:${B.canvas};border-radius:12px">` +
    `<tr><td style="padding:8px 20px">` +
    visible
      .map(([label, value], i) =>
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${i > 0 ? ` style="border-top:1px solid ${B.band}"` : ""}><tr>` +
        `<td width="22" valign="top" style="padding:10px 0;font-size:14px;line-height:1.5;font-weight:700;color:${B.accentInk}">&#10003;</td>` +
        `<td valign="top" style="padding:10px 12px 10px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${B.muted};white-space:nowrap">${escapeHtml(label)}</td>` +
        `<td valign="top" align="right" style="padding:10px 0;font-family:${FONT};font-size:14px;line-height:1.5;font-weight:600;color:${B.ink}">${escapeHtml(value)}</td>` +
        `</tr></table>`)
      .join("") +
    `</td></tr></table>`
  );
}

/** A body paragraph with the shell's spacing. HTML in (already escaped). */
export function emailParagraph(html: string): string {
  return `<p style="margin:0 0 14px">${html}</p>`;
}

/** The small closing line under the button (expiry, "ignore this if…"). HTML in. */
export function emailNote(html: string): string {
  return `<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:${B.muted}">${html}</p>`;
}
