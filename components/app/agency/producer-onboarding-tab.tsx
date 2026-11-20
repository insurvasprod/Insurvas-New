"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { notify } from "@/lib/notify";

import { TableCard } from "@/components/ui/table-card";
import { ErrorState, SectionLoading } from "@/components/ui/page-states";
import { Button } from "@/components/ui/button";
import { DoneStamp } from "@/components/ui/done-stamp";
import { useDoneStamps } from "@/components/ui/use-done-stamps";
import { cn } from "@/lib/utils";
import { licencePointer, onboardingTitle } from "./producer-record-core";
import { useAgencyData } from "./use-agency-data";

type Item = { item: string; seq: number; done: boolean; detail: string; feeds: string | null; completedAt: string | null; expiresOn: string | null; hasDocument: boolean };
type Checklist = { items: Item[]; canSubmit: boolean; reason: string | null; status: string | null };

/**
 * AG-1.10 · the six items between an invited producer and his first application. Most complete themselves from
 * the records later modules read (licence, appointments, writing numbers, levels — set on the Carriers tab); the
 * owner attests two: contracting and the W-9 (owner uploads). E&O was removed from the checklist 2026-10-26.
 * can_submit is shown, never edited: until every item holds, Sell refuses him naming the missing item.
 */
export function ProducerOnboardingTab({ producerId, userId, isOwner, isSelf }: { producerId: string; userId: string | null; isOwner: boolean; isSelf: boolean }) {
  const router = useRouter();
  const { data, error, loading, reload } = useAgencyData<Checklist>(`/api/app/agency/producers/${producerId}/onboarding`);
  const [busy, setBusy] = useState<string | null>(null);
  // Approve (contracting) stamps "Approved" where the button was, then the checklist reloads (Wave D, 2026-11-18).
  const stamps = useDoneStamps(data);

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
      // The rows and the title's count re-read together (a fresh read, never an older one in flight); the server
      // header (the Onboarding tab's tone) follows.
      if (item === "contracting") await stamps.stamp(item, "Approved", reload);
      else await reload();
      router.refresh();
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

  if (error) return <TableCard><ErrorState detail={error} /></TableCard>;
  if (loading || !data) return <TableCard><SectionLoading rows={6} columns={3} label="Loading the checklist" /></TableCard>;
  // Why he cannot submit is the card's own title (foundation pass 2026-11-03), not a tinted notice above it. The
  // count comes from the rows drawn below: an item wearing its "Approved" stamp is no longer missing.
  const { missing, title } = onboardingTitle({ items: data.items, canSubmit: data.canSubmit, isSelf, stamped: (item) => Boolean(stamps.labelOf(item)) });
  const licence = licencePointer({ viewerIsOwner: isOwner, isSelf, userId });
  return (
    <div className="flex flex-col gap-4">
      <TableCard title={title} description={!data.canSubmit && !missing ? data.reason ?? undefined : undefined}>
        <ul className="divide-y divide-border">
          {data.items.map((i) => (
            <li key={i.item} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm">
              <span className={cn("inline-flex size-[18px] items-center justify-center rounded", i.done ? "bg-[var(--primary)] text-[var(--on-primary)]" : "border-[1.5px] border-[var(--border-strong)]")} aria-label={i.done ? "Done" : "Not done"}>{i.done && <Check className="size-3 stroke-[3]" />}</span>
              <span className="min-w-0"><span className="font-medium">{i.detail}</span>{i.feeds && <span className="ml-2 text-xs text-[var(--muted)]">{i.feeds}</span>}{i.expiresOn && <span className="ml-2 text-xs text-[var(--muted)]">expires {i.expiresOn}</span>}</span>
              <span className="flex items-center gap-2">
                {stamps.labelOf(i.item) ? <DoneStamp label={stamps.labelOf(i.item)!} /> : null}
                {i.item === "contracting" && !i.done && isOwner && !stamps.labelOf(i.item) && <Button size="sm" onClick={() => complete("contracting")} disabled={busy !== null}>Approve</Button>}
                {i.item === "w9" && !i.done && isOwner && <Button size="sm" variant="outline" onClick={() => upload("w9")} disabled={busy !== null}>{busy === "w9" ? "Uploading…" : "Upload W-9"}</Button>}
                {["licence", "appointments", "numbers", "levels"].includes(i.item) && !i.done && (i.item === "licence" ? (licence.kind === "link" ? <Link className="text-xs font-medium text-[var(--accent-ink)] hover:underline" href={licence.href}>{licence.label}</Link> : <span className="text-xs text-[var(--muted)]">{licence.text}</span>) :<Link className="text-xs font-medium text-[var(--accent-ink)] hover:underline" href={`/app/producers/${producerId}?tab=carriers`}>Set on the Carriers tab</Link>)}
              </span>
            </li>
          ))}
        </ul>
      </TableCard>
    </div>
  );
}
