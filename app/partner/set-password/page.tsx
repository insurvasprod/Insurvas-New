import { Suspense } from "react";
import { PartnerSetPasswordForm } from "@/components/partner/partner-set-password-form";

export default function PartnerSetPasswordPage() {
  return <Suspense fallback={null}><PartnerSetPasswordForm /></Suspense>;
}
