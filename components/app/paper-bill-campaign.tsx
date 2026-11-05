"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { personName } from "@/lib/format/personName";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { fileDay } from "@/lib/ingestion/constants";
import { CONVERSION_OUTCOME_LABELS, STATE_LABELS, type CampaignState } from "@/lib/retention/campaign";
import type { Campaign, CampaignRow } from "@/lib/retention/campaignStore";

const money = (cents: number | null) => (cents === null ? "—" : `$${Math.round(cents / 100).toLocaleString("en-US")}`);
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};
const TONE: Record<CampaignState, StatusTone> = { remaining: "action", in_progress: "info", converted: "good", declined: "neutral", no_bank_account: "neutral" };
const VIEWS = { remaining: "To call", in_progress: "Asked", converted: "Converted", resting: "Said no", all: "All", results: "Results" } as const;
type View = keyof typeof VIEWS;
const callHref = (r: Pick<CampaignRow, "carrierId" | "policyNumber">) => `/app/servicing/campaign/${r.carrierId}/${encodeURIComponent(r.policyNumber)}`;

/**
 * LA-5.5 (Notion sprint) · paper bill → bank payment. A standing list worked on a quiet afternoon,
 * biggest premium first. "12 converted, 26 to go" makes it a task with an end; a conversion counts
 * only when the carrier file shows it.
 *
 * The pick of 2026-11-05 ("PbA", docs/retention/CRITIQUE.md): a policy's call is its own page (the name or
 * Call), where one answer logs it or starts the switch; the talk track is edited in Settings only; "Worth the
 * hours?" is the Results view, not a pop-up. The view is in the address (`pb`), so each tile links to it, and
 * the list opens on the policies that can be called today when any has a phone.
 */
export function PaperBillCampaign({ campaign, readOnly }: { campaign: Campaign; isOwner?: boolean; readOnly: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const { totals, rows } = campaign;
  const anyPhone = rows.some((r) => r.state === "remaining" && r.phone);
  const view: View = (params.get("pb") ?? "") in VIEWS ? (params.get("pb") as View) : "remaining";
  const viewHref = (v: View) => { const next = new URLSearchParams(params.toString()); next.set("view", "campaign"); if (v === "remaining") next.delete("pb"); else next.set("pb", v); return `${pathname}?${next}`; };
  const [search, setSearch] = useState("");
  // Only the policies that can be called today (owner 2026-11-02 critique: most rows had no phone), on by default when any can.
  const [withPhone, setWithPhone] = useState(anyPhone);
  const [page, setPage] = useState(1);
  const inView = (r: CampaignRow, v: View) => v === "all" || (v === "resting" ? r.state === "declined" || r.state === "no_bank_account" : r.state === v);
  const counts = useMemo(() => Object.fromEntries((Object.keys(VIEWS) as View[]).filter((v) => v !== "results").map((v) => [v, rows.filter((r) => inView(r, v)).length])) as Record<View, number>, [rows]);
  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => rows.filter((r) => inView(r, view) && (!withPhone || Boolean(r.phone)) && (!needle || [r.clientName, r.policyNumber, r.phone, r.carrierName].some((v) => v?.toLowerCase().includes(needle)))), [rows, view, needle, withPhone]);
  const phoned = useMemo(() => rows.filter((r) => inView(r, view) && r.phone).length, [rows, view]);
  // Inside one state the chip already says it, so "Where it stands" is drawn only where states mix or a line adds to it.
  const showState = view === "all" || view === "resting" || visible.some((r) => r.lastAttempt);
  const pageSize = useFittingPageSize(480, 57);
  const shown = paginate(visible, page, pageSize);
  const go = (v: View) => { setPage(1); router.replace(viewHref(v), { scroll: false }); };
  const filtered = Boolean(needle) || withPhone !== anyPhone || view !== "remaining";

  return (
    <>
      {rows.length > 0 && (
        <StatStrip label="Paper-bill campaign">
          <StatTile label="On paper bills" href={viewHref("all")} value={totals.policies.toLocaleString("en-US")} footnote={`${money(totals.monthlyCents)}/mo in premium`} />
          <StatTile label="Converted" href={viewHref("converted")} value={totals.converted.toLocaleString("en-US")} valueTone={totals.converted ? "good" : undefined} footnote={totals.converted ? `${money(totals.monthlyMovedCents)}/mo moved off paper` : "shown by a carrier file"} />
          <StatTile label="Switch asked for" href={viewHref("in_progress")} value={totals.inProgress.toLocaleString("en-US")} footnote="waiting for the file" />
          <StatTile label="To go" href={viewHref("remaining")} value={totals.remaining.toLocaleString("en-US")} footnote={`${totals.declined} said no · ${totals.noBankAccount} no bank account`} />
        </StatStrip>
      )}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {filtered && <ClearFiltersButton onClick={() => { setSearch(""); setWithPhone(anyPhone); go("remaining"); }} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            {view !== "results" && <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Client, policy or phone" />}
            {(Object.keys(VIEWS) as View[]).map((v) => (
              <ToggleChip key={v} role="radio" selected={view === v} count={v === "results" ? undefined : counts[v]} onClick={() => go(v)}>{VIEWS[v]}</ToggleChip>
            ))}
            {view !== "results" && <ToggleChip selected={withPhone} count={phoned} onClick={() => { setWithPhone(!withPhone); setPage(1); }}>Has a phone</ToggleChip>}
          </DataToolbar>
        }
        footer={view === "results" ? <span>From the carrier files: converted policies against those still paying by post.</span> : visible.length ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="policies" onPage={setPage} /> : undefined}
      >
        {view === "results" ? (
          <Results campaign={campaign} />
        ) : rows.length === 0 ? (
          <EmptyState title="No paper-bill policies" hint="Every in-force policy pays by draft or card." />
        ) : visible.length === 0 ? (
          <NoMatches noun="policies" onClear={() => { setSearch(""); setWithPhone(false); setPage(1); go("all"); }} />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Client</th>
                <th className="w-[110px] text-right">Premium</th>
                <th>On paper for</th>
                {showState && <th>Where it stands</th>}
                <th className="w-[120px] text-right"><span className="sr-only">Work it</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {shown.rows.map((r) => {
                const name = r.clientName ? personName(r.clientName) : "No client linked";
                return (
                  <tr key={r.key} className="m-row">
                    <td>
                      <Link href={callHref(r)} className="block truncate font-semibold text-foreground underline-offset-2 hover:underline" title={campaign.showOwners && r.owner ? `Owner: ${r.owner.name}` : undefined}>{name}</Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.phone ? <span className="select-all tabular-nums text-foreground" title="Check the calling window and do-not-call list before dialling">{phoneText(r.phone)}</span> : "No phone"}
                        {" · "}
                        <Link href={`/app/policies/carrier/${r.carrierId}/${encodeURIComponent(r.policyNumber)}`} className="hover:underline">{r.carrierName} {r.policyNumber}</Link>
                      </span>
                    </td>
                    <td className="text-right tabular-nums">{money(r.monthlyCents)}<span className="text-muted-foreground">/mo</span></td>
                    <td className="truncate text-foreground" title={r.history}>{r.history.replace(/^Paying by post for /, "")}</td>
                    {showState && <td>
                      <StatusChip tone={TONE[r.state]}>{STATE_LABELS[r.state]}</StatusChip>
                      {(r.state === "declined" && r.returnsOn) || r.lastAttempt ? (
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {r.state === "declined" && r.returnsOn ? `Back ${fileDay(r.returnsOn)}` : `${CONVERSION_OUTCOME_LABELS[r.lastAttempt!.outcome]}, ${fileDay(r.lastAttempt!.at.slice(0, 10))}${r.lastAttempt!.by ? ` · ${r.lastAttempt!.by}` : ""}`}
                        </span>
                      ) : null}
                    </td>}
                    <td className="text-right">
                      {/* One call, one answer (PbA): Log call and Start conversion are the answers on the call page. */}
                      {!readOnly && r.state === "remaining" && <Button asChild size="sm" variant="outline"><Link href={callHref(r)}>Call</Link></Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}

/** "Worth the hours?" (was a pop-up): converted against still on paper, and who did the calling. */
function Results({ campaign }: { campaign: Campaign }) {
  return (
    <table className="portal-lead-table w-full text-left text-sm">
      <thead>
        <tr>
          <th>Who</th>
          <th className="text-right">Calls</th>
          <th className="text-right">Agreed</th>
          <th className="text-right">Converted</th>
        </tr>
      </thead>
      <tbody>
        <tr className="font-semibold">
          <td className="text-foreground">Lapsed, converted vs still on paper</td>
          <td colSpan={3} className="text-right tabular-nums">{campaign.lapse.converted} converted · {campaign.lapse.onPaper} on paper{campaign.lapse.comparable ? "" : " · too few on one side to compare yet"}</td>
        </tr>
        {campaign.people.length === 0 ? (
          <tr><td colSpan={4} className="text-muted-foreground">No calls logged yet.</td></tr>
        ) : campaign.people.map((p) => (
          <tr key={p.name}>
            <td className="truncate text-foreground">{p.name}</td>
            <td className="text-right tabular-nums">{p.calls.toLocaleString("en-US")}</td>
            <td className="text-right tabular-nums">{p.agreed.toLocaleString("en-US")}</td>
            <td className="text-right tabular-nums">{p.verified.toLocaleString("en-US")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
