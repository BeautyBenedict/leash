/** @type {import('next').NextConfig} */
const nextConfig = {
  // keep the NEAR client out of the bundler; it runs in Node on the server only
  serverExternalPackages: ["near-api-js"],
};
export default nextConfig;
