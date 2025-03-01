import createNextIntlPlugin from "next-intl/plugin";

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Remove env override here; rely on .env files instead
};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);