import { redirect } from "next/navigation";

import { CallingRulesEditor } from "@/components/admin/calling-rules-editor";
import { PlatformPage } from "@/components/admin/platform/platform-page";
import { TitleActionButton } from "@/components/admin/platform/title-action";
import { PLATFORM_ACTION } from "@/lib/adminPlatform/titleActions";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { CAN_MANAGE_CALLING_RULES } from "@/lib/callingWindow/permissions";
import { getCallingRulesBoard } from "@/lib/callingWindow/rulesAdmin";

export default async function CallingRulesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!CAN_MANAGE_CALLING_RULES.includes(admin.role)) redirect("/admin");

  const board = await getCallingRulesBoard();
  // One date for the server render and the browser: which rule is "in force" depends on it.
  const today = new Date().toISOString().slice(0, 10);
  return (
    <PlatformPage
      step="calling"
      info="State calling hours, Sunday rules and holidays the dialer applies on top of the federal 8:00 am – 9:00 pm."
      actions={
        <TitleActionButton
          action={PLATFORM_ACTION.markReviewed}
          variant="outline"
          title="Confirm the rules as they stand. The dialer refuses every call once the last review is older than its limit."
        >
          Mark reviewed
        </TitleActionButton>
      }
    >
      <CallingRulesEditor board={board} today={today} />
    </PlatformPage>
  );
}
