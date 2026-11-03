"use client";

import { useEffect, useState } from "react";

type FlagSet = Record<string, string | undefined>;

/**
 * Country flags for the sign-up phone prefix (2026-10-26). The SVGs come from country-flag-icons,
 * bundled with the app (nothing is loaded from another host; emoji flags do not render on Windows).
 * The whole set is one chunk fetched after the page is up, shared by every flag on it, so the sign-up
 * form never waits on ~250 flags; until it arrives a flag is a plain tile of the same size.
 */
let flagSet: FlagSet | null = null;
let loading: Promise<FlagSet> | null = null;
function loadFlags(): Promise<FlagSet> {
  loading ??= import("country-flag-icons/string/3x2").then((module) => (flagSet = module as unknown as FlagSet));
  return loading;
}

export function CountryFlag({ code }: { code: string }) {
  const [flags, setFlags] = useState<FlagSet | null>(flagSet);
  useEffect(() => {
    if (flags) return;
    let active = true;
    void loadFlags().then((loaded) => { if (active) setFlags(loaded); });
    return () => { active = false; };
  }, [flags]);
  const svg = flags?.[code];
  const frame = "inline-block h-[14px] w-[21px] shrink-0 overflow-hidden rounded-[2px] shadow-[0_0_0_1px_rgba(255,255,255,0.12)] [&>svg]:block [&>svg]:h-full [&>svg]:w-full";
  // The SVG markup is the package's own, bundled at build time — never user input.
  return svg
    ? <span aria-hidden="true" className={frame} dangerouslySetInnerHTML={{ __html: svg }} />
    : <span aria-hidden="true" className={`${frame} bg-[var(--surface-alt)]`} />;
}
