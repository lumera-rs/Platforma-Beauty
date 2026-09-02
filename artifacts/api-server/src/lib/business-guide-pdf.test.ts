import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { businessGuide } from "./business-guide-content";
import { getBusinessGuidePdf, getBusinessGuideTocPageCount } from "./business-guide-pdf";

const execFile = promisify(execFileCallback);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expectedTocEntries(): string[] {
  const entries = businessGuide.chapters.flatMap((chapter, chapterIndex) => [
    `${chapterIndex + 1}. ${chapter.title}`,
    ...chapter.sections.map(
      (section, sectionIndex) => `${chapterIndex + 1}.${sectionIndex + 1} ${section.title}`,
    ),
  ]);
  entries.push(`${businessGuide.chapters.length + 1}. Brzo snalaženje — moduli i adrese`);
  return entries;
}

async function inspectPdf(pdf: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "lumera-business-guide-"));
  const pdfPath = join(directory, "business-guide.pdf");

  try {
    await writeFile(pdfPath, pdf);
    const [{ stdout: info }, { stdout: text }] = await Promise.all([
      execFile("pdfinfo", [pdfPath]),
      execFile("pdftotext", ["-layout", pdfPath, "-"]),
    ]);
    const pages = Number(info.match(/^Pages:\s+(\d+)$/m)?.[1]);
    assert.ok(Number.isSafeInteger(pages) && pages > 0, "pdfinfo must report a positive page count");
    return { pageCount: pages, text };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("business guide PDF has complete, correctly numbered TOC and footers", async () => {
  const pdf = await getBusinessGuidePdf();
  assert.match(pdf.subarray(0, 8).toString("ascii"), /^%PDF-\d\.\d/, "must start with a PDF header");
  assert.match(pdf.toString("latin1"), /%%EOF\s*$/, "must end with a PDF EOF marker");

  const { pageCount, text } = await inspectPdf(pdf);
  const tocPageCount = getBusinessGuideTocPageCount();
  assert.ok(pageCount > tocPageCount, "guide content must extend beyond its reserved TOC pages");

  const extractedPages = text.split("\f");
  const tocText = extractedPages.slice(1, 1 + tocPageCount).join("\n").replace(/\s+/g, " ").trim();
  for (const entry of expectedTocEntries()) {
    const match = tocText.match(new RegExp(`${escapeRegex(entry)}\\s+(\\d+)(?=\\s|$)`));
    assert.ok(
      match,
      `TOC entry "${entry}" is missing from the ${tocPageCount} reserved TOC page(s); the guide has outgrown its reservation.`,
    );
    const recordedPage = Number(match[1]);
    assert.ok(
      recordedPage >= 1 && recordedPage <= pageCount,
      `TOC entry "${entry}" points to invalid page ${recordedPage}; the PDF has ${pageCount} pages.`,
    );
  }

  const footers = [...text.matchAll(/Strana\s+(\d+)\s+od\s+(\d+)/g)].map((match) => ({
    page: Number(match[1]),
    total: Number(match[2]),
  }));
  assert.equal(footers.length, pageCount - 1, "every non-cover page must have exactly one footer");
  assert.deepEqual(
    footers.map((footer) => footer.page),
    Array.from({ length: pageCount - 1 }, (_, index) => index + 2),
    "footer page numbers must cover every non-cover page",
  );
  assert.ok(
    footers.every((footer) => footer.total === pageCount),
    `every footer total must equal the real ${pageCount}-page PDF length`,
  );
});