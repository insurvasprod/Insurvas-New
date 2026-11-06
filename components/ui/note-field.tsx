"use client";

import { useEffect, useRef, type TextareaHTMLAttributes } from "react";

import { DictateButton } from "@/components/ui/dictate-button";
import { textareaControl } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * A notes box with dictation inside it (owner 2026-11-06: "put the dictate inside the box"): the textarea, and
 * the mic in its bottom-right corner. Each phrase spoken is added to what is already typed. Where the browser
 * has no speech recognition, it is a plain textarea.
 */
export function NoteField({ value, onChange, className, ...props }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & { value: string; onChange: (next: string) => void }) {
  // Dictation keeps talking after a render: the latest text and handler, never the ones from when it started.
  const latest = useRef({ value, onChange });
  useEffect(() => { latest.current = { value, onChange }; });
  return (
    <div className="relative">
      <textarea {...props} className={cn(textareaControl, "pb-10", className)} value={value} onChange={(e) => onChange(e.target.value)} />
      <DictateButton compact className="absolute bottom-1.5 right-1.5" onText={(text) => {
        const { value: now, onChange: set } = latest.current;
        const next = now.trim() ? `${now.trim()} ${text}` : text;
        latest.current = { value: next, onChange: set };
        set(next);
      }} />
    </div>
  );
}
