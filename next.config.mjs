/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Note: /lib/embeddings.ts loads @xenova/transformers via an indirect import, so the
  // bundler never resolves it — no externals config needed while it's optional.
};

export default nextConfig;
