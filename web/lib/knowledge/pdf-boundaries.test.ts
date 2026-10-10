import { describe, expect, it, vi } from "vitest";
import { MAX_CHUNKS, MAX_TEXT_CHARS } from "./types";

const extracted = vi.hoisted(() => ({ text: "" }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async (importOriginal) => {
  const original = await importOriginal<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>();
  return {
    ...original,
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [{ str: extracted.text }] }),
          cleanup: () => undefined,
        }),
      }),
      destroy: async () => undefined,
    }),
  };
});

describe("PDF extracted-content limits", () => {
  const header = new TextEncoder().encode("%PDF-1.4\nfixture");
  it("rejects extracted text above 200,000 characters", async () => {
    extracted.text = "A".repeat(MAX_TEXT_CHARS + 1);
    const { parseDocument } = await import("./parse");
    await expect(parseDocument(header, "pdf")).rejects.toMatchObject({ code: "INVALID_FILE_CONTENT" });
  });
  it("rejects more than 200 ordered chunks", async () => {
    extracted.text = `${"A".repeat(700)} `.repeat(MAX_CHUNKS + 1);
    const { parseDocument } = await import("./parse");
    await expect(parseDocument(header, "pdf")).rejects.toMatchObject({ code: "INVALID_FILE_CONTENT" });
  });
});
