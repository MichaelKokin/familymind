import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://127.0.0.1:3000; frame-src blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
          },
        ],
      },
      // Next applies the last matching header value. The standalone report
      // must override the application policy at the HTTP layer as well as its
      // Route Handler; keep this equal to REPORT_CSP (production E2E checks it).
      {
        source: "/api/private/report",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'none'; style-src 'unsafe-inline'; img-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};
export default config;
