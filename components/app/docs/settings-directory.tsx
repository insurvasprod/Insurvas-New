import Link from "next/link";
import { Settings } from "lucide-react";

import { SETTINGS_DOCS, SETTINGS_DOC_GROUPS } from "@/lib/docs/settingsDocs";
import { SETTINGS_WALKS } from "@/lib/docs/settingsWalks";
import { cn } from "@/lib/utils";

const card = "rounded-[16px] border border-[var(--border)] bg-[var(--color-card)]";

/**
 * Every Settings page, by the Settings rail's groups (owner 2026-11-17): a shelf per group, each page a link to its
 * Docs page with how many settings it holds. Docs home shows it under the modules; /app/docs/settings is it alone.
 */
export function SettingsDirectory({ className, title = true }: { className?: string; title?: boolean }) {
  const groups = SETTINGS_DOC_GROUPS.map((group) => ({ group, pages: SETTINGS_DOCS.filter((page) => page.group === group) })).filter((entry) => entry.pages.length > 0);
  const fields = SETTINGS_DOCS.reduce((sum, page) => sum + page.parts.reduce((inner, part) => inner + part.fields.length, 0), 0);
  return (
    <section aria-label="Settings, page by page" className={cn(card, "flex min-w-0 flex-col gap-3 p-4", className)}>
      {title ? (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span aria-hidden="true" className="inline-flex size-8 items-center justify-center rounded-[9px] bg-[var(--primary-soft)] text-[var(--accent-ink)]"><Settings className="size-4" /></span>
          <Link href="/app/docs/settings" className="text-sm font-semibold text-[var(--ink)] no-underline hover:underline">Settings, page by page</Link>
          <span className="text-xs text-[var(--muted)] tabular-nums">{SETTINGS_DOCS.length} pages · {fields} settings, each walked step by step on the real screen</span>
        </header>
      ) : null}
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {groups.map(({ group, pages }) => (
          <div key={group} className="flex min-w-0 flex-col gap-1">
            <h3 className="m-0 text-xs font-semibold text-[var(--muted)]">{group}</h3>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {pages.map((page) => (
                <li key={page.slug} className="min-w-0">
                  <Link href={`/app/docs/settings/${page.slug}`} className="flex min-w-0 items-baseline gap-2 text-sm text-[var(--body)] no-underline hover:text-[var(--accent-ink)] hover:underline" title={SETTINGS_WALKS[page.slug]?.outcome ?? page.why}>
                    <span className="truncate">{page.title}</span>
                    {SETTINGS_WALKS[page.slug] ? <span className="shrink-0 text-xs text-[var(--muted)] tabular-nums">{SETTINGS_WALKS[page.slug].steps.length} steps</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
