// Which cadence a campaign ran over a period, from tenant_cadence_versions (20260925706200).
//
// The board's campaign comparison carries a caveat — "same period, similar volume, different
// cadence … this compares two things at once" — and until every save was kept, nothing could say
// it. Pure and dependency-free: the server reads the versions, this decides, and the client renders
// the answer (so no `server-only` here).
//
// The rules it applies are the scheduler's (schedule_next_attempt, 20260924230300):
//   * a campaign with any rule of its own runs only its own rules;
//   * otherwise it runs the tenant default;
//   * a scope with no rules runs the built-in cadence.
//
// History starts at the tenant's baseline (the snapshot the migration took). Before that, which
// cadence ran is not recorded, and this says so instead of assuming today's cadence always ran.

export type CadenceVersion = {
  campaignId: string | null;
  ruleCount: number;
  fingerprint: string;
  savedAt: string;
  source: "save" | "baseline";
};

export type EffectiveCadence = {
  kind: "own" | "default" | "builtin";
  /** Equal fingerprints mean identical rules; the built-in cadence is "builtin". */
  fingerprint: string;
  ruleCount: number;
  savedAt: string | null;
  source: "save" | "baseline" | null;
};

export type PeriodCadence = {
  campaignId: string;
  from: string;
  to: string;
  /** False when the period starts before cadence history began. */
  known: boolean;
  /** Every distinct cadence in force at some point in the period, in order. */
  cadences: EffectiveCadence[];
};

export type CadenceCaveat = {
  status: "pending" | "unknown" | "changed" | "different" | "same";
  /** One or two sentences, shown as-is. */
  message: string;
  historySince: string | null;
  a: PeriodCadence | null;
  b: PeriodCadence | null;
};

const BUILTIN: EffectiveCadence = { kind: "builtin", fingerprint: "builtin", ruleCount: 0, savedAt: null, source: null };

const time = (iso: string) => Date.parse(iso);

function latest(versions: CadenceVersion[], campaignId: string | null, at: number) {
  let found: CadenceVersion | null = null;
  for (const version of versions) {
    if (version.campaignId !== campaignId || time(version.savedAt) > at) continue;
    if (!found || time(version.savedAt) >= time(found.savedAt)) found = version;
  }
  return found;
}

/** The cadence a campaign's leads were scheduled on at instant `at`. */
export function effectiveCadenceAt(versions: CadenceVersion[], campaignId: string, at: number): EffectiveCadence {
  const own = latest(versions, campaignId, at);
  if (own && own.ruleCount > 0)
    return { kind: "own", fingerprint: own.fingerprint, ruleCount: own.ruleCount, savedAt: own.savedAt, source: own.source };
  const tenant = latest(versions, null, at);
  if (tenant && tenant.ruleCount > 0)
    return { kind: "default", fingerprint: tenant.fingerprint, ruleCount: tenant.ruleCount, savedAt: tenant.savedAt, source: tenant.source };
  return BUILTIN;
}

/** When recorded history begins for this tenant: its baseline, or null when it has none. */
export function historySince(versions: CadenceVersion[]): string | null {
  const baselines = versions.filter((version) => version.source === "baseline" && version.campaignId === null);
  if (baselines.length === 0) return null;
  return baselines.reduce((first, version) => (time(version.savedAt) < time(first.savedAt) ? version : first)).savedAt;
}

/** A YYYY-MM-DD day as [start, end] instants, UTC — the same days the comparison is matched on. */
function dayBounds(from: string, to: string) {
  return { start: Date.parse(`${from}T00:00:00Z`), end: Date.parse(`${to}T23:59:59.999Z`) };
}

export function periodCadence(versions: CadenceVersion[], period: { campaignId: string; from: string; to: string }): PeriodCadence {
  const { start, end } = dayBounds(period.from, period.to);
  const since = historySince(versions);
  // A tenant with no baseline was created after history began, and no path but a recorded save
  // writes cadence rules, so its history is complete from the start.
  const known = since === null || start >= time(since);
  const instants = [
    start,
    ...versions
      .filter((version) => (version.campaignId === period.campaignId || version.campaignId === null) && time(version.savedAt) > start && time(version.savedAt) <= end)
      .map((version) => time(version.savedAt)),
  ].sort((a, b) => a - b);
  const cadences: EffectiveCadence[] = [];
  for (const at of instants) {
    const cadence = effectiveCadenceAt(versions, period.campaignId, at);
    if (cadences[cadences.length - 1]?.fingerprint !== cadence.fingerprint) cadences.push(cadence);
  }
  // A cadence changed back to one already seen is still one cadence per fingerprint for the verdict.
  return { ...period, known, cadences };
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function describeCadence(cadence: EffectiveCadence): string {
  if (cadence.kind === "builtin") return "the built-in cadence";
  const rules = `${cadence.ruleCount} ${cadence.ruleCount === 1 ? "rule" : "rules"}`;
  const when = cadence.savedAt
    ? cadence.source === "baseline" ? `in force when history began, ${shortDate(cadence.savedAt)}` : `saved ${shortDate(cadence.savedAt)}`
    : null;
  const what = cadence.kind === "own" ? "its own cadence" : "the agency default";
  return `${what} (${rules}${when ? `, ${when}` : ""})`;
}

export function cadenceCaveat(
  versions: CadenceVersion[] | null,
  a: { campaignId: string; name: string; from: string; to: string },
  b: { campaignId: string; name: string; from: string; to: string },
): CadenceCaveat {
  if (versions === null)
    return {
      status: "pending",
      message: "Which cadence each period ran is not recorded yet — that needs a database update that has not been applied. Check the cadence before reading the gap as the list's doing.",
      historySince: null,
      a: null,
      b: null,
    };
  const since = historySince(versions);
  const periodA = periodCadence(versions, a);
  const periodB = periodCadence(versions, b);

  if (!periodA.known || !periodB.known) {
    const early = [!periodA.known ? a.name : null, !periodB.known ? b.name : null].filter(Boolean).join(" and ");
    return {
      status: "unknown",
      message: `Cadence history starts ${since ? shortDate(since) : "with the first saved change"}. ${early}'s period begins before that, so whether the two ran the same cadence is not known.`,
      historySince: since,
      a: periodA,
      b: periodB,
    };
  }

  if (periodA.cadences.length > 1 || periodB.cadences.length > 1) {
    const changed = [periodA.cadences.length > 1 ? a.name : null, periodB.cadences.length > 1 ? b.name : null].filter(Boolean).join(" and ");
    return {
      status: "changed",
      message: `The cadence changed during ${changed}'s period, so part of the gap may be the cadence rather than the list. Treat it as a signal to test, not a verdict.`,
      historySince: since,
      a: periodA,
      b: periodB,
    };
  }

  const cadenceA = periodA.cadences[0] ?? BUILTIN;
  const cadenceB = periodB.cadences[0] ?? BUILTIN;
  if (cadenceA.fingerprint !== cadenceB.fingerprint)
    return {
      status: "different",
      message: `Different cadence. ${a.name} ran ${describeCadence(cadenceA)} and ${b.name} ran ${describeCadence(cadenceB)}, so this compares two things at once. Treat the gap as a signal to test, not a verdict.`,
      historySince: since,
      a: periodA,
      b: periodB,
    };

  return {
    status: "same",
    message: `Both periods ran the same cadence — ${describeCadence(cadenceA)}.`,
    historySince: since,
    a: periodA,
    b: periodB,
  };
}
