"use client";

/**
 * Copy-assist (LA-3.14; boards l3-copy-assist and the Submit step's right column) — ONE component,
 * inline on the Submit step and in the pop-out window at /app/applications/[caseId]/copy-assist;
 * the extension's side panel builds its list from the same `buildCopyGroups`. It reads the attempt
 * it is given and nothing else, so the surfaces cannot drift.
 *
 * One click copies one value, in the format chosen on its row (dates and phones offer the formats
 * carrier forms ask for). A copied value keeps a tick until the next attempt, stored in
 * `tenant_copy_assist_ticks` so the inline panel, the pop-out and the extension share them (sample
 * data: local state only). Sensitive values stay masked: copying one reveals it through the audited
 * one-field call, and the revealed value masks itself again after 60 seconds.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardX, ExternalLink, X } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import type { AttemptView } from "@/lib/applications/types";
import { cn } from "@/lib/utils";

import { buildCopyGroups, type CopyGroup, type CopyItem } from "./copy-groups";

/** How long a revealed sensitive value stays on screen before it masks itself again. */
const REVEAL_SECONDS = 60;
/** How often an open panel re-reads the shared ticks (another surface may have copied something). */
const TICK_REFRESH_MS = 15_000;

const CLIPBOARD_HONESTY_LINE = "Clearing the clipboard is best-effort — your computer may keep a copy.";

/** The tab names, and the order the carrier forms ask in. */
const TAB: Record<string, string> = { insured: "Insured", addr: "Address", owner: "Owner", cov: "Coverage", pay: "Payment", ben: "Beneficiaries" };
const TAB_ORDER = ["insured", "addr", "owner", "cov", "pay", "ben"];

async function writeClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function copyFailed() {
  notify.block("Couldn't copy — select the value and press Ctrl+C.");
}

/** Opens the detachable copy-assist window beside the carrier's site. */
export function openCopyAssistWindow(caseId: string, attemptNo: number, insuredRole: "primary" | "spouse" = "primary", sample = false) {
  const role = insuredRole === "spouse" ? "&role=spouse" : "";
  const preview = sample ? "&preview=sample" : "";
  window.open(`/app/applications/${caseId}/copy-assist?attempt=${attemptNo}${role}${preview}`, `copy-assist-${caseId}-${attemptNo}-${insuredRole}`, "popup,width=460,height=900");
}

/** Ticks shared through the API. A tick shows at once and the save follows; a failed save keeps the tick on this screen and says so. */
function useSharedTicks(applicationId: string, sample: boolean, surface: "web" | "popout") {
  const [copied, setCopied] = useState<ReadonlySet<string>>(() => new Set());
  const pending = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    if (sample) return;
    try {
      const res = await fetch(`/api/app/applications/attempts/${applicationId}/copy-ticks`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { ticks: { fieldKey: string }[] };
      setCopied(new Set([...data.ticks.map((t) => t.fieldKey), ...pending.current]));
    } catch {
      // Offline for a moment: keep what is on screen.
    }
  }, [applicationId, sample]);

  useEffect(() => {
    if (sample) return;
    const first = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, TICK_REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh, sample]);

  const tick = useCallback((keys: string[]) => {
    setCopied((prev) => new Set([...prev, ...keys]));
    if (sample) return;
    keys.forEach((k) => pending.current.add(k));
    fetch(`/api/app/applications/attempts/${applicationId}/copy-ticks`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field_keys: keys, surface }),
    })
      .then((res) => { if (!res.ok) throw new Error("tick not saved"); })
      .catch(() => notify.block("Couldn't save that tick — it shows on this screen only."))
      .finally(() => keys.forEach((k) => pending.current.delete(k)));
  }, [applicationId, sample, surface]);

  return { copied, tick };
}

/** One sensitive value through the audited reveal call; null (after a toast) when it can't be read. */
async function revealValue(applicationId: string, fieldKey: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/app/applications/attempts/${applicationId}/reveal`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field_key: fieldKey, surface: "copy_assist" }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || typeof data?.value !== "string") {
      notify.block(data?.error ?? "Couldn't reveal that value.");
      return null;
    }
    return data.value;
  } catch {
    notify.fail("Couldn't reach Insurvas. Check your connection and try again.");
    return null;
  }
}

type Props = {
  attempt: AttemptView;
  caseId: string;
  sample: boolean;
  /** "Grace Oyelaran · Gerber Life" under the title. */
  subtitle?: string;
  /** True inside the pop-out window: a Close button instead of Pop out, and the white header. */
  popout?: boolean;
  className?: string;
};

export function CopyAssistPanel(props: Props) {
  // Keyed by attempt: a new attempt starts with no ticks (LA-3.16 — ticks never carry over).
  return <CopyAssistBody key={props.attempt.id} {...props} />;
}

function CopyAssistBody({ attempt, caseId, sample, popout, subtitle, className }: Props) {
  const groups = useMemo(() => {
    const all = buildCopyGroups(attempt);
    return TAB_ORDER.map((k) => all.find((g) => g.key === k)).filter((g): g is CopyGroup => Boolean(g && g.items.some((i) => i.display)));
  }, [attempt]);
  const [tab, setTab] = useState<string>(() => groups[0]?.key ?? "insured");
  const { copied, tick } = useSharedTicks(attempt.id, sample, popout ? "popout" : "web");
  const [format, setFormat] = useState<Readonly<Record<string, string>>>({});
  const [revealed, setRevealed] = useState<Readonly<Record<string, { value: string; until: number }>>>({});
  const [now, setNow] = useState(() => Date.now());
  const timers = useRef<Record<string, number>>({});

  // A countdown only while something is revealed.
  const anyRevealed = Object.keys(revealed).length > 0;
  useEffect(() => {
    if (!anyRevealed) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [anyRevealed]);
  useEffect(() => {
    const pending = timers.current;
    return () => Object.values(pending).forEach((t) => window.clearTimeout(t));
  }, []);

  const filled = groups.flatMap((g) => g.items.filter((i) => i.display));
  const total = filled.length;
  const done = filled.filter((i) => copied.has(i.key)).length;
  const left = filled.filter((i) => !copied.has(i.key));
  const leftSensitive = left.filter((i) => i.sensitive).length;
  const current = groups.find((g) => g.key === tab) ?? groups[0];
  const rows = current ? current.items.filter((i) => i.display) : [];
  const notGiven = current ? current.items.length - rows.length : 0;

  function remember(item: CopyItem, value: string) {
    setRevealed((prev) => ({ ...prev, [item.key]: { value, until: Date.now() + REVEAL_SECONDS * 1000 } }));
    window.clearTimeout(timers.current[item.key]);
    timers.current[item.key] = window.setTimeout(() => {
      setRevealed((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== item.key)));
    }, REVEAL_SECONDS * 1000);
  }

  async function copyOne(item: CopyItem) {
    if (item.sensitive) {
      // Reveal (audited, one field), write, tick. Sample data has no number to fetch.
      if (sample) { notify.warn("Sample data — nothing to reveal"); return; }
      const secret = revealed[item.key]?.value ?? (await revealValue(attempt.id, item.key));
      if (secret === null) return;
      if (!revealed[item.key]) remember(item, secret);
      if (!(await writeClipboard(secret))) return copyFailed();
      tick([item.key]);
      notify.done(`Copied ${item.name}`, { detail: CLIPBOARD_HONESTY_LINE });
      return;
    }
    const text = format[item.key] ?? item.copy;
    if (!text) return;
    if (!(await writeClipboard(text))) return copyFailed();
    tick([item.key]);
    notify.done(text !== item.copy ? `Copied ${item.name} · ${text}` : `Copied ${item.name}`);
  }

  async function copyGroup(group: CopyGroup) {
    const plain = group.items.filter((i) => i.copy && !i.sensitive);
    const skipped = group.items.filter((i) => i.sensitive && i.display).length;
    if (plain.length === 0) { notify.warn("Masked numbers are copied one at a time"); return; }
    if (!(await writeClipboard(plain.map((i) => format[i.key] ?? i.copy).join("\t")))) return copyFailed();
    tick(plain.map((i) => i.key));
    notify.done(`Copied ${TAB[group.key]?.toLowerCase() ?? group.label.toLowerCase()} · ${plain.length} ${plain.length === 1 ? "field" : "fields"}`, {
      detail: skipped ? "Masked numbers are left out — copy them one at a time." : undefined,
    });
  }

  async function clearClipboard() {
    if (!(await writeClipboard(""))) return notify.block("Couldn't clear the clipboard.");
    notify.done("Clipboard cleared", { detail: CLIPBOARD_HONESTY_LINE });
  }

  const header = popout ? (
    <div className="flex items-center gap-2.5 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-sm font-semibold text-[var(--ink)]">Copy-assist</h1>
        {subtitle && <p className="truncate text-xs text-[var(--muted)]">{subtitle}</p>}
      </div>
      <Button type="button" variant="outline" size="icon" aria-label="Close" onClick={() => window.close()}><X aria-hidden="true" /></Button>
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-t-[11px] border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3">
      <h2 className="text-sm font-semibold text-[var(--ink)]">Copy-assist</h2>
      <span className="flex items-center gap-2.5">
        <StatusChip tone={done === total && total > 0 ? "good" : "neutral"} dot={false}>{done} of {total} copied</StatusChip>
      </span>
    </div>
  );

  return (
    <section aria-label="Copy-assist" className={cn("flex min-w-0 flex-col rounded-[12px] border border-[var(--border)] bg-[var(--surface)]", className)}>
      {header}
      {groups.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--muted)]">Nothing on this application to copy yet.</p>
      ) : (
        <>
          <div className="px-4 py-2.5">
            <div role="group" aria-label="Field group" className="flex gap-[3px] rounded-[8px] bg-[var(--surface-alt)] p-[3px]">
              {groups.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  aria-pressed={g.key === current?.key}
                  onClick={() => setTab(g.key)}
                  className={cn(
                    "flex h-[30px] min-w-0 flex-1 items-center justify-center truncate rounded-[6px] border px-1.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    g.key === current?.key ? "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]",
                  )}
                >
                  {TAB[g.key] ?? g.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2.5 px-4 pb-2.5">
            <span className="text-xs text-[var(--muted)]">{rows.length} {rows.length === 1 ? "field" : "fields"} in this group{notGiven ? ` · ${notGiven} not given` : ""}</span>
            <span className="flex items-center gap-2">
              {!popout && (
                <Button type="button" variant="ghost" size="sm" onClick={() => openCopyAssistWindow(caseId, attempt.attemptNo, attempt.insuredRole, sample)}>
                  <ExternalLink aria-hidden="true" />Pop out
                </Button>
              )}
              {current && <Button type="button" variant="outline" size="sm" onClick={() => void copyGroup(current)}>Copy the whole group</Button>}
            </span>
          </div>
          <ul aria-label={current ? `${TAB[current.key] ?? current.label} fields` : undefined}>
            {rows.map((item, i) => (
              <li key={item.key}>
                {item.section && item.section !== rows[i - 1]?.section && (
                  <p className="border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.02em] text-[var(--muted)]">{item.section}</p>
                )}
                <CopyRow
                  item={item}
                  copied={copied.has(item.key)}
                  revealed={revealed[item.key] ?? null}
                  now={now}
                  format={format[item.key] ?? null}
                  onFormat={(v) => setFormat((prev) => ({ ...prev, [item.key]: v }))}
                  onCopy={() => void copyOne(item)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="rounded-b-[11px] border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold text-[var(--ink)] tabular-nums" aria-live="polite">{done} of {total} copied</span>
          <span className="text-xs text-[var(--muted)]">{left.length === 0 ? "Everything is copied" : `${left.length} left${leftSensitive ? `, ${leftSensitive} of them sensitive` : ""}`}</span>
          <span className="block w-full">
            <span role="meter" aria-label="Copied so far" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="m-meter block h-1.5 rounded-full bg-[var(--surface-alt)]">
              <span className="block h-1.5 rounded-full bg-[var(--primary)] transition-[width]" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
            </span>
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => void clearClipboard()}><ClipboardX aria-hidden="true" />Clear clipboard</Button>
          <p className="text-xs text-[var(--muted)]">{CLIPBOARD_HONESTY_LINE}</p>
        </div>
      </div>
    </section>
  );
}

function CopyRow({ item, copied, revealed, now, format, onFormat, onCopy }: {
  item: CopyItem;
  copied: boolean;
  revealed: { value: string; until: number } | null;
  now: number;
  format: string | null;
  onFormat: (value: string) => void;
  onCopy: () => void;
}) {
  const options = item.variants?.length && item.copy ? [{ label: item.copy, value: item.copy }, ...item.variants] : null;
  const chosen = format ?? item.copy;
  const shown = revealed ? revealed.value : options ? chosen : item.display;
  const secondsLeft = revealed ? Math.min(REVEAL_SECONDS, Math.max(0, Math.ceil((revealed.until - now) / 1000))) : 0;
  const label = item.label;
  return (
    <div className="border-t border-[var(--border)] px-4 py-[11px]">
      <div className="flex items-center gap-2.5">
        {copied
          ? <span className="flex size-[17px] shrink-0 items-center justify-center rounded-full bg-[var(--success)] text-white" aria-label="Copied"><Check className="size-3" strokeWidth={3} aria-hidden="true" /></span>
          : <span className="size-[17px] shrink-0 rounded-full border-[1.5px] border-[var(--border-strong)]" aria-label="Not copied yet" />}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--ink)]">{label}</span>
        {revealed && <StatusChip tone="warning" dot={false}>re-masks in {secondsLeft}s</StatusChip>}
      </div>
      <div className="mt-1 flex items-center gap-2.5 pl-[27px]">
        <span className={cn("min-w-0 flex-1 truncate text-xs text-[var(--ink)] tabular-nums", item.sensitive && "font-mono")}>{shown}</span>
        <Button type="button" variant="outline" size="sm" onClick={onCopy} aria-label={`Copy ${item.name}`}>Copy</Button>
      </div>
      {options && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[27px]">
          <span className="text-xs text-[var(--muted)]">Format</span>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={o.value === chosen}
              onClick={() => onFormat(o.value)}
              className={cn(
                "h-6 rounded-full border px-[9px] text-xs font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
                o.value === chosen ? "border-[var(--primary)] bg-[var(--brand-50)] text-[var(--accent-ink)]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)]",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
