import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    proxyClientMaxBodySize: "400mb",
  },
};

export default nextConfig;
