"use client";

import { useEffect, useLayoutEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { Paperclip, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isTypingTarget } from "@/lib/keyboard/listNavigation";
import { cn } from "@/lib/utils";

/**
 * The message bar.
 *
 * It replaces three stacked rows — a textarea, then a row holding "Attach files" on the left and
 * "Send message" on the right, then a line with the character count — which is what the owner meant
 * on 30 Oct by the attach button sitting next to Send while the writing box was above it. A chat
 * composer is one bar: the paperclip inside it on the left, the text growing in the middle, send on
 * the right.
 *
 * It keeps the shared controls (`Button`) and the kit's corners rather than inventing the circular
 * send button a messenger would use: §5a reserves round shapes, and an 8px icon button reads as
 * part of this product.
 */

/** One line of text, and the cap it grows to before the field scrolls instead. */
const LINE_HEIGHT = 20;
const MAX_ROWS = 6;

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  files,
  onFilesChange,
  busy = false,
  disabled = false,
  placeholder = "Write a message…",
  maxLength,
  accept,
  maxFiles = 3,
  countLabel,
  captureTyping = true,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  files: File[];
  onFilesChange: (next: File[]) => void;
  busy?: boolean;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  accept?: string;
  maxFiles?: number;
  /** How the count reads when it is close enough to the cap to matter. */
  countLabel?: (length: number) => string;
  /** Typing anywhere on the page starts a message here. Off for a composer that shares a page. */
  captureTyping?: boolean;
  className?: string;
}) {
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const caretToEnd = useRef(false);

  // Grow with the content up to MAX_ROWS, then scroll. A DOM write rather than state: the height is
  // the browser's measurement of the text, and React has nothing to add to it.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, LINE_HEIGHT * MAX_ROWS)}px`;
    // A character typed from outside lands at the end, and the caret follows it there — focusing a
    // textarea that already has text otherwise leaves the caret at the start.
    if (caretToEnd.current) {
      caretToEnd.current = false;
      field.setSelectionRange(field.value.length, field.value.length);
    }
  }, [value]);

  /**
   * Start typing anywhere and the message starts here (owner, 30 Oct) — what every messenger does,
   * and the reason nobody hunts for the box first. One printable character, no modifier, nothing
   * else already taking keys: the caret moves into the field and the character is kept.
   */
  useEffect(() => {
    if (!captureTyping) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1) return;
      const field = fieldRef.current;
      if (!field || disabled || field.disabled || document.activeElement === field) return;
      // Not from a box someone is already writing in, and not from a layer sitting over the page.
      if (isTypingTarget(event.target as HTMLElement | null)) return;
      if (document.querySelector("[role=dialog][data-state=open], [role=alertdialog][data-state=open], [role=menu][data-state=open], [role=listbox][data-state=open]")) return;
      // A sheet or detail panel over the page owns the keyboard while it is open (§11).
      if (document.querySelector("[data-slot=detail-panel][data-mode=overlay]")) return;
      // On a phone the thread can be display:none behind the conversation list.
      if (field.offsetParent === null) return;
      // A space would only put a space in front of the message; let it scroll the page instead.
      if (event.key === " " && !value) return;
      event.preventDefault();
      caretToEnd.current = true;
      field.focus();
      onChange(value + event.key);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [captureTyping, disabled, onChange, value]);

  const nothingToSend = !value.trim() && files.length === 0;
  const blocked = busy || disabled || nothingToSend;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (blocked) return;
    onSubmit();
  };

  // Enter sends, Shift+Enter breaks the line — what every messenger does, and what someone typing
  // a message expects before they have read any help.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  const addFiles = (chosen: FileList | null) => {
    if (!chosen) return;
    onFilesChange([...files, ...Array.from(chosen)].slice(0, maxFiles));
  };

  // The count is noise until it is nearly spent, so it appears in the last tenth of the allowance.
  const showCount = Boolean(maxLength && countLabel && value.length >= maxLength * 0.9);

  return (
    <form
      onSubmit={submit}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-2 transition-colors focus-within:border-[var(--primary)]",
        className,
      )}
    >
      {files.length > 0 && (
        <ul className="flex min-w-0 list-none flex-wrap gap-1.5 p-0">
          {files.map((file) => (
            <li
              key={`${file.name}-${file.size}-${file.lastModified}`}
              className="inline-flex min-w-0 items-center gap-1.5 rounded-badge border border-border bg-[var(--surface-alt)] py-1 pl-2.5 pr-1 text-xs"
            >
              <span className="min-w-0 truncate text-foreground">{file.name}</span>
              <button
                type="button"
                onClick={() => onFilesChange(files.filter((item) => item !== file))}
                aria-label={`Remove ${file.name}`}
                className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground outline-none hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex min-w-0 items-end gap-2">
        <label
          className={cn(
            "grid size-9 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--surface-alt)] hover:text-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--ring-color)]",
            (disabled || files.length >= maxFiles) && "pointer-events-none opacity-50",
          )}
        >
          <Paperclip className="size-[18px]" aria-hidden="true" />
          <span className="sr-only">Attach files</span>
          <input
            type="file"
            multiple
            accept={accept}
            disabled={disabled || files.length >= maxFiles}
            className="sr-only"
            onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }}
          />
        </label>

        <textarea
          ref={fieldRef}
          rows={1}
          aria-label="Message"
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 resize-none self-center bg-transparent py-2 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />

        <Button type="submit" size="icon" disabled={blocked} aria-label={busy ? "Sending" : "Send message"} className="shrink-0">
          <Send aria-hidden="true" />
        </Button>
      </div>

      {showCount && (
        <p className="m-0 px-1 text-right text-xs tabular-nums text-muted-foreground">{countLabel!(value.length)}</p>
      )}
    </form>
  );
}
