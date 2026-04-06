import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    // Ensure native @napi-rs/canvas bindings are required at runtime by Node
    // instead of being bundled, which avoids loader errors for the .node file.
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        "@napi-rs/canvas": "commonjs @napi-rs/canvas",
      });
    }
    return config;
  },
};

export default nextConfig;
