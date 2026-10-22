import { AppAuthFrame } from "@/components/app/app-auth-frame";
import { VerifyEmailPanel } from "@/components/app/verify-email-panel";
import { checkoutPaymentMode } from "@/lib/checkout/paymentMode";
import { EMAIL_VERIFICATION_TTL_HOURS } from "@/lib/signup/verification";

export default function VerifyEmailPage() {
  return (
    <AppAuthFrame>
      <VerifyEmailPanel ttlHours={EMAIL_VERIFICATION_TTL_HOURS} noPayment={checkoutPaymentMode() === "none"} />
    </AppAuthFrame>
  );
}
