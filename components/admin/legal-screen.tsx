"use client";

// Admin Legal page (board p-adm-legal).
//
// Left: the chosen document's versions (draft on top) and the acceptance lookup. Right: the draft
// editor, or the text and record of the version picked on the left. Below: every version of every
// document. Drafts live in legal_document_drafts (20260924363000) and no customer surface reads
// them; publishing a draft is what customers see, and it is confirmed with its consequence first.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";
import { PageHeader } from "@/components/ui/page-header";
import { btn, Pill } from "@/components/app/settings/primitives";
import { LEGAL_DOC_LABELS, type LegalDocType } from "@/lib/legal/constants";
import { LEGAL_MIN_CONTENT_LENGTH, legalDay, nextLegalVersion, type AdminLegalVersion, type LegalDraft } from "@/lib/legal/adminTypes";
import { CARD_TITLE, DRAFT_KEY, type EditorState, type Lookup, type Stat, VISIBLE_VERSIONS, fromDraft, plural, post, sameEditor } from "@/components/admin/legal/model";
import { DocSwitch, HistoryTable, VersionRow, VersionView } from "@/components/admin/legal/versions";
import { DraftSummaryCard, DraftTextCard, LookupCard } from "@/components/admin/legal/draft-cards";
import { ClearDialog, PublishDialog } from "@/components/admin/legal/dialogs";

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
