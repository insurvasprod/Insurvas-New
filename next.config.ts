import type { NextConfig } from "next";

// `experimental.authInterrupts` was enabled for the Configuration Center's use of forbidden().
// That hub is gone and nothing calls forbidden() any more, so the flag went with it.
const nextConfig: NextConfig = {
  // pdf.js loads its worker module at run time; bundled, that lookup breaks. Carrier PDF statements are
  // read on the server only (lib/ingestion/pdfText.ts), so it stays an external package there.
  serverExternalPackages: ["pdfjs-dist"],
  // Pure aliases, answered before any rendering. As page-level redirect() calls each of these paid
  // for a full shell render — the agent layout's whole batch of reads, ~570ms — just to say "go
  // elsewhere", and /app added a second hop to every login. The alias pages stay as a fallback.
  //
  // `/` is not redirected here: config redirects run before proxy.ts, which sends `/` on APP_HOST
  // (app.insurvas.com) to the sign-in page and keeps it the landing page on SITE_HOST (lib/security/siteHosts.ts).
  async redirects() {
    return [
      { source: "/app", destination: "/app/dashboard", permanent: false },
      { source: "/app/vendors", destination: "/app/campaigns", permanent: false },
      { source: "/app/scorecard", destination: "/app/activity?view=scorecard", permanent: false },
      { source: "/admin/settings", destination: "/admin/advanced", permanent: false },
    ];
  },
};

export default nextConfig;
