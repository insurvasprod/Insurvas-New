/**
 * Insurvas app colours, from the mobile board (docs/design/mobile-v1/kit.css `.scr`) and BRAND.md:
 * green acts, olive frames, gold highlights (people, new counts, one feature button a screen).
 * Status is a dot plus words — the *-s tones are the chip backgrounds, never page notices.
 */
export type Palette = {
  canvas: string; surf: string; surf2: string; elev: string; line: string; line2: string;
  ink: string; body: string; muted: string; faint: string;
  green: string; onGreen: string; greenInk: string; greenSoft: string; olive: string;
  gold: string; onGold: string; goldInk: string; goldSoft: string;
  ok: string; okS: string; info: string; infoS: string; warn: string; warnS: string; bad: string; badS: string;
  neutral: string; neutralS: string;
  bar: string; sheet: string; dim: string; snack: string; onSnack: string; track: string; field: string;
};

export const dark: Palette = {
  canvas: "#08110f", surf: "#0f1a17", surf2: "#14221e", elev: "#182925", line: "rgba(255,255,255,0.08)", line2: "rgba(255,255,255,0.14)",
  ink: "#f2f7f5", body: "#c9d6d1", muted: "#93a69f", faint: "#6b7f78",
  green: "#07d6a0", onGreen: "#04251d", greenInk: "#4fe3bb", greenSoft: "#0f3a30", olive: "#0d4037",
  gold: "#f2b33d", onGold: "#2a1c00", goldInk: "#f5c562", goldSoft: "#33270f",
  ok: "#45c07d", okS: "#11291d", info: "#7fb0ff", infoS: "#10203a", warn: "#f08a4b", warnS: "#2e1a0e", bad: "#f0837c", badS: "#2d1412",
  neutral: "#a7b5b0", neutralS: "#1a2622",
  bar: "rgba(15,26,23,0.92)", sheet: "#101c19", dim: "rgba(0,0,0,0.55)", snack: "#e6efec", onSnack: "#0b1513", track: "#22342e", field: "#0c1614",
};

export const light: Palette = {
  canvas: "#f3f7f5", surf: "#ffffff", surf2: "#e9f2ee", elev: "#ffffff", line: "#dbe6e1", line2: "#cbd8d2",
  ink: "#0d4037", body: "#26332e", muted: "#4d5f58", faint: "#7b8c85",
  green: "#07d6a0", onGreen: "#04251d", greenInk: "#00735a", greenSoft: "#dcfaf0", olive: "#0d4037",
  gold: "#f2b33d", onGold: "#2a1c00", goldInk: "#8a5a00", goldSoft: "#fdf1d6",
  ok: "#0c6633", okS: "#e2f4e8", info: "#1d4f9a", infoS: "#e4edf9", warn: "#9a3d00", warnS: "#fcebdc", bad: "#ab1f1f", badS: "#fdeceb",
  neutral: "#4d5f58", neutralS: "#e9f2ee",
  bar: "rgba(255,255,255,0.94)", sheet: "#ffffff", dim: "rgba(13,40,34,0.38)", snack: "#16231f", onSnack: "#eef6f3", track: "#d9e5df", field: "#ffffff",
};

/** Settled decision 2 (2026-11-24): 13 / 15 / 16 body, 20 section titles, 28–32 screen titles and big figures. */
export const type = {
  family: { body: "Inter_400Regular", medium: "Inter_500Medium", semi: "Inter_600SemiBold", bold: "Inter_700Bold", display: "InterTight_600SemiBold", displayBold: "InterTight_700Bold", mono: "GeistMono_500Medium" },
  size: { small: 13, body: 15, large: 16, section: 20, title: 28, hero: 32 },
} as const;

/** Settled decision 4: 10–12px corners on both platforms, no pills. */
export const radius = { control: 10, button: 12, card: 14, sheet: 20 } as const;

export const space = { gutter: 16, row: 12 } as const;

export type Tone = "ok" | "info" | "warn" | "bad" | "neutral" | "brand" | "gold";

export function toneColors(p: Palette, tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case "ok": return { fg: p.ok, bg: p.okS };
    case "info": return { fg: p.info, bg: p.infoS };
    case "warn": return { fg: p.warn, bg: p.warnS };
    case "bad": return { fg: p.bad, bg: p.badS };
    case "brand": return { fg: p.greenInk, bg: p.greenSoft };
    case "gold": return { fg: p.goldInk, bg: p.goldSoft };
    default: return { fg: p.neutral, bg: p.neutralS };
  }
}
