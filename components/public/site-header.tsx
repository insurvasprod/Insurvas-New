"use client";

import Link from "next/link";
import { ViewTransition, useEffect, useState } from "react";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import styles from "@/components/public/site-header.module.css";
import { ThemeSwitch } from "@/components/public/theme-switch";

/**
 * The marketing rail (2026-10-13): a floating, borderless glass pill rather than a full-width bar.
 * At the top of the page it sits nearly clear over the hero; once you scroll it firms up its glass
 * and casts a soft shadow. A light/dark switch sits beside Sign in. Links are 14px semibold, so the
 * nav never competes with the headline.
 *
 * `floating` (the landing page) lets the hero run underneath it; the other public pages keep it in
 * the flow. The section links are anchors on the landing page (/#…), so they work from every public
 * page. Below md the nav folds into a native <details> menu — no script needed to open it.
 */
const NAV: Array<{ href: string; label: string; key?: "home" | "pricing" }> = [
  { href: "/#product", label: "Product" },
  { href: "/#features", label: "Features" },
  { href: "/#industries", label: "Who it's for" },
  { href: "/#faq", label: "FAQ" },
  { href: "/pricing", label: "Pricing", key: "pricing" },
];

export function SiteHeader({ current, floating = false }: { current?: "home" | "pricing"; floating?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header className={`${floating ? "fixed inset-x-0" : "sticky"} top-0 z-50 px-3 pt-3 sm:px-6`}>
      <div
        // Borderless frosted glass: mostly transparent, with a strong blur and a little extra
        // saturation so whatever scrolls underneath shows through softened, like a reflection.
        className={`relative mx-auto flex items-center gap-3 overflow-visible rounded-full border-0 py-3 pl-6 pr-3 backdrop-blur-2xl backdrop-saturate-150 transition-[max-width,background-color,box-shadow] duration-500 ease-[cubic-bezier(.16,1,.3,1)] md:gap-8 ${
          scrolled
            ? "max-w-6xl bg-[color-mix(in_srgb,var(--color-card)_38%,transparent)] shadow-[0_12px_40px_-24px_rgba(13,64,55,.35)]"
            : "max-w-7xl bg-[color-mix(in_srgb,var(--color-card)_18%,transparent)] shadow-none"
        }`}
      >
        <Link href="/" aria-current={current === "home" ? "page" : undefined} className="flex shrink-0 items-center no-underline">
          {/* Named, so it glides into the sign-in form's logo (AuthBrand). */}
          <ViewTransition name="brand-logo" share="ribbon-morph" default="none">
            <InsurvasLogo size="public" alt="Insurvas" className={styles.introLogo} />
          </ViewTransition>
        </Link>

        <nav aria-label="Primary" className="mx-auto hidden max-w-2xl flex-1 items-center justify-evenly gap-2 xl:flex xl:gap-4">
          {NAV.map((item) => {
            const active = item.key && current === item.key;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold tracking-[-0.01em] no-underline transition-colors ${active ? "bg-[var(--surface-alt)] text-foreground" : "text-muted-foreground hover:bg-[color-mix(in_srgb,var(--surface-alt)_80%,transparent)] hover:text-foreground"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <span className="flex-1 xl:hidden" />

        <div className="flex shrink-0 items-center gap-2">
          {/* Off below sm: logo + switch + trial + menu is wider than a 375px phone, which clipped the
              menu button off the edge (QA 2026-10-22). The phone follows the system theme. */}
          <span className="hidden sm:contents"><ThemeSwitch /></span>
          <Button asChild variant="ghost" className="hidden h-10 rounded-full px-4 sm:inline-flex">
            <Link href="/app/login">Sign in</Link>
          </Button>
          <Button asChild className="h-10 rounded-full px-4 text-sm sm:px-5">
            <Link href="/signup"><span className="sm:hidden">Try free</span><span className="hidden sm:inline">Start free trial</span></Link>
          </Button>
          <details className="relative xl:hidden">
            <summary aria-label="Menu" className="flex size-10 cursor-pointer list-none items-center justify-center rounded-full border border-[var(--border-strong)] text-foreground [&::-webkit-details-marker]:hidden">
              <Menu className="size-4" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 top-14 w-56 rounded-2xl border border-border bg-card p-2 shadow-[var(--shadow-overlay)]">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="block rounded-lg px-3 py-2 text-sm font-semibold text-foreground no-underline hover:bg-[var(--surface-alt)]">
                  {item.label}
                </Link>
              ))}
              <div className="my-1 border-t border-border" />
              <Link href="/app/login" className="block rounded-lg px-3 py-2 text-sm font-semibold text-foreground no-underline hover:bg-[var(--surface-alt)]">Sign in</Link>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
