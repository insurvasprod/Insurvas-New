import { FunnelHeading } from "@/components/app/funnel-frame";

/**
 * The headings of the sign-up steps, kept apart from the steps' client components so a page can draw
 * them above the card (FunnelFrame `heading`) and the design showcase can still draw them inside.
 */

export function verifyEmailHeading(ttlHours: number) {
  return (
    <FunnelHeading title="Confirm Your Email">
      We sent a link to the address below. It works once, for {ttlHours} hours, and this page moves on by itself when you open it.
    </FunnelHeading>
  );
}

export function googleFinishHeading() {
  return <FunnelHeading title="Finish Your Account">Google confirmed your email.</FunnelHeading>;
}

export function businessProfileHeading({ gate, solo }: { gate: boolean; solo: boolean }) {
  return (
    <FunnelHeading title={gate ? "Finish Setting Up Your Workspace" : solo ? "Tell Us About You" : "Tell Us About Your Agency"}>
      {gate ? "One last step before you start. It takes a minute." : "We use this to set up your workspace."}
    </FunnelHeading>
  );
}
