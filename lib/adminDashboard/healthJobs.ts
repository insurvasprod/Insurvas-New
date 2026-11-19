// Admin dashboard › Platform health (admin round 1, docs/design/admin-r1/dashboard-combined.html §5): every
// scheduled job and outside service the platform can see, one line each — what it does, when it last worked,
// how often it should run, and whether it is working. Plain module: the reads are in healthQueries.ts, and
// every verdict here is decided from values they hand over, so each branch is testable.
//
// Three sources of truth, each the one the platform already keeps:
//   - its own records: the metrics snapshot, the billing heartbeat, payment events, compliance sources, the
//     email log, the transfer ladder's run table;
//   - app_cron_status() (20261015500000): every /api/cron route the database calls, and the answer it got;
//   - admin_cron_job_status() (20261117310000, pending): the database's own pg_cron jobs. Until it is
//     applied those jobs are listed honestly as "not watched yet".

export type HealthStatus = "failing" | "look" | "unknown" | "not_watched" | "working";

export const HEALTH_CHIP: Record<HealthStatus, { label: string; tone: "danger" | "warning" | "neutral" | "good" }> = {
  failing: { label: "Failing", tone: "danger" },
  look: { label: "Look", tone: "warning" },
  unknown: { label: "Couldn't check", tone: "neutral" },
  not_watched: { label: "Not watched yet", tone: "neutral" },
  working: { label: "Working", tone: "good" },
};

const STATUS_ORDER: Record<HealthStatus, number> = { failing: 0, look: 1, unknown: 2, not_watched: 3, working: 4 };

export type HealthRow = {
  key: string;
  name: string;
  does: string;
  /** "Sep 21", "12 min ago", "Never", "—". */
  lastWorked: string;
  shouldRun: string;
  status: HealthStatus;
  /** One sentence on why: shown under the name's hover and to screen readers. */
  reason: string;
  /** The page that deals with it, when there is one. */
  href: string | null;
};

export type AppCronRun = {
  path: string;
  lastDispatchedAt: string | null;
  skippedReason: string | null;
  httpStatus: number | null;
  timedOut: boolean | null;
};

export type DbCronJob = {
  jobname: string;
  schedule: string;
  active: boolean;
  lastStartAt: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
  lastSucceededAt: string | null;
};

/** Every input is null when its read failed. */
export type HealthInput = {
  now: number;
  snapshot: { date: string | null; ageDays: number | null } | null;
  billing: { healthy: boolean; lastRunAt: string | null; description: string } | null;
  payments: { stuck: number; oldestReceivedAt: string | null; lastProcessedAt: string | null } | null;
  sources: { enabled: number; failing: string[]; lastSuccessAt: string | null } | null;
  email: { lastSentAt: string | null; sent24h: number; failed24h: number } | null;
  ladder: { lastRunAt: string | null; ok: boolean | null; error: string | null } | null;
  appCron: AppCronRun[] | null;
  /** "missing" until 20261117310000 is applied. */
  dbCron: DbCronJob[] | "missing" | null;
};

/** A payment event unprocessed this long is failing, as the daily check (WEBHOOK_STUCK_MINUTES). */
const PAYMENT_STUCK_MINUTES = 10;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 min ago", "5 hours ago", "Sep 21": the age a reader takes in at a glance. Exported for the tests. */
export function ago(iso: string | null, now: number): string {
  if (!iso) return "Never";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "—";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const date = new Date(at);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function dayText(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return match ? `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}` : date;
}

function minutesSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : Math.max(0, (now - at) / 60_000);
}

/**
 * The /api/cron routes the database calls (app_cron_paths()), in plain words. `every` is the schedule in
 * minutes, so a route not called for twice that long is late. Routes folded into a richer row above
 * (metrics, billing, the transfer ladder) say so with `foldInto`.
 */
export const APP_JOBS: Record<string, { name: string; does: string; shouldRun: string; every: number; href: string | null; foldInto?: string }> = {
  "/api/cron/period-billing": { name: "Billing run", does: "Raises invoices for the period", shouldRun: "Every day", every: 1440, href: "/admin/invoices", foldInto: "billing" },
  "/api/cron/metrics-daily": { name: "Nightly metrics", does: "Revenue and customer figures", shouldRun: "Every night", every: 1440, href: "/admin/revenue", foldInto: "metrics" },
  "/api/cron/unclaimed-sla": { name: "Unclaimed-transfer emails", does: "Emails the ladder's escalations", shouldRun: "Every minute", every: 1, href: null },
  "/api/cron/invoices-overdue": { name: "Overdue invoices", does: "Marks unpaid invoices overdue", shouldRun: "Every day", every: 1440, href: "/admin/invoices" },
  "/api/cron/trial-reminders": { name: "Trial reminders", does: "Emails trials about to end", shouldRun: "Every day", every: 1440, href: "/admin/trials" },
  "/api/cron/notifications": { name: "Notification emails", does: "Sends the outbox and digests", shouldRun: "Every 5 minutes", every: 5, href: "/admin/email" },
  "/api/cron/webhooks": { name: "Agency webhooks", does: "Sends and retries agencies' webhooks", shouldRun: "Every minute", every: 1, href: null },
  "/api/cron/callback-reminders": { name: "Callback reminder emails", does: "Due-callback emails to agents", shouldRun: "Every 5 minutes", every: 5, href: null },
  "/api/cron/calendar-busy": { name: "Calendar sync", does: "Reads agents' busy times", shouldRun: "Every 15 minutes", every: 15, href: null },
  "/api/cron/licence-lapse": { name: "Licence lapses", does: "Flags lapsed agent licences", shouldRun: "Every hour", every: 60, href: null },
  "/api/cron/complaint-deadlines": { name: "Complaint deadlines", does: "Warns of regulator deadlines", shouldRun: "Every day", every: 1440, href: null },
  "/api/cron/compliance-monthly": { name: "Monthly compliance email", does: "Sends agencies' compliance summary", shouldRun: "Every day", every: 1440, href: null },
  "/api/cron/retention-summary": { name: "Retention summary", does: "Summarises what retention would delete", shouldRun: "Every day", every: 1440, href: null },
  "/api/cron/deletion-perform": { name: "Consumer deletions", does: "Carries out due deletion requests", shouldRun: "Every hour", every: 60, href: null },
  "/api/cron/pipeline-rules": { name: "Pipeline rules", does: "Moves leads by agencies' rules", shouldRun: "Every day", every: 1440, href: null },
};

/** The database's own jobs in plain words; any job not named here is listed by its own name. */
export const DB_JOBS: Record<string, { name: string; does: string }> = {
  "callback-due": { name: "Callback due times", does: "Marks callbacks due for agents" },
  "callback-in-app-reminders": { name: "Callback reminders", does: "Due-callback alerts to agents" },
  "unclaimed-sla-side-effects": { name: "Unclaimed-transfer ladder", does: "Escalates waiting transfers" },
  "assignment-rotation": { name: "Lead rotation", does: "Hands out leads by the rotation" },
  "appointment-in-app-reminders": { name: "Appointment reminders", does: "Appointment alerts to agents" },
  "appointment-close-out": { name: "Appointment close-out", does: "Closes appointments that passed" },
  "la4-carrier-file-poll": { name: "Carrier file poll", does: "Fetches carriers' policy files" },
  "la6-compliance-index-nightly": { name: "Compliance index", does: "Rebuilds the compliance index" },
};

/** Jobs that only tidy the run log are not worth a line. */
const HOUSEKEEPING = /log-cleanup$/;

/** What the database got back from calling an app route, as a verdict and a sentence. */
function appRunVerdict(run: AppCronRun, every: number, now: number): { status: HealthStatus; reason: string; worked: string | null } {
  if (!run.lastDispatchedAt) return { status: "failing", reason: "The database has never called it.", worked: null };
  if (run.skippedReason) return { status: "failing", reason: `Skipped: ${run.skippedReason}.`, worked: null };
  if (run.timedOut) return { status: "failing", reason: `Called ${ago(run.lastDispatchedAt, now)}; the app did not answer in time.`, worked: null };
  if (run.httpStatus !== null && run.httpStatus >= 200 && run.httpStatus < 300) {
    const late = (minutesSince(run.lastDispatchedAt, now) ?? 0) > Math.max(every * 2, every + 10);
    return late
      ? { status: "look", reason: `Not called since ${ago(run.lastDispatchedAt, now)}.`, worked: run.lastDispatchedAt }
      : { status: "working", reason: "The app answered the last call.", worked: run.lastDispatchedAt };
  }
  if (run.httpStatus === 401 || run.httpStatus === 403) {
    return { status: "failing", reason: `Called ${ago(run.lastDispatchedAt, now)}; the app refused it (${run.httpStatus}). The cron secret the database sends does not match the app's CRON_SECRET.`, worked: null };
  }
  if (run.httpStatus !== null) return { status: "failing", reason: `Called ${ago(run.lastDispatchedAt, now)}; the app answered ${run.httpStatus}.`, worked: null };
  return { status: "unknown", reason: `Called ${ago(run.lastDispatchedAt, now)}; the answer is no longer kept (the database keeps answers about six hours).`, worked: null };
}

export function healthRows(input: HealthInput): HealthRow[] {
  const { now } = input;
  const rows: HealthRow[] = [];
  const appRuns = new Map((input.appCron ?? []).map((run) => [run.path, run]));
  const refused = (input.appCron ?? []).some((run) => run.httpStatus === 401 || run.httpStatus === 403);
  /** A folded route's answer, as a clause after its own row's reason. */
  const callNote = (path: string) => {
    const run = appRuns.get(path);
    if (!run) return "";
    const verdict = appRunVerdict(run, APP_JOBS[path].every, now);
    if (verdict.status === "working") return "";
    if (verdict.status === "unknown" && refused) return ` ${verdict.reason.replace(/\.$/, "")}; other jobs called the same way are refused (401).`;
    return ` ${verdict.reason}`;
  };

  /* ── The platform's own records ── */
  const snapshot = input.snapshot;
  rows.push({
    key: "metrics", name: "Nightly metrics", does: "Revenue and customer figures", shouldRun: "Every night", href: "/admin/revenue",
    ...(snapshot === null
      ? { status: "unknown", lastWorked: "—", reason: "The metrics history could not be read just now." }
      : snapshot.date === null
        ? { status: "failing", lastWorked: "Never", reason: `No night has ever been computed.${callNote("/api/cron/metrics-daily")}` }
        : (snapshot.ageDays ?? 0) > 1
          ? { status: "failing", lastWorked: dayText(snapshot.date), reason: `Last computed ${dayText(snapshot.date)}, ${snapshot.ageDays} days ago.${callNote("/api/cron/metrics-daily")}` }
          : { status: "working", lastWorked: dayText(snapshot.date), reason: "Last night's figures are in." }),
  });

  const billing = input.billing;
  rows.push({
    key: "billing", name: "Billing run", does: "Raises invoices for the period", shouldRun: "Every day", href: "/admin/invoices",
    ...(billing === null
      ? { status: "unknown", lastWorked: "—", reason: "The billing heartbeat could not be read just now." }
      : billing.healthy
        ? { status: "working", lastWorked: ago(billing.lastRunAt, now), reason: billing.description }
        : { status: "failing", lastWorked: ago(billing.lastRunAt, now), reason: `${billing.description}${callNote("/api/cron/period-billing")}` }),
  });

  const payments = input.payments;
  const stuckFor = payments ? minutesSince(payments.oldestReceivedAt, now) : null;
  rows.push({
    key: "payments", name: "Payment events", does: "Reads what the provider sends", shouldRun: "As they arrive", href: "/admin/payments",
    ...(payments === null
      ? { status: "unknown", lastWorked: "—", reason: "The payment events could not be read just now." }
      : payments.stuck > 0 && (stuckFor ?? 0) >= PAYMENT_STUCK_MINUTES
        ? { status: "failing", lastWorked: ago(payments.lastProcessedAt, now), reason: `${payments.stuck} event${payments.stuck === 1 ? "" : "s"} waiting, the oldest since ${ago(payments.oldestReceivedAt, now)}.` }
        : { status: "working", lastWorked: ago(payments.lastProcessedAt, now), reason: payments.stuck ? "Events are arriving and being processed." : "Every event has been processed." }),
  });

  const sources = input.sources;
  rows.push({
    key: "compliance", name: "Compliance sources", does: "Do-not-call and consent lookups", shouldRun: "On every dial check", href: "/admin/compliance-sources",
    ...(sources === null
      ? { status: "unknown", lastWorked: "—", reason: "The compliance sources could not be read just now." }
      : sources.failing.length > 0
        ? { status: "failing", lastWorked: ago(sources.lastSuccessAt, now), reason: `Not answering: ${sources.failing.slice(0, 3).join(", ")}${sources.failing.length > 3 ? ` and ${sources.failing.length - 3} more` : ""}.` }
        : { status: "working", lastWorked: ago(sources.lastSuccessAt, now), reason: sources.enabled ? "No source has failed without answering in the last hour." : "No source is switched on." }),
  });

  const email = input.email;
  rows.push({
    key: "email", name: "Email sending", does: "Invites, receipts, alerts", shouldRun: "As needed", href: "/admin/email",
    ...(email === null
      ? { status: "unknown", lastWorked: "—", reason: "The email log could not be read just now." }
      : email.failed24h > 0 && email.sent24h === 0
        ? { status: "failing", lastWorked: ago(email.lastSentAt, now), reason: `${email.failed24h} email${email.failed24h === 1 ? "" : "s"} failed in the last 24 hours and none was sent.` }
        : email.failed24h > 0
          ? { status: "look", lastWorked: ago(email.lastSentAt, now), reason: `${email.failed24h} of ${email.failed24h + email.sent24h} emails failed in the last 24 hours.` }
          : { status: "working", lastWorked: ago(email.lastSentAt, now), reason: email.sent24h ? `${email.sent24h} sent in the last 24 hours, none failed.` : "Nothing failed; nothing needed sending in the last 24 hours." }),
  });

  const ladder = input.ladder;
  const ladderAge = ladder ? minutesSince(ladder.lastRunAt, now) : null;
  rows.push({
    key: "ladder", name: "Unclaimed-transfer ladder", does: "Escalates waiting transfers", shouldRun: "Every minute", href: null,
    ...(ladder === null
      ? { status: "unknown", lastWorked: "—", reason: "The ladder's run record could not be read just now." }
      : ladder.lastRunAt === null
        ? { status: "failing", lastWorked: "Never", reason: "The database has no run of the ladder on record." }
        : ladder.ok === false
          ? { status: "failing", lastWorked: ago(ladder.lastRunAt, now), reason: `The last run failed${ladder.error ? `: ${ladder.error.slice(0, 120)}` : "."}` }
          : (ladderAge ?? 0) > 5
            ? { status: "look", lastWorked: ago(ladder.lastRunAt, now), reason: `No run since ${ago(ladder.lastRunAt, now)}.` }
            : { status: "working", lastWorked: ago(ladder.lastRunAt, now), reason: "The last run finished cleanly." }),
  });

  /* ── The app routes the database calls ── */
  if (input.appCron === null) {
    rows.push({ key: "app-jobs", name: "Scheduled app jobs", does: "Reminders, emails, overdue invoices…", shouldRun: "On their schedules", status: "unknown", lastWorked: "—", reason: "Their last calls could not be read just now.", href: null });
  } else {
    for (const run of input.appCron) {
      const job = APP_JOBS[run.path];
      if (job?.foldInto) continue;
      const verdict = appRunVerdict(run, job?.every ?? 1440, now);
      rows.push({
        key: `app:${run.path}`,
        name: job?.name ?? run.path.replace("/api/cron/", ""),
        does: job?.does ?? "A scheduled app job",
        shouldRun: job?.shouldRun ?? "On its schedule",
        status: verdict.status === "unknown" && refused ? "failing" : verdict.status,
        lastWorked: verdict.worked ? ago(verdict.worked, now) : "—",
        reason: verdict.status === "unknown" && refused ? `${verdict.reason.replace(/\.$/, "")}; other jobs called the same way are refused (401).` : verdict.reason,
        href: job?.href ?? null,
      });
    }
  }

  /* ── The database's own jobs ── */
  if (input.dbCron === "missing") {
    rows.push({
      key: "db-jobs", name: "Database jobs", does: "Callback due times, lead rotation, carrier files and more", shouldRun: "On their schedules",
      status: "not_watched", lastWorked: "—", reason: "Their runs are not readable yet: needs a database update (20261117310000).", href: null,
    });
  } else if (input.dbCron === null) {
    rows.push({ key: "db-jobs", name: "Database jobs", does: "Callback due times, lead rotation, carrier files and more", shouldRun: "On their schedules", status: "unknown", lastWorked: "—", reason: "Their runs could not be read just now.", href: null });
  } else {
    for (const job of input.dbCron) {
      // The app routes are listed above by what they do; the transfer ladder has its own row.
      if (job.jobname.startsWith("app-cron-") || job.jobname === "unclaimed-sla-side-effects" || HOUSEKEEPING.test(job.jobname)) continue;
      const known = DB_JOBS[job.jobname];
      const failed = job.lastStatus === "failed";
      rows.push({
        key: `db:${job.jobname}`,
        name: known?.name ?? job.jobname,
        does: known?.does ?? "A database job",
        shouldRun: describeCron(job.schedule),
        status: !job.active ? "unknown" : failed ? "failing" : job.lastStartAt === null ? "look" : "working",
        lastWorked: ago(job.lastSucceededAt, now),
        reason: !job.active
          ? "Switched off."
          : failed
            ? `The last run failed${job.lastMessage ? `: ${job.lastMessage.slice(0, 120)}` : "."}`
            : job.lastStartAt === null
              ? "No run on record in the last week."
              : "The last run succeeded.",
        href: null,
      });
    }
  }

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => STATUS_ORDER[a.row.status] - STATUS_ORDER[b.row.status] || a.index - b.index)
    .map(({ row }) => row);
}

/** "* * * * *" → "Every minute"; the common shapes in words, anything else as written. Exported for the tests. */
export function describeCron(schedule: string): string {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return schedule;
  const [minute, hour, day, month, weekday] = parts;
  const rest = day === "*" && month === "*" && weekday === "*";
  if (!rest) return schedule;
  if (minute === "*" && hour === "*") return "Every minute";
  const step = /^\*\/(\d+)$/.exec(minute);
  if (step && hour === "*") return `Every ${step[1]} minutes`;
  if (/^\d+$/.test(minute) && hour === "*") return "Every hour";
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) return `Every day at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")} UTC`;
  return schedule;
}

/** "3 of 7 jobs failing" — the table's own summary line. */
export function healthSummary(rows: readonly HealthRow[]): string {
  const failing = rows.filter((row) => row.status === "failing").length;
  const late = rows.filter((row) => row.status === "look").length;
  const watched = rows.filter((row) => row.status !== "not_watched").length;
  if (failing) return `${failing} of ${watched} jobs failing${late ? ` · ${late} to look at` : ""}`;
  if (late) return `${late} of ${watched} jobs to look at`;
  return `All ${watched} watched jobs working`;
}
