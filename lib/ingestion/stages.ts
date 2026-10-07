import "server-only";

import type { ParsedFile, ReprocessFile, ReprocessStage } from "./reprocess";
import { recordFileEntries } from "./commissionLedgerStore";
import { rebuildFileSnapshots } from "./snapshotStore";

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
    if (file.fileType !== "policies" || !parsed?.typedRows) return { changed: 0 };
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

export const REPROCESS_STAGES: ReprocessStage[] = [policySnapshots, commissionEntries];

/** After a door's parse: the same stages a reprocess runs, for one file's passed rows. */
export async function runStages(tenantId: string, file: ReprocessFile, parsed: ParsedFile): Promise<void> {
  for (const stage of REPROCESS_STAGES) await stage.rebuild(tenantId, file, [], parsed);
}
