/**
 * Shared by the audit log and login events so both record the caller the same way.
 *
 * x-forwarded-for is a client-controllable header, so treat these values as "best effort
 * attribution", not proof of origin. Behind a trusted proxy (Vercel et al.) the first entry is
 * the real client.
 */
export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

export function getUserAgent(request: Request): string | null {
  return request.headers.get("user-agent");
}
