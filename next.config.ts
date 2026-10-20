import type { NextConfig } from 'next';
const config: NextConfig = { serverExternalPackages: ['node:sqlite'], poweredByHeader: false, devIndicators: false, distDir: process.env.NODE_ENV==='production'?'.next-production':'.next' };
export default config;
