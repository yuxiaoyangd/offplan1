import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
    if (!supabaseUrl) return [];

    return ["rest", "auth", "storage", "functions"].map((service) => ({
      source: `/supabase/${service}/v1/:path*`,
      destination: `${supabaseUrl}/${service}/v1/:path*`,
    }));
  },
};

export default nextConfig;
