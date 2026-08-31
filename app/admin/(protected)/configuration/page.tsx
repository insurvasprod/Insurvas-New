import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, History } from "lucide-react";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { accessibleConfigurationSections } from "@/lib/configuration/sections";
import { getConfigurationOverview } from "@/lib/configuration/status";
import { getRecentConfigurationChanges } from "@/lib/configuration/queries";
import { ConfigurationIcon } from "@/components/admin/configuration/configuration-icon";
import { relativeTime } from "@/lib/relativeTime";

const TONE_PILL: Record<string, string> = {
  good: "bg-[var(--color-success)]/10 text-[var(--color-success)]",
  attention: "bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
  neutral: "bg-[var(--color-blue-faint)] text-[var(--color-blue)]",
  unknown: "bg-muted text-muted-foreground",
};

export default async function ConfigurationCenterPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");

  const sections = accessibleConfigurationSections(admin.role);
  const [overview, recent] = await Promise.all([
    getConfigurationOverview(),
    getRecentConfigurationChanges(sections.map((s) => s.slug)),
  ]);

  const needsAttention = sections.filter((s) => overview[s.slug]?.tone === "attention");
  const lastChange = recent[0] ?? null;

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Configuration</h1>
        <p className="mt-1 max-w-[62ch] text-sm font-medium text-muted-foreground">
          Platform-wide settings, grouped by what they affect. Every change is recorded in the audit log.
        </p>
      </header>

      {/* The only thing that earns a place above the sections — and it is absent when nothing is
          wrong, so its presence means something. */}
      {needsAttention.length > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-4">
          <AlertTriangle className="mt-0.5 size-[18px] shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
          <p className="text-sm">
            <span className="font-semibold">
              {needsAttention.length === 1 ? "1 area needs" : `${needsAttention.length} areas need`} attention.
            </span>{" "}
            <span className="text-[var(--color-text-mid)]">
              {needsAttention.map((s) => `${s.label} — ${overview[s.slug].detail}`).join(" ")}
            </span>
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => {
          const status = overview[section.slug] ?? { tone: "unknown", badge: null, detail: "" };
          const attention = status.tone === "attention";

          return (
            <Link
              key={section.slug}
              href={`/admin/configuration/${section.slug}`}
              className={`group flex flex-col gap-2.5 rounded-xl border bg-card p-[18px] transition-all hover:border-[var(--color-blue)]/50 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-blue)] ${
                attention ? "border-[var(--color-warning)]/40" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <ConfigurationIcon icon={section.icon} className="size-5 text-[var(--color-accent-ink)]" />
                {status.badge && (
                  <span
                    className={`rounded-full px-2 py-[3px] text-[11px] font-bold uppercase tracking-wide ${TONE_PILL[status.tone]}`}
                  >
                    {status.badge}
                  </span>
                )}
              </div>

              <div>
                <div className="text-[15px] font-semibold">{section.label}</div>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{status.detail || section.description}</p>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Audit, demoted to one line. It was ten cards at the top of EVERY configuration screen. */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--color-border-light)] bg-card px-4 py-3">
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <History className="size-4" aria-hidden="true" />
          {lastChange ? (
            <>
              Last change: <span className="text-foreground">{lastChange.action}</span> by {lastChange.actor},{" "}
              {relativeTime(lastChange.ts).toLowerCase()}
            </>
          ) : (
            "No configuration changes recorded yet."
          )}
        </p>
        <Link href="/admin/audit-log" className="text-[13px] font-medium text-[var(--color-blue)] hover:underline">
          View audit log →
        </Link>
      </div>
    </div>
  );
}
