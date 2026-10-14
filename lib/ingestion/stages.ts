import "server-only";

import type { ParsedFile, ReprocessFile, ReprocessStage } from "./reprocess";
import { sweepOrphans } from "./carrierAccountsStore";
import { isPolicyFeed } from "./constants";
import { recordFileEntries } from "./commissionLedgerStore";
import { runDetection } from "./discrepancyStore";
import { evaluateRetention } from "./retentionStore";
import { computeExpected } from "./expectedCommissionStore";
import { rebuildFileSnapshots } from "./snapshotStore";
import { computeRadar } from "@/lib/retention/radarStore";

/**
 * LA-4.2+ (Notion sprint) · the stages that rebuild what is derived from a file, in order. A door
 * runs them after a file is parsed; a reprocess runs them after re-parsing it from its raw rows.
 *
 *   policy_snapshot (LA-4.6) — Layer 2: snapshots, then the change log of the policies touched.
 *   policy_current  (LA-4.7) — Layer 3, refreshed inside the snapshot stage for the same policies,
 *                              right after their history (snapshotStore → refreshPolicyCurrent).
 *
 * Each stage is idempotent: the same file gives the same rows, and `changed` counts what moved.
 */
const policySnapshots: ReprocessStage = {
  name: "policy_snapshot",
  async rebuild(tenantId: string, file: ReprocessFile, _rows, parsed: ParsedFile | null) {
    if (!isPolicyFeed(file.fileType) || !parsed?.typedRows) return { changed: 0 };
    const outcome = await rebuildFileSnapshots(tenantId, file.id, parsed.typedRows);
    return { changed: outcome.changed };
  },
};

/**
 * commission_entry (LA-4.12): a commission file's lines into the ledger. Reading a file again never
 * changes an entry; it writes reversals for lines that changed and new rows for the new lines.
 */
const commissionEntries: ReprocessStage = {
  name: "commission_entry",
  async rebuild(tenantId: string, file: ReprocessFile, _rows, parsed: ParsedFile | null) {
    if (file.fileType !== "commissions" || !parsed?.typedRows) return { changed: 0 };
    const outcome = await recordFileEntries(tenantId, file.id, parsed.typedRows);
    return { changed: outcome.inserted + outcome.reversed + outcome.replaced };
  },
};

/**
 * expected_commission (LA-4.13): after a policy file, the carrier's policies whose pay trigger has
 * now occurred get their expected figure (or a reason there is none). Figures are never rewritten.
 */
const expectedCommission: ReprocessStage = {
  name: "expected_commission",
  async rebuild(tenantId: string, file: ReprocessFile, _rows, parsed: ParsedFile | null) {
    if (!isPolicyFeed(file.fileType) || !parsed?.typedRows || !file.carrierId) return { changed: 0 };
    const outcome = await computeExpected(tenantId, file.carrierId);
    return { changed: outcome.inserted + outcome.filled };
  },
};

/**
 * orphan_commission (LA-4.14): after either kind of file, commission lines whose policy has now
 * arrived close their queue item, and lines unmatched past the threshold open one. Nothing is
 * written to the ledger: a line belongs to its policy by carrier and number.
 */
const orphanCommission: ReprocessStage = {
  name: "orphan_commission",
  async rebuild(tenantId: string, _file: ReprocessFile, _rows, parsed: ParsedFile | null) {
    if (!parsed?.typedRows) return { changed: 0 };
    const outcome = await sweepOrphans(tenantId);
    return { changed: outcome ? outcome.opened + outcome.closed : 0 };
  },
};

/**
 * commission_discrepancy (LA-4.15): last, once everything a file changed is in place, the agency's
 * discrepancies are found again. The same problems update the same rows; vanished ones resolve.
 */
const commissionDiscrepancies: ReprocessStage = {
  name: "commission_discrepancy",
  async rebuild(tenantId: string, _file: ReprocessFile, _rows, parsed: ParsedFile | null) {
    if (!parsed?.typedRows) return { changed: 0 };
    const outcome = await runDetection(tenantId);
    return { changed: outcome.available ? outcome.opened + outcome.reopened + outcome.cleared : 0 };
  },
};

/**
 * retention_result (LA-4.16): after a policy file, every logged retention call on its policies is
 * marked from the data — saved (paid-to moved), lost (lapsed or not taken), or still at risk.
 */
const retentionResults: ReprocessStage = {
  name: "retention_result",
  async rebuild(tenantId: string, file: ReprocessFile, _rows, parsed: ParsedFile | null) {
    if (!isPolicyFeed(file.fileType) || !parsed?.typedRows) return { changed: 0 };
    const outcome = await evaluateRetention(tenantId);
    return { changed: outcome ? outcome.saved + outcome.lost + outcome.still_at_risk : 0 };
  },
};

/**
 * risk_radar (LA-5.1 / 5.2): after a policy file, that carrier's in-force policies get their risk
 * signals and score again. Derived rows only; a failure here never fails the file — the save queue
 * recomputes on its own once a day has passed, and says when its scores are from.
 */
const riskRadar: ReprocessStage = {
  name: "risk_radar",
  async rebuild(tenantId: string, file: ReprocessFile, _rows, parsed: ParsedFile | null) {
    if (!isPolicyFeed(file.fileType) || !parsed?.typedRows || !file.carrierId) return { changed: 0 };
    try {
      const run = await computeRadar(tenantId, { carrierId: file.carrierId });
      return { changed: run.available ? run.scored + run.removed : 0 };
    } catch (error) {
      console.error("[risk_radar] the radar could not be refreshed after a file", error);
      return { changed: 0 };
    }
  },
};

export const REPROCESS_STAGES: ReprocessStage[] = [policySnapshots, expectedCommission, retentionResults, riskRadar, commissionEntries, orphanCommission, commissionDiscrepancies];

/** After a door's parse: the same stages a reprocess runs, for one file's passed rows. */
export async function runStages(tenantId: string, file: ReprocessFile, parsed: ParsedFile): Promise<void> {
  for (const stage of REPROCESS_STAGES) await stage.rebuild(tenantId, file, [], parsed);
}
