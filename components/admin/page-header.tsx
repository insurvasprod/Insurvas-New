import { PageHeader } from "@/components/ui/page-header";

/**
 * The admin wrapper kept so its 30-odd call sites keep working; PageHeader in components/ui is the
 * shared one.
 *
 * One title per page (UI standard, 2026-09-28): `path` used to add a section eyebrow above it and is
 * now accepted and ignored, so older call sites keep compiling. `subtitle` is optional — one short
 * sentence at most.
 *
 * `backHref` is the detail-page shape: the page it came from is the trail above the title.
 *
 * `tabs` is the page's sub-page bar, on the title's line like every other page in the service
 * (UI-CONSISTENCY §8b, owner 2026-11-09).
 */
export function AdminPageHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  actions,
  tabs,
}: {
  title: string;
  subtitle?: string;
  /** Accepted and ignored (no eyebrows). */
  path?: string;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
  /** The page's sub-pages or views (`ViewTabs`), on the title's line. */
  tabs?: React.ReactNode;
}) {
  // The way back is the trail above the title (owner 2026-10-30), as on every other page.
  return (
    <PageHeader
      title={title}
      description={subtitle || undefined}
      actions={actions}
      tabs={tabs}
      breadcrumbs={backHref ? [{ label: backLabel ?? "Back", href: backHref }, { label: title }] : undefined}
    />
  );
}
