import type { NextConfig } from "next";

// `experimental.authInterrupts` was enabled for the Configuration Center's use of forbidden().
// That hub is gone and nothing calls forbidden() any more, so the flag went with it.
const nextConfig: NextConfig = {
  // pdf.js loads its worker module at run time; bundled, that lookup breaks. Carrier PDF statements are
  // read on the server only (lib/ingestion/pdfText.ts), so it stays an external package there.
  serverExternalPackages: ["pdfjs-dist"],
  // Speed pass 2026-11-09 ("show the last data at once, then refresh"): the router keeps a page it drew for 30s, so
  // going back to it is instant; components/app/background-refresh.tsx then asks the server again behind it. Every
  // change already calls router.refresh(), which drops these copies. Prefetched pages and loading states: 3 min.
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
  },
  // Pure aliases, answered before any rendering. As page-level redirect() calls each of these paid
  // for a full shell render — the agent layout's whole batch of reads, ~570ms — just to say "go
  // elsewhere", and /app added a second hop to every login. The alias pages stay as a fallback.
  //
  // `/` is the landing page on every host, so it is not redirected anywhere.
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
