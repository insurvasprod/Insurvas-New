"use client";

import { usePathname } from "next/navigation";

import type { EffectiveMaintenanceLevel } from "@/lib/system/constants";

type Props = {
  workspaceName: string;
  planName: string | null;
  roleLabel: string;
  readOnly: boolean;
  maintenance: EffectiveMaintenanceLevel;
};

function routeMatch(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * The boards' context strip: who you are here on the left, what that means on the right.
 *
 * It replaces a card that repeated the page's own name in 20px above every page title. Same
 * classes as the partner shell's strip, so the two stay one component in CSS.
 */
export function AgentWorkspaceBar({ workspaceName, planName, roleLabel, readOnly, maintenance }: Props) {
  const pathname = usePathname();
  const who = [workspaceName, planName ? `${planName} plan` : null, roleLabel].filter(Boolean).join(" · ");

  // Settings boards swap the system chips for what governs every change on those pages.
  if (routeMatch(pathname, "/app/settings")) {
    return (
      <div className="portal-context-strip" aria-label="Current workspace">
        <span>{who}</span>
        <span className="portal-context-chips">
          <span className="portal-status-chip">Owner only</span>
          <span className="portal-status-chip is-success"><span aria-hidden="true" />Effective-dated and audited</span>
        </span>
      </div>
    );
  }

  const system =
    maintenance === "off"
      ? { tone: "is-success", label: "All systems normal" }
      : maintenance === "banner_only"
        ? { tone: "is-warning", label: "Maintenance scheduled" }
        : { tone: "is-warning", label: "Maintenance in progress" };

  return (
    <div className="portal-context-strip" aria-label="Current workspace">
      <span>{who}</span>
      <span className="portal-context-chips">
        <span className={`portal-status-chip ${system.tone}`}><span aria-hidden="true" />{system.label}</span>
        <span className={`portal-status-chip ${readOnly ? "is-warning" : ""}`}>{readOnly ? "Read only" : "Read-write"}</span>
      </span>
    </div>
  );
}
