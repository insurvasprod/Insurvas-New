"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import type { CarrierChoice } from "@/lib/ingestion/path";
import type { SenderRow } from "@/lib/ingestion/registry";

async function send(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That did not work; try again.");
}

/**
 * LA-4.1 (Notion sprint) · the email door: the agency's own address, and the carriers' known senders
 * that tell the pipeline which carrier an emailed file is from (exact address, or a whole @domain).
 * The bucket has its own tab since 2026-10-09 (carrier-bucket.tsx).
 */
export function CarrierFileDoors({
  address,
  addressConfigured,
  senders,
  carriers,
  canWrite,
  writeBlockedReason,
}: {
  address: string | null;
  addressConfigured: boolean;
  senders: SenderRow[];
  carriers: CarrierChoice[];
  canWrite: boolean;
  writeBlockedReason: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [carrierId, setCarrierId] = useState("");
  const [sender, setSender] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setProblem(null);
    try {
      await action();
      router.refresh();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "That did not work; try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {problem && <p role="alert" className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--error-ink)]">{problem}</p>}

      <TableCard
        title="Email"
        description={
          !addressConfigured
            ? "Email-in is not switched on for this workspace yet."
            : address
              ? `Forward carrier files to ${address}. Each CSV, Excel or PDF attachment is received as its own file.`
              : "Give the agency its own address, then forward carrier files to it."
        }
        action={
          address ? (
            <Button type="button" variant="outline" onClick={() => void copy(address)}>{copied === address ? "Copied" : "Copy address"}</Button>
          ) : addressConfigured ? (
            <Button type="button" disabled={!canWrite || busy !== null} title={writeBlockedReason ?? undefined} onClick={() => void run("address", () => send("/api/app/carrier-files/inbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_address" }) }))}>
              {busy === "address" ? "Creating…" : "Create address"}
            </Button>
          ) : undefined
        }
        toolbar={
          <form
            className="flex flex-wrap items-center gap-2 px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!carrierId) return setProblem("Choose the carrier this sender is.");
              void run("add", async () => {
                await send("/api/app/carrier-files/inbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add_sender", carrier_id: carrierId, sender }) });
                setSender("");
                setCarrierId("");
              });
            }}
          >
            <select aria-label="Carrier" className={toolbarControl} value={carrierId} disabled={!canWrite} onChange={(event) => setCarrierId(event.target.value)}>
              <option value="">Carrier</option>
              {carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}
            </select>
            <Input aria-label="Sender address or @domain" className="h-9 w-72" placeholder="commissions@carrier.com or @carrier.com" value={sender} disabled={!canWrite} onChange={(event) => setSender(event.target.value)} />
            <Button type="submit" variant="outline" disabled={!canWrite || busy !== null || !sender.trim()} title={writeBlockedReason ?? undefined}>{busy === "add" ? "Adding…" : "Add sender"}</Button>
          </form>
        }
      >
        {senders.length === 0 ? (
          <EmptyState title="No known carrier senders" hint="An emailed file from an unknown sender is still received, and is marked failed until its carrier is known." />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Sender</th>
                <th>Carrier</th>
                <th className="w-[140px]">Added by</th>
                <th className="w-[110px] text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {senders.map((row) => (
                <tr key={row.id}>
                  <td className="font-semibold text-foreground">{row.sender}</td>
                  <td>{row.carrierName ?? "—"}</td>
                  <td className="text-muted-foreground">{row.platform ? "Insurvas" : "This agency"}</td>
                  <td className="text-right">
                    {!row.platform && (
                      <Button type="button" variant="outline" size="sm" disabled={!canWrite || busy !== null} title={writeBlockedReason ?? undefined} onClick={() => void run(`remove-${row.id}`, () => send(`/api/app/carrier-files/inbound?sender_id=${row.id}`, { method: "DELETE" }))}>
                        {busy === `remove-${row.id}` ? "Removing…" : "Remove"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

    </div>
  );
}
