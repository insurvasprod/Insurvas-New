"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Check } from "lucide-react";

import type { ConfigurationSection } from "@/lib/configuration/sections";

/**
 * Breadcrumb, section switcher and title for every configuration section.
 *
 * This replaces a 250px vertical nav rail that sat beside the content on every section route —
 * a second column of navigation two inches from the sidebar that already listed the same areas.
 * Between them they took 430px of a 1440px window, which is why a one-row table used to render
 * in a sliver. Switching sections is one click here rather than zero, and the content gets the
 * width back.
 *
 * Deliberately shows no ticket reference. The registry still carries `owner` for maintainers;
 * "Owned by SA-4.9" is project management, and it was being printed under the title of a screen
 * used by people who do not read the sprint board.
 */
export function ConfigurationSectionHeader({
  section,
  sections,
  title,
  description,
}: {
  section: ConfigurationSection;
  sections: ConfigurationSection[];
  title: string;
  description: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/admin/configuration" className="transition-colors hover:text-foreground">
          Configuration
        </Link>
        <span aria-hidden="true">/</span>

        <div className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-blue)]"
          >
            {section.label}
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </button>

          {open && (
            <>
              {/* Click-away sits behind the menu so a click outside closes it without also
                  activating whatever was underneath. */}
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
              <ul
                role="listbox"
                className="absolute left-0 z-20 mt-1 max-h-[70vh] w-64 overflow-auto rounded-lg border border-border bg-card p-1 shadow-lg"
              >
                {sections.map((s) => {
                  const current = s.slug === section.slug;
                  return (
                    <li key={s.slug}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={current}
                        onClick={() => {
                          setOpen(false);
                          if (!current) router.push(`/admin/configuration/${s.slug}`);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                      >
                        <Check
                          className={`size-3.5 shrink-0 ${current ? "text-[var(--color-blue)]" : "invisible"}`}
                          aria-hidden="true"
                        />
                        <span className={current ? "font-medium" : ""}>{s.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </nav>

      <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-foreground">{title}</h1>
      <p className="mt-1 max-w-[68ch] text-sm font-medium text-muted-foreground">{description}</p>
    </div>
  );
}
