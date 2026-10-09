import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF.js resolves its worker relative to its own package in Node.js.
  // Bundling the module moves it into .next/server/chunks without the worker.
  serverExternalPackages: ["pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/knowledge/*/process": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
};

export default nextConfig;
