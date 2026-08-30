"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, CreditCard, BadgePercent, Boxes, FileStack, ShieldCheck, Gauge, ToggleRight, Mail, Wrench, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";

import type { ConfigurationIconKey, ConfigurationSection } from "@/lib/configuration/sections";
import { Input } from "@/components/ui/input";

const ICONS: Record<ConfigurationIconKey, typeof CreditCard> = {
  payments: CreditCard,
  offers: BadgePercent,
  products: Boxes,
  templates: FileStack,
  compliance: ShieldCheck,
  limits: Gauge,
  features: ToggleRight,
  email: Mail,
  system: Wrench,
  advanced: SlidersHorizontal,
};

export function ConfigurationNav({ sections }: { sections: ConfigurationSection[] }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const visible = useMemo(
    () => sections.filter((section) => `${section.label} ${section.description} ${section.keywords}`.toLowerCase().includes(normalized)),
    [normalized, sections],
  );

  return (
    <aside className="h-fit rounded-xl border bg-card p-4 shadow-sm lg:sticky lg:top-8" aria-label="Configuration sections">
      <p className="text-sm font-bold text-foreground">Configuration areas</p>
      <label className="relative mt-4 block">
        <span className="sr-only">Search settings</span>
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings"
          aria-label="Search setting labels"
          className="pl-9"
        />
      </label>

      <nav className="mt-4 space-y-1">
        {visible.map((section) => {
          const Icon = ICONS[section.icon];
          const href = `/admin/configuration/${section.slug}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              key={section.slug}
              href={href}
              className={`flex items-start gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active ? "border-primary/30 bg-primary/10 font-semibold text-primary" : "border-transparent hover:border-border hover:bg-muted/50"
              }`}
            >
              <Icon className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate">{section.label}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">{section.owner}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      {visible.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No matching setting labels.</p>}
    </aside>
  );
}
