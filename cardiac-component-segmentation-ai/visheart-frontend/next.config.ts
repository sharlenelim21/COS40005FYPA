import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // standalone output is required for Docker but causes symlink EPERM errors on Windows
  // without Developer Mode enabled. Set NEXT_STANDALONE=1 in CI/Docker only.
  output: process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
  outputFileTracingRoot: process.cwd(),
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    // Fix for Konva canvas dependency issue
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        canvas: false,
        encoding: false,
        fs: false,
        path: false,
        os: false,
      };
    }

    // Exclude problematic modules from server-side rendering
    config.externals = [...(config.externals || []), "canvas"];

    return config;
  },
  // Transpile specific packages that might have issues
  transpilePackages: ["konva", "react-konva"],

  // 🔥 Remove console.* in production
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
};

export default nextConfig;
