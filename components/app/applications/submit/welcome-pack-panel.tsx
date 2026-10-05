"use client";

/**
 * The client welcome pack (LA-3.20; board l3-ws-submit, "Client welcome pack"): before capture it
 * says what will go out; after, where it went — sent, held for review (and why), bounced — with the
 * PDF behind a 60-second signed URL. Sent once per attempt; an accepted counteroffer makes a new
 * version the agent can send deliberately.
 */

import { useCallback, useEffect, useState } from "react";
import { FileText, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { notify } from "@/lib/notify";
import type { AttemptView } from "@/lib/applications/types";

import { shortDate } from "@/components/app/applications/parts";
import { attemptUrl, request } from "./api";

export type PackStatus = {
  status: "not_sent" | "queued" | "sent" | "bounced" | "review"; recipient: string | null; sentAt: string | null; bouncedAt: string | null; bounceReason: string | null;
  note: string | null; version: number; sentVersion: number | null; generatedAt: string | null; household: boolean; pdfUrl: string | null;
};

const BASE_LINE = "Goes out once this attempt is captured.";

function describe(p: PackStatus | null, fallback: AttemptView["welcomePack"]): { tone: StatusTone; chip: string; line: string } {
  const status = p?.status ?? fallback?.status ?? null;
  const to = p?.recipient ?? fallback?.recipient ?? null;
  const sentAt = p?.sentAt ?? fallback?.sentAt ?? null;
  switch (status) {
    case "sent": return { tone: "good", chip: p?.household ? "Sent · household" : "Sent", line: `Sent to ${to ?? "the client"}${sentAt ? ` on ${shortDate(sentAt)}` : ""}.${p && p.sentVersion !== null && p.version > p.sentVersion ? " An updated version is ready to send." : ""}` };
    case "queued": return { tone: "info", chip: p?.household ? "Held for the household" : "Queued", line: p?.note ?? `Queued for ${to ?? "the client"}.` };
    case "bounced": return { tone: "danger", chip: "Bounced", line: `The email to ${to ?? "the client"} bounced${p?.bouncedAt ? ` on ${shortDate(p.bouncedAt)}` : ""} — check the address, then send it again.` };
    case "review": return { tone: "warning", chip: "Not sent", line: p?.note ?? "Held for review before it goes out." };
    case "not_sent": return { tone: "neutral", chip: "PDF only", line: p?.note ?? "No email on file — the PDF is ready to print or post." };
    default: return { tone: "neutral", chip: "Not made yet", line: "The PDF is made when the submission is recorded." };
  }
}

export function WelcomePackPanel({ attempt, sample, readOnly }: { attempt: AttemptView; sample: boolean; readOnly: boolean }) {
  const submitted = attempt.status !== "draft" && attempt.status !== "ready";
  const [pack, setPack] = useState<PackStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (sample || !submitted) return;
    const r = await request<{ pack: PackStatus | null }>(attemptUrl(attempt.id, "/welcome-pack"));
    if (r.ok) setPack(r.data.pack);
  }, [attempt.id, sample, submitted]);
  useEffect(() => { const t = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(t); }, [load]);

  async function run(action: "submit" | "generate" | "send" | "reissue") {
    if (sample) { notify.done("Sample data — no welcome pack is made."); return; }
    setBusy(true);
    try {
      const r = await request<{ pack: PackStatus | null; delivery: { status: string; note: string | null } | null }>(attemptUrl(attempt.id, "/welcome-pack"), { method: "POST", body: { action } });
      if (!r.ok) { notify.block(r.error); return; }
      setPack(r.data.pack);
      const d = r.data.delivery;
      if (d?.status === "sent") notify.done("Welcome pack sent", { detail: d.note ?? undefined });
      else if (d) notify.warn("Welcome pack not sent", { detail: d.note ?? undefined });
      else notify.done("Welcome pack PDF made");
    } finally {
      setBusy(false);
    }
  }

  async function openPdf() {
    // A fresh 60-second URL at the moment it is opened.
    const r = await request<{ pack: PackStatus | null }>(attemptUrl(attempt.id, "/welcome-pack"));
    const url = r.ok ? r.data.pack?.pdfUrl : null;
    if (!url) { notify.block(r.ok ? "The PDF isn't ready yet." : r.error); return; }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (!submitted) {
    return (
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-start gap-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-[var(--ink)]">Client welcome pack</div>
            <div className="mt-0.5 text-xs text-[var(--muted)]">{BASE_LINE}</div>
          </div>
          <StatusChip tone="neutral" dot>Waiting on capture</StatusChip>
        </div>
      </div>
    );
  }

  const { tone, chip, line } = describe(pack, attempt.welcomePack);
  const status = pack?.status ?? attempt.welcomePack?.status ?? null;
  const hasPdf = Boolean(pack?.pdfUrl) || Boolean(attempt.welcomePack);
  const canSend = !readOnly && status !== null && status !== "sent" && Boolean(pack?.recipient ?? attempt.welcomePack?.recipient ?? attempt.values["contact.email"]?.value);
  const canReissue = !readOnly && status === "sent" && pack !== null && pack.sentVersion !== null && pack.version > pack.sentVersion;
  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start gap-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--ink)]">Client welcome pack</div>
          <div className="mt-0.5 text-xs text-[var(--muted)]">{line}</div>
        </div>
        <StatusChip tone={tone} dot>{chip}</StatusChip>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {hasPdf
          ? <Button type="button" variant="outline" onClick={openPdf} disabled={busy || sample} title={sample ? "Sample data has no PDF" : busy ? "Working…" : undefined}><FileText aria-hidden="true" />View PDF</Button>
          : <Button type="button" variant="outline" onClick={() => void run("submit")} disabled={busy || readOnly} title={readOnly ? "This attempt is closed" : busy ? "Working…" : undefined}><FileText aria-hidden="true" />Make the welcome pack</Button>}
        {canSend && <Button type="button" onClick={() => void run("send")} disabled={busy} title={busy ? "Working…" : undefined}><Send aria-hidden="true" />{status === "bounced" ? "Send again" : "Send now"}</Button>}
        {canReissue && <Button type="button" onClick={() => void run("reissue")} disabled={busy} title={busy ? "Working…" : undefined}><Send aria-hidden="true" />Send the updated pack</Button>}
      </div>
    </div>
  );
}
