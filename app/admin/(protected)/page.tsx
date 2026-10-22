import { StatusChip } from "@/components/ui/status-chip";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import { LiveStamp } from "@/components/ui/live-stamp";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile, type MeterTone } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { DashboardUtcTime } from "@/components/admin/dashboard-utc-time";
import { pillTone } from "@/lib/ui/pillTone";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { ADMIN_ROLE_LABELS, type AdminRole } from "@/lib/adminAuth/roles";
import { startStepsFor, type HomeTile, type HomeTileTone } from "@/lib/adminDashboard/compose";
import { dailyChecksFor, dailySummary, type DailyCheckStatus } from "@/lib/adminDashboard/dailyChecks";
import { fetchDailyCheckInput } from "@/lib/adminDashboard/dailyQueries";
import { DashboardRefresh } from "@/components/admin/dashboard-refresh";
import type { StatusTone } from "@/components/ui/status-chip";
import { activeAdminsByRole, formatUtcDateTime, plural } from "@/lib/adminDashboard/figures";
import { fetchHomeTiles } from "@/lib/adminDashboard/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** The board writes role names in sentence case ("Super admin"); the shared labels are title case. */
function roleLabel(role: AdminRole) {
  const label = ADMIN_ROLE_LABELS[role];
  return label.charAt(0) + label.slice(1).toLowerCase();
}

/** A server render reads the clock once per request, which is the point. */
function readClock() {
  return new Date().toISOString();
}

const TILE_TONE: Record<HomeTileTone, MeterTone | undefined> = { default: undefined, success: "good", warning: "warning", error: "danger" };

const cardTitle = "m-0 text-title-sm leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]";
const factLabel = "text-xs leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const factValue = "mt-1 block text-sm leading-[1.5] font-semibold tracking-[-0.02em] tabular-nums text-[var(--ink)]";

/** LA-4.20: every figure opens the page that lists the rows behind it. */
function TileLink({ tile }: { tile: HomeTile }) {
  return (
    <Link href={tile.href} aria-label={tile.linkLabel} className="m-arrow inline-flex items-center gap-1 font-semibold text-[var(--accent-ink)] no-underline">
      Open
      <ArrowRight className="size-3" strokeWidth={2.4} aria-hidden="true" />
    </Link>
  );
}

const CHECK_CHIP: Record<DailyCheckStatus, { tone: StatusTone; label: string }> = {
  failing: { tone: "danger", label: "Failing" },
  look: { tone: "warning", label: "Look" },
  unknown: { tone: "neutral", label: "Couldn't check" },
  info: { tone: "info", label: "FYI" },
  clear: { tone: "good", label: "Clear" },
};

/**
 * Daily checks (owner, 2026-10-13: what an admin must check every single day to keep track). One row
 * per check — payments and billing, customers, sign-ins and the audit trail, the platform's own
 * jobs and sources — worst first, each with one line of what was found and the page that deals with
 * it, and only the checks whose page this role can open (lib/adminDashboard/dailyChecks.ts). It
 * covers everything the old "Needs attention" list did. Streams on its own: the platform reads
 * behind it are the slowest on the page.
 */
async function DailyChecks({ admin }: { admin: { id: string; role: AdminRole } }) {
  const checks = dailyChecksFor(admin.role, await fetchDailyCheckInput(admin));
  return (
    <TableCard title="Daily checks" description={dailySummary(checks)} action={<DashboardRefresh />}>
      <div className="overflow-x-auto">
        <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="w-[140px]">Status</th>
              <th scope="col">Check</th>
              <th scope="col" className="w-[110px]">Area</th>
              <th scope="col" className="text-right">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => (
              <tr key={check.key}>
                <td>
                  <StatusChip tone={CHECK_CHIP[check.status].tone} dot>
                    {CHECK_CHIP[check.status].label}
                  </StatusChip>
                </td>
                {/* The detail wraps: .portal-lead-table sets nowrap on every cell (unlayered, so a
                    utility class cannot undo it). */}
                <td style={{ whiteSpace: "normal" }}>
                  <span className="block font-semibold text-[var(--ink)]">{check.title}</span>
                  <span className="block text-[var(--body)]">{check.detail}</span>
                </td>
                <td className="text-[var(--muted)]">{check.area}</td>
                <td className="text-right">
                  <Button asChild size="sm" variant="outline">
                    <Link href={check.href}>{check.actionLabel}</Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TableCard>
  );
}

export default async function AdminDashboardPage() {
  const admin = await getCurrentAdmin();
  const renderedAt = readClock();

  const supabase = getSupabaseServiceClient();
  const [{ data: rows, error }, tiles] = await Promise.all([
    supabase.from("admin_users").select("role, is_active"),
    admin ? fetchHomeTiles({ id: admin.id, role: admin.role }) : [],
  ]);

  // Without this the dashboard greets a failed query with no admins at all, which is both wrong and
  // impossible — somebody is logged in reading it.
  if (error) throw new Error(`Could not load admin counts: ${error.message}`);

  const admins = (rows ?? []) as { role: AdminRole; is_active: boolean }[];
  const byRole = activeAdminsByRole(admins);
  const deactivated = admins.filter((row) => !row.is_active).length;
  const signedIn = formatUtcDateTime(admin?.last_login_at);
  // Only the pages this role can open — the nav's own gate (lib/adminNav/build.ts).
  const steps = admin ? startStepsFor(admin.role) : [];

  return (
    <DashboardStage>
      <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
        <PageHeader title="Platform administration" actions={<LiveStamp updatedAt={renderedAt} />} />

        {tiles.length > 0 && (
          <StatStrip label="Platform figures">
            {tiles.map((tile) => (
              <StatTile
                key={tile.key}
                label={tile.label}
                value={tile.value}
                valueSize={tile.valueSize}
                valueTone={TILE_TONE[tile.tone ?? "default"]}
                delta={tile.delta}
                footnote={tile.footnote}
                action={<TileLink tile={tile} />}
              />
            ))}
          </StatStrip>
        )}

        {admin && (
          <Suspense
            fallback={
              <TableCard title="Daily checks">
                <SectionLoading rows={8} columns={4} label="Running today's checks" />
              </TableCard>
            }
          >
            <DailyChecks admin={{ id: admin.id, role: admin.role }} />
          </Suspense>
        )}

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          {steps.length > 0 && (
            <Card className="min-w-0 gap-0 px-6" aria-labelledby="start-here-title">
              <h2 id="start-here-title" className={`${cardTitle} mb-3`}>
                Start here
              </h2>

              {steps.map((step, index) => (
                <details key={step.title} className="group border-t border-[var(--border)] py-3.5" open={step.open}>
                  <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex -rotate-90 text-[var(--muted)] transition-transform duration-150 group-open:rotate-0 motion-reduce:transition-none" aria-hidden="true">
                      <ChevronDown className="size-[13px]" strokeWidth={2.4} />
                    </span>
                    <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs leading-[1.5] font-semibold tracking-[-0.01em] tabular-nums text-[var(--ink)]">
                      {index + 1}
                    </span>
                    <span className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{step.title}</span>
                  </summary>

                  {step.links.map((link) => (
                    <div key={link.href} className="flex items-center gap-3 border-t border-[var(--border)] py-2.5">
                      <span className="flex-1 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]">{link.label}</span>
                      <Link
                        href={link.href}
                        className="m-arrow inline-flex items-center gap-1.5 text-sm leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] no-underline"
                      >
                        Open<span className="sr-only"> {link.label}</span>
                        <ArrowRight className="size-[13px]" strokeWidth={2.4} aria-hidden="true" />
                      </Link>
                    </div>
                  ))}
                </details>
              ))}
            </Card>
          )}

          <Card className="min-w-0 gap-0 px-6" aria-labelledby="admins-by-role-title">
            <h2 id="admins-by-role-title" className={cardTitle}>
              Admins by role
            </h2>
            <div className="mt-3.5 flex flex-wrap gap-2">
              {byRole.map(({ role, count }) => (
                <StatusChip key={role} tone={pillTone(role === "super_admin" ? "info" : "neutral")} dot>
                  {roleLabel(role)} &middot; {count.toLocaleString("en-US")}
                </StatusChip>
              ))}
              {byRole.length === 0 && (
                <p className="text-sm leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">No active admins.</p>
              )}
            </div>
            {deactivated > 0 && (
              <p className="mt-2 text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                {plural(deactivated, "deactivated account is", "deactivated accounts are")} not counted.
              </p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <div className={factLabel}>Your role</div>
                <span className={factValue}>{admin ? roleLabel(admin.role) : "—"}</span>
              </div>
              <div>
                <div className={factLabel}>Signed in</div>
                {admin?.last_login_at && signedIn ? (
                  <DashboardUtcTime iso={admin.last_login_at} text={signedIn} className={factValue} />
                ) : (
                  <span className={factValue}>First sign-in</span>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </DashboardStage>
  );
}
