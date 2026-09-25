import type { ReactNode } from "react";
import { Plus } from "lucide-react";

import { Callout } from "@/components/app/settings/primitives";

/**
 * What an administrator sees for a platform section that has no controls on this screen.
 *
 * Drawn to the p-adm-email board: a 620px card centred in the space under the page header, a 52px
 * glyph, a 24px heading, two 16px paragraphs, and an info callout that says why there is no form.
 *
 * This used to describe our process rather than the product ("Section reserved for {owner}", "will
 * be implemented by its ticket") and later promised a configuration screen nobody is building. The
 * words now come from the page, which knows what is true in its environment; the one sentence kept
 * here is the access rule, which lib/configuration/sections.ts enforces for every section.
 *
 * The caller must render this inside a flex column that can grow (`flex-1`) — the card centres in
 * whatever height that column has left.
 */
export function ConfigurationPlaceholder({
  title,
  lede,
  detail,
  note,
}: {
  title: string;
  /** The first paragraph: what is true right now. */
  lede: ReactNode;
  /** The second paragraph, before the access sentence: where the settings actually live. */
  detail: ReactNode;
  note?: { title: string; body: ReactNode };
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="w-full max-w-[620px]">
        <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-8">
          <div className="text-center">
            <span
              aria-hidden="true"
              className="inline-flex size-[52px] items-center justify-center rounded-full bg-[var(--surface-alt)] text-[var(--muted)]"
            >
              <Plus className="size-3.5" strokeWidth={2.4} />
            </span>
            <h2 className="mt-4 text-[24px] leading-[1.21] font-semibold tracking-[-0.02em] text-[var(--ink)]">
              {title}
            </h2>
            <p className="mt-2.5 text-[16px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{lede}</p>
            <p className="mt-2.5 text-[16px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
              {detail}{" "}
              <strong className="font-bold">
                Only super admins and platform config staff can open this page.
              </strong>
            </p>
          </div>
          {note && (
            <div className="mt-7">
              <Callout tone="info" title={note.title}>
                {note.body}
              </Callout>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
