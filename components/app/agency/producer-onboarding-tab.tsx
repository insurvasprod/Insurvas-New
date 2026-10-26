"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { notify } from "@/lib/notify";

import { TableCard } from "@/components/ui/table-card";
import { ErrorState, SectionLoading } from "@/components/ui/page-states";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAgencyData } from "./use-agency-data";

type Item = { item: string; seq: number; done: boolean; detail: string; feeds: string | null; completedAt: string | null; expiresOn: string | null; hasDocument: boolean };
type Checklist = { items: Item[]; canSubmit: boolean; reason: string | null; status: string | null };

/**
 * AG-1.10 · the six items between an invited producer and his first application. Most complete themselves from
 * the records later modules read (licence, appointments, writing numbers, levels — set on the Carriers tab); the
 * owner attests two: contracting and the W-9 (owner uploads). E&O was removed from the checklist 2026-10-26.
 * can_submit is shown, never edited: until every item holds, Sell refuses him naming the missing item.
 */
export function ProducerOnboardingTab({ producerId, isOwner, isSelf }: { producerId: string; isOwner: boolean; isSelf: boolean }) {
  const { data, error, loading, reload } = useAgencyData<Checklist>(`/api/app/agency/producers/${producerId}/onboarding`);
  const [busy, setBusy] = useState<string | null>(null);

  async function complete(item: "contracting" | "w9", file?: File | null) {
    const form = new FormData();
    form.set("item", item);
    if (file) form.set("file", file);
    setBusy(item);
    try {
      const res = await fetch(`/api/app/agency/producers/${producerId}/onboarding`, { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) { notify.fail(body?.error ?? "That did not save."); return; }
      notify.done(body?.canSubmit ? "Checklist complete. They can submit applications now." : "Saved. The checklist is re-checked.");
      reload();
    } finally {
      setBusy(null);
    }
  }

  const upload = (item: "w9") => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/png,image/jpeg";
    input.onchange = () => { const file = input.files?.[0]; if (file) void complete(item, file); };
    input.click();
  };

  if (error) return <ErrorState detail={error} />;
  if (loading || !data) return <SectionLoading rows={6} columns={3} label="Loading the checklist" />;
  const missing = data.items.filter((i) => !i.done);
  return (
    <div className="flex flex-col gap-4">
      {!data.canSubmit && (
        <p role="status" className="rounded-lg border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-ink)]">
          <strong>{isSelf ? "You can't submit applications yet." : "They can't submit applications yet."}</strong>{" "}
          {missing.length ? `${missing.length} item${missing.length === 1 ? " is" : "s are"} missing: ${missing.map((m) => m.detail.replace(/ \(.*\)$/, "")).join(", ")}.` : data.reason ?? ""}
        </p>
      )}
      <TableCard>
        <ul className="divide-y divide-border">
          {data.items.map((i) => (
            <li key={i.item} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm">
              <span className={cn("inline-flex size-[18px] items-center justify-center rounded", i.done ? "bg-[var(--primary)] text-[var(--on-primary)]" : "border-[1.5px] border-[var(--border-strong)]")} aria-label={i.done ? "Done" : "Not done"}>{i.done && <Check className="size-3 stroke-[3]" />}</span>
              <span className="min-w-0"><span className="font-medium">{i.detail}</span>{i.feeds && <span className="ml-2 text-xs text-[var(--muted)]">{i.feeds}</span>}{i.expiresOn && <span className="ml-2 text-xs text-[var(--muted)]">expires {i.expiresOn}</span>}</span>
              <span className="flex items-center gap-2">
                {i.item === "contracting" && !i.done && isOwner && <Button size="sm" onClick={() => complete("contracting")} disabled={busy !== null}>Approve</Button>}
                {i.item === "w9" && !i.done && isOwner && <Button size="sm" variant="outline" onClick={() => upload("w9")} disabled={busy !== null}>{busy === "w9" ? "Uploading…" : "Upload W-9"}</Button>}
                {["licence", "appointments", "numbers", "levels"].includes(i.item) && !i.done && <span className="text-xs text-[var(--muted)]">{i.item === "licence" ? "Settings › Team › licensed states" : "Carriers tab"}</span>}
              </span>
            </li>
          ))}
        </ul>
      </TableCard>
    </div>
  );
}
