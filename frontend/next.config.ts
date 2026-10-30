import type { NextConfig } from "next";

// Public base URL of the FastAPI backend, e.g. https://api.mtaasense.example (no trailing slash).
// The browser calls same-origin /api/v1/*; Next rewrites those requests to the backend so the
// reviewer session cookie stays first-party. No secrets ever live in NEXT_PUBLIC_* variables.
// `||` rather than `??`: CI passes an empty string when the variable is unset.
const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Camera/microphone/geolocation are requested only after an explicit user action.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self)" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${apiBase}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
