"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { Callout, KeyValues, Pill, st } from "@/components/app/settings/primitives";
import { LEGAL_DOC_LABELS, LEGAL_DOC_TYPES, type LegalDocType } from "@/lib/legal/constants";
import { parseLegalMarkdown } from "@/lib/legal/markdown";
import { legalDateTime, legalDay, type AdminLegalVersion } from "@/lib/legal/adminTypes";
import { SWITCH_LABEL, type Stat } from "./model";

export function DocSwitch({ value, onChange }: { value: LegalDocType; onChange: (next: LegalDocType) => void }) {
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

export function VersionRow({
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

export function VersionView({
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

export function HistoryTable({ versions, stats }: { versions: AdminLegalVersion[]; stats: Stat[] }) {
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

/** "22 Sep 2026 08:40:55 UTC", with the reader's local time on hover once mounted. */
export function UtcTime({ iso }: { iso: string }) {
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
export function Inline({ text }: { text: string }) {
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
export function LegalText({ content }: { content: string }) {
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
