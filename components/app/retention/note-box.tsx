"use client";

import { NoteField } from "@/components/ui/note-field";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";

/**
 * A note, typed or dictated (owner 2026-11-06), saved on its own to the record it sits on. `endpoint` and
 * `fields` say where (plain data, so a server page can pass them): the note is posted as `{ ...fields, note }`.
 * An error stays beside the button (§11).
 */
export function NoteBox({ endpoint, fields, id = "note-box" }: { endpoint: string; fields: Record<string, string>; id?: string }) {
  const body = (note: string) => ({ ...fields, note });
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body(note.trim())) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The note could not be saved.");
      notify.done("Note saved.");
      setNote("");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "The note could not be saved."); } finally { setBusy(false); }
  }
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-foreground">Add a note</label>
      <NoteField id={id} rows={3} maxLength={1000} placeholder="What happened, what the carrier said…" value={note} onChange={setNote} />
      {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
      <div className="flex justify-end"><Button type="button" size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save the note"}</Button></div>
    </div>
  );
}
