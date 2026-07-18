/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Transformers.js uses Node-specific ONNX bindings and must remain a native
    // server dependency. The standard import in lib/embeddings.ts allows output
    // file tracing to discover the package and its transitive dependencies.
    serverComponentsExternalPackages: ["@xenova/transformers"],
    outputFileTracingIncludes: {
      "/api/fit/analyze": ["./models/**/*"],
    },
  },
};

export default nextConfig;
