import { notFound } from "next/navigation";

import { AuthShowcase } from "@/components/design/auth-showcase";

export const metadata = { title: "Auth layout · Insurvas design system" };

/** Every combination of the one auth layout (UI-CONSISTENCY.md §13). Development only. */
export default function AuthLayoutPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AuthShowcase />;
}
