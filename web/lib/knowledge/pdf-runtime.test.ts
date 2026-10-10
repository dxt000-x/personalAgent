import { describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async (importOriginal) => {
  const original = await importOriginal<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>();
  return { ...original, getDocument: () => { throw new Error("synthetic worker setup failure"); } };
});

describe("PDF runtime failure boundary", () => {
  it("treats an unexpected PDF.js worker failure as temporary", async () => {
    const { parseDocument } = await import("./parse");
    await expect(parseDocument(new TextEncoder().encode("%PDF-1.4\nfixture"), "pdf"))
      .rejects.toMatchObject({ code: "KNOWLEDGE_UNAVAILABLE", status: 503 });
  });
});
