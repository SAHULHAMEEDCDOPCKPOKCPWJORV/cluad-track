/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      canvg: false,
      html2canvas: false,
      dompurify: false,
      fs: false,
    };
    return config;
  },
};

export default nextConfig;
