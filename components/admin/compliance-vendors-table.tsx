"use client";

import { useCallback, useId, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";

import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { Callout, Field, KeyValues, Pill, control, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { TableCard } from "@/components/ui/table-card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/page-states";
import { COMPLIANCE_VENDOR_TYPES, COMPLIANCE_VENDOR_TYPE_LABELS, type ComplianceVendor, type ComplianceVendorType } from "@/lib/compliance/constants";
import {
  ROLE_HINT,
  dialingPosture,
  fullUtc,
  healthPill,
  shortUtc,
  unreachableVendors,
  vendorRoles,
  type RegistryDialing,
} from "@/lib/compliance/registryView";

/**
 * Compliance (board p-adm-compliance): the vendor figures, the dial-gate alert when dialing is at
 * risk, and the vendor registry. The board has no action column, so a row opens the vendor's dialog, which holds every
 * action the old table carried: test the connection, enable or disable, edit, rotate the credential.
 */

export type ComplianceRegistry = { vendors: ComplianceVendor[]; dialing: RegistryDialing; readAt: string };

type FormState = {
  name: string; vendor_type: ComplianceVendorType; endpoint: string; credentials: string;
  is_enabled: boolean; priority: string; cost_per_lookup_cents: string;
};

/** A change the server refused until someone types the vendor's name (409 requiresConfirmation). */
type PendingConfirmation = { vendorId: string; vendorName: string; body: Record<string, unknown>; message: string; action: string; done: string };

const emptyForm: FormState = { name: "", vendor_type: "dnc_scrub", endpoint: "", credentials: "", is_enabled: false, priority: "0", cost_per_lookup_cents: "0" };
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

const subscribeNothing = () => () => {};
/** False on the server and during hydration, true after: local times are added only then. */
function useMounted() {
  return useSyncExternalStore(subscribeNothing, () => true, () => false);
}

export function ComplianceVendorsTable({ initial }: { initial: ComplianceRegistry }) {
  const [registry, setRegistry] = useState(initial);
  const { vendors, dialing } = registry;
  const nowYear = new Date(registry.readAt).getUTCFullYear();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useMounted();
  const formId = useId();

  const editing = editingId ? vendors.find((vendor) => vendor.id === editingId) ?? null : null;
  const roles = useMemo(() => vendorRoles(vendors), [vendors]);
  const unreachable = unreachableVendors(vendors);
  const posture = dialingPosture(vendors, dialing);
  const enabledCount = vendors.filter((vendor) => vendor.is_enabled).length;
  const availableDnc = vendors.filter((vendor) => vendor.vendor_type === "dnc_scrub" && vendor.is_enabled && vendor.available).length;

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/compliance-vendors");
    if (response.ok) setRegistry(await response.json());
  }, []);

  async function reload() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  /** Title text for a time: UTC always, plus the reader's local time once mounted. */
  const timeTitle = (iso: string | null) => {
    const full = fullUtc(iso);
    if (!full || !iso) return undefined;
    return mounted ? `${full} · ${new Date(iso).toLocaleString()} your time` : full;
  };

  function startCreate() { setEditingId(null); setForm(emptyForm); setOpen(true); }
  function startEdit(vendor: ComplianceVendor) {
    setEditingId(vendor.id);
    setForm({ name: vendor.name, vendor_type: vendor.vendor_type, endpoint: vendor.endpoint, credentials: "", is_enabled: vendor.is_enabled, priority: String(vendor.priority), cost_per_lookup_cents: String(vendor.cost_per_lookup_cents) });
    setOpen(true);
  }

  /**
   * PATCH a vendor. A 409 with requiresConfirmation opens the typed confirmation instead of failing:
   * the server decides what needs confirming (it re-checks the gate), the browser only collects it.
   */
  async function patch(vendor: { id: string; name: string }, body: Record<string, unknown>, labels: { action: string; done: string }): Promise<boolean> {
    const response = await fetch(`/api/admin/compliance-vendors/${vendor.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => null);
    if (response.status === 409 && result?.requiresConfirmation) {
      setPending({ vendorId: vendor.id, vendorName: result.vendorName ?? vendor.name, body, message: result.error, ...labels });
      return false;
    }
    if (!response.ok) { notify.block(result?.error ?? "Could not save vendor"); return false; }
    notify.done(labels.done);
    await refresh();
    return true;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const numbers = { priority: Number(form.priority), cost_per_lookup_cents: Number(form.cost_per_lookup_cents) };
    setBusy(true);
    if (editing) {
      // Availability has its own button in this dialog, so Save never flips it by accident.
      const body: Record<string, unknown> = { name: form.name, vendor_type: form.vendor_type, endpoint: form.endpoint, ...numbers };
      if (form.credentials) body.credentials = form.credentials;
      const saved = await patch(editing, body, { action: "Save and block dialing", done: "Compliance vendor updated" });
      setBusy(false);
      if (saved) setOpen(false);
      return;
    }
    const response = await fetch("/api/admin/compliance-vendors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, ...numbers }) });
    const result = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) { notify.block(result?.error ?? "Could not save vendor"); return; }
    notify.done("Compliance vendor created"); setOpen(false); refresh();
  }

  async function toggle(vendor: ComplianceVendor) {
    const next = !vendor.is_enabled;
    setToggling(vendor.id);
    await patch(vendor, { is_enabled: next }, { action: "Disable and block dialing", done: `${vendor.name} ${next ? "enabled" : "disabled"}` });
    setToggling(null);
  }

  async function test(vendor: ComplianceVendor) {
    setTesting(vendor.id);
    const response = await fetch(`/api/admin/compliance-vendors/${vendor.id}/test-connection`, { method: "POST" });
    const result = await response.json().catch(() => null); setTesting(null);
    if (result?.ok) notify.done(`${vendor.name}: ${result.message}`); else notify.fail(`${vendor.name}: ${result?.message ?? "Connection test failed"}`);
    refresh();
  }

  async function confirmPending(event: FormEvent) {
    event.preventDefault();
    if (!pending) return;
    const response = await fetch(`/api/admin/compliance-vendors/${pending.vendorId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pending.body, confirm_dnc_block: true }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) { notify.block(result?.error ?? "Could not save vendor"); return; }
    notify.done(pending.done);
    setPending(null);
    setOpen(false);
    refresh();
  }

  const health = editing ? healthPill(editing) : null;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader title="Compliance" actions={<Button type="button" onClick={startCreate}>Register a vendor</Button>} />

      <BoardStatGrid>
        <BoardStatTile label="Registered" value={vendors.length.toLocaleString("en-US")} />
        <BoardStatTile label="Enabled" value={enabledCount.toLocaleString("en-US")} />
        <BoardStatTile label="DNC available" value={availableDnc.toLocaleString("en-US")} tone={availableDnc === 0 && !dialing.demo ? "error" : "default"} />
        <BoardStatTile label="Unreachable" value={unreachable.length.toLocaleString("en-US")} tone={unreachable.length > 0 ? "error" : "default"} footnote="enabled, every call failed" />
      </BoardStatGrid>

      {(posture.tone === "error" || posture.tone === "warning") && (
        <Callout tone={posture.tone} title={posture.title}>
          {(posture.tone === "error" ? posture.lines.slice(0, -1) : posture.lines).join(" ")}
        </Callout>
      )}
      {dialing.demo && <Callout tone="info" title={posture.title} />}

      <TableCard toolbar={<DataToolbar actions={<RefreshButton onClick={() => void reload()} refreshing={refreshing} />} />}>
        <div className="min-w-0 overflow-x-auto">
          <table className={cn(st.table, "min-w-[880px] table-fixed")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Vendor</th>
                <th scope="col" className={cn(st.th, "w-[160px]")}>Type</th>
                <th scope="col" className={cn(st.th, "w-[140px]")}>Configured</th>
                <th scope="col" className={cn(st.th, "w-[240px]")}>Health</th>
                <th scope="col" className={cn(st.th, "w-[160px]")}>Last checked</th>
                <th scope="col" className={cn(st.th, "w-[130px]")}>Role</th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {vendors.length === 0 && (
                <tr>
                  <td colSpan={6} className="border-t border-[var(--border)] p-0">
                    <EmptyState title="No vendors registered yet" hint="Dialing stays blocked until a DNC scrub vendor and a litigator vendor are registered and enabled." />
                  </td>
                </tr>
              )}
              {vendors.map((vendor) => {
                const pill = healthPill(vendor);
                const role = roles.get(vendor.id) ?? "Unused";
                return (
                  <tr key={vendor.id} className="m-row cursor-pointer hover:bg-[var(--brand-50)]" onClick={() => startEdit(vendor)}>
                    <td className={st.td}>
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        onClick={(event) => { event.stopPropagation(); startEdit(vendor); }}
                        className="max-w-full cursor-pointer truncate text-left text-[var(--body)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                      >
                        {vendor.name}
                      </button>
                    </td>
                    <td className={st.td} title={COMPLIANCE_VENDOR_TYPE_LABELS[vendor.vendor_type]}>{vendor.vendor_type}</td>
                    <td className={st.td}>
                      {vendor.is_enabled ? <Pill tone="success" dot>Enabled</Pill> : <Pill tone="neutral" dot>Disabled</Pill>}
                    </td>
                    <td className={st.td} title={pill.hint}><Pill tone={pill.tone} dot>{pill.label}</Pill></td>
                    <td className={cn(st.td, "whitespace-nowrap tabular-nums")} title={timeTitle(vendor.last_checked_at) ?? "No lookup or connection test in the last 7 days"}>
                      {shortUtc(vendor.last_checked_at, nowYear) ?? "—"}
                    </td>
                    <td className={st.td} title={ROLE_HINT[role]}>{role}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </TableCard>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? editing.name : "Register a vendor"}</DialogTitle>
            <DialogDescription>Credentials are encrypted before storage and never returned. Use a vendor endpoint that supports HTTPS.</DialogDescription>
          </DialogHeader>

          {editing && health && (
            <div className="flex flex-col gap-4 rounded-[12px] border border-[var(--border)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                {editing.is_enabled ? <Pill tone="success" dot>Enabled</Pill> : <Pill tone="neutral" dot>Disabled</Pill>}
                <Pill tone={health.tone} dot>{health.label}</Pill>
                <span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{roles.get(editing.id) ?? "Unused"} · {ROLE_HINT[roles.get(editing.id) ?? "Unused"]}</span>
              </div>
              <KeyValues
                items={[
                  { label: "Calls, last 24 hours", value: `${editing.failures_24h} of ${editing.calls_24h} failed (${editing.failure_rate_24h}%)`, tone: editing.failures_24h > 0 ? "error" : undefined },
                  { label: "Last checked", value: <span title={timeTitle(editing.last_checked_at)}>{fullUtc(editing.last_checked_at) ?? "Not in the last 7 days"}</span> },
                  { label: "Last success", value: <span title={timeTitle(editing.last_success_at)}>{fullUtc(editing.last_success_at) ?? "Never"}</span> },
                  { label: "Credentials", value: editing.credentials_present ? "Stored" : "Not set" },
                  { label: "Cost per lookup", value: money(editing.cost_per_lookup_cents) },
                  { label: "Priority", value: String(editing.priority) },
                ]}
              />
              <p className="m-0 min-w-0 truncate font-mono text-[12px] text-[var(--muted)]" title={editing.endpoint}>{editing.endpoint}</p>
              <div className="flex flex-wrap items-center gap-2.5">
                <Button type="button" variant="outline" onClick={() => test(editing)} disabled={testing === editing.id}>
                  {testing === editing.id ? "Testing…" : "Test connection"}
                </Button>
                <Button type="button" variant="outline" onClick={() => toggle(editing)} disabled={toggling === editing.id}>
                  {editing.is_enabled ? "Disable vendor" : "Enable vendor"}
                </Button>
              </div>
            </div>
          )}

          <form id={formId} onSubmit={save} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Vendor name" htmlFor={`${formId}-name`} required>
                <input id={`${formId}-name`} className={control} required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Vendor type" htmlFor={`${formId}-type`}>
                <select id={`${formId}-type`} className={control} value={form.vendor_type} onChange={(e) => setForm({ ...form, vendor_type: e.target.value as ComplianceVendorType })}>
                  {COMPLIANCE_VENDOR_TYPES.map((type) => <option key={type} value={type}>{COMPLIANCE_VENDOR_TYPE_LABELS[type]}</option>)}
                </select>
              </Field>
            </div>
            <Field label="API endpoint" htmlFor={`${formId}-endpoint`} required>
              <input id={`${formId}-endpoint`} className={control} required type="url" placeholder="https://vendor.example.com/health" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} />
            </Field>
            <Field label={editing ? "Rotate credential token" : "Credential token"} htmlFor={`${formId}-credentials`} hint={editing ? "Leave blank to keep the stored token. The stored token is never shown." : "Sent as a bearer token. Stored encrypted, write-only."}>
              <input id={`${formId}-credentials`} className={control} type="password" autoComplete="new-password" value={form.credentials} onChange={(e) => setForm({ ...form, credentials: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Priority" htmlFor={`${formId}-priority`} required hint="Lower is tried first.">
                <input id={`${formId}-priority`} className={control} required type="number" min="0" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
              </Field>
              <Field label="Cost (cents)" htmlFor={`${formId}-cost`} required>
                <input id={`${formId}-cost`} className={control} required type="number" min="0" value={form.cost_per_lookup_cents} onChange={(e) => setForm({ ...form, cost_per_lookup_cents: e.target.value })} />
              </Field>
              {!editing && (
                <label htmlFor={`${formId}-enabled`} className="flex items-center gap-2 pt-8 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
                  <input id={`${formId}-enabled`} type="checkbox" checked={form.is_enabled} onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })} /> Enabled
                </label>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save vendor"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <TypedConfirmation pending={pending} onCancel={() => setPending(null)} onConfirm={confirmPending} />
    </div>
  );
}

/**
 * The typed confirmation for a change that blocks dialing platform-wide. The name, not a fixed
 * word: a fixed word can be typed from muscle memory on the wrong vendor. The server's 409 stays the
 * real check — this only collects the intent it asks for.
 */
function TypedConfirmation({ pending, onCancel, onConfirm }: { pending: PendingConfirmation | null; onCancel: () => void; onConfirm: (event: FormEvent) => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const [sending, setSending] = useState(false);
  const id = useId();
  const matches = Boolean(pending) && typed.trim().toLowerCase() === (pending?.vendorName ?? "").trim().toLowerCase();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!matches) return;
    setSending(true);
    await onConfirm(event);
    setSending(false);
    setTyped("");
  }

  return (
    <Dialog open={pending !== null} onOpenChange={(next) => { if (!next) { setTyped(""); onCancel(); } }}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Block dialing platform-wide?</DialogTitle>
            <DialogDescription>{pending?.message}</DialogDescription>
          </DialogHeader>
          <Field label={<>Type <span className="font-mono">{pending?.vendorName}</span> to confirm</>} htmlFor={`${id}-confirm`}>
            <input id={`${id}-confirm`} className={control} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={pending?.vendorName ?? ""} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setTyped(""); onCancel(); }}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={sending || !matches}>{sending ? "Saving…" : pending?.action ?? "Confirm"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
