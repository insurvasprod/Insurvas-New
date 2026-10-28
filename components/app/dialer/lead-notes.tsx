"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mic, MicOff, NotebookPen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionLoading } from "@/components/ui/page-states";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { fieldClass, label, small } from "@/components/app/dialer/model";
import { useDictation } from "@/components/app/dialer/use-dictation";

type Note = { id: string; body: string | null; visibility: "internal" | "shared"; author: { name: string }; createdAt: string; deletedAt: string | null };

/**
 * The lead's notes beside the outcomes (Dialer A, owner 2026-10-27): what the last person who
 * called learned, and room to leave the next one a line. The same notes as the lead's own page
 * (/api/app/leads/[id]/notes, team-only here); sharing a note with the partner stays on that page.
 * Owners, producers and assistants, as the notes route admits; a setter sees why it is not there.
 */
export function DialerLeadNotes({ leadId, canWrite }: { leadId: string; canWrite: boolean }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const path = `/api/app/leads/${encodeURIComponent(leadId)}/notes`;
  // Each finished sentence is added to whatever is already typed.
  const dictation = useDictation(useCallback((text: string) => { if (text) setBody((current) => (current.trim() ? `${current.replace(/\s+$/, "")} ${text}` : text)); }, []));

  const load = useCallback(async () => {
    const response = await fetch(path, { cache: "no-store" }).catch(() => null);
    const result = await response?.json().catch(() => null);
    if (!response?.ok) { setError(result?.error ?? "The notes could not be loaded."); return; }
    setError(null);
    setNotes((result?.notes ?? []) as Note[]);
  }, [path]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load this lead's notes when it opens
  useEffect(() => { setNotes(null); void load(); }, [load]);

  async function save() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text, visibility: "internal", mentions: [], idempotency_key: crypto.randomUUID() }) }).catch(() => null);
    const result = await response?.json().catch(() => null);
    setBusy(false);
    if (!response?.ok) { notify.block(result?.error ?? "Could not save the note"); return; }
    setBody("");
    notify.done("Note saved");
    await load();
  }

  const shown = (notes ?? []).filter((note) => !note.deletedAt && note.body);
  return (
    <section aria-label="Lead notes" className="m-glass flex h-full min-h-0 min-w-0 flex-col gap-3 rounded-[16px] border border-[var(--border)] p-4">
      <div className="flex items-center gap-2">
        <NotebookPen aria-hidden="true" className="size-4 text-[var(--muted)]" />
        <p className={cn(label, "m-0 flex-1")}>Lead notes</p>
        {notes && <span className={cn(small, "tabular-nums")}>{shown.length}</span>}
      </div>
      {canWrite && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`dialer-note-${leadId}`} className="sr-only">Add a note for whoever calls this lead next</label>
          <textarea
            id={`dialer-note-${leadId}`}
            rows={3}
            maxLength={4000}
            className={cn(fieldClass, "mt-0 h-auto py-2")}
            placeholder="What should the next person know? Best time, who answers, what they asked…"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save(); } }}
          />
          {dictation.problem && !dictation.listening && <p className="m-0 text-xs leading-[1.5] text-[var(--error-ink)]" role="alert">{dictation.problem}</p>}
          {dictation.listening && (
            <p className={cn(small, "m-0 flex items-center gap-2")} role="status" aria-live="polite">
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-[var(--error)]" aria-hidden="true" />
              {dictation.engine === "device"
                ? <span className="tabular-nums">Recording {Math.floor(dictation.seconds / 60)}:{String(dictation.seconds % 60).padStart(2, "0")} · press Stop to write it</span>
                : dictation.heard ? <span className="italic">{dictation.heard}</span> : "Listening… speak your note."}
            </p>
          )}
          {dictation.transcribing && (
            <p className={cn(small, "m-0 flex items-center gap-2")} role="status" aria-live="polite">
              <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
              {dictation.download !== null && dictation.download < 100 ? `Getting the speech model ready, the first time only · ${dictation.download}%` : "Writing your note…"}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className={small}>Your team sees it on this lead.</span>
            <span className="flex items-center gap-2">
              {!dictation.supported && <span className={small} title="This browser cannot record from the microphone.">No dictation in this browser</span>}
              {dictation.supported && (
                <Button type="button" size="sm" variant={dictation.listening ? "default" : "outline"} onClick={() => (dictation.listening ? dictation.stop() : dictation.start())} disabled={busy || dictation.transcribing} aria-pressed={dictation.listening} title={dictation.listening ? "Stop dictating" : dictation.engine === "device" ? "Speak the note; it is written on this computer when you press Stop" : "Speak the note instead of typing it"}>
                  {dictation.listening ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}{dictation.listening ? "Stop" : "Dictate"}
                </Button>
              )}
              <Button type="button" size="sm" onClick={() => { dictation.stop(); void save(); }} disabled={busy || !body.trim()}>{busy ? "Saving…" : "Save note"}</Button>
            </span>
          </div>
        </div>
      )}
      {error ? <p className="m-0 text-xs leading-[1.5] text-[var(--error-ink)]" role="alert">{error}</p>
        : !notes ? <SectionLoading rows={2} columns={1} label="Loading the notes" />
        : shown.length === 0 ? <p className={cn(small, "m-0")}>No notes yet.</p>
        : (
          <ol className="m-0 flex min-h-0 flex-1 list-none flex-col gap-2 overflow-y-auto p-0">
            {shown.map((note) => (
              <li key={note.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                <p className="m-0 text-sm leading-[1.5] tracking-[-0.02em] whitespace-pre-line text-[var(--body)]">{note.body}</p>
                <p className={cn(small, "m-0 mt-1")}>{note.author.name} · {dateTime(note.createdAt, viewerTimeZone(), { clock: "12h" })}{note.visibility === "shared" ? " · shared with the partner" : ""}</p>
              </li>
            ))}
          </ol>
        )}
    </section>
  );
}
