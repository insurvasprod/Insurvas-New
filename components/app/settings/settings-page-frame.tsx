"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { SettingsRailProvider, type SettingsRailSlots } from "@/components/ui/settings-rail-context";
import type { SettingsSection } from "@/lib/settings/sections";
import { groupSections, sectionHref } from "@/lib/settings/registry";
import { cn } from "@/lib/utils";

const SETTINGS_DESCRIPTION = "Manage your account, workspace, security, billing and operating preferences.";

/** Shared header, navigation and content start line for every Settings destination. */
export function SettingsPageFrame({ sections, activeId, onSelect, children, className }: {
  sections: readonly SettingsSection[];
  activeId?: string;
  onSelect?: (id: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const [slots, setSlots] = useState<SettingsRailSlots>({ heading: null, tabs: null });
  const attachHeading = useCallback((heading: HTMLDivElement | null) => {
    setSlots((current) => current.heading === heading ? current : { ...current, heading });
  }, []);
  const attachTabs = useCallback((tabs: HTMLDivElement | null) => {
    setSlots((current) => current.tabs === tabs ? current : { ...current, tabs });
  }, []);
  const groups = groupSections(sections);
  const otherGroups = groups
    .map(({ group, items }) => ({ group, items: items.filter((section) => section.id !== activeId) }))
    .filter(({ items }) => items.length > 0);
  const activeSection = sections.find((section) => section.id === activeId);
  function select(id: string) {
    const section = sections.find((item) => item.id === id);
    if (!section) return;
    if (section.route) {
      window.location.assign(sectionHref(section));
      return;
    }
    if (onSelect) onSelect(id);
    else window.location.assign(sectionHref(section));
  }

  return (
    <SettingsRailProvider slots={slots}>
      <div className={cn("portal-settings-page m-stagger flex min-w-0 flex-col gap-6", className)}>
        <PageHeader title="Settings" description={SETTINGS_DESCRIPTION} />
        <div className="flex min-w-0 flex-col lg:items-stretch lg:min-h-[calc(100dvh-var(--top-bar-h)-9rem)] lg:flex-row">
          <aside className="min-w-0 shrink-0 border-b border-[var(--border)] pb-4 lg:-ml-8 lg:w-[280px] lg:border-r lg:border-b-0 lg:pb-0 lg:pl-8 lg:pr-4">
            <div ref={attachHeading} className="mb-3 flex flex-col gap-2">
              {activeSection && <p className="m-0 px-2.5 pb-1.5 pt-3 text-xs font-semibold leading-[1.4] tracking-[0.04em] uppercase text-[var(--muted)]">{activeSection.group}</p>}
            </div>
            <div ref={attachTabs} className="mb-4 flex flex-col gap-1.5" />
          <label className="sr-only" htmlFor="settings-section-select">Settings section</label>
          <select
            id="settings-section-select"
            className="mb-4 h-9 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-foreground lg:hidden"
            value={activeId ?? ""}
            onChange={(event) => select(event.target.value)}
          >
            <option value="" disabled>Choose a settings area</option>
            {groups.map(({ group, items }) => <optgroup key={group} label={group}>
              {items.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
            </optgroup>)}
          </select>

          <nav aria-label="Settings sections" className="hidden lg:block lg:sticky lg:top-[calc(var(--top-bar-h)+1.25rem)] lg:max-h-[calc(100dvh-var(--top-bar-h)-2.5rem)] lg:overflow-y-auto lg:overscroll-contain">
            {otherGroups.map(({ group, items }) => (
              <div key={group} className="pb-4">
                <p className="m-0 px-2.5 pb-1.5 pt-3 text-sm font-semibold leading-[1.4] tracking-[-0.01em] text-[var(--body)]">{group}</p>
                <ul className="m-0 list-none space-y-0.5 p-0">
                  {items.map((section) => {
                    const active = activeId === section.id;
                    return (
                      <li key={section.id}>
                        <Link
                          href={sectionHref(section)}
                          aria-current={active ? "page" : undefined}
                          onClick={onSelect && !section.route ? (event) => { event.preventDefault(); onSelect(section.id); } : undefined}
                          className={cn(
                            "flex min-h-9 items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-field-label no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
                            active ? "bg-[var(--primary-soft)] font-semibold text-[var(--ink)]" : "font-normal text-[var(--body)] hover:bg-[var(--surface-alt)] hover:text-[var(--ink)]",
                            section.managed && "text-[var(--muted)]",
                          )}
                        >
                          <span className="min-w-0 flex-1">{section.label}</span>
                          {section.managed && <span className="text-xs text-[var(--muted)]">Managed</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          </aside>
          <main className="min-w-0 flex-1 lg:pl-6">
            <div className="min-w-0 max-w-[1100px]">{children}</div>
          </main>
        </div>
      </div>
    </SettingsRailProvider>
  );
}
