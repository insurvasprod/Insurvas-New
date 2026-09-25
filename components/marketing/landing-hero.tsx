"use client";

import Link from "next/link";
import { ArrowRight, Calculator, ShieldCheck, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tilt3D, usePrefersReducedMotion } from "@/components/marketing/motion";
import { AppWindow, DialerMock, InboundMock, Satellite } from "@/components/marketing/landing-mocks";
import styles from "@/components/marketing/landing.module.css";

/**
 * The hero: copy on the left, a 3D stage on the right. The stage is three layers at different
 * depths (a dialer window far back, the inbound floor in the middle, three satellites up front)
 * inside one preserve-3d scene that tilts toward the pointer, over a perspective grid floor that
 * runs toward the viewer. Dark ground in both themes — the one band on the page that is.
 */
export function LandingHero() {
  const reduced = usePrefersReducedMotion();
  return (
    <section className="relative isolate overflow-hidden bg-[var(--footer-bg)] text-[var(--nav-ink)]">
      <div aria-hidden="true" className={`${styles.aurora} -left-40 -top-72`} />
      <div aria-hidden="true" className={`${styles.aurora} -right-60 top-40 opacity-60`} style={{ animationDelay: "-7s" }} />
      <div aria-hidden="true" className={styles.floor} />

      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 pb-24 pt-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:px-16 lg:pb-32 lg:pt-24">
        <div className="relative z-10 max-w-[620px]">
          <span className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] px-3 py-1 text-xs font-semibold text-[color-mix(in_srgb,var(--primary)_70%,white)]">
            <span className={`size-1.5 rounded-full bg-[var(--primary)] ${styles.pulse}`} aria-hidden="true" />
            Built for agencies that buy their leads
          </span>
          <h1 className="mt-6 text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[56px] lg:text-[64px]">
            Know what every lead{" "}
            <span className="bg-[linear-gradient(100deg,var(--primary),color-mix(in_srgb,var(--primary)_55%,white))] bg-clip-text text-transparent">cost you.</span>
          </h1>
          <p className="mt-6 max-w-[56ch] text-base leading-[1.6] text-[var(--nav-muted)] sm:text-lg">
            Insurvas runs the inbound floor, the outbound dialer and the book of business in one workspace — and traces every
            issued policy back to the campaign that paid for it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild className="h-12 rounded-full px-7 text-base shadow-[0_10px_40px_-10px_var(--primary)]">
              <Link href="/signup">Start your 14-day trial<ArrowRight className="size-4" aria-hidden="true" /></Link>
            </Button>
            <Link href="#product" className="inline-flex h-12 items-center rounded-full border border-[var(--nav-line)] px-6 text-base font-semibold text-[var(--nav-ink)] no-underline transition-colors hover:border-[var(--nav-muted)] hover:bg-white/5">
              See it working
            </Link>
          </div>
          <p className="mt-4 text-sm text-[var(--nav-muted)]">No card. Your data stays in your workspace. Cancel from the app.</p>
        </div>

        {/* The stage. Hidden from assistive tech: it is a picture of the product, described by the
            copy beside it and by the tour below. */}
        <div aria-hidden="true" className="relative mx-auto w-full max-w-[640px] lg:max-w-none lg:pl-10">
          <Tilt3D max={7} rest={{ x: reduced ? 0 : 9, y: reduced ? 0 : -11 }} perspective={1600} className="py-10">
            <div className="relative" style={{ transformStyle: "preserve-3d" }}>
              {/* Far layer: the dialer, peeking out behind and to the right */}
              <div className="absolute -right-6 -top-14 hidden w-[74%] opacity-80 sm:block" style={{ transform: "translateZ(-160px)" }}>
                <AppWindow url="app.insurvas.com/app/dialer" tag={false}>
                  <DialerMock />
                </AppWindow>
              </div>

              {/* Middle layer: the inbound floor */}
              <div style={{ transform: "translateZ(0)" }}>
                <AppWindow url="app.insurvas.com/app/inbound">
                  <InboundMock />
                </AppWindow>
              </div>

              {/* Front layer: satellites, each floating on its own rhythm */}
              <div className={`absolute -left-4 top-[60%] hidden sm:block ${styles.float}`} style={{ transform: "translateZ(120px)" }}>
                <Satellite icon={<ShieldCheck className="size-4" />} label="Screened before the dial" value="4 of 4 checks clear" tone="success" />
              </div>
              <div className={`absolute -right-8 -bottom-10 hidden sm:block ${styles.floatSlow}`} style={{ transform: "translateZ(170px)" }}>
                <Satellite icon={<Calculator className="size-4" />} label="True CPA, per issued policy" value="$227.44" />
              </div>
              <div className={`absolute -top-8 left-[18%] hidden md:block ${styles.floatAlt}`} style={{ transform: "translateZ(90px)" }}>
                <Satellite icon={<Trophy className="size-4" />} label="Transfer claimed" value="One winner, settled by the server" />
              </div>
            </div>
          </Tilt3D>
        </div>
      </div>
    </section>
  );
}
