"use client";

import { guideRows, guideSubtitle, guideTitle, sampleCurl, type GuideInput } from "@/lib/leadPost/guide";
import { maskedAddress } from "./shared";

/**
 * The vendor's instructions as the owner previews them (board A5): the same content the copied text,
 * the PDF and the public page carry (lib/leadPost/guide.ts), with the workspace part of the address
 * masked — the copies carry the real one.
 */
export function GuideDoc({ input }: { input: GuideInput }) {
  const shown = `https://${maskedAddress(input.postingUrl)}`;
  const rows = guideRows(input);
  return (
    <article aria-label="Instructions preview" className="flex min-w-0 flex-col gap-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4">
      <header className="flex items-center gap-3">
        <span aria-hidden="true" className="size-7 shrink-0 rounded-[8px] bg-[var(--primary)]" />
        <div className="min-w-0">
          <h4 className="m-0 truncate text-base font-semibold text-[var(--ink)]">{guideTitle(input)}</h4>
          <p className="m-0 truncate text-xs text-[var(--muted)]">{guideSubtitle(input)}</p>
        </div>
      </header>
      <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-xs font-semibold text-[var(--muted)]">Address</dt>
        <dd className="m-0 break-all font-mono text-xs text-[var(--ink)]">POST {shown}</dd>
        <dt className="text-xs font-semibold text-[var(--muted)]">Headers</dt>
        <dd className="m-0 font-mono text-xs leading-[1.6] text-[var(--ink)]">Authorization: Bearer &lt;your key&gt;<br />Content-Type: application/json<br />Idempotency-Key: your lead id (optional)</dd>
        <dt className="text-xs font-semibold text-[var(--muted)]">Replies</dt>
        <dd className="m-0 text-sm text-[var(--body)]">accepted (true / false), reason_code, message, lead_id</dd>
      </dl>
      <div role="table" aria-label="Fields" className="min-w-0 overflow-hidden rounded-[8px] border border-[var(--border)]">
        <div role="row" className="grid grid-cols-[minmax(0,1.1fr)_64px_minmax(0,1.6fr)] gap-3 bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
          <span role="columnheader">Field</span><span role="columnheader">Needed</span><span role="columnheader">Rule</span>
        </div>
        {rows.map((row) => (
          <div role="row" key={row.field + row.rule} className="grid grid-cols-[minmax(0,1.1fr)_64px_minmax(0,1.6fr)] gap-3 border-t border-[var(--border)] px-3 py-2 text-sm">
            <span role="cell" className="truncate font-mono text-xs text-[var(--ink)]" title={row.field}>{row.field}</span>
            <span role="cell" className="text-[var(--body)]">{row.needed}</span>
            <span role="cell" className="truncate text-[var(--body)]" title={row.rule}>{row.rule}</span>
          </div>
        ))}
      </div>
      <pre className="m-0 overflow-x-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface-sunken)] p-3 font-mono text-xs leading-[1.6] text-[var(--ink)]">{sampleCurl(shown, input.fieldMap)}</pre>
    </article>
  );
}
