import { redirect } from "next/navigation";

/** The agent app's entry point. Dashboard is always entitled, so it's a safe landing place. */
export default function AgentHomePage() {
  redirect("/app/dashboard");
}
