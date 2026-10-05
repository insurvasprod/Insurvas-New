"use client";

/**
 * The confirmation screenshot or carrier letter (LA-3.15), attached three ways: Ctrl+V anywhere in
 * the box or the dialog that owns it (`onPaste`), drag and drop, or Choose a file. PNG, JPEG or PDF
 * up to 10 MB — the private bucket takes nothing else. The file stays in memory until the capture is
 * saved; then it uploads and is only ever shown again through a 60-second signed URL.
 */

import { useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import Image from "next/image";
import { FileText, ImageIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { confirmationExtension, MAX_CONFIRMATION_BYTES } from "@/lib/applications/afterSubmitRules";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

const ACCEPT = "image/png,image/jpeg,application/pdf";

export type Attachment = { file: File; previewUrl: string | null; addedAt: number; how: "pasted" | "chosen" | "dropped"; size: { w: number; h: number } | null };

/** Why a file can't be attached, or null when it can. */
export function attachmentProblem(file: File): string | null {
  if (!confirmationExtension(file.type)) return "Attach a PNG or JPEG screenshot, or a PDF.";
  if (file.size > MAX_CONFIRMATION_BYTES) return "The confirmation must be 10 MB or smaller.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

/** One attachment slot. The preview URL is made and revoked in the event that changes the file, never during render. */
export function useAttachment(initial: Attachment | null = null) {
  const [value, setValue] = useState<Attachment | null>(initial);
  // Only preview URLs this slot made are revoked here; a seeded one belongs to whoever made it.
  const owned = useRef(new Set<string>());
  const set = (file: File | null, how: Attachment["how"] = "chosen") => {
    if (value?.previewUrl && owned.current.has(value.previewUrl)) { URL.revokeObjectURL(value.previewUrl); owned.current.delete(value.previewUrl); }
    if (!file) { setValue(null); return; }
    const problem = attachmentProblem(file);
    if (problem) { notify.block(problem); return; }
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    if (previewUrl) owned.current.add(previewUrl);
    const next: Attachment = { file, previewUrl, addedAt: Date.now(), how, size: null };
    setValue(next);
    if (previewUrl) {
      const img = new window.Image();
      img.onload = () => setValue((cur) => (cur && cur.previewUrl === previewUrl ? { ...cur, size: { w: img.naturalWidth, h: img.naturalHeight } } : cur));
      img.src = previewUrl;
    }
  };
  /** Ctrl+V with an image on the clipboard attaches it; a text paste goes through to the input. */
  const onPaste = (event: ClipboardEvent) => {
    for (const item of Array.from(event.clipboardData?.items ?? [])) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (!file || !confirmationExtension(file.type)) continue;
      event.preventDefault();
      const stamp = new Date().toISOString().slice(0, 10);
      const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/jpeg" ? "jpg" : "png";
      set(new File([file], file.name && file.name !== "image.png" ? file.name : `confirmation-${stamp}.${ext}`, { type: file.type }), "pasted");
      return;
    }
  };
  return { value, set, onPaste };
}

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
const time = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();

/** The attached file, as the capture board shows it. */
export function AttachedFile({ value, onReplace, onRemove, disabled }: { value: Attachment; onReplace: () => void; onRemove: () => void; disabled?: boolean }) {
  const how = value.how === "pasted" ? "Pasted" : value.how === "dropped" ? "Dropped" : "Added";
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-[8px] border border-[var(--border-strong)] bg-[var(--canvas)] p-3.5">
      {value.previewUrl
        ? <Image src={value.previewUrl} alt="The attached confirmation" width={168} height={104} unoptimized className="h-[104px] w-[168px] shrink-0 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] object-cover object-top" />
        : <span className="flex h-[104px] w-[168px] shrink-0 items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--surface)]"><FileText className="size-6 text-[var(--muted)]" aria-hidden="true" /></span>}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate text-sm font-semibold text-[var(--ink)]">{value.file.name}</span>
        <span className="text-xs text-[var(--muted)]">
          {how} {time(value.addedAt)} · {size(value.file.size)}{value.size ? ` · ${value.size.w.toLocaleString("en-US")} × ${value.size.h.toLocaleString("en-US")}` : ""}
        </span>
        <StatusChip tone="neutral" dot={false}>Stored privately · served through a signed URL</StatusChip>
        <span className="mt-1 flex gap-2">
          <Button type="button" variant="outline" onClick={onReplace} disabled={disabled} title={disabled ? "Saving…" : undefined}>Replace</Button>
          <Button type="button" variant="ghost" onClick={onRemove} disabled={disabled} title={disabled ? "Saving…" : undefined}>Remove</Button>
        </span>
      </div>
    </div>
  );
}

/**
 * The dashed paste box (l3-ws-submit): paste, drop or choose. `children` renders under the copy —
 * the inline card puts its "Capture submission" button there.
 */
export function PasteBox({ id, onFile, disabled, disabledReason = "Saving…", children, title = "Paste the confirmation screenshot" }: {
  id: string;
  onFile: (file: File, how: Attachment["how"]) => void;
  disabled?: boolean;
  /** The tooltip on "Choose a file" while the box is disabled. */
  disabledReason?: string;
  children?: ReactNode;
  title?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped && !disabled) onFile(dropped, "dropped");
  };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn("flex flex-col items-center gap-2 rounded-[12px] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-5 text-center", over && "bg-[var(--surface-alt)]")}
    >
      <span className="flex size-[34px] items-center justify-center rounded-full bg-[var(--surface-alt)] text-[var(--muted)]" aria-hidden="true"><ImageIcon className="size-4" /></span>
      <div className="text-lg font-semibold text-[var(--ink)]">{title}</div>
      <p className="text-sm text-[var(--muted)]">Ctrl+V anywhere in this box, drop a file, or choose one. PNG, JPEG or PDF, up to 10 MB.</p>
      <input
        ref={input}
        id={id}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f, "chosen"); e.target.value = ""; }}
      />
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <Button type="button" variant="outline" onClick={() => input.current?.click()} disabled={disabled} title={disabled ? disabledReason : undefined}>Choose a file</Button>
        {children}
      </div>
    </div>
  );
}

/** A hidden file input the Replace button opens. */
export function useFilePicker(onFile: (file: File) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const node = (
    <input ref={ref} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true"
      onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
  );
  return { open: () => ref.current?.click(), node };
}
