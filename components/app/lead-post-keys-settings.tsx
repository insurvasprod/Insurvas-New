"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy } from "lucide-react";

import { notify } from "@/lib/notify";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Callout,
  control,
  DashedCard,
  DraftActions,
  Field,
  Pill,
  PlusIcon,
  SettingsCard,
  SettingsGrid,
  SettingsMeter,
  SettingsSectionHeader,
  SettingsStack,
  SettingsTableCard,
  btn,
  st,
} from "@/components/app/settings/primitives";
import { cn } from "@/lib/utils";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { canonicalFieldMap, FIELD_RULES, KNOWN_LEAD_FIELDS, OUR_FIELD_PATTERN, readFieldMap } from "@/lib/leadPost/fieldMap";
import { REJECTION_LABELS, REJECTION_TONE, type PostKey, type PostKeysLoaded } from "@/lib/leadPost/types";

const when = (value: string | null) => (value ? new Date(value).toLocaleDateString() : null);
const fmt = (n: number) => n.toLocaleString();

/** A row of the field-map draft. `id` is local, so React keys survive edits to either name. */
type DraftRow = { id: string; theirs: string; ours: string; note: string };

let rowSeq = 0;
const nextRowId = () => `row-${++rowSeq}`;

function draftFromKey(key: PostKey | null): DraftRow[] {
  if (!key) return [];
  // Read through the same tolerant reader the post path applies, so a map stored backwards by the
  // old mint dialog shows the way it is actually applied — and saves back the right way round.
  return readFieldMap(key.fieldMap).map((entry) => ({ id: nextRowId(), theirs: entry.theirs, ours: entry.ours, note: key.fieldNotes[entry.ours] ?? "" }));
}

function notesOf(rows: DraftRow[]) {
  return Object.fromEntries(rows.filter((row) => row.ours.trim() && row.note.trim()).map((row) => [row.ours.trim(), row.note.trim()]));
}

const same = (a: Record<string, string>, b: Record<string, string>) => {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((key, i) => key === bk[i] && a[key] === b[key]);
};

/** Code at 14px: the scale has no 13. */
const code = cn(st.code, "text-[14px]");

const cellInput =
  "box-border h-8 w-full min-w-0 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[14px] tracking-[-0.02em] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60";

async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error ?? "Could not save that change");
  return json;
}

export function LeadPostKeysSettings() {
  const [loaded, setLoaded] = useState<PostKeysLoaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [mintVendor, setMintVendor] = useState("");
  const [mintCampaign, setMintCampaign] = useState("");
  const [mintError, setMintError] = useState<string | null>(null);
  const [campaignError, setCampaignError] = useState<{ keyId: string; message: string } | null>(null);
  // Shown once, then gone. Kept in state rather than re-fetchable, because the server cannot
  // return it again — and a screen that pretended otherwise would be lying about the storage.
  const [revealed, setRevealed] = useState<{ key: string; vendorName: string } | null>(null);

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
          const next = body.keys.find((key) => key.id === wanted) ?? body.keys.find((key) => key.isActive) ?? body.keys[0];
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

  useEffect(() => {
    void load();
  }, [load]);

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

  function selectKey(id: string) {
    if (id === selectedKeyId) return;
    if (dirty && !window.confirm("Discard the unsaved changes to this field map?")) return;
    const key = loaded?.keys.find((item) => item.id === id) ?? null;
    setSelectedKeyId(id);
    setDraft(draftFromKey(key));
    setEditing(false);
    setSaveError(null);
  }

  function discard() {
    setDraft(draftFromKey(selectedKey));
    setEditing(false);
    setSaveError(null);
  }

  async function save() {
    if (!selectedKey || draftProblems.size > 0) return;
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
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save the field map");
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
      setMinting(false);
      setMintVendor("");
      setMintCampaign("");
      await load(body.record.id);
    } catch (cause) {
      setMintError(cause instanceof Error ? cause.message : "Could not create the key");
    } finally {
      setBusy(null);
    }
  }

  // Revoking is confirmed in its own dialog (p-ov-confirm-revoke): the vendor's integration starts
  // failing the moment it lands, so the owner types the vendor's name rather than clicking through.
  const [revoking, setRevoking] = useState<PostKey | null>(null);
  const [revokeTyped, setRevokeTyped] = useState("");

  async function act(key: PostKey, action: "rotate" | "activate" | "deactivate"): Promise<boolean> {
    if (action === "rotate" && !window.confirm(`Rotate ${key.vendorName}'s key? Their current key stops working, so send them the new one straight away.`)) return false;
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

  if (error) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <Callout tone="error" title="Could not load your posting keys">{error}</Callout>
      </SettingsStack>
    );
  }
  if (!loaded) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <p className="text-[14px] text-[var(--muted)]">Loading your posting keys…</p>
      </SettingsStack>
    );
  }

  // One URL per workspace: the path names this workspace, the key names the vendor and campaign.
  const headerUrl = `${origin}/api/post/${loaded.workspaceId}`;
  const statsByKey = new Map(loaded.stats.map((row) => [row.keyId, row]));
  const campaignsByVendor = (vendorId: string) => loaded.campaigns.filter((campaign) => campaign.vendorId === vendorId);
  const totalRejected = loaded.rejections.reduce((sum, row) => sum + row.count, 0);
  const mintCampaigns = campaignsByVendor(mintVendor);

  return (
    <SettingsStack>
      <SettingsSectionHeader
        actions={
          selectedKey ? (
            <DraftActions dirty={dirty} saving={saving} onDiscard={discard} onSave={() => void save()} disabled={draftProblems.size > 0} />
          ) : undefined
        }
      />

      <Callout tone="warning" title="A key is shown once, at creation, and never again">
        It is stored hashed. If a vendor loses it, the answer is a new key and the old one revoked &mdash; there is no
        screen anywhere that can reveal it, including to you.
      </Callout>

      <SettingsCard title="Where vendors post">
        <div className="flex flex-col gap-3.5">
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface-sunken)] px-3.5 py-3 font-mono text-[14px] break-all text-[var(--ink)]">
            POST {headerUrl} &nbsp;&middot;&nbsp; Authorization: Bearer &lt;key&gt;
          </div>
          <p className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
            One URL per workspace. The key identifies the vendor and the campaign, so the same URL attributes every post correctly.
          </p>
          {/* Kept for vendors already posting: the global URL, and the key-in-path form for systems that cannot set a header. */}
          <p className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
            Vendors already set up on <span className="font-mono">{legacyUrl}</span>, or with the key in the path (
            <span className="font-mono">{legacyUrl}/&lt;key&gt;</span>), keep working unchanged.
          </p>
        </div>
      </SettingsCard>

      <SettingsTableCard
        title="Posting keys"
        actions={
          <button type="button" className={btn("primary-sm")} onClick={() => setMinting(true)} disabled={loaded.vendors.length === 0}>
            <PlusIcon /> Create a key
          </button>
        }
      >
        {loaded.vendors.length === 0 ? (
          <div className="p-4">
            <DashedCard title="No vendors yet">
              A posting key belongs to a vendor, so add one on Vendors &amp; campaigns first. Then come back and mint them a key.
            </DashedCard>
          </div>
        ) : loaded.keys.length === 0 ? (
          <div className="p-4">
            <DashedCard title="No posting keys yet">
              Create one per vendor who delivers leads by API rather than by spreadsheet. They post to the URL above and
              the leads arrive already attributed.
            </DashedCard>
          </div>
        ) : (
          <table className={st.table}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={cn(st.th, "w-[220px]")}>Vendor</th>
                <th scope="col" className={cn(st.th, "w-[220px]")}>Campaign</th>
                <th scope="col" className={cn(st.th, "w-[180px]")}>Key</th>
                <th scope="col" className={cn(st.th, "w-[140px]")}>Posts ({loaded.windowDays}d)</th>
                <th scope="col" className={cn(st.th, "w-[130px]")}>Rejected</th>
                <th scope="col" className={st.th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loaded.keys.map((key) => {
                const stats = statsByKey.get(key.id);
                const campaigns = campaignsByVendor(key.vendorId);
                const campaignId = `key-campaign-${key.id}`;
                return (
                  <tr key={key.id} className={cn(key.id === selectedKeyId && "bg-[var(--surface-alt)]")}>
                    <td className={st.td}>
                      <button
                        type="button"
                        className="cursor-pointer text-left font-semibold text-[var(--ink)] hover:underline"
                        onClick={() => selectKey(key.id)}
                        aria-pressed={key.id === selectedKeyId}
                        aria-label={`Show ${key.vendorName}'s field map`}
                      >
                        {key.vendorName}
                      </button>
                      <span className={cn(st.sub, "flex flex-wrap items-center gap-1.5")}>
                        <Pill tone={key.isActive ? "success" : "neutral"} dot>{key.isActive ? "Active" : "Disabled"}</Pill>
                        <span>
                          Created {when(key.createdAt) ?? "—"}
                          {key.rotatedAt ? ` · retired ${when(key.rotatedAt)}` : ""}
                          {/* "Never used" is worth saying out loud: a key minted three weeks ago that
                              has never been called means the vendor never finished their side. */}
                          {key.lastUsedAt ? ` · last used ${when(key.lastUsedAt)}` : " · never used"}
                        </span>
                      </span>
                    </td>
                    <td className={st.td}>
                      <label htmlFor={campaignId} className="sr-only">Campaign for {key.vendorName}&rsquo;s key</label>
                      <select
                        id={campaignId}
                        className={cellInput}
                        value={key.campaignId ?? ""}
                        disabled={!loaded.schemaReady || busy === key.id}
                        onChange={(event) => void bindCampaign(key, event.target.value)}
                        title={loaded.schemaReady ? undefined : "Campaign binding needs a database update that has not been applied yet."}
                      >
                        <option value="">Vendor&rsquo;s accepting campaign</option>
                        {campaigns.map((campaign) => (
                          <option key={campaign.id} value={campaign.id}>
                            {campaign.name}{campaign.status !== "active" ? ` (${campaign.status})` : ""}
                          </option>
                        ))}
                      </select>
                      {campaignError?.keyId === key.id && <span role="alert" className="mt-1 block text-[12px] text-[var(--error-ink)]">{campaignError.message}</span>}
                    </td>
                    <td className={st.td}>
                      <code className={code}>{key.keyPrefix}&hellip;</code>
                    </td>
                    <td className={cn(st.td, "tabular-nums")}>
                      {fmt(stats?.posts ?? 0)}
                      {stats?.perVendor && <span className={st.sub}>all of this vendor&rsquo;s keys</span>}
                      {!!stats?.earlierPosts && <span className={st.sub}>+{fmt(stats.earlierPosts)} before per-key counts</span>}
                    </td>
                    <td className={cn(st.td, "tabular-nums")}>
                      {fmt(stats?.rejected ?? 0)}
                      {!!stats?.earlierRejected && <span className={st.sub}>+{fmt(stats.earlierRejected)} earlier</span>}
                    </td>
                    <td className={cn(st.td, "whitespace-nowrap text-right")}>
                      <button type="button" className={btn("row")} disabled={busy === key.id} onClick={() => void act(key, "rotate")}>
                        Rotate
                      </button>
                      {key.isActive ? (
                        <button type="button" className={btn("row")} disabled={busy === key.id} onClick={() => openRevoke(key)}>
                          Revoke
                        </button>
                      ) : (
                        <button type="button" className={btn("row")} disabled={busy === key.id} onClick={() => void act(key, "activate")}>
                          Enable
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </SettingsTableCard>

      <SettingsGrid>
        <SettingsCard
          title={selectedKey ? <>Field map &middot; {selectedKey.vendorName}</> : "Field map"}
          sub="Their names on the left, yours on the right. Set per vendor, because no two vendors agree."
          action={
            selectedKey && !editing ? (
              <button type="button" className={btn("secondary")} onClick={() => setEditing(true)}>
                Edit
              </button>
            ) : undefined
          }
        >
          {!selectedKey ? (
            <p className="m-0 text-[14px] text-[var(--muted)]">Create a key to map a vendor&rsquo;s field names onto yours.</p>
          ) : (
            <div className="flex flex-col gap-3.5">
              {vendorKeys.length > 1 && (
                <p className="m-0 text-[12px] text-[var(--muted)]">
                  {selectedKey.vendorName} has {vendorKeys.length} keys. Saving writes this map to all of them.
                </p>
              )}
              {vendorMapsDiffer && (
                <Callout tone="warning" title={`${selectedKey.vendorName}'s keys have different maps`}>
                  They were set one key at a time before maps were per vendor. This is the map on key{" "}
                  <code className={code}>{selectedKey.keyPrefix}&hellip;</code>; Save changes applies it to every key of this vendor.
                </Callout>
              )}
              {inverted > 0 && (
                <Callout tone="warning" title={`${inverted} ${inverted === 1 ? "field was" : "fields were"} saved the wrong way round`}>
                  The old form asked for their name first and stored it where yours belongs. Posts already read{" "}
                  {inverted === 1 ? "it" : "them"} the way shown below; Save changes stores {inverted === 1 ? "it" : "them"} the right way round.
                </Callout>
              )}
              {saveError && <Callout tone="error" title="The field map was not saved">{saveError}</Callout>}
              <datalist id="lead-post-our-fields">
                {KNOWN_LEAD_FIELDS.map((field) => <option key={field} value={field} />)}
              </datalist>
              {draft.length === 0 && !editing ? (
                <p className="m-0 text-[14px] text-[var(--muted)]">
                  No fields mapped. Their payload is read as sent, so it must already use your names &mdash; phone, state and a name.
                </p>
              ) : (
                <table className={st.table}>
                  <thead>
                    <tr className={st.headRow}>
                      <th scope="col" className={cn(st.th, "w-[130px]")}>Their field</th>
                      <th scope="col" className={cn(st.th, "w-[150px]")}>Your field</th>
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
                            <input aria-label={`Their field, row ${index + 1}`} className={cn(cellInput, "font-mono text-[14px]")} value={row.theirs} maxLength={120} placeholder="ph1" onChange={(event) => update({ theirs: event.target.value })} />
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
                            {problem && <span role="alert" className="mt-1 block text-[12px] text-[var(--error-ink)]">{problem}</span>}
                          </td>
                          <td className={cn(st.td, "align-top")}>
                            <button type="button" className={btn("danger-row", "px-2")} aria-label={`Remove row ${index + 1}`} onClick={() => setDraft((rows) => rows.filter((item) => item.id !== row.id))}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      ) : (
                        <tr key={row.id}>
                          <td className={st.td}><code className={code}>{row.theirs}</code></td>
                          <td className={st.td}>{row.ours}</td>
                          <td className={st.td}>
                            {row.note || rule || "—"}
                            {row.note && rule && <span className={st.sub}>{rule}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {editing && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button type="button" className={btn("secondary")} onClick={() => setDraft((rows) => [...rows, { id: nextRowId(), theirs: "", ours: "", note: "" }])}>
                    <PlusIcon /> Add a field
                  </button>
                  <span className="text-[12px] text-[var(--muted)]">
                    {loaded.schemaReady ? "Nothing changes until you save." : "Notes need a database update that has not been applied yet; the map itself saves."}
                  </span>
                </div>
              )}
            </div>
          )}
        </SettingsCard>

        <SettingsCard title={`Rejections, last ${loaded.windowDays} days`}>
          {loaded.rejections.length === 0 ? (
            <p className="m-0 text-[14px] text-[var(--muted)]">No posts were rejected in the last {loaded.windowDays} days.</p>
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
                  ariaLabel={`${REJECTION_LABELS[row.reasonCode] ?? row.reasonCode}: ${row.count} of ${totalRejected} rejected posts`}
                />
              ))}
            </div>
          )}
          <p className="mt-3.5 mb-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
            A rejected post is answered with the reason, so the vendor can fix it rather than re-send it.
          </p>
        </SettingsCard>
      </SettingsGrid>

      <Dialog open={minting} onOpenChange={(next) => { setMinting(next); setMintError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a posting key</DialogTitle>
            <DialogDescription>
              The key appears once on the next screen. Copy it then &mdash; it cannot be shown again. Map their field
              names afterwards, in Field map.
            </DialogDescription>
          </DialogHeader>
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
                  ? "Optional. A bound key posts to this campaign only, and is refused while it is not active and scrubbed."
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
            {mintError && <span role="alert" className="text-[12px] text-[var(--error-ink)]">{mintError}</span>}
            <DialogFooter>
              <button type="button" className={btn("ghost")} onClick={() => setMinting(false)}>Cancel</button>
              <button type="submit" className={btn("primary")} disabled={busy === "mint" || !mintVendor}>
                {busy === "mint" ? "Creating…" : "Create key"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={revoking !== null} onOpenChange={(next) => { if (!next && busy !== revoking?.id) setRevoking(null); }}>
        <DialogContent className="sm:max-w-[560px]">
          {revoking && (() => {
            const stats = statsByKey.get(revoking.id);
            const posts = stats?.posts ?? 0;
            const campaign = revoking.campaignId ? loaded.campaigns.find((item) => item.id === revoking.campaignId)?.name ?? "A bound campaign" : "Vendor’s accepting campaign";
            const matches = revokeTyped.trim().toLowerCase() === revoking.vendorName.trim().toLowerCase();
            const fact = (label: string, value: string) => (
              <div>
                <div className="text-[12px] font-semibold uppercase leading-[1.33] tracking-[0.02em] text-[var(--muted)]">{label}</div>
                <div className="mt-1 text-[14px] font-semibold tabular-nums text-[var(--ink)]">{value}</div>
              </div>
            );
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Revoke this posting key?</DialogTitle>
                  <DialogDescription>
                    {revoking.vendorName} · {campaign} · <code className={code}>{revoking.keyPrefix}&hellip;</code>
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                  <div className="rounded-[8px] border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-4">
                    <p className="text-[14px] font-semibold text-[var(--error-ink)]">{revoking.vendorName} stops being able to post the moment you confirm</p>
                    <p className="mt-1 text-[14px] leading-normal text-[var(--body)]">
                      Their integration will start receiving <code className={code}>401 Unauthorized</code>. Nothing warns them first, and there is no grace period.
                      {" "}{posts ? `${fmt(posts)} ${posts === 1 ? "lead" : "leads"} arrived on this key in the last ${loaded.windowDays} days${stats?.perVendor ? " (counted across this vendor’s keys)" : ""}.` : `No lead arrived on this key in the last ${loaded.windowDays} days.`}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-[8px] bg-[var(--surface-alt)] p-4">
                    {fact(`Posts in the last ${loaded.windowDays} days`, fmt(posts))}
                    {fact("Last post", revoking.lastUsedAt ? dateTime(revoking.lastUsedAt, viewerTimeZone()) : "Never used")}
                    {fact("Campaign", campaign)}
                    {fact("Created", when(revoking.createdAt) ?? "—")}
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-[var(--ink)]">What does <em>not</em> happen</p>
                    <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-[14px] leading-normal text-[var(--body)]">
                      <li>{posts ? `The ${fmt(posts)} leads already received stay exactly where they are.` : "Leads already received stay exactly where they are."}</li>
                      <li>Their cost, campaign and True CPA figures are untouched.</li>
                      <li>{revoking.vendorName}&rsquo;s vendor record and history remain, and stay visible for audit.</li>
                    </ul>
                  </div>
                  <Field label="Type the vendor name to confirm" htmlFor="revoke-confirm-name" hint={<>Type <strong>{revoking.vendorName}</strong>. The change is logged against your name; the key can be enabled again from this table.</>}>
                    <input id="revoke-confirm-name" className={control} autoComplete="off" value={revokeTyped} onChange={(event) => setRevokeTyped(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void confirmRevoke(); } }} />
                  </Field>
                </div>
                <DialogFooter>
                  <button type="button" className={btn("ghost")} disabled={busy === revoking.id} onClick={() => setRevoking(null)}>Keep the key</button>
                  <button type="button" className={btn("primary", "bg-[var(--error)] text-white hover:bg-[var(--error-ink)]")} disabled={!matches || busy === revoking.id} onClick={() => void confirmRevoke()}>
                    {busy === revoking.id ? "Revoking…" : "Revoke the key"}
                  </button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={revealed !== null} onOpenChange={(next) => !next && setRevealed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{revealed?.vendorName}&rsquo;s posting key</DialogTitle>
            <DialogDescription>
              This is the only time this key is shown. Send it to the vendor over a channel you trust; if it is lost,
              rotate rather than ask us for it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <RevealLine label="Key" value={revealed?.key ?? ""} onCopy={copy} />
            <RevealLine label="Post to, with Authorization: Bearer <key>" value={headerUrl} onCopy={copy} />
            <RevealLine label="Or, key in the path (the older URL)" value={`${legacyUrl}/${revealed?.key ?? ""}`} onCopy={copy} />
          </div>
          <DialogFooter>
            <button type="button" className={btn("primary")} onClick={() => setRevealed(null)}>I have copied it</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsStack>
  );
}

function RevealLine({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string) => Promise<void> }) {
  return (
    <div>
      <span className="text-[12px] font-semibold text-[var(--muted)]">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 rounded-[8px] border border-[var(--border)] bg-[var(--surface-sunken)] p-3 font-mono text-[14px] break-all text-[var(--ink)]">{value}</code>
        <button type="button" className={btn("secondary", "px-2.5")} aria-label={`Copy ${label.toLowerCase()}`} onClick={() => void onCopy(value)}>
          <Copy className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
