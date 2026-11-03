import Link from "next/link";
import { ViewTransition, type CSSProperties } from "react";
import { ArrowRight, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LandingObject } from "@/components/marketing/three/landing-object";
import styles from "@/components/marketing/landing.module.css";

/**
 * The hero (2026-10-13). Light and editorial, with one living object: a WebGL ribbon in the brand
 * greens flowing behind the headline — the stream of leads and money the product follows.
 *
 * Its entrance is one sequence, in CSS so it runs from the first paint and never waits on
 * hydration (owner, 2026-10-13): after the intro lifts, the ribbon sweeps in slowly, then the
 * headline rises word by word, then the rest. Every delay is measured from --intro-delay
 * (landing.module.css), which is 0 when there is no intro. Under reduced motion it all just shows.
 */
const at = (ms: number) => ({ "--at": `${ms}ms` }) as CSSProperties;

function Words({ text, from, className = "" }: { text: string; from: number; className?: string }) {
  const words = text.split(" ");
  return words.map((word, index) => (
    <span key={`${word}-${index}`}>
      <span className={styles.heroWordClip}><span className={`${styles.heroWord} ${className}`} style={at(from + index * 80)}>{word}</span></span>
      {index < words.length - 1 ? " " : null}
    </span>
  ));
}

export function LandingHero() {
  return (
    <section data-landing-hero="" className={`relative isolate overflow-hidden bg-background ${styles.hero}`}>
      {/* Named, so it morphs into the sign-in pages' brand panel (components/portal/portal-auth-split-shell.tsx). */}
      <ViewTransition name="brand-ribbon" share="ribbon-morph" default="none">
        <LandingObject kind="ribbon" className={`pointer-events-none absolute -right-[12%] top-[-6%] -z-10 h-[112%] w-[100%] [mask-image:linear-gradient(90deg,transparent_0%,black_35%,black_85%,transparent_100%)] lg:w-[78%] ${styles.ribbonIn}`} />
      </ViewTransition>
      {/* Keeps the headline legible where the ribbon passes behind it. On phones the text spans the whole width, so the veil never clears completely there (2026-10-22). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 -z-10 w-full bg-[linear-gradient(90deg,var(--background)_30%,transparent_70%)] max-sm:bg-[linear-gradient(90deg,var(--background)_35%,color-mix(in_srgb,var(--background)_60%,transparent)_100%)] lg:w-2/3" />

      <div className="mx-auto flex min-h-[100svh] max-w-7xl flex-col justify-center px-4 pb-20 pt-32 sm:px-6 lg:px-16">
        <p className={`text-sm font-semibold text-[var(--accent-ink)] ${styles.heroRise}`} style={at(700)}>For life &amp; health agencies and call centers that buy their leads</p>
        <h1 className="mt-5 max-w-[840px] text-headline-lg font-semibold leading-[1.0] tracking-[-0.045em] text-[var(--ink)] sm:text-hero lg:text-[clamp(3.5rem,6.2vw,5.25rem)]">
          <Words text="Know what every lead" from={850} />{" "}
          <Words text="really" from={1170} className="pr-[0.1em] font-light italic text-[var(--accent-ink)]" />{" "}
          <Words text="cost you." from={1250} />
        </h1>
        <p className={`mt-7 max-w-[560px] text-base leading-[1.65] text-muted-foreground sm:text-lg ${styles.heroRise}`} style={at(1500)}>
          Live transfers, dialing, applications and commissions in one workspace — and every issued policy traced back to
          the campaign that paid for it.
        </p>
        <div className={`mt-9 flex flex-wrap items-center gap-3 ${styles.heroRise}`} style={at(1650)}>
          <Button asChild className="h-12 rounded-full px-7 text-base">
            <Link href="/signup">Start your free trial<ArrowRight className="size-4" aria-hidden="true" /></Link>
          </Button>
          <Button asChild variant="outline" className="h-12 rounded-full bg-background/70 px-7 text-base backdrop-blur">
            <Link href="#product">See the product</Link>
          </Button>
        </div>
        <ul className={`mt-8 flex flex-wrap gap-x-6 gap-y-2 p-0 text-sm text-muted-foreground ${styles.heroRise}`} style={at(1780)}>
          {/* Each line is one the product can back: a card is taken at checkout but nothing is charged
              during the trial; there is no per-lead fee (add-ons and metered usage are priced on
              /pricing); screening runs the agency's own checks and vendors, it is not a legal guarantee. */}
          {["$0 due during the free trial", "No per-lead fees", "Consent, DNC and calling-window screening before a dial"].map((item) => (
            <li key={item} className="flex list-none items-center gap-2"><Check className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
