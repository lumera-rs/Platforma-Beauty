/**
 * Reproducibilna generacija PDF vodiča iz business-guide-content.ts.
 *
 * Koristi pdfkit sa DejaVu Sans fontovima (podrška za č, ć, š, ž, đ) koji su
 * verzionisani u artifacts/api-server/assets/fonts/. PDF se generiše u
 * memoriji pri prvom zahtevu i kešira po procesu — sadržaj je statičan po
 * verziji koda.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { businessGuide, type GuideChapter, type GuideSection } from "./business-guide-content";

const PAGE_MARGIN = 56;
const ACCENT = "#8a6d3b";
const TEXT = "#1f1f1f";
const MUTED = "#5a5a5a";
const RULE = "#d8d0c0";

function resolveFont(fileName: string): Buffer {
  const candidates = [
    // dist/index.mjs → ../assets/fonts (deploy i dev pokreću dist build iz artifact dir-a)
    path.resolve(__dirname, "../assets/fonts", fileName),
    path.resolve(__dirname, "../../assets/fonts", fileName),
    path.resolve(process.cwd(), "assets/fonts", fileName),
    path.resolve(process.cwd(), "artifacts/api-server/assets/fonts", fileName),
    `/usr/share/fonts/truetype/dejavu/${fileName}`,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate);
  }
  throw new Error(`Font za PDF vodič nije pronađen: ${fileName}. Proverite artifacts/api-server/assets/fonts.`);
}

type TocEntry = { label: string; page: number; level: 0 | 1 };

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day}.${month}.${year}.`;
}

function contentWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

export function generateBusinessGuidePdf(): Promise<Buffer> {
  const regular = resolveFont("DejaVuSans.ttf");
  const bold = resolveFont("DejaVuSans-Bold.ttf");

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN + 14, left: PAGE_MARGIN, right: PAGE_MARGIN },
    bufferPages: true,
    autoFirstPage: false,
    info: {
      Title: businessGuide.title,
      Author: "LUMERA",
      Subject: businessGuide.subtitle,
    },
  });

  doc.registerFont("Body", regular);
  doc.registerFont("Bold", bold);

  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const width = () => contentWidth(doc);
  const toc: TocEntry[] = [];

  // ---------- Naslovna strana ----------
  doc.addPage();
  doc.moveDown(6);
  doc.font("Bold").fontSize(13).fillColor(ACCENT).text("LUMERA BIZNIS", { align: "center", characterSpacing: 3 });
  doc.moveDown(1.2);
  doc.font("Bold").fontSize(28).fillColor(TEXT).text("Vodič za partnere", { align: "center" });
  doc.moveDown(0.4);
  doc.font("Body").fontSize(14).fillColor(MUTED).text(businessGuide.subtitle, { align: "center" });
  doc.moveDown(2.5);
  const ruleY = doc.y;
  doc.moveTo(doc.page.width / 2 - 60, ruleY).lineTo(doc.page.width / 2 + 60, ruleY).lineWidth(1).strokeColor(ACCENT).stroke();
  doc.moveDown(2.5);
  doc.font("Body").fontSize(11).fillColor(MUTED).text(
    `Verzija ${businessGuide.version} · Ažurirano ${formatDate(businessGuide.updatedAt)}`,
    { align: "center" },
  );
  doc.moveDown(4);
  doc.font("Body").fontSize(10.5).fillColor(TEXT).text(businessGuide.audienceNote, PAGE_MARGIN + 40, doc.y, {
    width: width() - 80,
    align: "center",
    lineGap: 3,
  });
  doc.x = PAGE_MARGIN;

  // ---------- Rezervacija strana za sadržaj ----------
  const tocEntryCount =
    businessGuide.chapters.length +
    businessGuide.chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0) +
    1; // tabela brzog snalaženja
  const tocLinesPerPage = 38;
  const tocPageCount = Math.max(1, Math.ceil((tocEntryCount + 3) / tocLinesPerPage));
  const tocFirstPageIndex = 1;
  for (let i = 0; i < tocPageCount; i += 1) doc.addPage();

  // ---------- Sadržaj poglavlja ----------
  const pageNumberOf = () => doc.bufferedPageRange().start + doc.bufferedPageRange().count; // 1-based current page

  const renderSection = (chapterIndex: number, sectionIndex: number, section: GuideSection) => {
    ensureSpace(doc, 110);
    const heading = `${chapterIndex}.${sectionIndex} ${section.title}`;
    toc.push({ label: heading, page: pageNumberOf(), level: 1 });

    doc.moveDown(0.9);
    doc.font("Bold").fontSize(12.5).fillColor(TEXT).text(heading, { lineGap: 2 });
    if (section.route) {
      doc.font("Body").fontSize(9).fillColor(ACCENT).text(`Putanja: ${section.route}`, { lineGap: 2 });
    }
    doc.moveDown(0.25);
    doc.font("Body").fontSize(10.5).fillColor(TEXT).text(section.purpose, { width: width(), lineGap: 2.5 });

    if (section.steps?.length) {
      doc.moveDown(0.4);
      doc.font("Bold").fontSize(10).fillColor(MUTED).text("Koraci");
      doc.moveDown(0.15);
      section.steps.forEach((step, index) => {
        ensureSpace(doc, 30);
        const label = `${index + 1}.`;
        const startY = doc.y;
        doc.font("Bold").fontSize(10).fillColor(ACCENT).text(label, PAGE_MARGIN, startY, { width: 18 });
        doc.font("Body").fontSize(10).fillColor(TEXT).text(step, PAGE_MARGIN + 20, startY, {
          width: width() - 20,
          lineGap: 2,
        });
        doc.x = PAGE_MARGIN;
        doc.moveDown(0.12);
      });
    }

    if (section.notes?.length) {
      doc.moveDown(0.4);
      doc.font("Bold").fontSize(10).fillColor(MUTED).text("Napomene");
      doc.moveDown(0.15);
      section.notes.forEach((note) => {
        ensureSpace(doc, 30);
        const startY = doc.y;
        doc.font("Bold").fontSize(10).fillColor(ACCENT).text("•", PAGE_MARGIN + 2, startY, { width: 12 });
        doc.font("Body").fontSize(10).fillColor(TEXT).text(note, PAGE_MARGIN + 16, startY, {
          width: width() - 16,
          lineGap: 2,
        });
        doc.x = PAGE_MARGIN;
        doc.moveDown(0.12);
      });
    }
  };

  const renderChapter = (chapter: GuideChapter, chapterNumber: number) => {
    doc.addPage();
    const heading = `${chapterNumber}. ${chapter.title}`;
    toc.push({ label: heading, page: pageNumberOf(), level: 0 });

    doc.font("Bold").fontSize(19).fillColor(TEXT).text(heading, { lineGap: 3 });
    const underlineY = doc.y + 4;
    doc.moveTo(PAGE_MARGIN, underlineY).lineTo(PAGE_MARGIN + width(), underlineY).lineWidth(1.2).strokeColor(RULE).stroke();
    doc.moveDown(1);
    if (chapter.intro) {
      doc.font("Body").fontSize(10.5).fillColor(MUTED).text(chapter.intro, { width: width(), lineGap: 2.5 });
      doc.moveDown(0.4);
    }
    chapter.sections.forEach((section, index) => renderSection(chapterNumber, index + 1, section));
  };

  businessGuide.chapters.forEach((chapter, index) => renderChapter(chapter, index + 1));

  // ---------- Tabela brzog snalaženja ----------
  doc.addPage();
  const quickRefNumber = businessGuide.chapters.length + 1;
  const quickRefHeading = `${quickRefNumber}. Brzo snalaženje — moduli i adrese`;
  toc.push({ label: quickRefHeading, page: pageNumberOf(), level: 0 });
  doc.font("Bold").fontSize(19).fillColor(TEXT).text(quickRefHeading);
  const qrUnderlineY = doc.y + 4;
  doc.moveTo(PAGE_MARGIN, qrUnderlineY).lineTo(PAGE_MARGIN + width(), qrUnderlineY).lineWidth(1.2).strokeColor(RULE).stroke();
  doc.moveDown(1.2);

  const col1 = Math.round(width() * 0.42);
  const col2 = Math.round(width() * 0.34);
  const col3 = width() - col1 - col2;
  const drawQuickRow = (module: string, route: string, roles: string, isHeader = false) => {
    ensureSpace(doc, 26);
    const rowY = doc.y;
    const font = isHeader ? "Bold" : "Body";
    const color = isHeader ? MUTED : TEXT;
    doc.font(font).fontSize(isHeader ? 9.5 : 10).fillColor(color);
    doc.text(module, PAGE_MARGIN, rowY, { width: col1 - 8 });
    const afterModule = doc.y;
    doc.text(route, PAGE_MARGIN + col1, rowY, { width: col2 - 8 });
    const afterRoute = doc.y;
    doc.text(roles, PAGE_MARGIN + col1 + col2, rowY, { width: col3 });
    const rowBottom = Math.max(afterModule, afterRoute, doc.y) + 4;
    doc.moveTo(PAGE_MARGIN, rowBottom).lineTo(PAGE_MARGIN + width(), rowBottom).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.x = PAGE_MARGIN;
    doc.y = rowBottom + 4;
  };
  drawQuickRow("Modul", "Adresa", "Dostupno za", true);
  businessGuide.quickReference.forEach((row) => drawQuickRow(row.module, row.route, row.roles));

  // ---------- Popunjavanje sadržaja (TOC) ----------
  doc.switchToPage(tocFirstPageIndex);
  let tocPageOffset = 0;
  doc.font("Bold").fontSize(19).fillColor(TEXT).text("Sadržaj", PAGE_MARGIN, PAGE_MARGIN);
  doc.moveDown(1);
  const tocBottom = doc.page.height - doc.page.margins.bottom;
  for (const entry of toc) {
    if (doc.y + 20 > tocBottom) {
      tocPageOffset += 1;
      if (tocPageOffset >= tocPageCount) break; // rezerva je dimenzionisana da se ovo ne desi
      doc.switchToPage(tocFirstPageIndex + tocPageOffset);
      doc.x = PAGE_MARGIN;
      doc.y = PAGE_MARGIN;
    }
    const isChapter = entry.level === 0;
    const indent = isChapter ? 0 : 16;
    const font = isChapter ? "Bold" : "Body";
    const size = isChapter ? 11 : 10;
    const rowY = doc.y;
    const pageLabel = String(entry.page);
    doc.font(font).fontSize(size).fillColor(isChapter ? TEXT : MUTED);
    doc.text(entry.label, PAGE_MARGIN + indent, rowY, { width: width() - indent - 40, lineGap: 2 });
    doc.font(font).fontSize(size).fillColor(isChapter ? TEXT : MUTED);
    doc.text(pageLabel, PAGE_MARGIN + width() - 36, rowY, { width: 36, align: "right" });
    doc.x = PAGE_MARGIN;
    doc.y = Math.max(doc.y, rowY + size + 6);
    doc.moveDown(isChapter ? 0.35 : 0.15);
  }

  // ---------- Zaglavlje/podnožje ----------
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    if (i === 0) continue; // naslovna strana bez podnožja
    doc.switchToPage(i);
    const footerY = doc.page.height - PAGE_MARGIN + 8;
    doc.font("Body").fontSize(8.5).fillColor(MUTED);
    doc.text(`${businessGuide.title} · v${businessGuide.version}`, PAGE_MARGIN, footerY, {
      width: width() / 2,
      lineBreak: false,
    });
    doc.text(`Strana ${i + 1} od ${range.count}`, PAGE_MARGIN + width() / 2, footerY, {
      width: width() / 2,
      align: "right",
      lineBreak: false,
    });
  }

  doc.end();
  return result;
}

let cachedPdf: Promise<Buffer> | null = null;

export function getBusinessGuidePdf(): Promise<Buffer> {
  if (!cachedPdf) {
    cachedPdf = generateBusinessGuidePdf().catch((error) => {
      cachedPdf = null;
      throw error;
    });
  }
  return cachedPdf;
}
