import { SaxesParser, type SaxesTag } from "saxes";
import { z } from "zod";
import {
  normalizedEducationBankTransactionSchema,
  type NormalizedEducationBankTransaction,
} from "./education-bank-reconciliation";

const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_ELEMENTS = 100_000;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const SUPPORTED_NAMESPACES = /^urn:iso:std:iso:20022:tech:xsd:camt\.053\.\d{3}\.\d{2}$/;
const FORBIDDEN_XML_DECLARATIONS = /<!\s*(?:DOCTYPE|ENTITY)\b/i;

const previewItemSchema = z.object({
  index: z.number().int().positive(),
  sourceItemId: z.string().max(255).nullable(),
  reference: z.string().max(140).nullable(),
  amountRsd: z.number().int().positive().nullable(),
  receivedAt: z.date().nullable(),
  status: z.enum(["ready", "invalid"]),
  errors: z.array(z.string()),
}).strict();

export type EducationCamt053PreviewItem = z.infer<typeof previewItemSchema>;

export type EducationCamt053Preview = {
  namespace: string;
  statementCount: number;
  entryCount: number;
  readyCount: number;
  invalidCount: number;
  items: EducationCamt053PreviewItem[];
};

type EntryDraft = {
  values: Map<string, string[]>;
  currency: string | null;
  creditDebit: string | null;
};

type StatementEntryDraft = EntryDraft & {
  details: EntryDraft[];
};

const firstMeaningful = (values: string[] | undefined) =>
  values?.map((value) => value.trim()).find((value) => value && value !== "NOTPROVIDED") ?? null;

const exactRsd = (raw: string | null) => {
  if (!raw || !/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  if (fraction.padEnd(2, "0") !== "00") return null;
  const amount = Number(whole);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 2_147_483_647 ? amount : null;
};

const exactDate = (raw: string | null) => {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : date;
};

const normalizeEntry = (entry: EntryDraft, index: number): EducationCamt053PreviewItem => {
  const sourceItemId = firstMeaningful(entry.values.get("AcctSvcrRef"))
    ?? firstMeaningful(entry.values.get("TxId"));
  const reference = firstMeaningful(entry.values.get("EndToEndId"))
    ?? firstMeaningful(entry.values.get("Ustrd"));
  const amountRsd = exactRsd(firstMeaningful(entry.values.get("Amt")));
  const receivedAt = exactDate(
    firstMeaningful(entry.values.get("BookgDt/Dt"))
    ?? firstMeaningful(entry.values.get("ValDt/Dt")),
  );
  const errors: string[] = [];
  if (!sourceItemId) errors.push("Nedostaje AcctSvcrRef ili TxId.");
  if (sourceItemId && sourceItemId.length > 255) errors.push("ID stavke je duži od 255 znakova.");
  if (!reference) errors.push("Nedostaje EndToEndId ili Ustrd referenca.");
  if (reference && reference.length > 140) errors.push("Referenca je duža od 140 znakova.");
  if (entry.currency !== "RSD") errors.push("Amt valuta mora biti RSD.");
  if (amountRsd === null) errors.push("Amt mora biti pozitivan ceo RSD iznos.");
  if (!receivedAt) errors.push("Nedostaje ispravan BookgDt ili ValDt datum.");
  if (entry.creditDebit !== "CRDT") errors.push("Stavka nije potvrđen priliv (CdtDbtInd mora biti CRDT).");
  return previewItemSchema.parse({
    index,
    sourceItemId: sourceItemId?.slice(0, 255) ?? null,
    reference: reference?.slice(0, 140) ?? null,
    amountRsd,
    receivedAt,
    status: errors.length ? "invalid" : "ready",
    errors,
  });
};

export function parseEducationCamt053(xml: string): EducationCamt053Preview {
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES) throw new Error("CAMT_XML_TOO_LARGE");
  if (FORBIDDEN_XML_DECLARATIONS.test(xml)) throw new Error("CAMT_XML_FORBIDDEN_DECLARATION");
  if (!xml.trim()) throw new Error("CAMT_XML_EMPTY");

  let namespace = "";
  let statementCount = 0;
  let elementCount = 0;
  let textBytes = 0;
  let currentEntry: StatementEntryDraft | null = null;
  let currentDetail: EntryDraft | null = null;
  const path: string[] = [];
  const textStack: string[] = [];
  const entries: EntryDraft[] = [];
  const parser = new SaxesParser({ xmlns: true, fragment: false });

  parser.on("doctype", () => { throw new Error("CAMT_XML_FORBIDDEN_DECLARATION"); });
  parser.on("opentag", (tag: SaxesTag) => {
    elementCount += 1;
    if (elementCount > MAX_ELEMENTS) throw new Error("CAMT_XML_TOO_COMPLEX");
    const local = tag.local ?? tag.name;
    const uri = tag.uri ?? "";
    path.push(local);
    textStack.push("");
    if (path.length === 1) {
      if (local !== "Document" || !SUPPORTED_NAMESPACES.test(uri)) throw new Error("CAMT_XML_UNSUPPORTED_NAMESPACE");
      namespace = uri;
    }
    if (local === "Stmt") statementCount += 1;
    if (local === "Ntry") currentEntry = { values: new Map(), currency: null, creditDebit: null, details: [] };
    if (currentEntry && local === "TxDtls") currentDetail = { values: new Map(), currency: null, creditDebit: null };
    if (currentEntry && local === "Amt" && typeof tag.attributes.Ccy === "object") {
      (currentDetail ?? currentEntry).currency = tag.attributes.Ccy.value.trim().toUpperCase();
    }
  });
  parser.on("text", (text: string) => {
    textBytes += Buffer.byteLength(text, "utf8");
    if (textBytes > MAX_TEXT_BYTES) throw new Error("CAMT_XML_TOO_COMPLEX");
    if (textStack.length) textStack[textStack.length - 1] += text;
  });
  parser.on("closetag", () => {
    const local = path[path.length - 1]!;
    const text = textStack.pop()!.trim();
    if (currentEntry && text) {
      const target = currentDetail ?? currentEntry;
      const parent = path[path.length - 2];
      const key = local === "Dt" && (parent === "BookgDt" || parent === "ValDt") ? `${parent}/Dt` : local;
      const values = target.values.get(key) ?? [];
      values.push(text);
      target.values.set(key, values);
      if (local === "CdtDbtInd") target.creditDebit = text.toUpperCase();
    }
    if (local === "TxDtls" && currentEntry && currentDetail) {
      currentEntry.details.push(currentDetail);
      currentDetail = null;
    }
    if (local === "Ntry" && currentEntry) {
      if (currentEntry.details.length === 0) {
        entries.push(currentEntry);
      } else {
        for (const detail of currentEntry.details) {
          const parentValues = new Map(currentEntry.values);
          if (currentEntry.details.length > 1) {
            parentValues.delete("AcctSvcrRef");
            parentValues.delete("TxId");
            if (!detail.values.has("Amt")) parentValues.delete("Amt");
          }
          const values = new Map([...parentValues, ...detail.values]);
          entries.push({
            values,
            currency: detail.currency ?? (currentEntry.details.length === 1 ? currentEntry.currency : null),
            creditDebit: detail.creditDebit ?? currentEntry.creditDebit,
          });
        }
      }
      currentEntry = null;
    }
    path.pop();
  });
  parser.write(xml).close();
  if (!namespace || statementCount === 0) throw new Error("CAMT_XML_NO_STATEMENT");

  const items = entries.map((entry, index) => normalizeEntry(entry, index + 1));
  return {
    namespace,
    statementCount,
    entryCount: items.length,
    readyCount: items.filter((item) => item.status === "ready").length,
    invalidCount: items.filter((item) => item.status === "invalid").length,
    items,
  };
}

export const normalizedTransactionsFromCamt053 = (
  preview: EducationCamt053Preview,
): NormalizedEducationBankTransaction[] => preview.items
  .filter((item): item is EducationCamt053PreviewItem & {
    sourceItemId: string; reference: string; amountRsd: number; receivedAt: Date;
  } => item.status === "ready")
  .map((item) => normalizedEducationBankTransactionSchema.parse({
    source: "raiffeisen_camt053",
    sourceItemId: item.sourceItemId,
    reference: item.reference,
    amountRsd: item.amountRsd,
    receivedAt: item.receivedAt,
  }));