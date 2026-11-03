import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

import { AuthCard } from "@/components/app/auth-card";
import { AuthHeading, AuthLayout } from "@/components/portal/auth-layout";

/**
 * The agent app's account doors beside sign-in (2026-10-13): setting a password from an invitation,
 * confirming a changed address, a suspended workspace, a failed verification. Owner, 2026-11-03: they
 * are the sign-in's twin, one centred card on the brand field with no showcase panel, the title
 * centred above the card. A screen that opens with an <AuthCard title> or an <AuthHeading> has it
 * lifted out of the card here; anything else keeps drawing its own heading inside.
 */
export function AppAuthFrame({ children, width = "default" }: { children: ReactNode; width?: "default" | "wide" }) {
  const nodes = Children.toArray(children);
  const first = nodes[0];
  let heading: ReactNode = undefined;
  let rest: ReactNode = children;

  if (isValidElement(first) && first.type === AuthCard) {
    const card = first as ReactElement<{ title?: string; description?: ReactNode }>;
    if (card.props.title) {
      heading = <AuthHeading title={card.props.title}>{card.props.description}</AuthHeading>;
      rest = [cloneElement(card, { title: undefined, description: undefined }), ...nodes.slice(1)];
    }
  } else if (isValidElement(first) && first.type === AuthHeading) {
    heading = first;
    rest = nodes.slice(1);
  }

  return (
    <AuthLayout
      plane="agent"
      width={width}
      heading={heading ? <div data-auth-line="" className="mb-3 flex justify-center text-center">{heading}</div> : undefined}
    >
      {rest}
    </AuthLayout>
  );
}
