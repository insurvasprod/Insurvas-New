import { PageHeader } from "@/components/ui/page-header";

/**
 * The admin wrapper kept so its 20-odd call sites keep working; PageHeader in components/ui is the
 * shared one, and takes an eyebrow and actions this signature never had.
 */
export function AdminPageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <PageHeader title={title} description={subtitle} />;
}
