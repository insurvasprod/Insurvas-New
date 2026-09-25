import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { adminSectionForPath } from "@/lib/adminNav/build";

/**
 * The admin wrapper kept so its 30-odd call sites keep working; PageHeader in components/ui is the
 * shared one.
 *
 * `path` is optional and is how a page gets its eyebrow — the section it belongs to, read from the
 * nav rather than typed here, so the two cannot drift. A page that passes nothing renders exactly
 * as it did before, which is what makes adopting this one page at a time safe.
 *
 * `backHref` is the detail-page shape from the artboards: the way back sits above the eyebrow, in
 * one place, rather than as an ad-hoc link each detail page invents for itself.
 */
export function AdminPageHeader({
  title,
  subtitle,
  path,
  backHref,
  backLabel,
  actions,
}: {
  title: string;
  subtitle: string;
  path?: string;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
}) {
  const header = (
    <PageHeader
      title={title}
      description={subtitle}
      eyebrow={path ? adminSectionForPath(path) ?? undefined : undefined}
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
