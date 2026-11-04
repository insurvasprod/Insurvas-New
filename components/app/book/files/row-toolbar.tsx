"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";

/**
 * A file's rows toolbar (UI-CONSISTENCY §6): the kit's DataToolbar, the search first, the outcome chips beside it,
 * the list's actions on the right and Refresh last. The search is the address's `?q=` (a shared link and the back
 * button keep it, and the server narrows the rows by it): typing replaces the address a moment after the last key,
 * keeping every other filter.
 */
export function RowToolbar({ filters, actions, placeholder = "Policy or client" }: { filters?: ReactNode; actions?: ReactNode; placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const asked = params.get("q") ?? "";
  const [query, setQuery] = useState(asked);
  const [refreshing, startRefresh] = useTransition();
  const [, startSearch] = useTransition();
  const timer = useRef<number | undefined>(undefined);

  // The address changed from outside (a chip, the back button): the box follows it.
  const [seen, setSeen] = useState(asked);
  // Its own replace landing is not "outside": a trailing space being typed survives it.
  if (asked !== seen) { setSeen(asked); if (asked !== query.trim().slice(0, 100)) setQuery(asked); }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const search = (value: string) => {
    setQuery(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      const text = value.trim().slice(0, 100);
      if (text) next.set("q", text); else next.delete("q");
      next.delete("page");
      const address = next.toString();
      startSearch(() => router.replace(address ? `${pathname}?${address}` : pathname, { scroll: false }));
    }, 300);
  };

  return (
    <DataToolbar actions={<>
      {actions}
      <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} labelClassName="max-2xl:sr-only" />
    </>}>
      <ToolbarSearch value={query} onChange={search} placeholder={placeholder} className="sm:w-52" />
      {filters}
    </DataToolbar>
  );
}
