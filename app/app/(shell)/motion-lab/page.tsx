import { notFound } from "next/navigation";

import { MotionLab } from "@/components/app/motion-lab/motion-lab";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Motion lab (premium motion foundation, 2026-11-09): the motion catalogue on the real kit parts, for the owner's
 * sign-off before it is rolled out page by page. Not in the menu; off on the production deployment unless MOTION_LAB=1.
 */
export default function MotionLabPage() {
  if (process.env.VERCEL_ENV === "production" && process.env.MOTION_LAB !== "1") notFound();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Motion lab" description="Every motion pattern in the product, on the real components." />
      <MotionLab />
    </div>
  );
}
