import "server-only";

/** Email links use configuration, never the caller-controlled Host header. */
export function configuredAppOrigin(plane: "agent" | "partner" = "agent"): string {
  const configured = plane === "partner"
    ? process.env.NEXT_PUBLIC_PARTNER_APP_URL || process.env.NEXT_PUBLIC_APP_URL
    : process.env.NEXT_PUBLIC_AGENT_APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) throw new Error(`A configured ${plane} application URL is required to build an email link.`);
  return configured.replace(/\/$/, "");
}
