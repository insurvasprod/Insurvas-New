import type { ReactNode } from "react";

import { CountUp, Reveal } from "@/components/marketing/motion";
import { LandingObject } from "@/components/marketing/three/landing-object";

/**
 * The capability grid (2026-10-13): four calm tiles, three of them holding a live 3D object — calls
 * arcing across a globe, a heater shield with a scan passing down it, a policy card turning in the
 * light. Every line is something the product does today; figures are labelled samples. The three
 * small text-only tiles were removed at the owner's request, and the section sits close to pricing.
 */
function Tile({ title, body, children, className = "", tone = "light" }: { title: string; body: string; children?: ReactNode; className?: string; tone?: "light" | "dark" }) {
  const dark = tone === "dark";
  return (
    <article className={`relative flex flex-col overflow-hidden rounded-[28px] border p-7 sm:p-8 ${dark ? "border-transparent bg-[var(--footer-bg)] text-[var(--nav-ink)]" : "border-border bg-card"} ${className}`}>
      <h3 className={`max-w-[26ch] text-title-sm font-semibold leading-[1.2] tracking-[-0.02em] ${dark ? "" : "text-[var(--ink)]"}`}>{title}</h3>
      <p className={`mt-2 max-w-[44ch] text-sm leading-[1.6] ${dark ? "text-[var(--nav-muted)]" : "text-muted-foreground"}`}>{body}</p>
      {children}
    </article>
  );
}

const VENDORS = [
  { name: "Cobalt Media", value: 227, width: 46 },
  { name: "Summit Live", value: 312, width: 64 },
  { name: "Bayview Data", value: 488, width: 100 },
];

export function LandingBento() {
  return (
    <section id="features" aria-labelledby="bento-title" className="scroll-mt-20 bg-background px-4 pb-10 pt-24 sm:px-6 lg:px-16 lg:pb-12 lg:pt-32">
      <div className="mx-auto max-w-7xl">
        <Reveal className="max-w-[760px]">
          <p className="text-sm font-semibold text-[var(--accent-ink)]">What it does</p>
          <h2 id="bento-title" className="mt-3 text-title-lg font-semibold leading-[1.05] tracking-[-0.035em] text-[var(--ink)] sm:text-headline-lg">
            Built for the way insurance is really sold.
          </h2>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-12">
          <Reveal className="lg:col-span-7" variant="rise">
            <Tile title="Every live transfer, claimed exactly once." body="Transfers from your partners land on one floor, screened, with the wait on the row. Two closers click — the server settles who won." className="h-full min-h-[480px]">
              <LandingObject kind="sphere" className="pointer-events-none absolute -bottom-4 -right-6 size-[340px] sm:size-[400px] lg:bottom-0 lg:right-0 lg:size-[380px]" />
            </Tile>
          </Reveal>
          <Reveal className="lg:col-span-5" variant="rise" delay={100}>
            <Tile tone="dark" title="Four checks before every dial." body="Consent, DNC, your suppression list and the customer's calling window — re-checked by the server in the instant before the call. A refusal is logged with its reason." className="h-full min-h-[480px]">
              <LandingObject kind="shield" className="pointer-events-none absolute bottom-2 left-1/2 size-[300px] -translate-x-1/2" />
            </Tile>
          </Reveal>

          <Reveal className="lg:col-span-5" variant="rise">
            <Tile title="Every commission matched to its policy." body="Carrier statements come in, each line meets the policy you wrote, and what was owed is set against what was paid." className="h-full min-h-[400px]">
              <LandingObject kind="card" className="pointer-events-none absolute inset-x-0 bottom-0 h-[260px]" />
            </Tile>
          </Reveal>
          <Reveal className="lg:col-span-7" variant="rise" delay={100}>
            <Tile title="The number nobody else can give you." body="True cost per issued policy, by campaign and by vendor — computed from your own linked data, never estimated." className="h-full min-h-[400px]">
              <div className="mt-auto pt-8">
                <div className="flex items-baseline gap-3">
                  <span className="text-hero font-semibold tabular-nums tracking-[-0.04em] text-[var(--ink)]"><CountUp value={227.44} prefix="$" decimals={2} /></span>
                  <span className="text-sm text-muted-foreground">per issued policy · sample</span>
                </div>
                <ul className="m-0 mt-6 space-y-3 p-0">
                  {VENDORS.map((vendor, index) => (
                    <li key={vendor.name} className="list-none">
                      <div className="flex justify-between text-sm"><span className="text-muted-foreground">{vendor.name}</span><span className="font-semibold tabular-nums text-foreground">${vendor.value}</span></div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-alt)]">
                        <div className="h-full rounded-full" style={{ width: `${vendor.width}%`, background: index === 0 ? "var(--primary)" : `color-mix(in srgb, var(--primary) ${60 - index * 18}%, var(--surface-alt))` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </Tile>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
