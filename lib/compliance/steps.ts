/**
 * The one Compliance page's six steps (2026-10-30, canvas "M6 · Compliance (one page)"): Overview, TCPA / DNC,
 * Consent, Complaints, Deletions and Evidence, down a rail on the left as Leads in does
 * (components/app/compliance/compliance-flow.tsx). A plain module so the server frame, the client rail,
 * the sidebar and the page trail all read one list.
 */
/** The Compliance menu collapsed or open, remembered for a year; read on the server so the page draws at the right width. */
export const COMPLIANCE_RAIL_COOKIE = "insurvas_compliance_rail";

export type ComplianceStep = "overview" | "dnc" | "consent" | "complaints" | "deletions" | "evidence";

export const COMPLIANCE_STEPS: { key: ComplianceStep; label: string; sub: string; href: string }[] = [
  { key: "overview", label: "Overview", sub: "Am I exposed right now", href: "/app/compliance" },
  { key: "dnc", label: "TCPA / DNC", sub: "Can we call this number", href: "/app/tcpa" },
  { key: "consent", label: "Consent", sub: "Proof they agreed", href: "/app/consent" },
  { key: "complaints", label: "Complaints", sub: "Deadlines and responses", href: "/app/complaints" },
  { key: "deletions", label: "Deletions", sub: "Verify, hold, delete", href: "/app/deletion-requests" },
  { key: "evidence", label: "Evidence", sub: "What we hold, what is missing", href: "/app/evidence-report" },
];

/** Each step's own address. Compliance settings (/app/compliance/settings) is Settings, not a step. */
const STEP_PATHS: [RegExp, ComplianceStep][] = [
  [/^\/app\/compliance\/?$/, "overview"],
  [/^\/app\/tcpa\/?$/, "dnc"],
  [/^\/app\/consent\/?$/, "consent"],
  [/^\/app\/complaints\/?$/, "complaints"],
  [/^\/app\/deletion-requests\/?$/, "deletions"],
  [/^\/app\/evidence-report\/?$/, "evidence"],
];

export function complianceStepOf(pathname: string): ComplianceStep | null {
  return STEP_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

export function complianceStepLabel(step: ComplianceStep): string {
  return COMPLIANCE_STEPS.find((item) => item.key === step)?.label ?? "";
}

export type ComplianceStepCounts = Partial<Record<ComplianceStep, number>>;

/** What the rail says under a step once its live count is in (the step's `sub` until then, or on a failed read). */
export function complianceStepStatus(step: ComplianceStep, n: number): { text: string; needsYou: boolean } | null {
  const many = n.toLocaleString("en-US");
  switch (step) {
    case "complaints": return n > 0 ? { text: `${many} due or overdue`, needsYou: true } : { text: "No deadline is close", needsYou: false };
    case "deletions": return n > 0 ? { text: `${many} waiting on you`, needsYou: true } : { text: "Nothing waiting", needsYou: false };
    default: return null;
  }
}
