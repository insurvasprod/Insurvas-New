import { redirect } from "next/navigation";

/** SA-4.3 makes Advanced the canonical home for the SA-4.1 raw settings store. */
export default function SettingsPage() {
  redirect("/admin/configuration/advanced");
}
