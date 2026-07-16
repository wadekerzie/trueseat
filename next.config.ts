import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (pdfjs-dist) must load its worker from node_modules at runtime;
  // bundling it breaks the worker path resolution.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
