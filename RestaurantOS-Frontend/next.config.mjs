/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: 'http', hostname: 'localhost', port: '5102', pathname: '/images/**' }],
  },
  async rewrites() {
    // Dev-only proxy to the Phase 1 local backend (Docker-Backend-Test), so the
    // frontend never needs CORS config and never points anywhere near srv1399.hstgr.io.
    // /images/:path* proxies the backend's real menu-item photos and receipt/report logo
    // (server.local.js serves its own tmp/ folder there) so <img src="/images/..."> works
    // from the frontend's own origin (port 3000) without hardcoding localhost:5102 anywhere.
    return [
      { source: '/api/:path*', destination: 'http://localhost:5102/:path*' },
      { source: '/images/:path*', destination: 'http://localhost:5102/images/:path*' },
    ];
  },
};
export default nextConfig;
