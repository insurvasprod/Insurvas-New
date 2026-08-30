import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Configuration Center uses Next's real 403 interruption for server-side route gates.
    authInterrupts: true,
  },
};

export default nextConfig;
