import { redirect } from "next/navigation";

/** The Agent Floor is Team since Inbound A (2026-10-27): old links and bookmarks land there. */
export default function AgentFloorPage() {
  redirect("/app/inbound/team");
}
