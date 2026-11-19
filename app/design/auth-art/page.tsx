import { notFound } from "next/navigation";

import { AuthArtShowcase } from "@/components/design/auth-art-showcase";

export const metadata = { title: "Auth panel studies · Insurvas design system" };

/**
 * Three directions for the animated panel beside sign-in, against the photograph they would
 * replace (owner, 12 Nov). Mockups for choosing between — nothing here is wired into the real auth
 * screens. Development only.
 */
export default function AuthArtPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AuthArtShowcase />;
}
