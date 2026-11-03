import { redirect } from "next/navigation";

import { CallingRulesEditor } from "@/components/admin/calling-rules-editor";
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
  return <CallingRulesEditor board={board} today={today} />;
}
