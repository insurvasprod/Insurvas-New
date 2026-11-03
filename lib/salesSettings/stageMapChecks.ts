// Settings › Application stages (LA-3.23), pure: the helpers and checks the screen runs on a draft map.
// No `server-only` and no imports, so the screen and the tests (node --experimental-strip-types) share it.
//
// Nothing here is a rule the sync enforces: the sync moves a card to whatever stage the owner chose.
// These are the mistakes worth a second look before saving (owner, 2026-10-30: "easy to understand,
// self-explanatory"): a later state placed before an earlier one on the board, Issued sent to a stage
// marked lost, Lost to a stage marked won, and a sale counted as won before it is issued.

export type SyncStateKey = "quoted" | "application_started" | "submitted" | "pending_requirements" | "issued" | "requoting" | "lost";
export type StageType = "open" | "won" | "lost";
export type CheckStage = { id: string; name: string; stageType: StageType };
export type CheckPipeline = { id: string; name: string; stages: CheckStage[] };
export type StateMap = Partial<Record<SyncStateKey, string | null>>;

/** The states a card moves forward through, in order (stageSync.ts's RANK). Requoting and Lost sit outside it. */
export const FORWARD_ORDER: readonly SyncStateKey[] = ["quoted", "application_started", "submitted", "pending_requirements", "issued"];

/** STATUS-MODEL §6: the stage name each state looks for when the map is filled from stage names. */
export const DEFAULT_STAGE_NAME: Record<SyncStateKey, string> = {
  quoted: "Quoted",
  application_started: "Application started",
  submitted: "Submitted",
  pending_requirements: "Pending requirements",
  issued: "Issued",
  requoting: "Quoted",
  lost: "Lost",
};

const SHORT_LABEL: Record<SyncStateKey, string> = {
  quoted: "Quoted",
  application_started: "Application started",
  submitted: "Submitted",
  pending_requirements: "Pending requirements",
  issued: "Issued",
  requoting: "Back to quoting",
  lost: "Lost",
};

const ALL: readonly SyncStateKey[] = ["quoted", "application_started", "submitted", "pending_requirements", "issued", "requoting", "lost"];
const norm = (name: string) => name.trim().toLowerCase();

/** Each state → the pipeline's stage carrying its default name (case-insensitive), else nothing. Never a guess. */
export function matchByName(pipeline: CheckPipeline): Record<SyncStateKey, string | null> {
  const out = {} as Record<SyncStateKey, string | null>;
  for (const key of ALL) out[key] = pipeline.stages.find((s) => norm(s.name) === norm(DEFAULT_STAGE_NAME[key]))?.id ?? null;
  return out;
}

/** How many states matchByName would fill. */
export function matchCount(pipeline: CheckPipeline): number {
  return Object.values(matchByName(pipeline)).filter(Boolean).length;
}

/**
 * Another pipeline's map, carried over by stage name: a state lands on the target's stage with the same
 * name as the source's stage. `found` lists the states that carried; the rest keep `current`.
 */
export function copyByName(from: CheckPipeline, fromMap: StateMap, to: CheckPipeline, current: StateMap): { map: Record<SyncStateKey, string | null>; found: SyncStateKey[]; missing: SyncStateKey[] } {
  const map = {} as Record<SyncStateKey, string | null>;
  const found: SyncStateKey[] = [];
  const missing: SyncStateKey[] = [];
  for (const key of ALL) {
    map[key] = current[key] ?? null;
    const source = fromMap[key] ? from.stages.find((s) => s.id === fromMap[key]) : undefined;
    if (!source) continue;
    const target = to.stages.find((s) => norm(s.name) === norm(source.name));
    if (target) {
      map[key] = target.id;
      found.push(key);
    } else missing.push(key);
  }
  return { map, found, missing };
}

export type MapCheck = { key: SyncStateKey; text: string };

/** The draft's second-look warnings, one per state at most, in the states' order. */
export function mapChecks(pipeline: CheckPipeline, map: StateMap): MapCheck[] {
  const position = new Map(pipeline.stages.map((s, i) => [s.id, i]));
  const stage = (key: SyncStateKey) => (map[key] ? pipeline.stages.find((s) => s.id === map[key]) : undefined);
  const out = new Map<SyncStateKey, string>();

  // A later state on a stage left of an earlier state's: the card would look like it went back.
  for (let j = 1; j < FORWARD_ORDER.length; j += 1) {
    const later = FORWARD_ORDER[j];
    const at = stage(later);
    if (!at) continue;
    for (let i = j - 1; i >= 0; i -= 1) {
      const earlier = stage(FORWARD_ORDER[i]);
      if (!earlier || earlier.id === at.id) continue;
      if ((position.get(at.id) ?? 0) < (position.get(earlier.id) ?? 0)) {
        out.set(later, `Its stage comes before ${SHORT_LABEL[FORWARD_ORDER[i]]}'s (${earlier.name}) on the board, so the card would look like it moved back.`);
      }
      break;
    }
  }

  const issued = stage("issued");
  if (issued?.stageType === "lost") out.set("issued", `${issued.name} is marked lost on the board, so an issued policy would count as lost.`);
  const lost = stage("lost");
  if (lost?.stageType === "won") out.set("lost", `${lost.name} is marked won on the board, so a lost case would count as won.`);

  // A sale counted as won before the policy is issued.
  if (issued && issued.stageType !== "won") {
    for (const key of FORWARD_ORDER.slice(0, -1)) {
      const at = stage(key);
      if (at?.stageType === "won" && !out.has(key)) {
        out.set(key, `${at.name} is marked won, so the sale counts as won before it is issued (Issued goes to ${issued.name}).`);
        break;
      }
    }
  }

  return ALL.filter((key) => out.has(key)).map((key) => ({ key, text: out.get(key)! }));
}

/** The states that land on each stage, for the board preview. */
export function statesByStage(map: StateMap): Map<string, SyncStateKey[]> {
  const out = new Map<string, SyncStateKey[]>();
  for (const key of ALL) {
    const id = map[key];
    if (!id) continue;
    out.set(id, [...(out.get(id) ?? []), key]);
  }
  return out;
}
