import Link from "next/link";

import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import { LEGAL_DOC_TYPES, type LegalDocType } from "@/lib/legal/constants";
import { fetchCurrentDocuments } from "@/lib/legal/queries";

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
 *
 * The brand block is the real mark (owner, 2026-10-13): the full logo, isotype and wordmark, in its
 * on-dark cut, since the ground here is always ink.
 *
 * The Legal column lists only documents that have a published version: /legal/dpa used to be linked
 * here and answered 404 because no DPA had been published. A failed read lists none rather than
 * guessing.
 */
const COLUMNS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  {
    title: "Product",
    links: [
      { href: "/#product", label: "Inside one call" },
      { href: "/#features", label: "Features" },
      { href: "/#industries", label: "Who it's for" },
      { href: "/#faq", label: "Questions" },
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
];

/** Footer wording per document type, in the order the column shows them. */
const LEGAL_LINK_LABELS: Record<LegalDocType, string> = {
  tos: "Terms of service",
  privacy: "Privacy policy",
  dpa: "Data processing",
  subprocessors: "Subprocessors",
  cookies: "Cookies",
  refund: "Refunds",
};
const LEGAL_LINK_ORDER: LegalDocType[] = ["tos", "privacy", "dpa", "subprocessors", "cookies", "refund"];

async function publishedLegalLinks(): Promise<Array<{ href: string; label: string }>> {
  const documents = await fetchCurrentDocuments().catch(() => []);
  const published = new Set(documents.map((doc) => doc.doc_type));
  return LEGAL_LINK_ORDER.filter((type) => LEGAL_DOC_TYPES.includes(type) && published.has(type)).map((type) => ({
    href: `/legal/${type}`,
    label: LEGAL_LINK_LABELS[type],
  }));
}

export async function SiteFooter() {
  const legalLinks = await publishedLegalLinks();
  const columns = legalLinks.length > 0 ? [...COLUMNS, { title: "Legal", links: legalLinks }] : COLUMNS;
  return (
    <footer className="bg-[var(--footer-bg)] px-4 pb-10 pt-20 sm:px-6 lg:px-16">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))]">
          <div>
            <Link href="/" className="inline-flex no-underline">
              <InsurvasLogo size="auth" tone="dark" alt="Insurvas" />
            </Link>
            <p className="mt-4 max-w-[260px] text-sm leading-normal tracking-[-0.02em] text-[var(--nav-muted)]">
              The operating system for insurance teams that buy leads and write policies.
            </p>
          </div>

          {columns.map((column) => (
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
            Pre-dial screening uses the checks and vendors your agency configures · Subscription payments are taken on our payment provider&rsquo;s hosted page
          </span>
        </div>
      </div>
    </footer>
  );
}
