import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseDocument } from "./parse";
import { MAX_FILE_BYTES, MAX_PDF_PAGES } from "./types";

// These two fixtures were exported by Microsoft Word from test-only content.
// The text fixture has two selectable-text pages; the image fixture has no
// text layer. Neither contains user documents or credentials.
const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url));

function pdfWithPages(count: number, text = "Boundary page"): Uint8Array {
  const refs = Array.from({ length: count }, (_, index) => `${4 + index * 2} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${refs}] /Count ${count} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let index = 0; index < count; index += 1) {
    const contents = 5 + index * 2;
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contents} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("PDF ingestion regression", () => {
  it("extracts searchable text from both pages of a Word-exported PDF", async () => {
    const chunks = await parseDocument(await fixture("word-export-text.pdf"), "pdf");
    const result = chunks.join(" ");
    expect(result).toContain("Page one contains searchable text");
    expect(result).toContain("Page two contains another searchable sentence");
    expect(result).toContain("知识库测试");
  });

  it("identifies an image-only Word-exported PDF as requiring unsupported OCR", async () => {
    await expect(parseDocument(await fixture("word-export-image-only.pdf"), "pdf"))
      .rejects.toMatchObject({ code: "PDF_NO_TEXT", status: 400 });
  });

  it("safely rejects a damaged PDF", async () => {
    await expect(parseDocument(new TextEncoder().encode("%PDF-1.4\ntruncated"), "pdf"))
      .rejects.toMatchObject({ code: "PDF_PARSE_FAILED" });
  });

  it("accepts 50 pages and rejects page 51", async () => {
    const accepted = await parseDocument(pdfWithPages(MAX_PDF_PAGES), "pdf");
    expect(accepted.join(" ")).toContain("Boundary page");
    await expect(parseDocument(pdfWithPages(MAX_PDF_PAGES + 1), "pdf"))
      .rejects.toMatchObject({ code: "INVALID_FILE_CONTENT" });
  });

  it("retains the 4 MiB file limit", async () => {
    await expect(parseDocument(new Uint8Array(MAX_FILE_BYTES + 1), "pdf"))
      .rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });
});
