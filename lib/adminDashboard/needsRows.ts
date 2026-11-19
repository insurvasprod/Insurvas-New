import "server-only";

import { readPlatformState } from "@/lib/adminAlerts/service";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { fetchAllSwitches } from "@/lib/features/killSwitch";
import { formatCentsAsCurrency } from "@/lib/money";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { TRIAL_CHASE_DAYS } from "./dailyChecks";
import { ago } from "./healthJobs";
import { staffChangesToday } from "./securityQueries";
import { shortDay } from "./statusLine";

/**
 * The rows behind a daily check, for Needs you's right pane (admin round 1 §2): the trials ending with their
 * plan, end, last sign-in and card; the events waiting; the invoices to chase. Read only for the check the
 * pane shows, at most ROW_LIMIT rows, newest or worst first; `total` is the full count, so the pane can say
 * "and 23 more" and send the rest to the check's page.
 *
 * Read-only. Every read throws on a database error: the pane says it could not load rather than drawing an
 * empty table, which would read as "nothing to do".
 */

// Several of these tables and views (admin_trials_in_flight, webhook_events, feature_switches) are not in
// the generated types; the access stays untyped here, as in lib/adminAlerts/service.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

export const ROW_LIMIT = 25;

export type NeedsChip = { label: string; tone: "danger" | "warning" | "neutral" | "good" };
export type NeedsRow = { key: string; cells: string[]; chip?: NeedsChip; href: string | null };
export type NeedsTable = { columns: Array<{ label: string; align?: "right" }>; rows: NeedsRow[]; total: number };

type Result<T> = { data: T | null; error: { message: string } | null; count?: number | null };

function rowsOf<T>(result: Result<T[]>, label: string): T[] {
  if (result.error) throw new Error(`Could not load ${label}: ${result.error.message}`);
  return result.data ?? [];
}

const dayAgo = () => new Date(Date.now() - 86_400_000).toISOString();
const isoDay = (iso: string | null) => (iso ? shortDay(iso.slice(0, 10)) : "—");

/** Which checks have rows to show. The rest (sign-ins, metrics, maintenance…) are one figure: the pane explains them. */
export const CHECKS_WITH_ROWS = new Set(["trials", "webhooks", "past-due", "overdue", "mismatched", "seats", "compliance", "signups", "cancellations", "suspended", "staff-changes", "features"]);

export async function needsRowsFor(key: string, admin: { id: string; role: AdminRole }): Promise<NeedsTable | null> {
  const now = Date.now();
  switch (key) {
    case "trials": {
      const result: Result<Array<{ tenant_id: string; tenant_name: string; plan_name: string | null; trial_ends_at: string; days_remaining: number; last_login_at: string | null; has_payment_method: boolean }>> = await db()
        .from("admin_trials_in_flight")
        .select("tenant_id, tenant_name, plan_name, trial_ends_at, days_remaining, last_login_at, has_payment_method", { count: "exact" })
        .lte("days_remaining", TRIAL_CHASE_DAYS)
        // No card first: those are the ones that will not convert by themselves.
        .order("has_payment_method", { ascending: true })
        .order("days_remaining", { ascending: true })
        .limit(ROW_LIMIT);
      const rows = rowsOf(result, "trials ending");
      return {
        columns: [{ label: "Customer" }, { label: "Plan" }, { label: "Ends" }, { label: "Signed in" }, { label: "Card" }],
        total: result.count ?? rows.length,
        rows: rows.map((row) => ({
          key: row.tenant_id,
          cells: [row.tenant_name ?? "—", row.plan_name ?? "—", row.days_remaining < 0 ? "Ended" : row.days_remaining === 0 ? "Today" : row.days_remaining === 1 ? "Tomorrow" : isoDay(row.trial_ends_at), row.last_login_at ? ago(row.last_login_at, now) : "Never"],
          chip: row.has_payment_method ? { label: "Card on file", tone: "good" } : { label: "No card", tone: "warning" },
          href: `/admin/tenants/${row.tenant_id}`,
        })),
      };
    }
    case "webhooks": {
      const result: Result<Array<{ event_id: string; provider: string | null; event_type: string | null; received_at: string; process_error: string | null }>> = await db()
        .from("webhook_events")
        .select("event_id, provider, event_type, received_at, process_error", { count: "exact" })
        .is("processed_at", null)
        .order("received_at", { ascending: true })
        .limit(ROW_LIMIT);
      const rows = rowsOf(result, "waiting payment events");
      return {
        columns: [{ label: "Event" }, { label: "Provider" }, { label: "Received" }, { label: "Last error" }],
        total: result.count ?? rows.length,
        rows: rows.map((row) => ({ key: row.event_id, cells: [row.event_type ?? row.event_id, row.provider ?? "—", ago(row.received_at, now), row.process_error?.slice(0, 80) ?? "None recorded"], href: "/admin/payments" })),
      };
    }
    case "past-due": {
      const result: Result<Array<{ id: string; tenant_id: string; current_period_end: string | null; tenants: { name: string } | null; plan: { name: string } | null }>> = await db()
        .from("subscriptions")
        .select("id, tenant_id, current_period_end, tenants(name), plan:plans!subscriptions_plan_id_fkey(name)", { count: "exact" })
        .eq("status", "past_due")
        .order("current_period_end", { ascending: true })
        .limit(ROW_LIMIT);
      const rows = rowsOf(result, "past-due subscriptions");
      return {
        columns: [{ label: "Customer" }, { label: "Plan" }, { label: "Period ended" }],
        total: result.count ?? rows.length,
        rows: rows.map((row) => ({ key: row.id, cells: [row.tenants?.name ?? "—", row.plan?.name ?? "—", isoDay(row.current_period_end)], chip: { label: "Past due", tone: "warning" }, href: `/admin/tenants/${row.tenant_id}` })),
      };
    }
    case "overdue":
    case "mismatched": {
      const query = db()
        .from("platform_invoices")
        .select("id, number, total_cents, provider_total_cents, due_at, created_at, tenants(name)", { count: "exact" });
      const result: Result<Array<{ id: string; number: string; total_cents: number; provider_total_cents: number | null; due_at: string | null; created_at: string; tenants: { name: string } | null }>> =
        key === "overdue"
          ? await query.eq("status", "overdue").order("due_at", { ascending: true }).limit(ROW_LIMIT)
          : await query.eq("reconciliation", "mismatched").order("created_at", { ascending: false }).limit(ROW_LIMIT);
      const rows = rowsOf(result, key === "overdue" ? "overdue invoices" : "invoices that don't match");
      return key === "overdue"
        ? {
            columns: [{ label: "Invoice" }, { label: "Customer" }, { label: "Amount", align: "right" }, { label: "Due" }],
            total: result.count ?? rows.length,
            rows: rows.map((row) => ({ key: row.id, cells: [row.number, row.tenants?.name ?? "—", formatCentsAsCurrency(row.total_cents), isoDay(row.due_at)], chip: { label: "Overdue", tone: "warning" }, href: `/admin/invoices/${row.id}` })),
          }
        : {
            columns: [{ label: "Invoice" }, { label: "Customer" }, { label: "Invoiced", align: "right" }, { label: "Provider charged", align: "right" }],
            total: result.count ?? rows.length,
            rows: rows.map((row) => ({
              key: row.id,
              cells: [row.number, row.tenants?.name ?? "—", formatCentsAsCurrency(row.total_cents), row.provider_total_cents === null ? "—" : formatCentsAsCurrency(row.provider_total_cents)],
              href: `/admin/invoices/${row.id}`,
            })),
          };
    }
    case "seats":
    case "compliance": {
      const state = await readPlatformState(now);
      if (key === "seats") {
        if (!state.seatLimited) throw new Error("Could not load seat limits");
        return {
          columns: [{ label: "Customer" }, { label: "Seats used", align: "right" }, { label: "Invites waiting", align: "right" }],
          total: state.seatLimited.length,
          rows: state.seatLimited.slice(0, ROW_LIMIT).map((row) => ({ key: row.tenantId, cells: [row.tenantName, `${row.used} of ${row.max}`, String(row.pendingInvites)], href: `/admin/tenants/${row.tenantId}` })),
        };
      }
      if (!state.failingSources) throw new Error("Could not load compliance sources");
      return {
        columns: [{ label: "Source" }, { label: "Failures today", align: "right" }, { label: "Last answered" }],
        total: state.failingSources.length,
        rows: state.failingSources.slice(0, ROW_LIMIT).map((row) => ({ key: row.name, cells: [row.name, String(row.failures24h), row.lastSuccessAt ? ago(row.lastSuccessAt, now) : "Never"], chip: { label: "Not answering", tone: "danger" }, href: "/admin/compliance-sources" })),
      };
    }
    case "signups":
    case "suspended": {
      const query = db().from("tenants").select("id, name, plan_code, created_at, suspended_at", { count: "exact" });
      const result: Result<Array<{ id: string; name: string; plan_code: string | null; created_at: string; suspended_at: string | null }>> =
        key === "signups"
          ? await query.gte("created_at", dayAgo()).order("created_at", { ascending: false }).limit(ROW_LIMIT)
          : await query.eq("status", "suspended").order("suspended_at", { ascending: false }).limit(ROW_LIMIT);
      const rows = rowsOf(result, key === "signups" ? "new sign-ups" : "suspended customers");
      return key === "signups"
        ? { columns: [{ label: "Customer" }, { label: "Plan" }, { label: "Signed up" }], total: result.count ?? rows.length, rows: rows.map((row) => ({ key: row.id, cells: [row.name, row.plan_code ?? "—", ago(row.created_at, now)], href: `/admin/tenants/${row.id}` })) }
        : { columns: [{ label: "Customer" }, { label: "Suspended" }], total: result.count ?? rows.length, rows: rows.map((row) => ({ key: row.id, cells: [row.name, row.suspended_at ? isoDay(row.suspended_at) : "—"], chip: { label: "Suspended", tone: "neutral" }, href: `/admin/tenants/${row.id}` })) };
    }
    case "cancellations": {
      const result: Result<Array<{ id: string; tenant_id: string; cancelled_at: string; cancel_reason: string | null; tenants: { name: string } | null }>> = await db()
        .from("subscriptions")
        .select("id, tenant_id, cancelled_at, cancel_reason, tenants(name)", { count: "exact" })
        .gte("cancelled_at", dayAgo())
        .order("cancelled_at", { ascending: false })
        .limit(ROW_LIMIT);
      const rows = rowsOf(result, "cancellations");
      return {
        columns: [{ label: "Customer" }, { label: "Cancelled" }, { label: "Reason" }],
        total: result.count ?? rows.length,
        rows: rows.map((row) => ({ key: row.id, cells: [row.tenants?.name ?? "—", ago(row.cancelled_at, now), row.cancel_reason?.slice(0, 80) ?? "None given"], href: `/admin/tenants/${row.tenant_id}` })),
      };
    }
    case "staff-changes": {
      const changes = await staffChangesToday(admin.id, admin.role);
      return {
        columns: [{ label: "Who" }, { label: "What" }, { label: "When" }],
        total: changes.total,
        rows: changes.rows.map((row) => ({ key: row.id, cells: [row.who, row.what, row.time], href: "/admin/audit-log" })),
      };
    }
    case "features": {
      const switches = await fetchAllSwitches();
      const off = [...switches.values()].filter((item) => item.state === "off");
      const labels: Result<Array<{ feature_key: string; label: string }>> = off.length
        ? await db().from("features").select("feature_key, label").in("feature_key", off.map((item) => item.feature_key))
        : { data: [], error: null };
      const names = new Map(rowsOf(labels, "feature names").map((row) => [row.feature_key, row.label]));
      return {
        columns: [{ label: "Feature" }, { label: "Switched off" }, { label: "What customers see" }],
        total: off.length,
        rows: off.slice(0, ROW_LIMIT).map((item) => ({
          key: item.feature_key,
          cells: [names.get(item.feature_key) ?? item.feature_key, item.updated_at ? ago(item.updated_at, now) : "—", item.off_message?.slice(0, 80) ?? "The default message"],
          chip: { label: "Off", tone: "neutral" },
          href: "/admin/features",
        })),
      };
    }
    default:
      return null;
  }
}
