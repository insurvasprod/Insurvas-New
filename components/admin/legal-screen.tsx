"use client";

// Admin Legal page (board p-adm-legal).
//
// Left: the chosen document's versions (draft on top) and the acceptance lookup. Right: the draft
// editor, or the text and record of the version picked on the left. Below: every version of every
// document. Drafts live in legal_document_drafts (20260924363000) and no customer surface reads
// them; publishing a draft is what customers see, and it is confirmed with its consequence first.

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { notify } from "@/lib/notify";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { btn, Callout, control, Field, KeyValues, Pill, st } from "@/components/app/settings/primitives";
import { LEGAL_DOC_LABELS, LEGAL_DOC_TYPES, type LegalDocType } from "@/lib/legal/constants";
import { parseLegalMarkdown } from "@/lib/legal/markdown";
import {
  LEGAL_MIN_CONTENT_LENGTH,
  legalDateTime,
  legalDay,
  nextLegalVersion,
  type AdminLegalVersion,
  type LegalDraft,
} from "@/lib/legal/adminTypes";

type Stat = {
  document_id: string;
  doc_type: string;
  version: number;
  title: string;
  label: string;
  is_draft: boolean;
  requires_reacceptance: boolean;
  eligible_users: number;
  accepted_count: number;
};

type Lookup = {
  email: string;
  found: boolean;
  records: { id: string; doc_type: string; version: number; accepted_at: string; ip: string | null; context: string }[];
};

type Props = {
  canPublish: boolean;
  initialDoc: LegalDocType;
  today: string;
  stats: Stat[];
  versions: AdminLegalVersion[];
  drafts: LegalDraft[];
  draftsSupported: boolean;
  /** Users whose status is not 'inactive', at page load. The publish dialog re-reads it live. */
  eligibleUsers: number | null;
  lookup: Lookup | null;
};

type EditorState = {
  title: string;
  content: string;
  effectiveDate: string;
  changeSummary: string;
  requiresReacceptance: boolean;
};

/** The board's card titles are sentence case; the stored labels stay as they are elsewhere. */
const CARD_TITLE: Record<LegalDocType, string> = {
  tos: "Terms of service",
  privacy: "Privacy policy",
  dpa: "Data processing agreement",
};

const SWITCH_LABEL: Record<LegalDocType, string> = { tos: "Terms", privacy: "Privacy", dpa: "DPA" };

const DRAFT_KEY = "draft";
const VISIBLE_VERSIONS = 6;

function fromDraft(draft: LegalDraft): EditorState {
  return {
    title: draft.title,
    content: draft.content,
    effectiveDate: draft.effective_date,
    changeSummary: draft.change_summary ?? "",
    requiresReacceptance: draft.requires_reacceptance,
  };
}

function sameEditor(a: EditorState, b: EditorState) {
  return (
    a.title === b.title &&
    a.content === b.content &&
    a.effectiveDate === b.effectiveDate &&
    a.changeSummary.trim() === b.changeSummary.trim() &&
    a.requiresReacceptance === b.requiresReacceptance
  );
}

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/admin/legal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body: json as Record<string, unknown> | null };
}

export function LegalScreen({
  canPublish,
  initialDoc,
  today,
  stats,
  versions,
  drafts,
  draftsSupported,
  eligibleUsers,
  lookup,
}: Props) {
  const router = useRouter();
  const [doc, setDoc] = useState<LegalDocType>(initialDoc);
  const [selection, setSelection] = useState<Partial<Record<LegalDocType, string>>>({});
  const [editors, setEditors] = useState<Partial<Record<LegalDocType, EditorState>>>({});
  // A save/discard/publish answers before router.refresh() brings new props. These overrides bridge
  // that gap and are dropped as soon as the props they were made against are replaced.
  const [overrides, setOverrides] = useState<{ against: LegalDraft[]; map: Partial<Record<LegalDocType, LegalDraft | null>> }>({
    against: drafts,
    map: {},
  });
  const [busy, setBusy] = useState<null | "save" | "discard" | "publish">(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearTarget, setClearTarget] = useState<AdminLegalVersion | null>(null);
  const [showAll, setShowAll] = useState(false);

  const overrideMap = overrides.against === drafts ? overrides.map : {};
  const draftFor = (type: LegalDocType): LegalDraft | null =>
    type in overrideMap ? (overrideMap[type] ?? null) : (drafts.find((d) => d.doc_type === type) ?? null);

  const docVersions = useMemo(() => versions.filter((v) => v.doc_type === doc), [versions, doc]);
  const current = docVersions[0] ?? null;
  const stat = stats.find((s) => s.doc_type === doc) ?? null;
  const draft = draftFor(doc);
  const nextVersion = nextLegalVersion(versions, doc);

  const freshEditor = (): EditorState => ({
    title: current?.title ?? LEGAL_DOC_LABELS[doc],
    content: current?.content ?? "",
    effectiveDate: today,
    changeSummary: "",
    requiresReacceptance: true,
  });
  const editor: EditorState = editors[doc] ?? (draft ? fromDraft(draft) : freshEditor());
  const saved = draft !== null && sameEditor(editor, fromDraft(draft));

  const canStartDraft = canPublish;
  const defaultKey = draft || (canStartDraft && !current) ? DRAFT_KEY : (current?.id ?? (canStartDraft ? DRAFT_KEY : ""));
  const requested = selection[doc];
  const selectedKey =
    requested === DRAFT_KEY && (draft || canStartDraft)
      ? DRAFT_KEY
      : requested && docVersions.some((v) => v.id === requested)
        ? requested
        : defaultKey;
  const selectedVersion = selectedKey === DRAFT_KEY ? null : (docVersions.find((v) => v.id === selectedKey) ?? null);

  function switchDoc(next: LegalDocType) {
    setDoc(next);
    setShowAll(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("doc", next);
      window.history.replaceState(null, "", url.toString());
    } catch {
      // The URL is a convenience; the switch itself has happened.
    }
  }

  function edit(patch: Partial<EditorState>) {
    setEditors((prev) => ({ ...prev, [doc]: { ...editor, ...patch } }));
  }

  function setOverride(type: LegalDocType, value: LegalDraft | null) {
    setOverrides({ against: drafts, map: { ...overrideMap, [type]: value } });
  }

  async function saveDraft() {
    setBusy("save");
    const result = await post({
      action: "save_draft",
      docType: doc,
      title: editor.title,
      content: editor.content,
      effectiveDate: editor.effectiveDate,
      changeSummary: editor.changeSummary.trim() || undefined,
      requiresReacceptance: editor.requiresReacceptance,
      expectedUpdatedAt: draft?.updated_at ?? null,
    });
    setBusy(null);
    if (!result.ok) {
      notify.block(String(result.body?.error ?? "Could not save the draft"));
      return;
    }
    const savedDraft = result.body?.draft as LegalDraft;
    setOverride(doc, savedDraft);
    setEditors((prev) => ({ ...prev, [doc]: fromDraft(savedDraft) }));
    notify.done("Draft saved. Customers cannot see it until it is published.");
    router.refresh();
  }

  async function discardDraft() {
    if (!draft) {
      setEditors((prev) => ({ ...prev, [doc]: undefined }));
      return;
    }
    if (!window.confirm(`Discard the draft of version ${nextVersion}? Its text is deleted; nothing published changes.`)) return;
    setBusy("discard");
    const result = await post({ action: "discard_draft", docType: doc, expectedUpdatedAt: draft.updated_at });
    setBusy(null);
    if (!result.ok) {
      notify.block(String(result.body?.error ?? "Could not discard the draft"));
      return;
    }
    setOverride(doc, null);
    setEditors((prev) => ({ ...prev, [doc]: undefined }));
    setSelection((prev) => ({ ...prev, [doc]: undefined }));
    notify.done("Draft discarded.");
    router.refresh();
  }

  /** Returns an error to show in the dialog, or null when it published. */
  async function publish(): Promise<string | null> {
    setBusy("publish");
    const result = draftsSupported
      ? await post({ action: "publish_draft", docType: doc, expectedVersion: nextVersion, expectedUpdatedAt: draft?.updated_at })
      : await post({
          action: "publish",
          docType: doc,
          title: editor.title,
          content: editor.content,
          effectiveDate: editor.effectiveDate,
          changeSummary: editor.changeSummary.trim() || undefined,
          requiresReacceptance: editor.requiresReacceptance,
        });
    setBusy(null);
    if (!result.ok) return String(result.body?.error ?? "Could not publish");

    const version = Number(result.body?.version);
    notify.done(
      editor.requiresReacceptance
        ? `Published version ${version}. Every user will be asked to accept it on their next request.`
        : `Published version ${version}. Nobody is interrupted.`,
    );
    setOverride(doc, null);
    setEditors((prev) => ({ ...prev, [doc]: undefined }));
    setSelection((prev) => ({ ...prev, [doc]: undefined }));
    setConfirmOpen(false);
    router.refresh();
    return null;
  }

  const contentLongEnough = editor.content.trim().length >= LEGAL_MIN_CONTENT_LENGTH;
  const titleOk = editor.title.trim().length >= 3;
  const publishBlocker = !contentLongEnough
    ? `The text must be at least ${LEGAL_MIN_CONTENT_LENGTH} characters before it can be published.`
    : !titleOk
      ? "Give the document a title of at least 3 characters."
      : draftsSupported && !draft
        ? "Save the draft first. Publishing sends the saved text, so what customers get is exactly what was saved."
        : draftsSupported && !saved
          ? "Save your changes first. Publishing sends the saved draft, not unsaved edits."
          : null;

  const shownVersions = showAll ? docVersions : docVersions.slice(0, VISIBLE_VERSIONS);

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader title="Legal" actions={<DocSwitch value={doc} onChange={switchDoc} />} />

      <div className="flex min-w-0 flex-col gap-6 lg:flex-row">
        {/* ── left column ───────────────────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-5 lg:w-[340px] lg:shrink-0">
          <section className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3">
              <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{CARD_TITLE[doc]}</span>
              <span className="flex items-center gap-2.5">
                {stat && (
                  <span
                    className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums"
                    title={`${stat.accepted_count.toLocaleString("en-US")} of ${stat.eligible_users.toLocaleString("en-US")} active users accepted version ${stat.version}`}
                  >
                    {stat.eligible_users === 0 ? "No active users" : `${Math.round((stat.accepted_count / stat.eligible_users) * 100)}% accepted`}
                  </span>
                )}
              </span>
            </div>

            <div className="divide-y divide-[var(--border)]">
              {(draft || canStartDraft) && (
                <VersionRow
                  selected={selectedKey === DRAFT_KEY}
                  onSelect={() => setSelection((prev) => ({ ...prev, [doc]: DRAFT_KEY }))}
                  title={`Version ${nextVersion}`}
                  meta={
                    draft
                      ? `Draft · edited ${legalDay(draft.updated_at)}`
                      : !draftsSupported
                        ? "New version · drafts need a database update"
                        : current
                          ? `No draft yet · starts from version ${current.version}`
                          : "No draft yet"
                  }
                  pills={
                    <Pill tone="warning" dot>
                      Draft
                    </Pill>
                  }
                />
              )}

              {shownVersions.map((version) => {
                const isCurrent = version.id === current?.id;
                const count = version.accepted_count ?? (isCurrent && stat ? stat.accepted_count : null);
                return (
                  <VersionRow
                    key={version.id}
                    selected={selectedKey === version.id}
                    onSelect={() => setSelection((prev) => ({ ...prev, [doc]: version.id }))}
                    title={`Version ${version.version}`}
                    meta={`Effective ${legalDay(version.effective_date)} · ${count === null ? "acceptances not counted yet" : plural(count, "acceptance", "acceptances")}`}
                    pills={
                      <>
                        {isCurrent ? (
                          <Pill tone="success" dot>
                            Published
                          </Pill>
                        ) : (
                          <Pill tone="neutral" dot>
                            Superseded
                          </Pill>
                        )}
                        {version.is_draft && <Pill tone="warning">Unreviewed text</Pill>}
                      </>
                    }
                  />
                );
              })}

              {docVersions.length > VISIBLE_VERSIONS && (
                <div className="px-4 py-2.5">
                  <button type="button" onClick={() => setShowAll((v) => !v)} className={btn("row", "px-0 text-[var(--accent-ink)]")}>
                    {showAll ? "Show fewer versions" : `Show all ${docVersions.length} versions`}
                  </button>
                </div>
              )}

              {docVersions.length === 0 && !draft && (
                <div className="px-4 py-[11px]">
                  <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Nothing published yet</span>
                  <span className="mt-0.5 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                    {doc === "dpa"
                      ? "Signup does not require a Data Processing Agreement. Once a version is published, everyone is asked to accept it."
                      : "Signup is blocked until a Terms of Service and a Privacy Policy both exist. Nobody can be asked to agree to a document that does not exist."}
                  </span>
                </div>
              )}
            </div>
          </section>

          <LookupCard doc={doc} lookup={lookup} />
        </div>

        {/* ── right column ──────────────────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {selectedKey === DRAFT_KEY ? (
            <>
              <DraftTextCard
                key={`text-${doc}`}
                version={nextVersion}
                editor={editor}
                canEdit={canPublish}
                hasSavedDraft={draft !== null}
                onEdit={edit}
              />
              <DraftSummaryCard
                doc={doc}
                version={nextVersion}
                editor={editor}
                canEdit={canPublish}
                draft={draft}
                saved={saved}
                draftsSupported={draftsSupported}
                eligibleUsers={eligibleUsers}
                busy={busy}
                publishBlocker={publishBlocker}
                titleOk={titleOk}
                onEdit={edit}
                onSave={saveDraft}
                onDiscard={discardDraft}
                onPublish={() => setConfirmOpen(true)}
              />
            </>
          ) : selectedVersion ? (
            <VersionView
              doc={doc}
              version={selectedVersion}
              isCurrent={selectedVersion.id === current?.id}
              stat={stat}
              canClear={canPublish}
              onClear={() => setClearTarget(selectedVersion)}
            />
          ) : (
            <section className="rounded-[12px] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-6 text-center">
              <div className="text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">Nothing to show yet</div>
              <p className="mx-auto mt-1.5 max-w-[46ch] text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
                No version of the {LEGAL_DOC_LABELS[doc]} has been published. Only a super admin can write and publish one.
              </p>
            </section>
          )}
        </div>
      </div>

      <HistoryTable versions={versions} stats={stats} />

      <PublishDialog
        open={confirmOpen}
        onOpenChange={(next) => busy !== "publish" && setConfirmOpen(next)}
        doc={doc}
        version={nextVersion}
        editor={editor}
        pageLoadEligible={eligibleUsers}
        busy={busy === "publish"}
        onConfirm={publish}
      />

      <ClearDialog
        target={clearTarget}
        doc={doc}
        onClose={() => setClearTarget(null)}
        onCleared={() => {
          setClearTarget(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/* ── document switch ───────────────────────────────────────────────────────────────────────── */

function DocSwitch({ value, onChange }: { value: LegalDocType; onChange: (next: LegalDocType) => void }) {
  return (
    <div role="group" aria-label="Document" className="inline-flex h-9 items-center gap-0.5 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] p-[3px]">
      {LEGAL_DOC_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => onChange(type)}
          aria-pressed={value === type}
          title={LEGAL_DOC_LABELS[type]}
          className={cn(
            "h-full rounded-[6px] px-3.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] whitespace-nowrap",
            value === type ? "bg-[var(--brand-50)] text-[var(--accent-ink)]" : "text-[var(--body)] hover:bg-[var(--surface-alt)]",
          )}
        >
          {SWITCH_LABEL[type]}
        </button>
      ))}
    </div>
  );
}

/* ── version row ───────────────────────────────────────────────────────────────────────────── */

function VersionRow({
  selected,
  onSelect,
  title,
  meta,
  pills,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  meta: string;
  pills: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-[11px] text-left",
        selected ? "bg-[var(--brand-50)] shadow-[inset_2px_0_0_var(--primary)]" : "hover:bg-[var(--canvas)]",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{title}</span>
        <span className="block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{meta}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">{pills}</span>
    </button>
  );
}

/* ── acceptance lookup ─────────────────────────────────────────────────────────────────────── */

function LookupCard({ doc, lookup }: { doc: LegalDocType; lookup: Lookup | null }) {
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

function DraftTextCard({
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

function DraftSummaryCard({
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

function VersionView({
  doc,
  version,
  isCurrent,
  stat,
  canClear,
  onClear,
}: {
  doc: LegalDocType;
  version: AdminLegalVersion;
  isCurrent: boolean;
  stat: Stat | null;
  canClear: boolean;
  onClear: () => void;
}) {
  const currentStat = isCurrent && stat && stat.document_id === version.id ? stat : null;
  const accepted = version.accepted_count ?? currentStat?.accepted_count ?? null;
  const rate = currentStat && currentStat.eligible_users > 0 ? currentStat.accepted_count / currentStat.eligible_users : null;
  const canStop = canClear && currentStat !== null && currentStat.requires_reacceptance && (rate === null || rate < 1);

  return (
    <>
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3">
          <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">
            Version {version.version} &mdash; {isCurrent ? "published" : "superseded"}
          </span>
          <span className="flex flex-wrap items-center gap-2.5">
            {version.is_draft && <Pill tone="warning">Unreviewed text</Pill>}
            {isCurrent ? (
              <Pill tone="success" dot>
                Visible to customers
              </Pill>
            ) : (
              <Pill tone="neutral" dot>
                Kept as the record
              </Pill>
            )}
            <Link
              href={`/legal/${doc}?v=${version.version}`}
              target="_blank"
              className="text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--accent-ink)] underline"
            >
              Read it
            </Link>
          </span>
        </div>
        <div className="px-5 py-4">
          <LegalText content={version.content} />
        </div>
      </section>

      <section className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">Change summary</h2>
        <p className="mt-4 mb-5 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
          {version.change_summary ?? "No summary was written for this version."}
        </p>
        <KeyValues
          items={[
            { label: "Effective", value: legalDay(version.effective_date) },
            { label: "Published", value: <UtcTime iso={version.published_at} /> },
            { label: "Users must accept it", value: version.requires_reacceptance ? "Yes" : "No" },
            {
              label: "Acceptances",
              value:
                accepted === null
                  ? "Not counted yet"
                  : currentStat
                    ? `${accepted.toLocaleString("en-US")} of ${currentStat.eligible_users.toLocaleString("en-US")} active users${rate === null ? "" : ` · ${Math.round(rate * 100)}%`}`
                    : accepted.toLocaleString("en-US"),
            },
          ]}
        />

        {version.is_draft && (
          <Callout tone="warning" title="Unreviewed text. Replace it by publishing a reviewed version." className="mt-5" />
        )}

        {canStop && (
          <div className="mt-5 flex justify-end border-t border-[var(--border)] pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClear}
              title="Stops this version blocking anyone. The text stays exactly as it is."
            >
              Stop requiring acceptance
            </Button>
          </div>
        )}
      </section>
    </>
  );
}

/* ── history ───────────────────────────────────────────────────────────────────────────────── */

function HistoryTable({ versions, stats }: { versions: AdminLegalVersion[]; stats: Stat[] }) {
  return (
    <TableCard title="Every published version">
      <div className="min-w-0 overflow-x-auto">
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Document</th>
              <th scope="col" className={st.th}>Version</th>
              <th scope="col" className={st.th}>Effective</th>
              <th scope="col" className={st.th}>Material</th>
              <th scope="col" className={cn(st.th, "text-right")}>Acceptances</th>
              <th scope="col" className={st.th}>What changed</th>
            </tr>
          </thead>
          <tbody>
            {versions.length === 0 ? (
              <tr>
                <td colSpan={6} className={cn(st.td, "p-0")}>
                  <EmptyState title="Nothing published yet" hint="Published versions of every document appear here." />
                </td>
              </tr>
            ) : (
              versions.map((doc) => {
                const stat = stats.find((s) => s.document_id === doc.id);
                const count = doc.accepted_count ?? stat?.accepted_count ?? null;
                return (
                  <tr key={doc.id}>
                    <td className={cn(st.td, st.strong)}>
                      {LEGAL_DOC_LABELS[doc.doc_type as LegalDocType]}
                      {doc.is_draft && <span className="ml-2 text-[12px] font-semibold text-[var(--warning-ink)]">Unreviewed text</span>}
                    </td>
                    <td className={st.td}>
                      <Link href={`/legal/${doc.doc_type}?v=${doc.version}`} target="_blank" className="text-[var(--accent-ink)] underline">
                        v{doc.version}
                      </Link>
                    </td>
                    <td className={cn(st.td, "whitespace-nowrap")}>{legalDay(doc.effective_date)}</td>
                    <td className={st.td}>{doc.requires_reacceptance ? "Yes" : "No"}</td>
                    <td className={cn(st.td, st.num)}>{count === null ? "—" : count.toLocaleString("en-US")}</td>
                    <td className={cn(st.td, "max-w-md text-[var(--muted)]")}>{doc.change_summary ?? "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </TableCard>
  );
}

/* ── publish confirmation ──────────────────────────────────────────────────────────────────── */

function PublishDialog({
  open,
  onOpenChange,
  doc,
  version,
  editor,
  pageLoadEligible,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  doc: LegalDocType;
  version: number;
  editor: EditorState;
  pageLoadEligible: number | null;
  busy: boolean;
  onConfirm: () => Promise<string | null>;
}) {
  const [live, setLive] = useState<{ state: "loading" } | { state: "ok"; count: number } | { state: "failed" }>({ state: "loading" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/admin/legal", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (response.ok && typeof body?.eligibleUsers === "number") setLive({ state: "ok", count: body.eligibleUsers });
        else setLive({ state: "failed" });
      })
      .catch(() => {
        if (!cancelled) setLive({ state: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function change(next: boolean) {
    if (!next) {
      setError(null);
      setLive({ state: "loading" });
    }
    onOpenChange(next);
  }

  async function confirm() {
    setError(null);
    const failure = await onConfirm();
    if (failure) setError(failure);
    else setLive({ state: "loading" });
  }

  const who =
    live.state === "ok"
      ? plural(live.count, "user is", "users are")
      : live.state === "loading"
        ? "Counting the users this affects…"
        : pageLoadEligible === null
          ? "The number of active users could not be counted just now."
          : `${plural(pageLoadEligible, "user was", "users were")} active when this page loaded (a live count failed).`;

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            Publish version {version} of the {LEGAL_DOC_LABELS[doc]}?
          </DialogTitle>
          <DialogDescription className="text-[14px] leading-[1.5] tracking-[-0.02em]">
            The version number is allocated when you publish. Older versions stay readable forever &mdash; that is what makes an acceptance
            record mean anything.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {editor.requiresReacceptance ? (
            <Callout tone="error" title="Every user will be required to accept this before using the product">
              {live.state === "ok" ? `${who} active right now.` : who} Each of them is stopped at the acceptance screen on their next request
              until they accept version {version}.
            </Callout>
          ) : (
            <Callout tone="info" title="Nobody is interrupted">
              This is not marked as a material change. Existing users keep the version they accepted; new signups accept version {version}.
            </Callout>
          )}

          <KeyValues
            items={[
              { label: "Title", value: editor.title },
              { label: "Effective", value: legalDay(editor.effectiveDate) },
              { label: "Material change", value: editor.requiresReacceptance ? "Yes — everyone must accept" : "No" },
              { label: "Length", value: `${editor.content.trim().length.toLocaleString("en-US")} characters` },
            ]}
          />
          <div>
            <div className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">What changed</div>
            <p className="m-0 mt-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
              {editor.changeSummary.trim() || "No summary. Users are not told what changed."}
            </p>
          </div>

          {error && (
            <p role="alert" className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--error-ink)]">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => change(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={confirm} disabled={busy}>
            {busy ? "Publishing…" : `Publish version ${version}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── the escape hatch ──────────────────────────────────────────────────────────────────────── */

function ClearDialog({
  target,
  doc,
  onClose,
  onCleared,
}: {
  target: AdminLegalVersion | null;
  doc: LegalDocType;
  onClose: () => void;
  onCleared: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (saving) return;
    setReason("");
    setError(null);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    if (reason.trim().length < 5) {
      setError("Give a reason of at least 5 characters.");
      return;
    }
    setSaving(true);
    const result = await post({ action: "clear_reacceptance", documentId: target.id, reason: reason.trim() });
    setSaving(false);
    if (!result.ok) {
      setError(String(result.body?.error ?? "Could not clear it"));
      return;
    }
    notify.done("Cleared — nobody is blocked by this version any more.");
    setReason("");
    setError(null);
    onCleared();
  }

  return (
    <Dialog open={target !== null} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-[560px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              Stop requiring acceptance of version {target?.version} of the {LEGAL_DOC_LABELS[doc]}?
            </DialogTitle>
            <DialogDescription className="text-[14px] leading-[1.5] tracking-[-0.02em]">
              Use this if it was published by mistake. Nobody is blocked by it any more; the text is not changed or deleted, and people who
              already accepted keep their record. The reason is kept in the audit log.
            </DialogDescription>
          </DialogHeader>
          <Field label="Reason" htmlFor="legal-clear-reason" required error={error}>
            <textarea
              id="legal-clear-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              className={cn(control, "h-auto py-2")}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Clearing…" : "Stop requiring acceptance"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── small pieces ──────────────────────────────────────────────────────────────────────────── */

/** "22 Sep 2026 08:40:55 UTC", with the reader's local time on hover once mounted. */
function UtcTime({ iso }: { iso: string }) {
  const [local, setLocal] = useState<string | undefined>(undefined);
  return (
    <time
      dateTime={iso}
      title={local}
      onMouseEnter={() => {
        if (local) return;
        const date = new Date(iso);
        if (!Number.isNaN(date.getTime())) setLocal(`${date.toLocaleString()} (your time)`);
      }}
    >
      {legalDateTime(iso)}
    </time>
  );
}

/** Bold only, like the public page; everything else stays literal text. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={index} className="font-semibold text-[var(--ink)]">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

/** The stored markdown subset, drawn at the admin plane's 14px rather than the public page's 16px. */
function LegalText({ content }: { content: string }) {
  const blocks = parseLegalMarkdown(content);
  return (
    <div className="max-w-[72ch] text-[14px] leading-[1.6] tracking-[-0.02em] text-[var(--body)]">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return block.level === 1 ? (
            <h3 key={index} className="mt-5 mb-2 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)] first:mt-0">
              <Inline text={block.text} />
            </h3>
          ) : (
            <h4 key={index} className="mt-4 mb-1.5 text-[16px] leading-[1.4] font-semibold tracking-[-0.02em] text-[var(--ink)] first:mt-0">
              <Inline text={block.text} />
            </h4>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={index} className="my-2.5 list-disc space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="my-2.5 first:mt-0">
            <Inline text={block.text} />
          </p>
        );
      })}
    </div>
  );
}
