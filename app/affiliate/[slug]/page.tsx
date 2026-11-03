import { AffiliateIntakeForm } from "@/components/affiliate/affiliate-intake-form";

export default async function AffiliatePage({ params }: { params: Promise<{ slug: string }> }) {
  return <AffiliateIntakeForm slug={(await params).slug} />;
}
