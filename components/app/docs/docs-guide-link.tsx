"use client";

import Link from "next/link";

import { usePagePathname } from "@/components/ui/page-pathname";
import { docModuleForPath } from "@/lib/docs/moduleRoutes";
import { DOC_MODULES } from "@/lib/docs/modules";
import { settingsIndexForPath as settingsDocForPath } from "@/lib/docs/settingsIndex";

const linkClass = "mt-2 block border-t border-[var(--border)] pt-2 font-semibold text-[var(--accent-ink)] no-underline hover:underline";

/**
 * The last line of a page title's (i) (owner 2026-11-17: "Yes, add it"): "How it works: Commissions · Docs ›", to the
 * module guide this page belongs to (lib/docs/moduleRoutes.ts). A Settings page links to its own Settings doc, every
 * setting on it explained (owner 2026-11-17). Nothing on a page outside any module.
 */
export function DocsGuideLink() {
  const pathname = usePagePathname();
  const setting = settingsDocForPath(pathname);
  if (setting) return <Link href={`/app/docs/settings/${setting.slug}`} className={linkClass}>Every setting here: {setting.title} · Docs ›</Link>;
  if (pathname === "/app/settings") return <Link href="/app/docs/settings" className={linkClass}>Every setting, page by page · Docs ›</Link>;
  const key = docModuleForPath(pathname);
  const guide = key ? DOC_MODULES.find((item) => item.key === key) : null;
  if (!guide) return null;
  return (
    <Link href={`/app/docs/modules/${guide.key}`} className={linkClass}>
      How it works: {guide.title} · Docs ›
    </Link>
  );
}
