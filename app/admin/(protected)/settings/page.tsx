import { redirect } from "next/navigation";

/** Advanced is the canonical home for the SA-4.1 raw settings store. */
export default function SettingsPage() {
  redirect("/admin/advanced");
}
