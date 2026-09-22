import { notFound } from "next/navigation";

import { PrimitivesShowcase } from "@/components/design/primitives-showcase";

export const metadata = { title: "Insurvas design system" };

/**
 * The primitives page: every variant and state of every shared control, in one place.
 *
 * It exists so a page review is a comparison rather than an argument — and so a change to a
 * primitive is seen everywhere it lands before it reaches 93 pages. Development only.
 */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PrimitivesShowcase />;
}
