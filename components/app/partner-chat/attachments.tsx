"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, FileSpreadsheet, FileText, FileType2, Image as ImageIcon, ImageOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PartnerMessageAttachment } from "@/lib/partnerChat/cards";
import { cn } from "@/lib/utils";

/**
 * Files in partner chat (owner, 2026-10-28): a picture shows as itself, any other file as a card that
 * says what it is, and a click opens a preview — the picture full size, a PDF in a viewer, a text file
 * as text. Word and Excel files cannot be drawn in the browser, so their preview says so and offers
 * the download.
 */

export const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

type Kind = "image" | "pdf" | "text" | "word" | "sheet" | "file";
export function fileKind(contentType: string, name = ""): Kind {
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (contentType.startsWith("text/") || /\.txt$/i.test(name)) return "text";
  if (contentType.includes("wordprocessingml") || /\.docx?$/i.test(name)) return "word";
  if (contentType.includes("spreadsheetml") || /\.xlsx?$/i.test(name)) return "sheet";
  return "file";
}

const KIND_LOOK: Record<Kind, { label: string; tile: string; Icon: typeof FileText }> = {
  image: { label: "Image", tile: "bg-[var(--info-surface)] text-[var(--info-ink)]", Icon: ImageIcon },
  pdf: { label: "PDF", tile: "bg-[var(--error-surface)] text-[var(--error-ink)]", Icon: FileType2 },
  text: { label: "Text", tile: "bg-[var(--surface-alt)] text-[var(--body)]", Icon: FileText },
  word: { label: "Word", tile: "bg-[var(--info-surface)] text-[var(--info-ink)]", Icon: FileText },
  sheet: { label: "Excel", tile: "bg-[var(--success-surface)] text-[var(--success-ink)]", Icon: FileSpreadsheet },
  file: { label: "File", tile: "bg-[var(--surface-alt)] text-[var(--body)]", Icon: FileText },
};

/** The coloured square that names a file's type: PDF red, Word blue, Excel green. */
export function FileTypeTile({ contentType, name, scale = "md" }: { contentType: string; name: string; scale?: "sm" | "md" }) {
  const look = KIND_LOOK[fileKind(contentType, name)];
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center rounded-lg", look.tile, scale === "sm" ? "size-8" : "size-10")}>
      <look.Icon className={scale === "sm" ? "size-4" : "size-5"} />
    </span>
  );
}

/** A message's files: pictures as a small gallery, everything else as file cards. */
export function MessageAttachments({ attachments, mine }: { attachments: PartnerMessageAttachment[]; mine: boolean }) {
  const [open, setOpen] = useState<PartnerMessageAttachment | null>(null);
  if (!attachments.length) return null;
  const images = attachments.filter((item) => fileKind(item.contentType, item.fileName) === "image");
  const files = attachments.filter((item) => fileKind(item.contentType, item.fileName) !== "image");
  return (
    <div className={cn("mt-1.5 flex max-w-full flex-col gap-1.5", mine ? "items-end" : "items-start")}>
      {images.length > 0 && (
        <div className={cn("grid max-w-[360px] gap-1.5", images.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
          {images.map((item) => item.downloadUrl ? (
            <button key={item.id} type="button" onClick={() => setOpen(item)} aria-label={`Open ${item.fileName}`} title={item.fileName} className="group/img relative block overflow-hidden rounded-xl border border-border bg-[var(--surface-alt)]">
              {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed storage URL, not a static asset */}
              <img src={item.downloadUrl} alt={item.fileName} loading="lazy" className={cn("block w-full object-cover transition-transform group-hover/img:scale-[1.02]", images.length > 1 ? "aspect-square" : "max-h-72")} />
            </button>
          ) : <Unavailable key={item.id} item={item} />)}
        </div>
      )}
      {files.map((item) => item.downloadUrl ? (
        <button key={item.id} type="button" onClick={() => setOpen(item)} className="flex w-[280px] max-w-full items-center gap-3 rounded-xl border border-border bg-card p-2.5 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-alt)]">
          <FileTypeTile contentType={item.contentType} name={item.fileName} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{item.fileName}</span>
            <span className="block text-xs text-muted-foreground">{KIND_LOOK[fileKind(item.contentType, item.fileName)].label} · {kb(item.sizeBytes)} · Preview</span>
          </span>
        </button>
      ) : <Unavailable key={item.id} item={item} />)}
      <AttachmentPreview attachment={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Unavailable({ item }: { item: PartnerMessageAttachment }) {
  return <span className="inline-flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"><ImageOff className="size-4" aria-hidden="true" />{item.fileName} is unavailable</span>;
}

/** The preview: the file itself where the browser can draw it, and always the download. */
export function AttachmentPreview({ attachment, onClose }: { attachment: PartnerMessageAttachment | null; onClose: () => void }) {
  const kind = attachment ? fileKind(attachment.contentType, attachment.fileName) : "file";
  const url = attachment?.downloadUrl ?? null;
  const [text, setText] = useState<{ url: string; body: string | null } | null>(null);
  useEffect(() => {
    if (!url || kind !== "text") return;
    let live = true;
    void fetch(url).then((response) => (response.ok ? response.text() : null)).catch(() => null).then((body) => { if (live) setText({ url, body: body === null ? null : body.slice(0, 200_000) }); });
    return () => { live = false; };
  }, [url, kind]);
  return (
    <Dialog open={Boolean(attachment)} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="xl" showCloseButton={false} className="gap-0 overflow-hidden p-0">
        {attachment && (
          <>
            <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-3 text-left">
              <FileTypeTile contentType={attachment.contentType} name={attachment.fileName} scale="sm" />
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-sm">{attachment.fileName}</DialogTitle>
                <DialogDescription className="text-xs">{KIND_LOOK[kind].label} · {kb(attachment.sizeBytes)}</DialogDescription>
              </div>
              {url && <Button asChild variant="outline" size="sm"><a href={url} target="_blank" rel="noreferrer" download={attachment.fileName}><Download aria-hidden="true" />Download</a></Button>}
              <Button type="button" variant="ghost" size="icon" aria-label="Close the preview" onClick={onClose}><X aria-hidden="true" /></Button>
            </DialogHeader>
            <div className="flex max-h-[75dvh] min-h-64 items-center justify-center overflow-auto bg-[var(--surface-alt)]">
              {!url ? <p className="m-0 p-8 text-sm text-muted-foreground">This file is unavailable right now.</p>
                : kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed storage URL
                  <img src={url} alt={attachment.fileName} className="block max-h-[75dvh] max-w-full object-contain" />
                ) : kind === "pdf" ? (
                  <iframe src={url} title={attachment.fileName} className="h-[75dvh] w-full border-0 bg-white" />
                ) : kind === "text" ? (
                  text?.url !== url ? <p className="m-0 p-8 text-sm text-muted-foreground">Opening the file…</p>
                    : text.body === null ? <p className="m-0 p-8 text-sm text-muted-foreground">This file could not be opened here. Download it instead.</p>
                    : <pre className="m-0 w-full self-stretch overflow-auto bg-card p-5 font-mono text-sm leading-relaxed whitespace-pre-wrap text-[var(--body)]">{text.body}</pre>
                ) : (
                  <div className="flex flex-col items-center gap-3 p-10 text-center">
                    <FileTypeTile contentType={attachment.contentType} name={attachment.fileName} />
                    <p className="m-0 max-w-sm text-sm text-muted-foreground">{KIND_LOOK[kind].label} files cannot be shown in the browser. Download it to open it in {kind === "sheet" ? "Excel" : kind === "word" ? "Word" : "its app"}.</p>
                    <Button asChild variant="outline"><a href={url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />Open the file</a></Button>
                  </div>
                )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The files waiting in the composer: pictures as thumbnails, the rest as type tiles. */
export function ComposerFiles({ files, onRemove }: { files: File[]; onRemove: (file: File) => void }) {
  const urls = useMemo(() => files.map((file) => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null)), [files]);
  useEffect(() => () => urls.forEach((url) => url && URL.revokeObjectURL(url)), [urls]);
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2.5">
      {files.map((file, index) => (
        <span key={`${file.name}-${file.size}`} className="relative inline-flex max-w-[220px] items-center gap-2 rounded-lg border border-border bg-card p-1.5 pr-7">
          {urls[index]
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL for the picked file
            ? <img src={urls[index] as string} alt="" className="size-10 shrink-0 rounded-md object-cover" />
            : <FileTypeTile contentType={file.type} name={file.name} />}
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-foreground">{file.name}</span>
            <span className="block text-xs text-muted-foreground">{kb(file.size)}</span>
          </span>
          <button type="button" onClick={() => onRemove(file)} aria-label={`Remove ${file.name}`} className="absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--surface-alt)] hover:text-foreground"><X className="size-3" aria-hidden="true" /></button>
        </span>
      ))}
    </div>
  );
}
