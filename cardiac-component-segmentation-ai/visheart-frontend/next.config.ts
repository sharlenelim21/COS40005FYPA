import type { NextConfig } from "next";

const isWindows = process.platform === "win32";

const nextConfig: NextConfig = {
  /* config options here */
  // standalone output is required for Docker but causes symlink EPERM errors on Windows
  // without Developer Mode enabled. Set NEXT_STANDALONE=1 in CI/Docker only.
  output: process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
  outputFileTracingRoot: process.cwd(),

  // Do not advertise the framework (was leaking "X-Powered-By: Next.js"). (F8)
  poweredByHeader: false,

  // Baseline security headers on every response (F8 partial). No strict CSP here —
  // a tuned Content-Security-Policy is deferred to avoid breaking the app's inline
  // scripts/styles and canvas workers; tracked as remaining work.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
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

  // 🔥 Remove console.* in production — except console.info / console.clear,
  // kept for the landmark page's P1 / P2 / LV-centre coordinate log.
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["info", "clear"] } : false,
  },
};

export default nextConfig;
