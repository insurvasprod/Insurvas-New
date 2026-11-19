import Link from "next/link";
import {
  BarChart3, BookOpen, Building2, Check, ChevronRight, Coins, FileSignature, Handshake, Landmark, LayoutDashboard, LifeBuoy, Megaphone, PhoneCall, RefreshCw, ShieldCheck, type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/** One module as the directory lists it. */
export type DirectoryModule = {
  key: string;
  title: string;
  covers: string;
  done: number;
  total: number;
  /** Its tasks, the ones still to do first. */
  tasks: { slug: string; title: string; done: boolean }[];
};

/** Each module's mark: one line icon, so the eye finds it before reading (owner 2026-11-17, premium docs homes). */
export const MODULE_ICONS: Record<string, LucideIcon> = {
  leads: Megaphone, today: PhoneCall, sales: FileSignature, book: BookOpen, retention: LifeBuoy, "carrier-sync": RefreshCw,
  commissions: Coins, accounting: Landmark, partners: Handshake, compliance: ShieldCheck, reports: BarChart3, home: LayoutDashboard, agency: Building2,
};

/** The four shelves, in the order a lead becomes money, then the agency around it. */
export const DIRECTORY_GROUPS: { key: string; title: string; hint: string; modules: string[] }[] = [
  { key: "sell", title: "Find and sell", hint: "From a lead to a submitted application", modules: ["leads", "today", "sales"] },
  { key: "after", title: "After the sale", hint: "Policies, keeping them, carrier files", modules: ["book", "retention", "carrier-sync"] },
  { key: "money", title: "Money", hint: "What you earn, pay and spend", modules: ["commissions", "accounting", "partners"] },
  { key: "run", title: "Run the agency", hint: "Rules, numbers and your team", modules: ["compliance", "reports", "home", "agency"] },
];

export const directoryCard = "rounded-[16px] border border-[var(--border)] bg-[var(--color-card)]";

function Count({ done, total }: { done: number; total: number }) {
  if (total === 0) return null;
  if (done === total) return <span title="Done in your agency" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--success)] tabular-nums"><Check aria-hidden="true" className="size-3.5" strokeWidth={3} />{done}/{total}</span>;
  return <span title="Done in your agency" className="text-xs text-[var(--muted)] tabular-nums">{done}/{total}</span>;
}

/**
 * Docs home's directory (R7, owner 2026-11-17: "easier for the eyes to read and shift from one to another… how
 * docs are implemented in the premium platforms"). Four shelves side by side, each the same shape: its name, then
 * its modules, each an icon, a title, what it covers and two tasks to open. One reading pattern, repeated.
 */
export function DocsDirectory({ modules }: { modules: DirectoryModule[] }) {
  const byKey = new Map(modules.map((item) => [item.key, item]));
  return (
    <section aria-label="Browse by module" className="grid min-h-0 gap-3 md:grid-cols-2 2xl:grid-cols-4">
      {DIRECTORY_GROUPS.map((group) => {
        const items = group.modules.map((key) => byKey.get(key)).filter((item): item is DirectoryModule => Boolean(item));
        if (items.length === 0) return null;
        return (
          <div key={group.key} className={cn(directoryCard, "flex min-w-0 flex-col p-2")}>
            <header className="flex flex-col gap-0.5 px-3 pt-2 pb-2.5">
              <h2 className="m-0 text-sm font-semibold text-[var(--ink)]">{group.title}</h2>
              <span className="text-xs text-[var(--muted)]">{group.hint}</span>
            </header>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {items.map((item) => {
                const Icon = MODULE_ICONS[item.key] ?? BookOpen;
                return (
                  <li key={item.key} className="group/mod rounded-[12px] px-3 py-2.5 transition-colors hover:bg-[var(--surface-alt)]">
                    <Link href={`/app/docs/modules/${item.key}`} className="flex min-w-0 items-start gap-3 no-underline">
                      <span aria-hidden="true" className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--primary-soft)] text-[var(--accent-ink)]"><Icon className="size-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)] group-hover/mod:underline">{item.title}</span>
                          <Count done={item.done} total={item.total} />
                        </span>
                        <span className="block truncate text-xs text-[var(--muted)]">{item.covers}</span>
                      </span>
                    </Link>
                    {item.tasks.length > 0 ? (
                      <ul className="m-0 mt-1.5 flex list-none flex-col gap-0.5 p-0 pl-11">
                        {item.tasks.slice(0, 2).map((task) => (
                          <li key={task.slug} className="min-w-0">
                            <Link href={`/app/docs/${task.slug}`} className="flex min-w-0 items-center gap-1 text-xs text-[var(--body)] no-underline hover:text-[var(--accent-ink)] hover:underline">
                              <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-[var(--muted)]" />
                              <span className="truncate">{task.title}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
