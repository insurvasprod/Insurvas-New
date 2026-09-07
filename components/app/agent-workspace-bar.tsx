"use client";

import { Activity, ChevronRight, Home, LockKeyhole } from "lucide-react";
import { usePathname } from "next/navigation";

import type { MenuSection } from "@/lib/menu/definition";

type Props = {
  menu: MenuSection[];
  planName: string | null;
  role: string;
  readOnly: boolean;
};

function routeMatch(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function AgentWorkspaceBar({ menu, planName, role, readOnly }: Props) {
  const pathname = usePathname();
  const current = menu
    .flatMap((section) => section.items.map((item) => ({ ...item, sectionLabel: section.label })))
    .filter((item) => routeMatch(pathname, item.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const sectionLabel = current?.sectionLabel ?? "Workspace";
  const pageLabel = current?.label ?? "Agent workspace";
  const roleLabel = role.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());

  return (
    <section
      aria-label="Current workspace"
      className="mb-6 overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-blue)]/10 text-[var(--color-blue)]">
            <Home className="size-4" aria-hidden="true" />
          </span>
          <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-[11px] font-bold uppercase tracking-wider text-[var(--color-accent-ink)]">
              {sectionLabel}
            </p>
            <p className="truncate text-lg font-extrabold tracking-tight text-foreground sm:text-xl">
              {pageLabel}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-2.5 py-1 text-[var(--color-success)]">
            <Activity className="size-3.5" aria-hidden="true" />
            Workspace ready
          </span>
          {readOnly && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-warning)]/35 bg-[var(--color-warning)]/10 px-2.5 py-1 text-[var(--color-warning)]">
              <LockKeyhole className="size-3.5" aria-hidden="true" />
              Read only
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
        <span>{roleLabel} access</span>
        {planName && <span>· {planName} plan</span>}
        <span className="hidden sm:inline">· Changes are saved to your account as you work</span>
      </div>
    </section>
  );
}
