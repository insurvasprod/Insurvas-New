import type { ReactNode } from "react";

import { AuthLayout } from "@/components/portal/auth-layout";
import { StoryPanel } from "@/components/app/tenant-auth-workspace";

/**
 * The agent app's account doors beside sign-in (2026-10-13): setting a password from an invitation,
 * confirming a changed address, a suspended workspace, a failed verification. They are the one auth
 * layout with the sign-in story; the screen draws its own AuthHeading (via AuthCard).
 */
export function AppAuthFrame({ children, width = "default" }: { children: ReactNode; width?: "default" | "wide" }) {
  return (
    <AuthLayout plane="agent" width={width} story={<StoryPanel mode="sign-in" />}>
      {children}
    </AuthLayout>
  );
}
