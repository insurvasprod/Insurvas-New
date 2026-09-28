import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";

/**
 * The admin wrapper kept so its 30-odd call sites keep working; PageHeader in components/ui is the
 * shared one.
 *
 * One title per page (UI standard, 2026-09-28): `path` used to add a section eyebrow above it and is
 * now accepted and ignored, so older call sites keep compiling. `subtitle` is optional — one short
 * sentence at most.
 *
 * `backHref` is the detail-page shape: the one way back sits above the title, in one place, rather
 * than as an ad-hoc link each detail page invents for itself.
 */
export function AdminPageHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  actions,
}: {
  title: string;
  subtitle?: string;
  /** Accepted and ignored (no eyebrows). */
  path?: string;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
}) {
  const header = (
    <PageHeader
      title={title}
      description={subtitle || undefined}
      actions={actions}
    />
  );

  if (!backHref) return header;

  return (
    <div>
      <Link
        href={backHref}
        className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground no-underline transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {backLabel ?? "Back"}
      </Link>
      {header}
    </div>
  );
}
