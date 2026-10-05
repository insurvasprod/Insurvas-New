import Link from "next/link";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InsurvasLogo } from "@/components/shared/insurvas-logo";

/**
 * The marketing rail.
 *
 * The wordmark is a filled orange tile and the product name beside it, because the header is the
 * only place on a public page where the brand is allowed to be the loudest thing. Everything after
 * it is 14px semibold: a nav that competes with the headline has already lost the page.
 *
 * Sticky, on a translucent card so the page's motion shows through as it scrolls under. The section
 * links are anchors on the landing page (/#…), so they work from every public page. Below md the
 * nav folds into a native <details> menu — no script needed to open it.
 */
const NAV: Array<{ href: string; label: string; key?: "home" | "pricing" }> = [
  { href: "/#product", label: "Product" },
  { href: "/#journey", label: "How it works" },
  { href: "/#compliance", label: "Compliance" },
  { href: "/pricing", label: "Pricing", key: "pricing" },
];

export function SiteHeader({ current }: { current?: "home" | "pricing" }) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-[color-mix(in_srgb,var(--card)_82%,transparent)] backdrop-blur-xl supports-[backdrop-filter]:bg-[color-mix(in_srgb,var(--card)_72%,transparent)]">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-[14px] sm:px-6 md:gap-10 lg:px-16">
        <Link href="/" aria-current={current === "home" ? "page" : undefined} className="group flex items-center gap-2.5 no-underline">
          <InsurvasLogo size="public" />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.key && current === item.key ? "page" : undefined}
              className={`text-sm font-semibold tracking-[-0.01em] no-underline ${item.key && current === item.key ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <span className="flex-1" />

        <div className="flex items-center gap-3">
          <Button asChild variant="secondary" className="hidden h-10 rounded-full border-[var(--border-strong)] px-[18px] sm:inline-flex">
            <Link href="/app/login">Sign in</Link>
          </Button>
          <Button asChild className="h-10 rounded-full px-4 text-sm sm:px-7 sm:text-base">
            <Link href="/signup"><span className="sm:hidden">Try free</span><span className="hidden sm:inline">Start free trial</span></Link>
          </Button>
          <details className="relative md:hidden">
            <summary aria-label="Menu" className="flex size-10 cursor-pointer list-none items-center justify-center rounded-full border border-[var(--border-strong)] text-foreground [&::-webkit-details-marker]:hidden">
              <Menu className="size-4" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 top-12 w-56 rounded-xl border border-border bg-card p-2 shadow-[var(--shadow-overlay)]">
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
