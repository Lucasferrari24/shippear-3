import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Binarios nativos del modelo local: se cargan desde node_modules en vez de empaquetarse.
  serverExternalPackages: ["onnxruntime-node", "sharp"],
};

export default nextConfig;
