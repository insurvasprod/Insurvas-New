import Link from "next/link";

/**
 * The dark close of a public page.
 *
 * Ink ground, because a marketing page needs one hard edge at the bottom that says the reading is
 * over. The column set is deliberately short: only destinations that actually exist are listed — a
 * footer full of links that 404 is worse than a footer with a few. The three sign-in doors are all
 * here, because agents, partners and staff share a domain and land on the wrong form constantly.
 *
 * The strapline states only what the product enforces. It used to claim "SOC 2 Type II", which
 * nothing in the product or its documents backs; a certification is a claim a customer can hold
 * us to, so it goes back only with the report behind it.
 */
const COLUMNS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  {
    title: "Product",
    links: [
      { href: "/#product", label: "Inbound floor & dialer" },
      { href: "/#journey", label: "How it works" },
      { href: "/#compliance", label: "Compliance" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Sign in",
    links: [
      { href: "/app/login", label: "Agents" },
      { href: "/partner/login", label: "Partners" },
      { href: "/admin/login", label: "Insurvas staff" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/tos", label: "Terms of service" },
      { href: "/legal/privacy", label: "Privacy policy" },
      { href: "/legal/dpa", label: "Data processing" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-[var(--footer-bg)] px-4 pb-10 pt-20 sm:px-6 lg:px-16">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))]">
          <div>
            <Link href="/" className="flex items-center gap-2.5 no-underline">
              <span className="inline-flex size-7 items-center justify-center rounded-lg bg-[var(--primary)] text-sm font-semibold text-[var(--on-primary)]">
                I
              </span>
              <span className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-[var(--nav-ink)]">
                Insurvas
              </span>
            </Link>
            <p className="mt-4 max-w-[260px] text-sm leading-normal tracking-[-0.02em] text-[var(--nav-muted)]">
              The operating system for insurance teams that buy leads and write policies.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-[var(--nav-ink)]">{column.title}</div>
              <div className="mt-3">
                {column.links.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block py-[5px] text-sm leading-normal tracking-[-0.02em] text-[var(--nav-muted)] no-underline hover:text-[var(--nav-ink)]"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-6 border-t border-[var(--nav-line)] pt-6">
          <span className="text-xs leading-normal tracking-[-0.01em] text-[var(--nav-muted)]">
            © {new Date().getFullYear()} Insurvas Inc. All rights reserved.
          </span>
          <span className="text-xs leading-normal tracking-[-0.01em] text-[var(--nav-muted)]">
            TCPA screening on every dial · Card details never reach our servers · Data stays in your workspace
          </span>
        </div>
      </div>
    </footer>
  );
}
