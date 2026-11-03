/**
 * The one Compliance page's steps (2026-10-30, canvas "M6 · Compliance (one page)"): Overview, TCPA / DNC,
 * Consent, Complaints, Deletions, Evidence and Licences & appointments, down a rail on the left as Leads in
 * does (components/app/compliance/compliance-flow.tsx, on the shared StepFrame since the foundation pass of
 * 2026-11-03). A plain module so the server frame, the sidebar and the page trail all read one list.
 */
/** The Compliance menu collapsed or open, remembered for a year; read on the server so the page draws at the right width. */
export const COMPLIANCE_RAIL_COOKIE = "insurvas_compliance_rail";

export type ComplianceStep = "overview" | "dnc" | "consent" | "complaints" | "deletions" | "evidence" | "appointments";

/** `icon` names one of the shared rail's icons (components/app/step-frame/step-rail.tsx). */
export const COMPLIANCE_STEPS: { key: ComplianceStep; label: string; sub: string; href: string; icon: string }[] = [
  { key: "overview", label: "Overview", sub: "Am I exposed right now", href: "/app/compliance", icon: "shield-check" },
  { key: "dnc", label: "TCPA / DNC", sub: "Can we call this number", href: "/app/tcpa", icon: "phone-off" },
  { key: "consent", label: "Consent", sub: "Proof they agreed", href: "/app/consent", icon: "lock-keyhole" },
  { key: "complaints", label: "Complaints", sub: "Deadlines and responses", href: "/app/complaints", icon: "circle-alert" },
  { key: "deletions", label: "Deletions", sub: "Verify, hold, delete", href: "/app/deletion-requests", icon: "user-x" },
  { key: "evidence", label: "Evidence", sub: "What we hold, what is missing", href: "/app/evidence-report", icon: "file-search" },
  // LA-0.5 · the appointment and licence vault, which LA-6.2's licence gate reads (owner 2026-11-02: out of Book).
  { key: "appointments", label: "Licences & appointments", sub: "Where you may write today", href: "/app/appointments", icon: "badge-check" },
];

/**
 * Each step's addresses. A record under a step (a complaint, a deletion request, a certificate, a new
 * exemption; foundation pass 2026-11-03) is that step too, so the rail and the sidebar stay on it.
 * Compliance settings (/app/compliance/settings) is Settings, not a step.
 */
const STEP_PATHS: [RegExp, ComplianceStep][] = [
  [/^\/app\/compliance\/?$/, "overview"],
  [/^\/app\/tcpa(\/.*)?$/, "dnc"],
  [/^\/app\/consent(\/.*)?$/, "consent"],
  [/^\/app\/complaints(\/.*)?$/, "complaints"],
  [/^\/app\/deletion-requests(\/.*)?$/, "deletions"],
  [/^\/app\/evidence-report(\/.*)?$/, "evidence"],
  [/^\/app\/appointments(\/.*)?$/, "appointments"],
];

export function complianceStepOf(pathname: string): ComplianceStep | null {
  return STEP_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

export function complianceStepLabel(step: ComplianceStep): string {
  return COMPLIANCE_STEPS.find((item) => item.key === step)?.label ?? "";
}

export function complianceStepHref(step: ComplianceStep): string {
  return COMPLIANCE_STEPS.find((item) => item.key === step)?.href ?? "/app/compliance";
}

export type ComplianceStepCounts = Partial<Record<ComplianceStep, number>>;

/** What each rail badge counts, one and many (/api/app/compliance/steps); a step left out has no badge. */
export const COMPLIANCE_WAITING: Record<string, [string, string]> = {
  complaints: ["complaint due or overdue", "complaints due or overdue"],
  deletions: ["deletion request waiting on you", "deletion requests waiting on you"],
};
