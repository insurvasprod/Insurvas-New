"use client";

import { Copy, Download, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState, LoadingRows, SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import { SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { notify } from "@/lib/notify";
import { viewerTimeZone } from "@/lib/format/dates";
import { REASON_WORDS, type LeadPostBoard, type StatusFilter, type VendorRow } from "@/lib/leadPost/board";
import type { CampaignSpeedRow } from "@/lib/leadPost/campaignSpeed";
import type { PostActivity } from "@/lib/leadPost/types";
import { PostsTable } from "@/components/app/settings/lead-posting/activity";
import { ConnectWizard } from "@/components/app/settings/lead-posting/connect-wizard";
import { GuideTab } from "@/components/app/settings/lead-posting/guide-tab";
import { emailInstructions, tellVendor } from "@/components/app/settings/lead-posting/instructions";
import { RevealDialog, RevokeDialog, RotateDialog } from "@/components/app/settings/lead-posting/key-dialogs";
import { RejectionsTab, repeatingReasons, type Refused, type RejectionWindow } from "@/components/app/settings/lead-posting/rejections-tab";
import { ago, copyText, InlineLink, send, StatusLine } from "@/components/app/settings/lead-posting/shared";
import { VendorSheet, type SheetTab } from "@/components/app/settings/lead-posting/vendor-sheet";
import { VendorTable } from "@/components/app/settings/lead-posting/vendor-table";

/**
 * Settings › Lead posting — round 8, option A "Vendor list + vendor sheet" (owner pick 2026-11-12,
 * docs/design/settings-r8/lead-posting.html). Vendors post leads by API the moment someone fills a
 * form; each post is mapped, scrubbed, de-duplicated and queued at the top, or refused with a reason
 * — and a refused post is a lead the agency is not billed for.
 *
 *   Vendors        one figure strip and every vendor on one table; a vendor opens as a right sheet
 *                  (Setup · Field map · Test · Activity)
 *   Activity       every post, newest first
 *   Rejections     refused posts and the reasons that repeat, each with its fix
 *   Vendor guide   the instructions any vendor can be sent
 *
 * "Connect a vendor" (the page's one gold button) walks vendor & campaign → the key, shown once →
 * instructions → a test post. What needs migration 20261112100100 (test mode, price, cap, hours,
 * status callback, rotation grace, notes, instructions tracking) is drawn and disabled with "needs a
 * database update" until it is applied; everything else works today.
 */

type PageTab = "vendors" | "activity" | "rejections" | "guide";
type Reveal = { vendorName: string; key: string; graceUntil: string | null; emailAfter: { keyId: string; to: string } | null };

/** The median first dial across campaigns, each campaign's median weighted by the leads it dialled. */
function firstDialMedian(rows: CampaignSpeedRow[] | null): number | null {
  const points = (rows ?? []).filter((row) => row.medianSeconds !== null && row.dialledLeads > 0).sort((a, b) => (a.medianSeconds ?? 0) - (b.medianSeconds ?? 0));
  const total = points.reduce((sum, row) => sum + row.dialledLeads, 0);
  let seen = 0;
  for (const row of points) {
    seen += row.dialledLeads;
    if (seen * 2 >= total) return row.medianSeconds;
  }
  return null;
}

export function LeadPostKeysSettings() {
  const [board, setBoard] = useState<LeadPostBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PageTab>("vendors");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState<{ vendorId: string; tab: SheetTab } | null>(null);
  const [wizard, setWizard] = useState<{ vendorId?: string } | null>(null);
  const [rotating, setRotating] = useState<VendorRow | null>(null);
  const [revoking, setRevoking] = useState<VendorRow | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<PostActivity | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [speed, setSpeed] = useState<CampaignSpeedRow[] | null>(null);
  const [days, setDays] = useState<RejectionWindow>(1);
  const [vendorFilter, setVendorFilter] = useState("");
  const [refused, setRefused] = useState<Refused | null>(null);
  const [refusedError, setRefusedError] = useState<string | null>(null);

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  // Promise chains, not async/await: the effect below calls these on mount, and every setState lands
  // in a callback rather than anywhere the linter can reach synchronously.
  const load = useCallback(
    () =>
      send<LeadPostBoard>(`/api/app/lead-post-keys/board?tz=${encodeURIComponent(viewerTimeZone())}`, "GET")
        .then((body) => { setBoard(body); setError(null); })
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Vendors didn't load")),
    [],
  );
  const loadActivity = useCallback(
    () =>
      Promise.all([
        send<PostActivity>("/api/app/lead-post-keys/activity", "GET").then((body) => { setActivity(body); setActivityError(null); }).catch((cause: unknown) => setActivityError(cause instanceof Error ? cause.message : "Posts didn't load")),
        // An empty list when the plan has no dialing (the route answers 403) or it failed.
        fetch("/api/app/campaigns/speed-to-lead", { cache: "no-store" })
          .then(async (response) => {
            const body = await response.json().catch(() => null);
            setSpeed(response.ok && Array.isArray(body?.campaigns) ? (body.campaigns as CampaignSpeedRow[]) : []);
          })
          .catch(() => setSpeed([])),
      ]),
    [],
  );
  const loadRefused = useCallback(
    (window: RejectionWindow) =>
      send<Refused>(`/api/app/lead-post-keys/rejections?days=${window}&tz=${encodeURIComponent(viewerTimeZone())}`, "GET")
        .then((body) => { setRefused(body); setRefusedError(null); })
        .catch((cause: unknown) => setRefusedError(cause instanceof Error ? cause.message : "Refused posts didn't load")),
    [],
  );

  useEffect(() => {
    void load();
    void loadActivity();
  }, [load, loadActivity]);
  useEffect(() => {
    void loadRefused(days);
  }, [days, loadRefused]);

  const reloadAll = useCallback(async () => {
    await Promise.all([load(), loadActivity()]);
  }, [load, loadActivity]);

  const vendorOf = useCallback((vendorId: string) => board?.vendors.find((row) => row.vendorId === vendorId) ?? null, [board]);
  const open = (row: VendorRow, sheetTab: SheetTab = "setup") => setSheet({ vendorId: row.vendorId, tab: sheetTab });
  const openById = (vendorId: string, sheetTab: SheetTab) => {
    const row = vendorOf(vendorId);
    if (row) { setTab("vendors"); open(row, sheetTab); }
  };

  async function rotate(row: VendorRow, input: { graceHours: number; emailInstructions: boolean }) {
    setBusy(true);
    try {
      const body = await send<{ key: string; record: { id: string }; graceUntil: string | null }>(`/api/app/lead-post-keys/${row.key.id}`, "PATCH", { action: "rotate", graceHours: input.graceHours });
      setRotating(null);
      setReveal({ vendorName: row.vendorName, key: body.key, graceUntil: body.graceUntil, emailAfter: input.emailInstructions ? { keyId: body.record.id, to: row.settings?.instructionsEmail ?? "" } : null });
      await reloadAll();
    } catch (cause) {
      notify.block(cause instanceof Error ? cause.message : "The key could not be rotated.");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(row: VendorRow, active: boolean) {
    setBusy(true);
    try {
      await send(`/api/app/lead-post-keys/${row.key.id}`, "PATCH", { action: active ? "activate" : "deactivate" });
      notify.done(active ? `${row.vendorName}'s key works again.` : `${row.vendorName}'s key is revoked. Their posts are refused from now on.`);
      setRevoking(null);
      await reloadAll();
    } catch (cause) {
      notify.block(cause instanceof Error ? cause.message : "That key could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  const tell = (vendorId: string, reasonCode: string, count: number) => {
    const row = vendorOf(vendorId);
    tellVendor({ to: row?.settings?.instructionsEmail ?? "", vendorName: row?.vendorName ?? "vendor", agencyName: board?.agencyName ?? "us", reasonCode, count, days });
  };

  const sheetRow = sheet ? vendorOf(sheet.vendorId) : null;
  const firstDial = useMemo(() => firstDialMedian(speed), [speed]);

  const connectButton = (
    <Button type="button" variant="highlight" disabled={!board} onClick={() => setWizard({})}>
      <Plus aria-hidden="true" />
      Connect a vendor
    </Button>
  );

  const header = (
    <SettingsSectionHeader
      tabs={
        <UnderlineTabs
          label="Lead posting"
          tabs={[
            { key: "vendors", label: "Vendors", count: board ? board.vendors.length : null },
            { key: "activity", label: "Activity" },
            { key: "rejections", label: "Rejections", count: board ? board.figures.refusedToday || null : null, tone: "danger" },
            { key: "guide", label: "Vendor guide" },
          ]}
          value={tab}
          onChange={setTab}
        />
      }
      actions={
        <>
          {tab === "rejections" ? (
            <Button asChild variant="outline"><a href={`/api/app/lead-post-keys/rejections?days=${days}&tz=${encodeURIComponent(viewerTimeZone())}&format=csv`} download><Download aria-hidden="true" />Export CSV</a></Button>
          ) : (
            <Button type="button" variant="outline" disabled={!board} onClick={() => board && void copyText(`${origin}${board.postingPath}`, "Posting address copied.")}><Copy aria-hidden="true" />Copy posting address</Button>
          )}
          {connectButton}
        </>
      }
    />
  );

  if (error && !board) {
    return (
      <SettingsStack>
        {header}
        <StatusLine tone="bad">Vendors didn&rsquo;t load · <InlineLink onClick={() => void load()}>try again</InlineLink></StatusLine>
        <TableCard title="Vendors">
          <ErrorState title="Couldn't load your vendors" detail="Posts are still being accepted; only this page failed to load." action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} />
        </TableCard>
      </SettingsStack>
    );
  }
  if (!board) {
    return (
      <SettingsStack>
        {header}
        <StatusLine tone="muted">Reading your vendors</StatusLine>
        <TableCard title="Vendors"><SectionLoading label="Loading your vendors" rows={6} columns={6} /></TableCard>
      </SettingsStack>
    );
  }

  // ── the status line ──────────────────────────────────────────────────────────
  const posting = board.vendors.filter((row) => row.status === "live" || row.status === "needs_you").length;
  const lastLead = board.vendors.filter((row) => row.lastPostAt && !row.lastPostWasTest).map((row) => row.lastPostAt as string).sort().reverse()[0] ?? null;
  const worst = board.vendors.filter((row) => row.status === "needs_you").sort((a, b) => b.week.refused - a.week.refused)[0] ?? null;
  const pending = !board.r8Ready ? " · Test mode, prices, caps, hours and status calls need a database update" : "";
  let statusTone: "ok" | "warn" | "bad" | "muted" = board.vendors.length ? "ok" : "muted";
  let statusText: React.ReactNode = board.vendors.length
    ? <>{posting} {posting === 1 ? "vendor" : "vendors"} posting{lastLead ? ` · last lead ${ago(lastLead)}` : ""}</>
    : <>No vendors connected yet</>;
  if (tab === "rejections" && refused) {
    const top = repeatingReasons(refused.rows)[0];
    const total = refused.rows.length;
    statusTone = total ? "warn" : "ok";
    statusText = total
      ? <>{total} refused {days === 1 ? "today" : `in ${days} days`}{top && top.count > 1 ? ` · ${top.count} have the same cause, ${top.vendorName}'s ${(REASON_WORDS[top.reasonCode] ?? top.reasonCode).toLowerCase()}` : ""}</>
      : <>Nothing refused {days === 1 ? "today" : `in ${days} days`}</>;
  } else if (worst) {
    statusTone = "warn";
    statusText = (
      <>
        {statusText} · {worst.vendorName} {worst.week.refused ? `refused ${worst.week.refused} of its last ${worst.week.posts} posts` : `has ${worst.needsYou ?? "fields"} not read`} —{" "}
        <InlineLink onClick={() => openById(worst.vendorId, "map")}>fix its field map</InlineLink>
      </>
    );
  }
  if (error) {
    statusTone = "bad";
    statusText = <>Vendors didn&rsquo;t refresh · <InlineLink onClick={() => void load()}>try again</InlineLink></>;
  }

  return (
    <SettingsStack className="gap-4">
      {header}
      <StatusLine tone={statusTone}>{statusText}{pending}</StatusLine>

      {tab === "vendors" && (
        <VendorTable
          board={board}
          filter={filter}
          onFilter={setFilter}
          query={query}
          onQuery={setQuery}
          selectedVendorId={sheet?.vendorId ?? null}
          onOpen={(row) => open(row)}
          firstDialSeconds={firstDial}
          connectButton={connectButton}
          onGuide={() => setTab("guide")}
        />
      )}

      {tab === "activity" && (
        <TableCard title="Every post" info="Every vendor, newest first. Payloads stay out of sight; open the lead for its details. Test posts are marked and never become leads.">
          <div className="max-h-[calc(100vh-320px)] min-h-[200px] overflow-y-auto">
            {activityError ? (
              <ErrorState title="Posts didn't load" detail={activityError} action={<Button type="button" variant="outline" onClick={() => void loadActivity()}>Try again</Button>} />
            ) : !activity ? (
              <LoadingRows rows={6} columns={4} />
            ) : activity.recent.length === 0 ? (
              <p className="m-0 px-4 py-8 text-center text-sm text-[var(--muted)]">No vendor has posted yet.</p>
            ) : (
              <PostsTable rows={activity.recent} vendorName={(id) => board.vendors.find((row) => row.vendorId === id)?.vendorName ?? board.allVendors.find((vendor) => vendor.id === id)?.name ?? "Unknown vendor"} withVendor label="Every post" />
            )}
          </div>
        </TableCard>
      )}

      {tab === "rejections" && (
        <RejectionsTab
          board={board}
          days={days}
          onDays={(next) => { setRefused(null); setDays(next); }}
          vendorFilter={vendorFilter}
          onVendorFilter={setVendorFilter}
          refused={refused}
          error={refusedError}
          onRetry={() => void loadRefused(days)}
          onFixMap={(vendorId) => openById(vendorId, "map")}
          onTellVendor={tell}
          onRotate={(vendorId) => { const row = vendorOf(vendorId); if (row) setRotating(row); }}
        />
      )}

      {tab === "guide" && <GuideTab board={board} origin={origin} />}

      {sheetRow && sheet && (
        <VendorSheet
          key={sheetRow.vendorId}
          row={sheetRow}
          board={board}
          origin={origin}
          tab={sheet.tab}
          onTab={(next) => setSheet({ vendorId: sheetRow.vendorId, tab: next })}
          onClose={() => setSheet(null)}
          onChanged={reloadAll}
          onRotate={() => (sheetRow.key.isActive ? setRotating(sheetRow) : setWizard({ vendorId: sheetRow.vendorId }))}
          onRevoke={() => setRevoking(sheetRow)}
          onEnable={() => void setActive(sheetRow, true)}
          activity={activity}
          activityError={activityError}
          speed={speed}
        />
      )}

      {wizard && <ConnectWizard board={board} origin={origin} presetVendorId={wizard.vendorId} onClose={() => setWizard(null)} onConnected={reloadAll} />}
      {rotating && <RotateDialog vendorName={rotating.vendorName} r8Ready={board.r8Ready} busy={busy} onCancel={() => setRotating(null)} onRotate={(input) => void rotate(rotating, input)} />}
      {revoking && <RevokeDialog vendorName={revoking.vendorName} busy={busy} onCancel={() => setRevoking(null)} onRevoke={() => void setActive(revoking, false)} />}
      {reveal && (
        <RevealDialog
          vendorName={reveal.vendorName}
          value={reveal.key}
          postingUrl={`${origin}${board.postingPath}`}
          graceUntil={reveal.graceUntil}
          onDone={() => {
            const after = reveal.emailAfter;
            setReveal(null);
            if (after) void emailInstructions({ keyId: after.keyId, vendorName: reveal.vendorName, to: after.to, agencyName: board.agencyName, recordSent: board.r8Ready });
          }}
        />
      )}
    </SettingsStack>
  );
}
