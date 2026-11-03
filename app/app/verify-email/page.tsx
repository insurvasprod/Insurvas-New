import { FunnelFrame, FunnelHeading } from "@/components/app/funnel-frame";
import { verifyEmailHeading } from "@/components/app/funnel-headings";
import { FunnelReview } from "@/components/app/funnel-review";
import { VerifyEmailPanel } from "@/components/app/verify-email-panel";
import { checkoutPaymentMode } from "@/lib/checkout/paymentMode";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { EMAIL_VERIFICATION_TTL_HOURS } from "@/lib/signup/verification";

/** Back from step 2 is step 1, which shows the account already made (owner, 2026-10-27). */
const BACK = "/signup";

export default async function VerifyEmailPage() {
  // Reached through Back from step 3: the email is confirmed, so the step shows that and Continue
  // returns to where the signup stands, instead of the waiting panel moving on by itself.
  const context = await resolveSignupContext();
  const destination = context && context.userStatus === "active" ? signupDestination(context) : null;
  if (context && destination) {
    return (
      <FunnelFrame step={2} heading={<FunnelHeading title="Your Email Is Confirmed">Nothing more to do here.</FunnelHeading>}>
        <FunnelReview
          rows={[{ label: "Email", value: context.email, done: true }]}
          continueHref={destination}
          back={BACK}
        />
      </FunnelFrame>
    );
  }
  return (
    <FunnelFrame step={2} heading={verifyEmailHeading(EMAIL_VERIFICATION_TTL_HOURS)}>
      <VerifyEmailPanel ttlHours={EMAIL_VERIFICATION_TTL_HOURS} noPayment={checkoutPaymentMode() === "none"} back={BACK} withHeading={false} />
    </FunnelFrame>
  );
}
