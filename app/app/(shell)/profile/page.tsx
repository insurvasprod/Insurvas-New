import { redirect } from "next/navigation";

/**
 * Your profile moved into Settings › My profile (redesign 2026-10-27, owner pick A), with its
 * sign-in and security, your own settings history and Notifications as tabs
 * (components/app/settings/my-profile.tsx). Old links and bookmarks land there; a sign-in that
 * needs two-factor keeps its ?two_factor=required and opens Sign-in & security.
 */
export default async function OwnProfilePage({ searchParams }: { searchParams: Promise<{ two_factor?: string }> }) {
  const params = await searchParams;
  redirect(params.two_factor === "required" ? "/app/settings?two_factor=required#my-profile/security" : "/app/settings#my-profile");
}
