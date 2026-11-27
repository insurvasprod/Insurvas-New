/**
 * The phone app's web preview (mobile/, `npx expo start --web`) runs on its own origin, so the browser
 * needs CORS to call /api/app. Development only: in production this answers null for every request,
 * and the installed app needs no CORS at all (native requests have no origin). The allowed origins are
 * Expo's dev ports on localhost; nothing is configurable, so a deployment can't widen it by mistake.
 * Credentials are never allowed: the preview sends a Bearer header, never cookies.
 */
const PREVIEW_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):(8081|8082|19006)$/;

export function appPreviewOrigin(input: { nodeEnv: string | undefined; pathname: string; origin: string | null }): string | null {
  if (input.nodeEnv === "production") return null;
  if (!input.pathname.startsWith("/api/app/")) return null;
  return input.origin && PREVIEW_ORIGIN.test(input.origin) ? input.origin : null;
}

export function appPreviewCorsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, accept, x-insurvas-client, x-insurvas-trusted",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}
