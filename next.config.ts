import type { NextConfig } from "next";

// `experimental.authInterrupts` was enabled for the Configuration Center's use of forbidden().
// That hub is gone and nothing calls forbidden() any more, so the flag went with it.
const nextConfig: NextConfig = {};

export default nextConfig;
