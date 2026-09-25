import "server-only";

// Everything the admin Trials page shows (board p-adm-trials), read once per request.
//
// A new module rather than an edit to lib/trials/queries.ts: that file's fetchTrials() also feeds
// the staff alerts (lib/adminAlerts/service.ts), and its TrialRow shape is theirs to keep.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  COHORT_DAYS,
  DAY_MS,
  ENDING_SOON_DAYS,
  NO_SIGNALS,
  calendarDaysLeft,
  earliest,
  trialConverted,
  monthOutcome,
  secondEarliest,
  separation,
  signalsAt,
  trialFullUtc,
  trialShortDate,
  type CohortTrial,
  type MonthOutcome,
  type Separation,
  type SignalKey,
  type SignalMoments,
} from "@/lib/trials/boardModel";

export type TrialEngagement = { level: "at_risk" | "quiet" | "engaged"; label: string };

export type TrialBoardRow = {
  subscriptionId: string;
  tenantId: string;
  /** The trading name when the business profile has one, else the tenant's name. */
  displayName: string;
  tenantName: string;
  planName: string;
  billingCycle: string;
  startedAt: string;
  trialEndsAt: string;
  startedLabel: string;
  startedFull: string;
  endsLabel: string;
  endsFull: string;
  daysLeft: number;
  daysElapsed: number;
  overdue: boolean;
  ownerName: string | null;
  ownerEmail: string | null;
  lastLoginFull: string | null;
  engagement: TrialEngagement;
  hasPaymentMethod: boolean;
  /** Null when the signal tables could not be read — shown as unknown, never as "not done". */
  signals: Record<SignalKey, boolean> | null;
  /** When each signal was first reached, formatted, for the hover text. */
  signalDates: Record<SignalKey, string | null>;
};

export type TrialsBoard = {
  rows: TrialBoardRow[];
  figures: {
    inTrial: number;
    planCount: number;
    endingSoon: number;
    month: MonthOutcome;
  };
  separation: Separation | null;
  /** The in-flight trial with the fewest days left that has neither imported leads nor a second user. */
  spotlight: { name: string; daysLeft: number; overdue: boolean; others: number } | null;
  signalsAvailable: boolean;
  /** The subscriptions behind the month figures could be read. */
  statsAvailable: boolean;
  /** The in-flight list itself could not be read. */
  listError: boolean;
};

type ViewRow = {
  subscription_id: string;
  tenant_id: string;
  tenant_name: string;
  plan_name: string;
  billing_cycle: string;
  started_at: string;
  trial_ends_at: string;
  owner_email: string | null;
  owner_name: string | null;
  last_login_at: string | null;
  has_payment_method: boolean | null;
  business_name: string | null;
};

type SubRow = {
  id: string;
  tenant_id: string;
  status: string;
  started_at: string;
  trial_ends_at: string;
  cancelled_at: string | null;
  trial_outcome?: string | null;
  trial_outcome_at?: string | null;
};

type Result<T> = { data: T[] | null; error: { message: string } | null };

const PAGE = 1000;
/** Tenant ids per `in (...)` filter — keeps the request URL well under PostgREST's limits. */
const CHUNK = 60;

/** Reads every page of a query (PostgREST caps a response at 1000 rows). Null on any error. */
async function readAllPages<T>(read: (from: number, to: number) => PromiseLike<Result<T>>): Promise<T[] | null> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) {
      console.error("[trials board] read failed:", error.message);
      return null;
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** The same, over a list of tenant ids split into chunks. */
async function readForTenants<T>(
  ids: readonly string[],
  read: (chunk: string[], from: number, to: number) => PromiseLike<Result<T>>,
): Promise<T[] | null> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const results = await Promise.all(chunks.map((chunk) => readAllPages<T>((from, to) => read(chunk, from, to))));
  if (results.some((rows) => rows === null)) return null;
  return results.flatMap((rows) => rows ?? []);
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/**
 * Whether this trial looks like it will convert, from the owner's last sign-in (kept from the page
 * this replaces). Worked out on the server so the label cannot differ between render and hydration.
 */
function engagementFor(lastLoginAt: string | null, daysLeft: number, now: Date): TrialEngagement {
  if (!lastLoginAt) {
    return daysLeft <= 7 ? { level: "at_risk", label: "Never signed in" } : { level: "quiet", label: "Not signed in yet" };
  }
  const daysSince = Math.max(0, Math.floor((now.getTime() - new Date(lastLoginAt).getTime()) / DAY_MS));
  if (daysSince >= 5) return { level: "quiet", label: `Last seen ${daysSince}d ago` };
  return { level: "engaged", label: daysSince === 0 ? "Active today" : `Active ${daysSince}d ago` };
}

export async function fetchTrialsBoard(now: Date = new Date()): Promise<TrialsBoard> {
  const supabase = getSupabaseServiceClient();

  // trial_outcome(_at) arrive with 20260925502000; until it is applied the read falls back to the
  // columns every database has, and every ended trial is inferred as before.
  const readSubs = (columns: string) =>
    readAllPages<SubRow>((from, to) =>
      supabase
        .from("subscriptions")
        .select(columns)
        .not("trial_ends_at", "is", null)
        .order("id")
        .range(from, to) as unknown as PromiseLike<Result<SubRow>>,
    );
  const [viewResult, withOutcome] = await Promise.all([
    supabase.from("admin_trials_in_flight").select("*").order("trial_ends_at", { ascending: true }),
    readSubs("id, tenant_id, status, started_at, trial_ends_at, cancelled_at, trial_outcome, trial_outcome_at"),
  ]);
  const subs = withOutcome ?? (await readSubs("id, tenant_id, status, started_at, trial_ends_at, cancelled_at"));

  if (viewResult.error) console.error("[trials board] in-flight view failed:", viewResult.error.message);
  const view = ((viewResult.data ?? []) as ViewRow[]).filter((row) => row.trial_ends_at);
  const allSubs = subs ?? [];

  const windowStart = now.getTime() - COHORT_DAYS * DAY_MS;
  const ended = allSubs.filter((s) => s.status !== "trialing");
  const cohortSubs = ended.filter((s) => new Date(s.started_at).getTime() >= windowStart);
  const convertedSubs = ended.filter((s) => trialConverted(s));

  const signalTenants = [...new Set([...view.map((r) => r.tenant_id), ...cohortSubs.map((s) => s.tenant_id)])];
  const paidTenants = [...new Set(convertedSubs.map((s) => s.tenant_id))];

  type MemberRow = { tenant_id: string; role: string; invited_at: string | null; accepted_at: string | null; users: unknown };
  type AtRow = { tenant_id: string; at: string | null };

  const [members, carriers, imports, payments] = await Promise.all([
    readForTenants<MemberRow>(signalTenants, (chunk, from, to) =>
      supabase
        .from("tenant_users")
        .select("tenant_id, role, invited_at, accepted_at, users(last_login_at)")
        .in("tenant_id", chunk)
        .order("tenant_id")
        .order("user_id")
        .range(from, to) as unknown as PromiseLike<Result<MemberRow>>,
    ),
    readForTenants<AtRow>(signalTenants, (chunk, from, to) =>
      supabase
        .from("tenant_carriers")
        .select("tenant_id, at:created_at")
        .in("tenant_id", chunk)
        .order("id")
        .range(from, to) as unknown as PromiseLike<Result<AtRow>>,
    ),
    readForTenants<AtRow & { created_at: string }>(signalTenants, (chunk, from, to) =>
      supabase
        .from("agent_lead_import_batches")
        .select("tenant_id, at:completed_at, created_at")
        .in("tenant_id", chunk)
        .eq("status", "completed")
        .order("id")
        .range(from, to) as unknown as PromiseLike<Result<AtRow & { created_at: string }>>,
    ),
    readForTenants<AtRow>(paidTenants, (chunk, from, to) =>
      supabase
        .from("payments")
        .select("tenant_id, at:paid_at")
        .in("tenant_id", chunk)
        .eq("status", "succeeded")
        .order("id")
        .range(from, to) as unknown as PromiseLike<Result<AtRow>>,
    ),
  ]);

  const signalsAvailable = members !== null && carriers !== null && imports !== null;

  const membersBy = groupBy(members ?? [], (m) => m.tenant_id);
  const carriersBy = groupBy(carriers ?? [], (c) => c.tenant_id);
  const importsBy = groupBy(imports ?? [], (i) => i.tenant_id);
  const paymentsBy = groupBy(payments ?? [], (p) => p.tenant_id);

  const momentsFor = (tenantId: string): SignalMoments => {
    if (!signalsAvailable) return NO_SIGNALS;
    return {
      leads: earliest((importsBy.get(tenantId) ?? []).map((i) => i.at ?? i.created_at)),
      team: secondEarliest((membersBy.get(tenantId) ?? []).map((m) => m.invited_at ?? m.accepted_at)),
      carrier: earliest((carriersBy.get(tenantId) ?? []).map((c) => c.at)),
    };
  };

  const ownerSignedIn = (tenantId: string): boolean =>
    (membersBy.get(tenantId) ?? []).some((m) => {
      if (m.role !== "owner") return false;
      const user = (Array.isArray(m.users) ? m.users[0] : m.users) as { last_login_at?: string | null } | null | undefined;
      return Boolean(user?.last_login_at);
    });

  const firstPaidAt = (sub: SubRow): string | null => {
    // Payments are only read for converted tenants; a failed read leaves conversions dated by the
    // trial end, which is what trialEndedAt falls back to anyway.
    const started = new Date(sub.started_at).getTime();
    return earliest(
      (paymentsBy.get(sub.tenant_id) ?? [])
        .map((p) => p.at)
        .filter((at): at is string => Boolean(at) && new Date(at as string).getTime() >= started),
    );
  };

  const rows: TrialBoardRow[] = view
    .map((row) => {
      const daysLeft = calendarDaysLeft(row.trial_ends_at, now);
      const moments = momentsFor(row.tenant_id);
      const reached = signalsAvailable ? signalsAt(moments, now) : null;
      const elapsed = Math.max(0, Math.floor((now.getTime() - new Date(row.started_at).getTime()) / DAY_MS));
      return {
        subscriptionId: row.subscription_id,
        tenantId: row.tenant_id,
        displayName: row.business_name?.trim() || row.tenant_name,
        tenantName: row.tenant_name,
        planName: row.plan_name,
        billingCycle: row.billing_cycle,
        startedAt: row.started_at,
        trialEndsAt: row.trial_ends_at,
        startedLabel: trialShortDate(row.started_at, now),
        startedFull: trialFullUtc(row.started_at),
        endsLabel: trialShortDate(row.trial_ends_at, now),
        endsFull: trialFullUtc(row.trial_ends_at),
        daysLeft,
        daysElapsed: elapsed,
        overdue: new Date(row.trial_ends_at).getTime() < now.getTime(),
        ownerName: row.owner_name,
        ownerEmail: row.owner_email,
        lastLoginFull: row.last_login_at ? trialFullUtc(row.last_login_at) : null,
        engagement: engagementFor(row.last_login_at, daysLeft, now),
        hasPaymentMethod: Boolean(row.has_payment_method),
        signals: reached,
        signalDates: {
          leads: moments.leads ? trialFullUtc(moments.leads) : null,
          team: moments.team ? trialFullUtc(moments.team) : null,
          carrier: moments.carrier ? trialFullUtc(moments.carrier) : null,
        },
      } satisfies TrialBoardRow;
    })
    // "Fewest days remaining first", ties by the exact end.
    .sort((a, b) => a.daysLeft - b.daysLeft || a.trialEndsAt.localeCompare(b.trialEndsAt));

  const endedInputs = ended.map((s) => ({ ...s, first_paid_at: trialConverted(s) ? firstPaidAt(s) : null }));

  const cohort: CohortTrial[] = cohortSubs.map((s) => ({
    ...s,
    first_paid_at: trialConverted(s) ? firstPaidAt(s) : null,
    signals: momentsFor(s.tenant_id),
    owner_signed_in: ownerSignedIn(s.tenant_id),
  }));

  const neither = rows.filter((r) => r.signals && !r.signals.leads && !r.signals.team);
  const first = neither[0];

  return {
    rows,
    figures: {
      inTrial: rows.length,
      planCount: new Set(rows.map((r) => r.planName)).size,
      endingSoon: rows.filter((r) => r.daysLeft <= ENDING_SOON_DAYS).length,
      month: monthOutcome(endedInputs, now),
    },
    separation: subs !== null && signalsAvailable ? separation(cohort, now) : null,
    spotlight: first ? { name: first.displayName, daysLeft: first.daysLeft, overdue: first.overdue, others: neither.length - 1 } : null,
    signalsAvailable,
    statsAvailable: subs !== null,
    listError: Boolean(viewResult.error),
  };
}
