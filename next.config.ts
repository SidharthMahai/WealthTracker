import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NODE_ENV === "production" ? ".next" : ".next-dev",
  typedRoutes: true,
};

export default nextConfig;
