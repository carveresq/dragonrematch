/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output keeps the Fly.io image small (single-machine MVP, no shared state).
  output: "standalone",
};

export default nextConfig;
