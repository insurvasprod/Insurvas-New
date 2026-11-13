"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export type DocsIndexEntry = { kind: "doc" | "insurvas" | "term"; href: string; title: string; meta: string; text: string };

const GROUPS: { kind: DocsIndexEntry["kind"]; label: string }[] = [
  { kind: "doc", label: "Docs" },
  { kind: "insurvas", label: "In Insurvas" },
  { kind: "term", label: "Key terms" },
];

/**
 * Docs search, R4 D4: one long box in the middle of the title line, ⌘K / Ctrl+K from anywhere in Docs. Results
 * drop under it, grouped into Docs pages, Insurvas pages (each opening its step's guide) and key terms; Enter
 * opens the first.
 */
export function DocsSearch({ entries }: { entries: DocsIndexEntry[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return entries
      .map((entry) => {
        const title = entry.title.toLowerCase();
        const body = `${entry.text} ${entry.meta}`.toLowerCase();
        if (!words.every((word) => title.includes(word) || body.includes(word))) return null;
        return { entry, score: words.filter((word) => title.includes(word)).length };
      })
      .filter((hit): hit is { entry: DocsIndexEntry; score: number } => hit !== null)
      .sort((a, b) => b.score - a.score);
  }, [entries, query]);
  const grouped = GROUPS.map((group) => ({ ...group, hits: results.filter((hit) => hit.entry.kind === group.kind).slice(0, group.kind === "doc" ? 6 : 3) })).filter((group) => group.hits.length > 0);
  const first = grouped[0]?.hits[0]?.entry ?? null;

  return (
    <div className="relative mx-auto w-full max-w-[560px]">
      <label className="flex h-9 items-center gap-2.5 rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-sm text-[var(--muted)] focus-within:border-[var(--primary)]">
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <input
          ref={input}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && first) router.push(first.href);
            if (event.key === "Escape") { setQuery(""); input.current?.blur(); }
          }}
          placeholder="Search Docs: licences, carriers, pipelines…"
          aria-label="Search Docs"
          className="min-w-0 flex-1 bg-transparent text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
        />
        <kbd className="shrink-0 rounded-md border border-[var(--border)] px-1.5 text-xs">⌘K</kbd>
      </label>
      {open && query.trim() ? (
        <div role="listbox" aria-label="Docs results" className="absolute inset-x-0 top-11 z-40 rounded-[14px] border border-[var(--border)] bg-[var(--color-card)] py-1.5 shadow-[var(--shadow-overlay,0_24px_60px_rgba(0,0,0,.5))]">
          {grouped.length === 0 ? (
            <p className="m-0 px-4 py-4 text-sm text-[var(--muted)]">Nothing for &ldquo;{query.trim()}&rdquo;. Try another word, such as &ldquo;licence&rdquo; or &ldquo;carriers&rdquo;.</p>
          ) : grouped.map((group) => (
            <div key={group.kind} className="py-1">
              <p className="m-0 px-4 pt-1 pb-1 text-xs font-semibold text-[var(--muted)]">{group.label}</p>
              {group.hits.map(({ entry }) => (
                <Link key={`${entry.kind}-${entry.href}-${entry.title}`} href={entry.href} role="option" aria-selected={entry === first} className="flex items-center gap-3 px-4 py-2 no-underline hover:bg-[var(--surface-alt)]">
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">{entry.title}</span>
                  <span className="max-w-[55%] shrink-0 truncate text-xs text-[var(--muted)]">{entry.meta}</span>
                </Link>
              ))}
            </div>
          ))}
          <p className="m-0 flex gap-4 border-t border-[var(--border)] px-4 pt-2 pb-1 text-xs text-[var(--muted)]"><span>↵ open the first</span><span>Esc close</span></p>
        </div>
      ) : null}
    </div>
  );
}
