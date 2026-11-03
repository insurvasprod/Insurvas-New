"use client";

import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

/**
 * Six boxes for a six-digit code. Typing moves to the next box, Backspace to the previous one, and a
 * pasted code ("123 456" included) fills every box at once. `onComplete` fires when the sixth digit
 * lands, so the code signs in without a button press (the button stays for anyone who wants it).
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  idPrefix,
  autoFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  idPrefix: string;
  autoFocus?: boolean;
}) {
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  // Keystrokes can arrive faster than the parent re-renders with the new value, so each one reads
  // the latest code from here rather than from the `value` its render saw.
  const latest = useRef(value);
  useEffect(() => { latest.current = value; }, [value]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? "");
  const current = () => Array.from({ length: 6 }, (_, index) => latest.current[index] ?? "");

  function commit(next: string, focusIndex: number) {
    const clean = next.replace(/\D/g, "").slice(0, 6);
    latest.current = clean;
    onChange(clean);
    boxes.current[Math.min(focusIndex, 5)]?.focus();
    if (clean.length === 6) onComplete?.(clean);
  }

  /**
   * One keystroke brings one digit, but a phone's "fill code from Messages" and some keyboards put the
   * whole code into the first box in one go: every digit that arrives is written from this box on.
   */
  function type(index: number, raw: string) {
    let incoming = raw.replace(/\D/g, "");
    if (!incoming) return;
    const now = current();
    // The box already held a digit, and the browser kept it beside the new one(s).
    if (incoming.length > 1 && now[index]) {
      if (incoming.startsWith(now[index])) incoming = incoming.slice(1);
      else if (incoming.endsWith(now[index])) incoming = incoming.slice(0, -1);
    }
    const slots = [...now];
    [...incoming].forEach((digit, offset) => { if (index + offset < 6) slots[index + offset] = digit; });
    const next = slots.join("").slice(0, 6);
    commit(next, Math.min(next.length, 5));
  }

  function key(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      event.preventDefault();
      const now = current();
      if (now[index]) commit(now.slice(0, index).join("") + now.slice(index + 1).join(""), index);
      else if (index > 0) commit(now.slice(0, index - 1).join("") + now.slice(index).join(""), index - 1);
    } else if (event.key === "ArrowLeft" && index > 0) {
      boxes.current[index - 1]?.focus();
    } else if (event.key === "ArrowRight" && index < 5) {
      boxes.current[index + 1]?.focus();
    }
  }

  function paste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;
    event.preventDefault();
    commit(pasted, pasted.length);
  }

  return (
    <div className="flex gap-2" role="group" aria-label="Six-digit code">
      {digits.map((digit, index) => (
        <input
          key={index}
          id={`${idPrefix}-${index}`}
          ref={(node) => { boxes.current[index] = node; }}
          value={digit}
          onChange={(event) => type(index, event.target.value)}
          onKeyDown={(event) => key(index, event)}
          onPaste={paste}
          onFocus={(event) => event.target.select()}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          autoFocus={autoFocus && index === 0}
          maxLength={6}
          disabled={disabled}
          aria-label={`Digit ${index + 1} of 6`}
          className={cn(
            "h-14 w-full min-w-0 max-w-14 rounded-lg border border-[var(--border-strong)] bg-card text-center text-2xl font-semibold tabular-nums text-foreground",
            "outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--ring-color)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_25%,transparent)]",
            "disabled:opacity-60",
          )}
        />
      ))}
    </div>
  );
}
