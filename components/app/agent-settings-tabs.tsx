"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AgentSettingsOverview } from "@/components/app/agent-settings-overview";
import { AppointmentVaultSettings } from "@/components/app/appointment-vault-settings";
import { CarrierLibrarySettings } from "@/components/app/carrier-library-settings";
import { DispositionSettings } from "@/components/app/disposition-settings";
import { PipelineSettings } from "@/components/app/pipeline-settings";
import { QueueSlaSettings } from "@/components/app/queue-sla-settings";
import { CalendarAvailabilitySettings } from "@/components/app/calendar-availability-settings";
import { CadenceSettings } from "@/components/app/cadence-settings";
import { CallingWindowSettingsPanel } from "@/components/app/calling-window-settings";
import { LeadPostKeysSettings } from "@/components/app/lead-post-keys-settings";
import { TeamSettings } from "@/components/app/team-settings";
import { TemplateSettings } from "@/components/app/template-settings";
import { ManagedElsewhereSettings } from "@/components/app/settings/managed-settings";
import { LockIcon, SettingsSectionProvider } from "@/components/app/settings/primitives";
import type { TeamSnapshot } from "@/lib/tenantTeam/service";
import type { WorkspaceSnapshot } from "@/lib/settings/workspaceSnapshot";
import { cn } from "@/lib/utils";

export type AgentSettingsTab = {
  id: string;
  label: string;
  description: string;
  disabled?: string;
  /** Selectable, locked, and explained on its own page: the thing is managed somewhere else. */
  managed?: string;
  /** The rail heading this section sits under. Sections with no group are listed first, ungrouped. */
  group?: string;
};

export function AgentSettingsTabs({
  tabs,
  team,
  workspace,
  initialTab = "agency-profile",
}: {
  tabs: AgentSettingsTab[];
  team: TeamSnapshot;
  workspace: WorkspaceSnapshot;
  initialTab?: string;
}) {
  const firstAvailable = tabs.find((tab) => !tab.disabled)?.id ?? tabs[0]?.id ?? initialTab;
  const [activeId, setActiveId] = useState(initialTab);
  const active = useMemo(
    () => tabs.find((tab) => tab.id === activeId && !tab.disabled) ?? tabs.find((tab) => tab.id === firstAvailable),
    [activeId, firstAvailable, tabs]
  );

  // Grouped in the order the caller listed them, so the rail's order and the page's order cannot
  // drift apart. A tab with no group keeps its place in the first, unheaded run.
  const grouped = useMemo(() => {
    const out: { group?: string; items: AgentSettingsTab[] }[] = [];
    for (const tab of tabs) {
      const last = out[out.length - 1];
      if (last && last.group === tab.group) last.items.push(tab);
      else out.push({ group: tab.group, items: [tab] });
    }
    return out;
  }, [tabs]);

  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash && tabs.some((tab) => tab.id === hash && !tab.disabled)) {
        // Hash deep-links are external browser state that should select the matching tab.
        setActiveId(hash);
      }
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [tabs]);

  function selectTab(id: string) {
    const tab = tabs.find((item) => item.id === id);
    if (!tab || tab.disabled) return;
    setActiveId(id);
    window.history.replaceState(null, "", `#${id}`);
  }

  /**
   * The few rail rows that carry a figure. Only two do on the board, and both are things an owner
   * acts on from the rail: licences about to lapse, and a team with no seat left to invite into.
   * A zero is not drawn — a badge that always says something stops being read.
   */
  function badgeFor(id: string): { text: string; warn: boolean } | null {
    if (id === "states-licences" && workspace.licencesExpiringSoon > 0) {
      return { text: `${workspace.licencesExpiringSoon} expiring`, warn: true };
    }
    if (id === "team-access" && team.seats.max !== null) {
      return { text: `${team.seats.used} / ${team.seats.max}`, warn: team.seats.used >= team.seats.max };
    }
    return null;
  }

  function renderActiveContent(): ReactNode {
    if (!active) return null;
    switch (active.id) {
      case "agency-profile": return <AgentSettingsOverview team={team} workspace={workspace} />;
      case "carrier-library": return <CarrierLibrarySettings />;
      case "states-licences": return <AppointmentVaultSettings inSettings />;
      case "team-access": return <TeamSettings initial={team} workspace={workspace} />;
      case "calendar": return <CalendarAvailabilitySettings />;
      case "cadence": return <CadenceSettings />;
      case "calling-windows": return <CallingWindowSettingsPanel />;
      case "lead-posting": return <LeadPostKeysSettings />;
      case "queue-sla": return <QueueSlaSettings />;
      case "pipelines": return <PipelineSettings />;
      case "dispositions": return <DispositionSettings />;
      case "form-templates": return <TemplateSettings />;
      case "alerts":
      case "billing": return <ManagedElsewhereSettings which={active.id} team={team} workspace={workspace} />;
      default: return <p className="portal-settings-empty">This settings area is not available for the current account.</p>;
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start">
      <nav
        aria-label="Settings sections"
        role="tablist"
        aria-orientation="vertical"
        className="box-border flex w-full shrink-0 gap-1 overflow-x-auto rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-2 pt-1 pb-2.5 lg:sticky lg:top-[calc(var(--top-bar-h)+1rem)] lg:w-[262px] lg:flex-col lg:gap-0 lg:overflow-visible"
      >
        {/* Keyed by position, not by the group's name. A run is defined by where it sits in the
            caller's order, and the same name can legitimately open a second run — so the name is not
            an identity. Keying on it made React see duplicates, warn that children "may be duplicated
            and/or omitted", and then throw NotFoundError from insertBefore, which aborted hydration
            for the whole page: the settings rail stopped responding to clicks entirely. */}
        {grouped.map(({ group, items }, index) => (
          <div key={`${group ?? "ungrouped"}-${index}`} role="presentation" className="flex shrink-0 gap-1 lg:flex-col lg:gap-0">
            {group && (
              <p className="hidden px-2.5 pt-3.5 pb-1.5 text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)] lg:block">
                {group}
              </p>
            )}
            {items.map((tab) => {
              const isActive = active?.id === tab.id;
              const badge = badgeFor(tab.id);
              return (
                <button
                  key={tab.id}
                  id={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`settings-panel-${tab.id}`}
                  disabled={Boolean(tab.disabled)}
                  onClick={() => selectTab(tab.id)}
                  className={cn(
                    "mb-0.5 flex min-h-[34px] w-full shrink-0 items-center gap-2 rounded-[8px] border-0 px-2.5 py-1.5 text-left text-[14px] leading-[1.5] tracking-[-0.02em] whitespace-nowrap transition-colors lg:whitespace-normal",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-50",
                    isActive
                      ? "bg-[var(--brand-50)] font-semibold text-[var(--accent-ink)] shadow-[inset_2px_0_0_var(--primary)]"
                      : tab.managed
                        ? "bg-transparent text-[var(--muted)] hover:bg-[var(--surface-alt)]"
                        : "bg-transparent text-[var(--body)] hover:bg-[var(--surface-alt)] hover:text-[var(--ink)]"
                  )}
                >
                  <span className="min-w-0 flex-grow">{tab.label}</span>
                  {badge && (
                    <span
                      className={cn(
                        "ml-auto shrink-0 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] tabular-nums",
                        badge.warn ? "text-[var(--warning-ink)]" : "text-[var(--muted)]"
                      )}
                    >
                      {badge.text}
                    </span>
                  )}
                  {tab.managed && (
                    <span className="ml-auto inline-flex shrink-0 text-[var(--muted)]" aria-label="Managed elsewhere">
                      <LockIcon />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        {active && (
          <section
            id={`settings-panel-${active.id}`}
            className="portal-settings-panel min-w-0"
            role="tabpanel"
            aria-labelledby={active.id}
            tabIndex={-1}
            key={active.id}
          >
            <SettingsSectionProvider value={{ title: active.label, description: active.description }}>
              {renderActiveContent()}
            </SettingsSectionProvider>
          </section>
        )}
      </div>
    </div>
  );
}
