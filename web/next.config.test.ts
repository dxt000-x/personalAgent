import { expect, it } from "vitest";
import nextConfig from "./next.config";

it("keeps PDF.js external to the server bundle so its Node worker remains resolvable", () => {
  expect(nextConfig.serverExternalPackages).toContain("pdfjs-dist");
  expect(nextConfig.outputFileTracingIncludes?.["/api/knowledge/*/process"])
    .toContain("./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
});
