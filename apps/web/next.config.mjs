/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: '/relay', destination: '/', permanent: false },
      { source: '/replay', destination: '/', permanent: false },
      { source: '/replay/:id', destination: '/', permanent: false },
    ];
  },
};
export default nextConfig;
