"use client";

import Link from "next/link";
import { StatusChip } from "@/components/ui/status-chip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, FlaskConical, Plus, X } from "lucide-react";

import { notify } from "@/lib/notify";
import { dayMonthYear } from "@/lib/format/dates";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Callout, control, Field, SettingsCard, SettingsMeter, SettingsSectionHeader, SettingsStack, st, pillTone } from "@/components/app/settings/primitives";
import { cn } from "@/lib/utils";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { canonicalFieldMap, FIELD_RULES, KNOWN_LEAD_FIELDS, OUR_FIELD_PATTERN, readFieldMap } from "@/lib/leadPost/fieldMap";
import { checkSample, guessFieldMap, NOT_CHECKED_HERE, parseSample } from "@/lib/leadPost/sampleCheck";
import { REJECTION_LABELS, REJECTION_TONE, type PostActivity, type PostKey, type PostKeysLoaded } from "@/lib/leadPost/types";
import type { CampaignSpeedRow } from "@/lib/leadPost/campaignSpeed";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { LeaveGuard } from "@/components/ui/leave-guard";

/**
 * Settings › Lead posting (LA-2.5), owner pick A "Vendors" (canvas settings-lead-posting, 2026-10-30).
 *
 * Vendors post leads by API the moment someone fills a form; each post is mapped, scrubbed,
 * de-duplicated and queued at the top, or rejected with a reason — and a rejected post is a lead the
 * agency is not billed for. The page reads top to bottom: where vendors post, the 30-day figures,
 * then one card per key on the left and the picked key's whole story on the right (its key and
 * campaign, its field map, why its posts bounced, its recent posts). Live posts from every vendor
 * sit under the cards. "Connect a vendor" makes a key, shows it once, and checks a sample post.
 */

// One date form across Settings ("28 Oct 2026"; settings audit P9), in the viewer's own zone.
const when = (value: string | null) => (value ? dayMonthYear(value, viewerTimeZone()) : null);
const fmt = (n: number) => n.toLocaleString();

/** A row of the field-map draft. `id` is local, so React keys survive edits to either name. */
type DraftRow = { id: string; theirs: string; ours: string; note: string };
type Tab = "key" | "map" | "rejections" | "posts";
const TABS: { key: Tab; label: string }[] = [
  { key: "key", label: "Key & campaign" },
  { key: "map", label: "Field map" },
  { key: "rejections", label: "Rejections" },
  { key: "posts", label: "Recent posts" },
];

let rowSeq = 0;
const nextRowId = () => `row-${++rowSeq}`;

function draftFromKey(key: PostKey | null): DraftRow[] {
  if (!key) return [];
  const notes = key.fieldNotes ?? {};
  return readFieldMap(key.fieldMap).map((entry) => ({ id: nextRowId(), theirs: entry.theirs, ours: entry.ours, note: notes[entry.ours] ?? "" }));
}

function notesOf(rows: DraftRow[]) {
  return Object.fromEntries(rows.filter((row) => row.ours.trim() && row.note.trim()).map((row) => [row.ours.trim(), row.note.trim()]));
}

const same = (a: Record<string, string>, b: Record<string, string>) => {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((key) => a[key] === b[key]);
};

/** Code at 14px: the scale has no 13. */
const code = cn(st.code, "text-sm");

const cellInput =
  "h-9 w-full min-w-0 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)] disabled:opacity-60";

async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error ?? "Something went wrong");
  return json;
}

/** Where a key stands, in a word: posting, never posted (the vendor never finished their side), disabled. */
function keyState(key: PostKey) {
  if (!key.isActive) return { label: "Disabled", tone: "neutral" as const };
  if (!key.lastUsedAt) return { label: "Never posted", tone: "warning" as const };
  return { label: "Posting", tone: "success" as const };
}

const seconds = (value: number | null) => {
  if (value === null) return "—";
  if (value < 60) return `${Math.round(value)} s`;
  const minutes = Math.floor(value / 60);
  return minutes < 60 ? `${minutes} min ${Math.round(value % 60)} s` : `${Math.round(minutes / 60)} h`;
};

/** The reason's fix, in the panel beside it. Null where there is nothing to do but not pay. */
type Fix = { label: string; href?: string; tab?: "map"; rotate?: boolean } | null;
function fixFor(reasonCode: string, key: PostKey | null): Fix {
  switch (reasonCode) {
    case "invalid_phone":
    case "unknown_state":
    case "missing_required_field":
    case "invalid_date_of_birth":
    case "missing_consent_text":
    case "missing_consent_ip":
      return { label: "Check the field map", tab: "map" };
    case "state_not_licensed":
      return { label: "Add a licence", href: "/app/settings#contracting" };
    case "campaign_not_accepting":
      return { label: "Open the campaign", href: key?.campaignId ? `/app/campaigns/${key.campaignId}` : "/app/campaigns" };
    case "unauthorised":
      return key ? { label: "Rotate and resend the key", rotate: true } : null;
    default:
      return null;
  }
}

/** What a reason means for the bill, for the reasons whose fix is not on this screen. */
const REASON_NOTE: Record<string, string> = {
  duplicate: "Already yours, so not billed. Send the vendor the count.",
  suppressed_litigator: "Scrubbed out and not billed.",
  suppressed_internal: "On your own do-not-call list; not billed.",
  suppressed_dnc: "On a do-not-call registry; not billed.",
  scrub_unavailable: "The suppression check was down; the vendor can retry.",
  rate_limited: "Ask the vendor to post more slowly.",
};

export function LeadPostKeysSettings() {
  const [loaded, setLoaded] = useState<PostKeysLoaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [connectStep, setConnectStep] = useState<0 | 1 | 2 | 3>(0);
  const [mintVendor, setMintVendor] = useState("");
  const [mintCampaign, setMintCampaign] = useState("");
  const [mintError, setMintError] = useState<string | null>(null);
  const [campaignError, setCampaignError] = useState<{ keyId: string; message: string } | null>(null);
  // Shown once, then gone. Kept in state rather than re-fetchable, because the server cannot
  // return it again — and a screen that pretended otherwise would be lying about the storage.
  const [revealed, setRevealed] = useState<{ key: string; vendorName: string } | null>(null);
  const [activity, setActivity] = useState<PostActivity | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  // Null until read; an empty list when the plan has no dialing (the route answers 403) or it failed.
  const [speed, setSpeed] = useState<CampaignSpeedRow[] | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const [tab, setTab] = useState<Tab>("key");
  const [sampleFor, setSampleFor] = useState<PostKey | null>(null);

  const [selectedKeyId, setSelectedKeyIdState] = useState("");
  // Mirrors selectedKeyId for `load`, which runs from an effect and must not close over state.
  const selectedRef = useRef("");
  const setSelectedKeyId = useCallback((id: string) => {
    selectedRef.current = id;
    setSelectedKeyIdState(id);
  }, []);
  const [draft, setDraft] = useState<DraftRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [keyQuery, setKeyQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // A promise chain, not async/await: the effect below calls this on mount and every setState has
  // to land in a callback rather than anywhere the linter can reach it synchronously.
  const load = useCallback(
    (select?: string) =>
      fetch("/api/app/lead-post-keys", { cache: "no-store" })
        .then(async (response) => {
          const body = await response.json().catch(() => null);
          if (!response.ok) throw new Error(body?.error ?? "Could not load your posting keys");
          return body as PostKeysLoaded;
        })
        .then((body) => {
          setError(null);
          setLoaded(body);
          const wanted = select ?? selectedRef.current;
          const next = body.keys.find((key) => key.id === wanted) ?? (wanted === "none" ? undefined : body.keys.find((key) => key.isActive) ?? body.keys[0]);
          setSelectedKeyId(next?.id ?? "");
          setDraft(draftFromKey(next ?? null));
          setEditing(false);
          setSaveError(null);
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not load your posting keys");
        }),
    [setSelectedKeyId],
  );

  // Recent posts, rejections per vendor and speed to lead: read beside the keys, never blocking them.
  const loadActivity = useCallback(
    () =>
      Promise.all([
        fetch("/api/app/lead-post-keys/activity", { cache: "no-store" })
          .then(async (response) => {
            const body = await response.json().catch(() => null);
            if (!response.ok) throw new Error(body?.error ?? "Could not load recent posts");
            setActivity(body as PostActivity);
            setActivityError(null);
          })
          .catch((cause: unknown) => setActivityError(cause instanceof Error ? cause.message : "Could not load recent posts")),
        fetch("/api/app/campaigns/speed-to-lead", { cache: "no-store" })
          .then(async (response) => {
            const body = await response.json().catch(() => null);
            setSpeed(response.ok && Array.isArray(body?.campaigns) ? (body.campaigns as CampaignSpeedRow[]) : []);
          })
          .catch(() => setSpeed([])),
      ]),
    [],
  );

  useEffect(() => {
    void load();
    void loadActivity();
  }, [load, loadActivity]);

  const selectedKey = loaded?.keys.find((key) => key.id === selectedKeyId) ?? null;

  const draftProblems = useMemo(() => {
    const problems = new Map<string, string>();
    const seen = new Set<string>();
    for (const row of draft) {
      const ours = row.ours.trim();
      const theirs = row.theirs.trim();
      if (!ours && !theirs) continue;
      if (!theirs) problems.set(row.id, "Enter the name they send.");
      else if (theirs.length > 120) problems.set(row.id, "Their field name is too long.");
      else if (!OUR_FIELD_PATTERN.test(ours)) problems.set(row.id, "Your field: lowercase letters, numbers and underscores, starting with a letter.");
      else if (seen.has(ours)) problems.set(row.id, `${ours} is already mapped above.`);
      else if (row.note.trim().length > 200) problems.set(row.id, "Keep the note under 200 characters.");
      seen.add(ours);
    }
    return problems;
  }, [draft]);

  const draftMap = canonicalFieldMap(draft);
  const vendorKeys = selectedKey ? (loaded?.keys ?? []).filter((key) => key.vendorId === selectedKey.vendorId) : [];
  const vendorMapsDiffer = vendorKeys.some((key) => !same(canonicalFieldMap(readFieldMap(key.fieldMap)), canonicalFieldMap(readFieldMap(selectedKey?.fieldMap))));
  const inverted = selectedKey ? readFieldMap(selectedKey.fieldMap).filter((entry) => entry.inverted).length : 0;
  const dirty =
    selectedKey !== null &&
    (!same(draftMap, selectedKey.fieldMap) || (loaded?.schemaReady === true && !same(notesOf(draft), selectedKey.fieldNotes)));

  async function selectKey(id: string) {
    if (id === selectedKeyId) return;
    if (dirty && !(await confirmAction({ title: "Discard your field-map changes?", description: "The unsaved changes to this field map are lost.", confirmLabel: "Discard changes", cancelLabel: "Keep editing" }))) return;
    const key = loaded?.keys.find((item) => item.id === id) ?? null;
    setSelectedKeyId(id);
    setDraft(draftFromKey(key));
    setEditing(false);
    setSaveError(null);
  }

  async function closePanel() {
    if (dirty && !(await confirmAction({ title: "Discard your field-map changes?", description: "The unsaved changes to this field map are lost.", confirmLabel: "Discard changes", cancelLabel: "Keep editing" }))) return;
    setSelectedKeyId("none");
    setDraft([]);
    setEditing(false);
    setSaveError(null);
  }

  function discard() {
    setDraft(draftFromKey(selectedKey));
    setEditing(false);
    setSaveError(null);
  }

  /** True when it saved; the leave guard stays on the page otherwise, with the error shown. */
  async function save(): Promise<boolean> {
    if (!selectedKey || draftProblems.size > 0) return false;
    setSaving(true);
    setSaveError(null);
    try {
      await send(`/api/app/lead-post-keys/${selectedKey.id}`, "PATCH", {
        action: "field_map",
        fieldMap: draftMap,
        ...(loaded?.schemaReady ? { fieldNotes: notesOf(draft) } : {}),
      });
      notify.done(vendorKeys.length > 1 ? `Field map saved to all ${vendorKeys.length} of ${selectedKey.vendorName}'s keys.` : "Field map saved.");
      await load(selectedKey.id);
      return true;
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save the field map");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function mint(event: React.FormEvent) {
    event.preventDefault();
    setBusy("mint");
    setMintError(null);
    try {
      const body = await send("/api/app/lead-post-keys", "POST", { vendorId: mintVendor, ...(mintCampaign ? { campaignId: mintCampaign } : {}) });
      setRevealed({ key: body.key, vendorName: body.record.vendorName });
      setConnectStep(2);
      setMintVendor("");
      setMintCampaign("");
      setTab("key");
      await load(body.record.id);
    } catch (cause) {
      setMintError(cause instanceof Error ? cause.message : "Could not create the key");
    } finally {
      setBusy(null);
    }
  }

  function closeConnect() {
    setConnectStep(0);
    setMintError(null);
    // The key exists only on this screen until the dialog closes; past step 2 it is gone for good.
    setRevealed(null);
  }

  // Revoking is confirmed in its own dialog (p-ov-confirm-revoke): the vendor's integration starts
  // failing the moment it lands, so the owner types the vendor's name rather than clicking through.
  const [revoking, setRevoking] = useState<PostKey | null>(null);
  const [revokeTyped, setRevokeTyped] = useState("");

  async function act(key: PostKey, action: "rotate" | "activate" | "deactivate"): Promise<boolean> {
    if (action === "rotate" && !(await confirmAction({ title: `Rotate ${key.vendorName}'s key?`, description: "Their current key stops working, so send them the new one straight away.", confirmLabel: "Rotate key", cancelLabel: "Keep current key" }))) return false;
    setBusy(key.id);
    try {
      const body = await send(`/api/app/lead-post-keys/${key.id}`, "PATCH", { action });
      if (action === "rotate") setRevealed({ key: body.key, vendorName: key.vendorName });
      else notify.done(action === "activate" ? "Key enabled." : `${key.vendorName}'s key revoked.`);
      await load(action === "rotate" ? body.record.id : key.id);
      return true;
    } catch (cause) {
      notify.block(cause instanceof Error ? cause.message : "Could not change that key");
      return false;
    } finally {
      setBusy(null);
    }
  }

  function openRevoke(key: PostKey) {
    setRevokeTyped("");
    setRevoking(key);
  }

  async function confirmRevoke() {
    if (!revoking || revokeTyped.trim().toLowerCase() !== revoking.vendorName.trim().toLowerCase()) return;
    if (await act(revoking, "deactivate")) setRevoking(null);
  }

  async function bindCampaign(key: PostKey, campaignId: string) {
    if ((key.campaignId ?? "") === campaignId) return;
    setBusy(key.id);
    setCampaignError(null);
    try {
      await send(`/api/app/lead-post-keys/${key.id}`, "PATCH", { action: "campaign", campaignId: campaignId || null });
      notify.done(campaignId ? "Key bound to that campaign." : "Key posts to the vendor's accepting campaign.");
      await load(selectedKeyId);
    } catch (cause) {
      setCampaignError({ keyId: key.id, message: cause instanceof Error ? cause.message : "Could not bind that campaign" });
    } finally {
      setBusy(null);
    }
  }

  /** The sample's guessed rows into the editor; the save bar then saves them like any edit. */
  function applyGuess(key: PostKey, rows: { ours: string; theirs: string }[]) {
    if (!rows.length) return;
    const base = key.id === selectedKeyId ? draft : draftFromKey(key);
    if (key.id !== selectedKeyId) setSelectedKeyId(key.id);
    setDraft([...base, ...rows.map((row) => ({ id: nextRowId(), theirs: row.theirs, ours: row.ours, note: "" }))]);
    setEditing(true);
    setTab("map");
    notify.done(`${rows.length} ${rows.length === 1 ? "field" : "fields"} added to the map. Save to keep ${rows.length === 1 ? "it" : "them"}.`);
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify.done("Copied.");
    } catch {
      // Clipboard access can be refused, and a silent no-op would look like a copy that worked.
      notify.fail("Your browser would not let us copy. Select the text and copy it by hand.");
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  // The older, global URL. Vendors already set up on it (header or key-in-path) keep working.
  const legacyUrl = `${origin}/api/leads/post`;

  async function refresh() {
    // Reloading resets the field-map draft, so ask first — the same question switching keys asks.
    if (dirty && !(await confirmAction({ title: "Discard your field-map changes?", description: "The unsaved changes to this field map are lost.", confirmLabel: "Discard changes", cancelLabel: "Keep editing" }))) return;
    setRefreshing(true);
    try { await Promise.all([load(selectedKeyId), loadActivity()]); } finally { setRefreshing(false); }
  }

  const connectButton = (
    <Button type="button" onClick={() => { setMintError(null); setConnectStep(1); }} disabled={!loaded || loaded.vendors.length === 0}>
      <Plus aria-hidden="true" />
      Connect a vendor
    </Button>
  );

  if (error) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <Callout tone="error" title={error} />
      </SettingsStack>
    );
  }
  if (!loaded) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <TableCard><SectionLoading label="Loading your posting keys" /></TableCard>
      </SettingsStack>
    );
  }

  // One URL per workspace: the path names this workspace, the key names the vendor and campaign.
  const headerUrl = `${origin}/api/post/${loaded.workspaceId}`;
  const statsByKey = new Map(loaded.stats.map((row) => [row.keyId, row]));
  const campaignsByVendor = (vendorId: string) => loaded.campaigns.filter((campaign) => campaign.vendorId === vendorId);
  const campaignName = (key: PostKey) => (key.campaignId ? loaded.campaigns.find((item) => item.id === key.campaignId)?.name ?? "A bound campaign" : "Vendor’s accepting campaign");
  const vendorName = (id: string | null) => loaded.vendors.find((vendor) => vendor.id === id)?.name ?? "Unknown vendor";
  const totalRejected = loaded.rejections.reduce((sum, row) => sum + row.count, 0);
  const totalPosts = loaded.stats.reduce((sum, row) => sum + row.posts + row.earlierPosts, 0);
  const mintCampaigns = campaignsByVendor(mintVendor);
  const keyNeedle = keyQuery.trim().toLowerCase();
  const shownKeys = loaded.keys.filter((key) => !keyNeedle || key.vendorName.toLowerCase().includes(keyNeedle) || key.keyPrefix.toLowerCase().includes(keyNeedle));
  const posted = (speed ?? []).reduce((sum, row) => sum + row.postedLeads, 0);
  const within = (speed ?? []).reduce((sum, row) => sum + row.dialledWithin60s, 0);
  const vendorSpeed = selectedKey ? (speed ?? []).filter((row) => row.vendorId === selectedKey.vendorId && row.postedLeads > 0) : [];
  const vendorRejections = selectedKey ? (activity?.byVendor ?? []).filter((row) => row.vendorId === selectedKey.vendorId) : [];
  const vendorRejected = vendorRejections.reduce((sum, row) => sum + row.count, 0);
  const vendorPosts = selectedKey ? (activity?.recent ?? []).filter((row) => row.vendorId === selectedKey.vendorId) : [];

  const postsTable = (rows: PostActivity["recent"], withVendor: boolean) => (
    <table className={st.table}>
      <thead>
        <tr className={st.headRow}>
          <th scope="col" className={cn(st.th, "w-[150px]")}>Arrived</th>
          {withVendor && <th scope="col" className={st.th}>Vendor</th>}
          <th scope="col" className={st.th}>Outcome</th>
          <th scope="col" className={cn(st.th, "w-[90px] text-right")}>Took</th>
          <th scope="col" className={cn(st.th, "w-[110px]")}><span className="sr-only">Lead</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.receivedAt}-${index}`}>
            <td className={cn(st.td, "tabular-nums whitespace-nowrap")}>{dateTime(row.receivedAt, viewerTimeZone())}</td>
            {withVendor && <td className={cn(st.td, st.strong)}>{vendorName(row.vendorId)}</td>}
            <td className={st.td}>
              {row.outcome === "accepted"
                ? <StatusChip tone="good">Accepted</StatusChip>
                : <StatusChip tone={row.outcome === "error" ? "warning" : "danger"}>{REJECTION_LABELS[row.reasonCode] ?? row.reasonCode}</StatusChip>}
            </td>
            <td className={cn(st.td, st.num)}>{row.processingMs === null ? "—" : `${(row.processingMs / 1000).toFixed(1)} s`}</td>
            <td className={cn(st.td, "text-right")}>{row.leadId && <Link href={`/app/leads/${row.leadId}`} className="text-sm font-semibold text-[var(--accent-ink)] hover:underline">Open lead</Link>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const fixButton = (fix: Fix, key: PostKey | null) => {
    if (!fix) return null;
    if (fix.href) return <Button asChild variant="outline" size="sm"><Link href={fix.href}>{fix.label}</Link></Button>;
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => {
        if (fix.rotate && key) void act(key, "rotate");
        else if (fix.tab) { setTab("map"); setEditing(true); }
      }}>{fix.label}</Button>
    );
  };

  const fact = (label: string, value: React.ReactNode, sub?: React.ReactNode) => (
    <div className="min-w-0 rounded-[10px] bg-[var(--surface-alt)] px-3 py-2.5">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--ink)]">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--muted)]">{sub}</div>}
    </div>
  );

  const key = selectedKey;
  const keyStats = key ? statsByKey.get(key.id) : undefined;
  const panelState = key ? keyState(key) : null;
  const keyCampaigns = key ? campaignsByVendor(key.vendorId) : [];
  const busyKey = key !== null && busy === key.id;
  const panel = key && panelState && (
      <SettingsCard
        title={key.vendorName}
        sub={<span className="flex flex-wrap items-center gap-2"><StatusChip tone={pillTone(panelState.tone)} dot>{panelState.label}</StatusChip>{campaignName(key)}</span>}
        action={<Button type="button" variant="ghost" size="icon" aria-label="Close the vendor" onClick={() => void closePanel()}><X aria-hidden="true" /></Button>}
        className="lg:sticky lg:top-4"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${key.vendorName}'s sections`}>
            {TABS.map((item) => (
              <ToggleChip key={item.key} selected={tab === item.key} onClick={() => setTab(item.key)} count={item.key === "rejections" && vendorRejected ? vendorRejected : undefined}>{item.label}</ToggleChip>
            ))}
          </div>

          {tab === "key" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {fact("Key", <code className={code}>{key.keyPrefix}&hellip;</code>)}
                {fact(
                  `Posts / rejected, ${loaded.windowDays} days`,
                  `${fmt(keyStats?.posts ?? 0)} / ${fmt(keyStats?.rejected ?? 0)}`,
                  keyStats?.perVendor ? "All of this vendor’s keys" : keyStats?.earlierPosts ? `+${fmt(keyStats.earlierPosts)} before per-key counts` : undefined,
                )}
                {fact("First dial, median", vendorSpeed.length ? seconds(vendorSpeed[0].medianSeconds) : "—", vendorSpeed.length ? `${vendorSpeed[0].dialledWithin60sPct ?? 0}% inside a minute` : "No posted lead dialed yet")}
              </div>
              <p className="m-0 text-xs text-[var(--muted)]">
                Created {when(key.createdAt) ?? "—"}
                {key.rotatedAt ? ` · retired ${when(key.rotatedAt)}` : ""}
                {/* "Never used" is worth saying out loud: a key minted three weeks ago that has never
                    been called means the vendor never finished their side. */}
                {key.lastUsedAt ? ` · last used ${when(key.lastUsedAt)}` : " · never used"}
              </p>

              <div className="flex flex-col gap-2">
                <span className="text-label text-[var(--muted)]">Posts into</span>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Campaign for ${key.vendorName}’s key`}>
                  <ToggleChip role="radio" selected={!key.campaignId} disabled={!loaded.schemaReady || busyKey} onClick={() => void bindCampaign(key, "")}>Vendor’s accepting campaign</ToggleChip>
                  {keyCampaigns.map((campaign) => (
                    <ToggleChip key={campaign.id} role="radio" selected={key.campaignId === campaign.id} disabled={!loaded.schemaReady || busyKey} onClick={() => void bindCampaign(key, campaign.id)}>
                      {campaign.name}{campaign.status !== "active" ? ` (${campaign.status})` : ""}
                    </ToggleChip>
                  ))}
                </div>
                <span className="text-xs text-[var(--muted)]">
                  {loaded.schemaReady ? "A bound key posts to that campaign only." : "Campaign binding needs a database update that has not been applied yet."}
                </span>
                {campaignError?.keyId === key.id && <span role="alert" className="text-xs text-[var(--error-ink)]">{campaignError.message}</span>}
              </div>

              {vendorSpeed.length > 1 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-label text-[var(--muted)]">Speed to lead by campaign</span>
                  {vendorSpeed.map((row) => (
                    <div key={row.campaignId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-[var(--ink)]">{row.campaignName}</span>
                      <span className="shrink-0 tabular-nums text-[var(--body)]">{seconds(row.medianSeconds)} · {row.dialledWithin60sPct ?? 0}% inside a minute</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={busyKey} onClick={() => setSampleFor(key)}>
                  <FlaskConical aria-hidden="true" />
                  Check a sample post
                </Button>
                <Button type="button" variant="outline" disabled={busyKey} onClick={() => void act(key, "rotate")}>Rotate key</Button>
                {key.isActive ? (
                  <Button type="button" variant="outline" className="text-[var(--error-ink)]" disabled={busyKey} onClick={() => openRevoke(key)}>Revoke</Button>
                ) : (
                  <Button type="button" variant="outline" disabled={busyKey} onClick={() => void act(key, "activate")}>Enable</Button>
                )}
              </div>
            </div>
          )}

          {tab === "map" && (
            <div className="flex flex-col gap-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 text-sm text-[var(--muted)]">Their field names on the left, yours on the right.</p>
                <span className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setSampleFor(key)}><FlaskConical aria-hidden="true" />Check a sample post</Button>
                  {!editing && <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
                </span>
              </div>
              {vendorKeys.length > 1 && (
                <p className="m-0 text-xs text-[var(--muted)]">
                  {key.vendorName} has {vendorKeys.length} keys. Saving writes this map to all of them.
                </p>
              )}
              {vendorMapsDiffer && (
                <Callout tone="warning" title={`${key.vendorName}'s keys have different maps — saving applies this one to all of them.`} />
              )}
              {inverted > 0 && (
                <Callout tone="warning" title={`${inverted} ${inverted === 1 ? "field was" : "fields were"} stored the wrong way round — saving fixes ${inverted === 1 ? "it" : "them"}.`} />
              )}
              {saveError && <Callout tone="error" title="The field map was not saved">{saveError}</Callout>}
              <datalist id="lead-post-our-fields">
                {KNOWN_LEAD_FIELDS.map((field) => <option key={field} value={field} />)}
              </datalist>
              {draft.length === 0 && !editing ? (
                <p className="m-0 text-sm text-[var(--muted)]">
                  No fields mapped. Their payload is read as sent, so it must already use your names &mdash; phone, state and a name.
                </p>
              ) : (
                <TableCard>
                  <table className={st.table}>
                    <thead>
                      <tr className={st.headRow}>
                        <th scope="col" className={cn(st.th, "w-[30%]")}>Their field</th>
                        <th scope="col" className={cn(st.th, "w-[30%]")}>Your field</th>
                        <th scope="col" className={st.th}>Note</th>
                        {editing && <th scope="col" className={st.th}><span className="sr-only">Remove</span></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {draft.map((row, index) => {
                        const rule = FIELD_RULES[row.ours.trim()];
                        const problem = draftProblems.get(row.id);
                        const update = (patch: Partial<DraftRow>) => setDraft((rows) => rows.map((item) => (item.id === row.id ? { ...item, ...patch } : item)));
                        return editing ? (
                          <tr key={row.id}>
                            <td className={cn(st.td, "align-top")}>
                              <input aria-label={`Their field, row ${index + 1}`} className={cn(cellInput, "font-mono text-sm")} value={row.theirs} maxLength={120} placeholder="ph1" onChange={(event) => update({ theirs: event.target.value })} />
                            </td>
                            <td className={cn(st.td, "align-top")}>
                              <input aria-label={`Your field, row ${index + 1}`} list="lead-post-our-fields" className={cellInput} value={row.ours} maxLength={80} placeholder="phone" onChange={(event) => update({ ours: event.target.value.toLowerCase() })} aria-invalid={problem ? true : undefined} />
                            </td>
                            <td className={cn(st.td, "align-top")}>
                              <input
                                aria-label={`Note, row ${index + 1}`}
                                className={cellInput}
                                value={row.note}
                                maxLength={200}
                                placeholder={rule ?? "Optional"}
                                disabled={!loaded.schemaReady}
                                title={loaded.schemaReady ? undefined : "Notes need a database update that has not been applied yet."}
                                onChange={(event) => update({ note: event.target.value })}
                              />
                              {rule && <span className={st.sub}>{rule}</span>}
                              {problem && <span role="alert" className="mt-1 block text-xs text-[var(--error-ink)]">{problem}</span>}
                            </td>
                            <td className={cn(st.td, "align-top")}>
                              <Button type="button" variant="ghost" size="icon" className="text-[var(--error-ink)]" aria-label={`Remove row ${index + 1}`} onClick={() => setDraft((rows) => rows.filter((item) => item.id !== row.id))}>
                                <X aria-hidden="true" />
                              </Button>
                            </td>
                          </tr>
                        ) : (
                          <tr key={row.id}>
                            <td className={st.td}><code className={code}>{row.theirs}</code></td>
                            <td className={cn(st.td, st.strong)}>{row.ours}</td>
                            <td className={st.td}>
                              {row.note || rule || "—"}
                              {row.note && rule && <span className={st.sub}>{rule}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableCard>
              )}
              {editing && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button type="button" variant="outline" onClick={() => setDraft((rows) => [...rows, { id: nextRowId(), theirs: "", ours: "", note: "" }])}>
                    <Plus aria-hidden="true" /> Add a field
                  </Button>
                  {!loaded.schemaReady && <span className="text-xs text-[var(--muted)]">Notes need a database update; the map itself saves.</span>}
                </div>
              )}
            </div>
          )}

          {tab === "rejections" && (
            <div className="flex flex-col gap-3">
              <p className="m-0 text-sm text-[var(--muted)]">A rejected post is a lead you are not billed for. Each reason says what to do about it.</p>
              {activityError ? (
                <Callout tone="error" title={activityError} />
              ) : !activity ? (
                <SectionLoading label="Loading rejections" />
              ) : vendorRejections.length === 0 ? (
                <p className="m-0 text-sm text-[var(--muted)]">No posts from {key.vendorName} were rejected in the last {activity.windowDays} days.</p>
              ) : (
                vendorRejections.map((row) => {
                  const fix = fixFor(row.reasonCode, key);
                  return (
                    <div key={row.reasonCode} className="flex flex-col gap-2 rounded-[10px] bg-[var(--surface-alt)] px-3 py-2.5">
                      <SettingsMeter
                        value={row.count}
                        max={vendorRejected}
                        tone={REJECTION_TONE[row.reasonCode] ?? "warning"}
                        label={REJECTION_LABELS[row.reasonCode] ?? row.reasonCode}
                        valueLabel={fmt(row.count)}
                        ariaLabel={`${REJECTION_LABELS[row.reasonCode] ?? row.reasonCode}: ${row.count} of ${vendorRejected} rejected posts`}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-[var(--muted)]">{REASON_NOTE[row.reasonCode] ?? "Fix it and their next posts go through."}</span>
                        {fixButton(fix, key)}
                      </div>
                    </div>
                  );
                })
              )}
              {activity?.capped && <span className="text-xs text-[var(--muted)]">More than 10,000 rejected posts in the window; these counts are the first 10,000.</span>}
            </div>
          )}

          {tab === "posts" && (
            activityError ? (
              <Callout tone="error" title={activityError} />
            ) : !activity ? (
              <SectionLoading label="Loading recent posts" />
            ) : vendorPosts.length === 0 ? (
              <EmptyState title="No posts from this vendor yet" hint="Check a sample post to see what theirs would get, before a real one arrives." />
            ) : (
              <TableCard>{postsTable(vendorPosts.slice(0, 25), false)}</TableCard>
            )
          )}
        </div>
      </SettingsCard>
  );

  return (
    <SettingsStack>
      <SettingsSectionHeader actions={connectButton} />

      <SettingsCard pad={20} bodyClassName="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-label text-[var(--muted)]">Vendors post to</span>
          <code className="min-w-0 flex-1 truncate rounded-[8px] border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 font-mono text-sm text-[var(--ink)]">
            POST {headerUrl} &nbsp;&middot;&nbsp; Authorization: Bearer &lt;key&gt;
          </code>
          <Button type="button" variant="outline" onClick={() => void copy(headerUrl)}><Copy aria-hidden="true" />Copy</Button>
          <ToggleChip selected={showOlder} onClick={() => setShowOlder((value) => !value)}>Older URLs</ToggleChip>
        </div>
        {/* Kept for vendors already posting: the global URL, and the key-in-path form for systems that cannot set a header. */}
        {showOlder && (
          <p className="m-0 text-xs leading-[1.5] text-[var(--muted)]">
            Still accepted for vendors set up before: <span className="font-mono text-[var(--ink)]">{legacyUrl}</span> with the header, or <span className="font-mono text-[var(--ink)]">{legacyUrl}/&lt;key&gt;</span> for systems that cannot set a header.
          </p>
        )}
      </SettingsCard>

      <StatStrip label="Lead posting, last 30 days">
        <StatTile label={`Posts, ${loaded.windowDays} days`} value={fmt(totalPosts)} footnote={`${loaded.keys.filter((key) => key.isActive).length} live keys`} />
        <StatTile label="Accepted" value={totalPosts ? `${Math.round(((totalPosts - totalRejected) / totalPosts) * 100)}%` : "—"} valueTone={totalPosts ? "good" : undefined} footnote={`${fmt(Math.max(0, totalPosts - totalRejected))} queued at the top`} />
        <StatTile label="Rejected, not billed" value={fmt(totalRejected)} valueTone={totalRejected ? "warning" : undefined} footnote={`${loaded.rejections.length} ${loaded.rejections.length === 1 ? "reason" : "reasons"}`} />
        <StatTile label="Dialed inside a minute" labelTitle="Of every lead a vendor has posted, the share whose first Dial came within 60 seconds of arriving." value={speed === null ? "…" : posted ? `${Math.round((within / posted) * 100)}%` : "—"} valueTone={posted ? "good" : undefined} footnote={posted ? `${fmt(posted)} posted leads` : "No posted lead yet"} />
      </StatStrip>

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        <div className="flex min-w-0 flex-col gap-3">
          <DataToolbar actions={<RefreshButton onClick={() => void refresh()} refreshing={refreshing} />}>
            <ToolbarSearch value={keyQuery} onChange={setKeyQuery} placeholder="Search vendors or keys" />
          </DataToolbar>

          {loaded.vendors.length === 0 ? (
            <EmptyState title="No vendors yet" hint="A posting key belongs to a vendor, so add one on Vendors & campaigns first." />
          ) : loaded.keys.length === 0 ? (
            <EmptyState title="No posting keys yet" hint="Connect a vendor who delivers leads by API. The key is shown once, when it is created." action={connectButton} />
          ) : shownKeys.length === 0 ? (
            <NoMatches noun="keys" onClear={() => setKeyQuery("")} />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Posting keys">
              {shownKeys.map((key) => {
                const stats = statsByKey.get(key.id);
                const posts = stats?.posts ?? 0;
                const rejected = stats?.rejected ?? 0;
                const state = keyState(key);
                const on = key.id === selectedKeyId;
                const acceptedPct = posts ? Math.round(((posts - rejected) / posts) * 100) : 0;
                return (
                  <li key={key.id}>
                    <button
                      type="button"
                      onClick={() => void selectKey(key.id)}
                      aria-pressed={on}
                      aria-label={`Open ${key.vendorName}`}
                      className={cn(
                        "m-glass flex w-full flex-col gap-2 rounded-[12px] border px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
                        on ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)] hover:border-[var(--border-strong)]",
                        !key.isActive && "opacity-70",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)]">{key.vendorName}</span>
                        <StatusChip tone={pillTone(state.tone)} dot>{state.label}</StatusChip>
                      </span>
                      <span className="truncate text-xs text-[var(--muted)]">
                        {campaignName(key)} · <code className="font-mono">{key.keyPrefix}&hellip;</code>
                      </span>
                      <span className="flex h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]" aria-hidden="true">
                        {posts > 0 && <span className="bg-[var(--success)]" style={{ width: `${acceptedPct}%` }} />}
                        {posts > 0 && <span className="bg-[var(--error)]" style={{ width: `${100 - acceptedPct}%` }} />}
                      </span>
                      <span className="flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
                        <span className="tabular-nums"><strong className="text-[var(--ink)]">{fmt(posts)}</strong> posts · {fmt(rejected)} rejected</span>
                        <span>{key.lastUsedAt ? `last post ${when(key.lastUsedAt)}` : "never used"}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <SettingsCard title="Live posts" sub="Every vendor, newest first. Payloads stay out of sight; open the lead for its details." pad={20}>
            {activityError ? (
              <Callout tone="error" title={activityError} />
            ) : !activity ? (
              <SectionLoading label="Loading recent posts" />
            ) : activity.recent.length === 0 ? (
              <p className="m-0 text-sm text-[var(--muted)]">No vendor has posted yet.</p>
            ) : (
              <TableCard>{postsTable(activity.recent.slice(0, 12), true)}</TableCard>
            )}
          </SettingsCard>
        </div>

        {panel || (
          <SettingsCard title={`Rejections, last ${loaded.windowDays} days`} sub="Across every vendor. Open a vendor for its key, field map and posts." className="lg:sticky lg:top-4">
            {loaded.rejections.length === 0 ? (
              <p className="m-0 text-sm text-[var(--muted)]">No posts were rejected in the last {loaded.windowDays} days.</p>
            ) : (
              <div className="flex flex-col gap-3.5">
                {loaded.rejections.map((row) => (
                  <SettingsMeter
                    key={row.reasonCode}
                    value={row.count}
                    max={totalRejected}
                    tone={REJECTION_TONE[row.reasonCode] ?? "warning"}
                    label={REJECTION_LABELS[row.reasonCode] ?? row.reasonCode}
                    valueLabel={fmt(row.count)}
                    caption={(() => {
                      const vendors = (activity?.byVendor ?? []).filter((item) => item.reasonCode === row.reasonCode).map((item) => vendorName(item.vendorId));
                      return vendors.length ? `From ${vendors.join(", ")}` : undefined;
                    })()}
                    ariaLabel={`${REJECTION_LABELS[row.reasonCode] ?? row.reasonCode}: ${row.count} of ${totalRejected} rejected posts`}
                  />
                ))}
              </div>
            )}
          </SettingsCard>
        )}
      </div>

      {/* Connect a vendor: 1 vendor and campaign, 2 the key shown once, 3 check a sample post. */}
      <Dialog open={connectStep > 0} onOpenChange={(next) => { if (!next) closeConnect(); }}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>Connect a vendor</DialogTitle>
            <DialogDescription>
              <span className={cn(connectStep === 1 && "font-semibold text-[var(--ink)]")}>1 Vendor and campaign</span>{" › "}
              <span className={cn(connectStep === 2 && "font-semibold text-[var(--ink)]")}>2 Copy the key</span>{" › "}
              <span className={cn(connectStep === 3 && "font-semibold text-[var(--ink)]")}>3 Check a sample post</span>
            </DialogDescription>
          </DialogHeader>
          {connectStep === 1 && (
            <form onSubmit={mint} className="flex flex-col gap-4">
              <Field label="Vendor" htmlFor="mint-vendor" required>
                <select
                  id="mint-vendor"
                  required
                  className={control}
                  value={mintVendor}
                  onChange={(event) => { setMintVendor(event.target.value); setMintCampaign(""); }}
                >
                  <option value="">Choose a vendor</option>
                  {loaded.vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                  ))}
                </select>
              </Field>
              <Field
                label="Campaign"
                htmlFor="mint-campaign"
                hint={
                  loaded.schemaReady
                    ? "Optional. A bound key posts to this campaign only."
                    : "Campaign binding needs a database update that has not been applied yet; the key posts to the vendor's accepting campaign."
                }
              >
                <select
                  id="mint-campaign"
                  className={control}
                  value={mintCampaign}
                  disabled={!loaded.schemaReady || !mintVendor}
                  onChange={(event) => setMintCampaign(event.target.value)}
                >
                  <option value="">Vendor&rsquo;s accepting campaign</option>
                  {mintCampaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}{campaign.status !== "active" ? ` (${campaign.status})` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              {mintError && <span role="alert" className="text-xs text-[var(--error-ink)]">{mintError}</span>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeConnect}>Cancel</Button>
                <Button type="submit" disabled={busy === "mint" || !mintVendor}>
                  {busy === "mint" ? "Creating…" : "Create key"}
                </Button>
              </DialogFooter>
            </form>
          )}
          {connectStep === 2 && revealed && (
            <>
              <p className="m-0 text-sm text-[var(--body)]">{revealed.vendorName}&rsquo;s posting key. <strong className="text-[var(--ink)]">This is the only time it is shown</strong>; if it is lost, rotate it.</p>
              <div className="flex flex-col gap-3">
                <RevealLine label="Key" value={revealed.key} onCopy={copy} />
                <RevealLine label="Post to, with Authorization: Bearer <key>" value={headerUrl} onCopy={copy} />
                <RevealLine label="Or, key in the path (the older URL)" value={`${legacyUrl}/${revealed.key}`} onCopy={copy} />
              </div>
              <DialogFooter>
                <Button type="button" onClick={() => { setRevealed(null); setConnectStep(3); }}>I have copied it</Button>
              </DialogFooter>
            </>
          )}
          {connectStep === 3 && selectedKey && (
            <>
              <SamplePost postKey={selectedKey} onApply={(rows) => { applyGuess(selectedKey, rows); closeConnect(); }} />
              <DialogFooter>
                <Button type="button" onClick={closeConnect}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={sampleFor !== null} onOpenChange={(next) => { if (!next) setSampleFor(null); }}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>Check a sample post · {sampleFor?.vendorName}</DialogTitle>
            <DialogDescription>Paste one payload they send. Nothing is posted or saved.</DialogDescription>
          </DialogHeader>
          {sampleFor && (
            <SamplePost
              postKey={sampleFor.id === selectedKeyId && editing ? { ...sampleFor, fieldMap: draftMap } : sampleFor}
              onApply={(rows) => { applyGuess(sampleFor, rows); setSampleFor(null); }}
            />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSampleFor(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revoking !== null} onOpenChange={(next) => { if (!next && busy !== revoking?.id) setRevoking(null); }}>
        <DialogContent className="sm:max-w-[560px]">
          {revoking && (() => {
            const stats = statsByKey.get(revoking.id);
            const posts = stats?.posts ?? 0;
            const matches = revokeTyped.trim().toLowerCase() === revoking.vendorName.trim().toLowerCase();
            const factLine = (label: string, value: string) => (
              <div>
                <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-[var(--muted)]">{label}</div>
                <div className="mt-1 text-sm font-semibold tabular-nums text-[var(--ink)]">{value}</div>
              </div>
            );
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Revoke this posting key?</DialogTitle>
                  <DialogDescription>
                    {revoking.vendorName} · {campaignName(revoking)} · <code className={code}>{revoking.keyPrefix}&hellip;</code>
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                  <div className="rounded-[8px] border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-4">
                    <p className="text-sm font-semibold text-[var(--error-ink)]">{revoking.vendorName} stops being able to post the moment you confirm</p>
                    <p className="mt-1 text-sm leading-normal text-[var(--body)]">
                      Their integration will start receiving <code className={code}>401 Unauthorized</code>. Nothing warns them first, and there is no grace period.
                      {" "}{posts ? `${fmt(posts)} ${posts === 1 ? "lead" : "leads"} arrived on this key in the last ${loaded.windowDays} days${stats?.perVendor ? " (counted across this vendor’s keys)" : ""}.` : `No lead arrived on this key in the last ${loaded.windowDays} days.`}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-[8px] bg-[var(--surface-alt)] p-4">
                    {factLine(`Posts in the last ${loaded.windowDays} days`, fmt(posts))}
                    {factLine("Last post", revoking.lastUsedAt ? dateTime(revoking.lastUsedAt, viewerTimeZone()) : "Never used")}
                    {factLine("Campaign", campaignName(revoking))}
                    {factLine("Created", when(revoking.createdAt) ?? "—")}
                  </div>
                  <Field label="Type the vendor name to confirm" htmlFor="revoke-confirm-name" hint={<>Type <strong>{revoking.vendorName}</strong>. The key can be enabled again later.</>}>
                    <input id="revoke-confirm-name" className={control} autoComplete="off" value={revokeTyped} onChange={(event) => setRevokeTyped(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void confirmRevoke(); } }} />
                  </Field>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" disabled={busy === revoking.id} onClick={() => setRevoking(null)}>Keep the key</Button>
                  <Button type="button" variant="destructive" disabled={!matches || busy === revoking.id} onClick={() => void confirmRevoke()}>
                    {busy === revoking.id ? "Revoking…" : "Revoke the key"}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* A rotated key, shown once. A new vendor's key is shown inside Connect a vendor instead. */}
      <Dialog open={revealed !== null && connectStep === 0} onOpenChange={(next) => !next && setRevealed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{revealed?.vendorName}&rsquo;s posting key</DialogTitle>
            <DialogDescription>This is the only time this key is shown. If it is lost, rotate it.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <RevealLine label="Key" value={revealed?.key ?? ""} onCopy={copy} />
            <RevealLine label="Post to, with Authorization: Bearer <key>" value={headerUrl} onCopy={copy} />
            <RevealLine label="Or, key in the path (the older URL)" value={`${legacyUrl}/${revealed?.key ?? ""}`} onCopy={copy} />
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setRevealed(null)}>I have copied it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedKey && (
        <SettingsSaveBar visible={dirty} note={vendorKeys.length > 1 ? `Saving writes this map to all ${vendorKeys.length} of ${selectedKey.vendorName}'s keys` : "Unsaved changes to the field map"}>
          <Button type="button" variant="outline" onClick={discard} disabled={saving}>Discard</Button>
          <Button type="button" onClick={() => void save()} disabled={saving || draftProblems.size > 0}>{saving ? "Saving…" : "Save changes"}</Button>
        </SettingsSaveBar>
      )}
      <LeaveGuard dirty={dirty} onSave={save} onDiscard={discard} what={selectedKey ? `${selectedKey.vendorName}'s field map` : "this field map"} />
    </SettingsStack>
  );
}

/**
 * Check a sample post: paste one of the vendor's payloads, see the map it suggests and what the post
 * path's field checks would say (lib/leadPost/sampleCheck.ts). Nothing leaves the browser.
 */
function SamplePost({ postKey, onApply }: { postKey: PostKey; onApply: (rows: { ours: string; theirs: string }[]) => void }) {
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const parsed = checked === null ? null : parseSample(checked);
  const existing = readFieldMap(postKey.fieldMap);
  const payload = parsed && "payload" in parsed ? parsed.payload : null;
  const guess = payload ? guessFieldMap(payload, existing) : [];
  // The checks run on the map as it would be with the guess added, so "Add these" is the fix shown.
  const result = payload ? checkSample(payload, canonicalFieldMap([...existing, ...guess])) : null;

  return (
    <div className="flex flex-col gap-3">
      <Field label="Their payload" htmlFor="sample-payload" hint="JSON, or name=value pairs joined with &.">
        <textarea
          id="sample-payload"
          className={cn(control, "h-auto min-h-[120px] py-2 font-mono text-sm")}
          value={text}
          spellCheck={false}
          placeholder={'{"fname":"Ana","lname":"Ruiz","phone1":"(512) 555-0142","st":"TX","consent_text":"…","ip":"203.0.113.9"}'}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <div>
        <Button type="button" variant="outline" disabled={!text.trim()} onClick={() => setChecked(text)}>Check it</Button>
      </div>
      {parsed && "error" in parsed && <Callout tone="error" title={parsed.error} />}
      {result && (
        <>
          {guess.length > 0 && (
            <div className="flex flex-col gap-2 rounded-[10px] bg-[var(--surface-alt)] px-3 py-2.5">
              <span className="text-sm font-semibold text-[var(--ink)]">Fields to map</span>
              <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--body)]">
                {guess.map((row) => <span key={row.theirs}><code className={code}>{row.theirs}</code> → {row.ours}</span>)}
              </span>
              <div><Button type="button" size="sm" onClick={() => onApply(guess)}>Add these to the map</Button></div>
            </div>
          )}
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="What a real post would get">
            {result.checks.map((check) => (
              <li key={check.label} className="flex items-start gap-2 text-sm">
                {check.ok
                  ? <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
                  : <X aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--error-ink)]" />}
                <span><strong className="text-[var(--ink)]">{check.label}</strong> <span className="text-[var(--body)]">{check.detail}</span></span>
              </li>
            ))}
          </ul>
          {result.reasonCode
            ? <Callout tone="warning" title={`A real post would be rejected: ${REJECTION_LABELS[result.reasonCode] ?? result.reasonCode}.`} />
            : <Callout tone="success" title="The fields pass." >A real post also checks {NOT_CHECKED_HERE.join(", ")}.</Callout>}
        </>
      )}
    </div>
  );
}

function RevealLine({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string) => Promise<void> }) {
  return (
    <div>
      <span className="text-xs font-semibold text-[var(--muted)]">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 rounded-[8px] border border-[var(--border)] bg-[var(--surface-sunken)] p-3 font-mono text-sm break-all text-[var(--ink)]">{value}</code>
        <Button type="button" variant="outline" size="icon" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => void onCopy(value)}>
          <Copy aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
