"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/view-tabs";
import { notify } from "@/lib/notify";
import type { VendorRow } from "@/lib/leadPost/board";
import type { TestResult } from "@/lib/leadPost/boardStore";
import { canonicalFieldMap, readFieldMap } from "@/lib/leadPost/fieldMap";
import { NeedsUpdate, send } from "./shared";
import { DEFAULT_TEST_LEAD, describeLead, payloadFor, TestLeadDialog, TestResultCard, type TestLead } from "./test-runner";

type HistoryRow = { at: string; accepted: boolean; reasonCode: string; ms: number | null; ours: boolean; payloadNote: string };
type Shown = { key: string; who: string; result: TestResult | (Pick<TestResult, "accepted" | "reasonCode" | "message" | "at" | "ms">) };

/**
 * Vendor sheet › Test (board A8): send a made-up lead through every check a real post runs, stopping
 * before a lead or a charge; see theirs and ours, newest first; a refusal names its cause and offers
 * one fix that re-sends. "Test mode / Live" switches the key itself (needs 20261112100100): in test
 * mode the vendor's own posts are checked the same way and never become leads.
 */
export function SheetTestTab({ row, r8Ready, onChanged }: { row: VendorRow; r8Ready: boolean; onChanged: () => Promise<void> }) {
  const [lead, setLead] = useState<TestLead>(DEFAULT_TEST_LEAD);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<TestResult[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [switching, setSwitching] = useState(false);
  const testMode = row.settings?.testMode ?? false;

  const loadHistory = useCallback(() => {
    if (!r8Ready) return;
    void send<{ tests: HistoryRow[] }>(`/api/app/lead-post-keys/${row.key.id}/test`, "GET").then((body) => setHistory(body.tests)).catch(() => null);
  }, [r8Ready, row.key.id]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function run(fieldMap?: Record<string, string>) {
    setBusy(true);
    try {
      const map = fieldMap ?? row.key.fieldMap;
      const result = await send<TestResult>(`/api/app/lead-post-keys/${row.key.id}/test`, "POST", { payload: payloadFor(lead, map), ...(fieldMap ? { fieldMap } : {}) });
      setMine((list) => [result, ...list].slice(0, 10));
      loadHistory();
    } catch (cause) {
      notify.fail(cause instanceof Error ? cause.message : "The test could not run.");
    } finally {
      setBusy(false);
    }
  }

  async function fixAndResend(suggestion: { theirs: string; ours: string }) {
    const map = canonicalFieldMap([...readFieldMap(row.key.fieldMap).filter((entry) => entry.ours !== suggestion.ours), suggestion]);
    setBusy(true);
    try {
      await send(`/api/app/lead-post-keys/${row.key.id}`, "PATCH", { action: "field_map", fieldMap: map });
      notify.done(`${suggestion.theirs} is read now.`);
      await onChanged();
    } catch (cause) {
      notify.fail(cause instanceof Error ? cause.message : "The field map was not saved.");
      setBusy(false);
      return;
    }
    await run(map);
  }

  async function setMode(next: "test" | "live") {
    if ((next === "test") === testMode) return;
    setSwitching(true);
    try {
      await send(`/api/app/lead-post-keys/${row.key.id}`, "PATCH", { action: "settings", settings: { testMode: next === "test" } });
      notify.done(next === "test" ? `${row.vendorName} is in test mode: their posts are checked, never kept as leads.` : `${row.vendorName} is live: their posts become leads.`);
      await onChanged();
    } catch (cause) {
      notify.fail(cause instanceof Error ? cause.message : "That did not change.");
    } finally {
      setSwitching(false);
    }
  }

  // Ours from this session first (with every check), then the log's, skipping ours already shown.
  const shown: Shown[] = [
    ...mine.map((result) => ({ key: `m-${result.at}`, who: "Our test", result })),
    ...history.filter((item) => !(item.ours && mine.some((result) => Math.abs(Date.parse(result.at) - Date.parse(item.at)) < 5000))).map((item) => ({
      key: `h-${item.at}`,
      who: item.ours ? "Our test" : "Their test",
      result: { accepted: item.accepted, reasonCode: item.reasonCode, message: item.accepted ? "Every check passed." : `${item.payloadNote}: refused.`, at: item.at, ms: item.ms },
    })),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Test mode" options={[{ key: "test", label: "Test mode" }, { key: "live", label: "Live" }]} value={testMode ? "test" : "live"} onChange={(next) => void setMode(next)} disabled={!r8Ready || switching} />
        {!r8Ready && <NeedsUpdate />}
        <span className="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>Edit test lead</Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => void run()}>{busy ? "Sending…" : "Send a test post"}</Button>
        </span>
      </div>
      <p className="m-0 text-xs text-[var(--muted)]">
        Test posts run every check a real post runs, then stop before a lead or a charge is made. Test lead: {describeLead(lead)}.
      </p>
      {shown.length === 0 ? (
        <p className="m-0 py-6 text-center text-sm text-[var(--muted)]">No test posts yet. Send one to see what a real post from {row.vendorName} would get.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {shown.map((item) => (
            <TestResultCard key={item.key} who={item.who} result={item.result} fixing={busy} onFix={(suggestion) => void fixAndResend(suggestion)} />
          ))}
        </div>
      )}
      {editing && <TestLeadDialog open lead={lead} onClose={() => setEditing(false)} onSave={setLead} />}
    </div>
  );
}
