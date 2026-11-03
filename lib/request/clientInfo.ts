/**
 * Shared by the audit log, login events and the rate limiter so all of them name the caller the
 * same way.
 *
 * Only headers the platform sets are trusted. On Vercel that is x-real-ip, which the edge writes
 * from the connection and overwrites if the client sent one. X-Forwarded-For is a list the client
 * can START: anything it sends arrives as the first entries, and each proxy appends the address it
 * saw. So the first hop is whatever the caller chose (the old code took it, letting anyone pick a
 * fresh per-IP rate-limit bucket on every request), and only the last hop was written by a proxy
 * we sit behind. That last hop is the fallback when x-real-ip is missing (another host, a proxy in
 * front of `next start`). With no proxy at all the last hop is client-written too, which is why
 * x-real-ip comes first and why these values are attribution, not proof of origin.
 */
export function trustedClientIp(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
  return hops.length ? hops[hops.length - 1]! : null;
}

export function getClientIp(request: Request): string | null {
  return trustedClientIp(request.headers);
}

export function getUserAgent(request: Request): string | null {
  return request.headers.get("user-agent");
}
