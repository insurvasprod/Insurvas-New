import type { NextConfig } from "next";

// `experimental.authInterrupts` was enabled for the Configuration Center's use of forbidden().
// That hub is gone and nothing calls forbidden() any more, so the flag went with it.
const nextConfig: NextConfig = {
  // Pure aliases, answered before any rendering. As page-level redirect() calls each of these paid
  // for a full shell render — the agent layout's whole batch of reads, ~570ms — just to say "go
  // elsewhere", and /app added a second hop to every login. The alias pages stay as a fallback.
  //
  // `/` → /pricing is deliberately NOT here: config redirects run before proxy.ts, and the proxy
  // sends `/` on app.insurvas.com to the login page instead.
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
