"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { btn, Callout, control, Field, Pill } from "@/components/app/settings/primitives";
import { LEGAL_DOC_LABELS, type LegalDocType } from "@/lib/legal/constants";
import { legalDay, type LegalDraft } from "@/lib/legal/adminTypes";
import { type EditorState, type Lookup, plural } from "./model";
import { LegalText, UtcTime } from "./versions";

export function LookupCard({ doc, lookup }: { doc: LegalDocType; lookup: Lookup | null }) {
  const router = useRouter();
  const [email, setEmail] = useState(lookup?.email ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    const query = email.trim();
    if (!query) return;
    router.push(`/admin/legal?doc=${doc}&user=${encodeURIComponent(query)}`);
  }

  return (
    <section className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">Acceptance lookup</h2>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
        <Field label="User email" htmlFor="legal-lookup-email">
          <input
            id="legal-lookup-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="user@example.com"
            className={control}
          />
        </Field>
        <Button type="submit" variant="outline" className="w-full">
          Look up
        </Button>
      </form>

      {lookup && !lookup.found && (
        <p className="mt-4 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">No user with that email address.</p>
      )}

      {lookup?.found && lookup.records.length === 0 && (
        <p className="mt-4 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
          That user exists but has accepted nothing. They signed up before acceptance was recorded, or their signup did not
          complete.
        </p>
      )}

      {lookup?.found && lookup.records.length > 0 && (
        <div className="mt-4">
          <div className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">
            {plural(lookup.records.length, "acceptance", "acceptances")} · {lookup.email}
          </div>
          <ul className="m-0 mt-2 list-none divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] p-0">
            {lookup.records.map((record) => (
              <li key={record.id} className="px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                    {LEGAL_DOC_LABELS[record.doc_type as LegalDocType] ?? record.doc_type}
                  </span>
                  <Link
                    href={`/legal/${record.doc_type}?v=${record.version}`}
                    target="_blank"
                    className="shrink-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--accent-ink)] underline"
                  >
                    v{record.version}
                  </Link>
                </div>
                <div className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                  <UtcTime iso={record.accepted_at} /> · {record.context === "signup" ? "At signup" : "Re-acceptance"}
                </div>
                <div className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                  IP <span className="font-mono text-[var(--body)]">{record.ip ?? "not recorded"}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ── draft editor ──────────────────────────────────────────────────────────────────────────── */

export function DraftTextCard({
  version,
  editor,
  canEdit,
  hasSavedDraft,
  onEdit,
}: {
  version: number;
  editor: EditorState;
  canEdit: boolean;
  hasSavedDraft: boolean;
  onEdit: (patch: Partial<EditorState>) => void;
}) {
  const [preview, setPreview] = useState(!canEdit);

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3">
        <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Version {version} &mdash; draft</span>
        <span className="flex items-center gap-2.5">
          {canEdit && (
            <button type="button" onClick={() => setPreview((p) => !p)} className={btn("row", "h-7 px-2.5")} aria-pressed={preview}>
              {preview ? "Edit" : "Preview"}
            </button>
          )}
          <Pill tone="warning" dot>
            Not visible to customers
          </Pill>
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 px-5 py-4">
        {!canEdit && !hasSavedDraft ? null : canEdit && !preview ? (
          <>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
              <Field label="Title" htmlFor="legal-draft-title">
                <input
                  id="legal-draft-title"
                  value={editor.title}
                  onChange={(event) => onEdit({ title: event.target.value })}
                  maxLength={160}
                  className={control}
                />
              </Field>
              <Field label="Effective date" htmlFor="legal-draft-effective">
                <input
                  id="legal-draft-effective"
                  type="date"
                  value={editor.effectiveDate}
                  onChange={(event) => onEdit({ effectiveDate: event.target.value })}
                  className={control}
                />
              </Field>
            </div>
            <Field
              label="Text"
              htmlFor="legal-draft-content"
              hint={`Markdown: # headings, ## sections, - bullets, **bold**. ${editor.content.trim().length.toLocaleString("en-US")} characters.`}
              className="flex flex-1 flex-col"
            >
              <textarea
                id="legal-draft-content"
                value={editor.content}
                onChange={(event) => onEdit({ content: event.target.value })}
                placeholder={"# Terms of Service\n\n## 1. Scope\n\nThese terms govern your use of the Insurvas platform…"}
                className={cn(control, "h-auto min-h-[360px] flex-1 resize-y py-2.5 text-[14px] leading-[1.6]")}
              />
            </Field>
          </>
        ) : (
          <>
            {!canEdit && (
              <p className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                {editor.title} · effective {legalDay(editor.effectiveDate)} if published as it stands. Only a super admin can edit or
                publish it.
              </p>
            )}
            {editor.content.trim() ? (
              <LegalText content={editor.content} />
            ) : (
              <p className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">The draft has no text yet.</p>
            )}
          </>
        )}
        {!canEdit && !hasSavedDraft && (
          <p className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
            Nobody has started a draft of the next version. Only a super admin can write and publish one.
          </p>
        )}
      </div>
    </section>
  );
}

export function DraftSummaryCard({
  doc,
  version,
  editor,
  canEdit,
  draft,
  saved,
  draftsSupported,
  eligibleUsers,
  busy,
  publishBlocker,
  titleOk,
  onEdit,
  onSave,
  onDiscard,
  onPublish,
}: {
  doc: LegalDocType;
  version: number;
  editor: EditorState;
  canEdit: boolean;
  draft: LegalDraft | null;
  saved: boolean;
  draftsSupported: boolean;
  eligibleUsers: number | null;
  busy: null | "save" | "discard" | "publish";
  publishBlocker: string | null;
  titleOk: boolean;
  onEdit: (patch: Partial<EditorState>) => void;
  onSave: () => void;
  onDiscard: () => void;
  onPublish: () => void;
}) {
  if (!canEdit) {
    if (!draft) return null;
    return (
      <section className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">Change summary</h2>
        <p className="mt-4 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
          {editor.changeSummary.trim() || "No summary written yet."}
        </p>
        <p className="mt-3 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
          {editor.requiresReacceptance ? "Marked as a material change: publishing it would ask every user to accept it." : "Not marked as a material change: publishing it would interrupt nobody."}{" "}
          Last saved <UtcTime iso={draft.updated_at} />.
        </p>
      </section>
    );
  }

  const saveBlocker = !draftsSupported
    ? "Saving drafts needs a database update that has not been applied yet. Publishing still works, straight from this editor."
    : !titleOk
      ? "Give the document a title of at least 3 characters."
      : null;
  const eligible = eligibleUsers === null ? "every" : `all ${eligibleUsers.toLocaleString("en-US")}`;

  return (
    <section className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">Change summary</h2>

      <div className="mt-4">
        <label htmlFor="legal-draft-summary" className="sr-only">
          What changed (shown to users on the acceptance screen)
        </label>
        <textarea
          id="legal-draft-summary"
          rows={3}
          value={editor.changeSummary}
          onChange={(event) => onEdit({ changeSummary: event.target.value })}
          maxLength={2000}
          placeholder="Clarified the refund policy and added a data retention period."
          className={cn(control, "mt-0 h-auto resize-y py-2.5")}
        />
        <span className="mt-1.5 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
          Shown to users on the acceptance screen.
        </span>
      </div>

      <label htmlFor="legal-draft-material" className="mt-4 flex cursor-pointer items-start gap-3 rounded-[8px] border border-[var(--border)] p-3">
        <input
          id="legal-draft-material"
          type="checkbox"
          checked={editor.requiresReacceptance}
          onChange={(event) => onEdit({ requiresReacceptance: event.target.checked })}
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
        />
        <span className="text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
          <span className="font-semibold text-[var(--ink)]">This is a material change.</span> Every user is blocked from the product until
          they accept it.
        </span>
      </label>

      {editor.requiresReacceptance && (
        <Callout tone="error" title={`Publishing stops ${eligible} users until they accept version ${version}.`} className="mt-4" />
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {(draft || !saved) && (
          <Button type="button" variant="ghost" onClick={onDiscard} disabled={busy !== null} className="mr-auto">
            {busy === "discard" ? "Discarding…" : draft ? "Discard draft" : "Reset"}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onSave} disabled={busy !== null || saveBlocker !== null || saved}>
          {busy === "save" ? "Saving…" : saved ? "Draft saved" : "Save draft"}
        </Button>
        <Button type="button" onClick={onPublish} disabled={busy !== null || publishBlocker !== null}>
          Publish version {version}
        </Button>
      </div>

      {(saveBlocker || publishBlocker) && (
        <div className="mt-2 flex flex-col items-end gap-0.5 text-right">
          {saveBlocker && <span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{saveBlocker}</span>}
          {publishBlocker && <span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{publishBlocker}</span>}
        </div>
      )}
      {draft && (
        <p className="mt-2 text-right text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
          Last saved <UtcTime iso={draft.updated_at} /> · {LEGAL_DOC_LABELS[doc]}
        </p>
      )}
    </section>
  );
}

/* ── a published version ───────────────────────────────────────────────────────────────────── */
