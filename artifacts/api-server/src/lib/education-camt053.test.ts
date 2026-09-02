import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizedTransactionsFromCamt053,
  parseEducationCamt053,
} from "./education-camt053";

const wrap = (entry: string, namespace = "urn:iso:std:iso:20022:tech:xsd:camt.053.001.08") => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="${namespace}">
  <BkToCstmrStmt>
    <Stmt><Id>statement-1</Id>${entry}</Stmt>
  </BkToCstmrStmt>
</Document>`;

const anonymizedRaiffeisenFixture = readFileSync(
  new URL("./fixtures/raiffeisen-camt053-anonymized.xml", import.meta.url),
  "utf8",
);

test("parses an anonymized Raiffeisen export without crossing grouped or duplicate payments", () => {
  const preview = parseEducationCamt053(anonymizedRaiffeisenFixture);

  assert.equal(preview.namespace, "urn:iso:std:iso:20022:tech:xsd:camt.053.001.08");
  assert.equal(preview.statementCount, 1);
  assert.equal(preview.entryCount, 4);
  assert.equal(preview.readyCount, 4);
  assert.equal(preview.invalidCount, 0);

  const transactions = normalizedTransactionsFromCamt053(preview);
  assert.deepEqual(transactions, [
    {
      source: "raiffeisen_camt053",
      sourceItemId: "ANON-RFB-TX-000001",
      reference: "EDU-AUTO-ANON-0001",
      amountRsd: 12500,
      receivedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
    {
      source: "raiffeisen_camt053",
      sourceItemId: "ANON-RFB-TX-000002",
      reference: "EDU-AUTO-ANON-0002",
      amountRsd: 5000,
      receivedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
    {
      source: "raiffeisen_camt053",
      sourceItemId: "ANON-RFB-ASR-000003",
      reference: "EDU-AUTO-ANON-0003",
      amountRsd: 12500,
      receivedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
    {
      source: "raiffeisen_camt053",
      sourceItemId: "ANON-RFB-ASR-000003",
      reference: "EDU-AUTO-ANON-0003",
      amountRsd: 12500,
      receivedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  ]);

  assert.deepEqual(
    transactions.slice(0, 2).map(({ sourceItemId, reference, amountRsd }) => ({
      sourceItemId,
      reference,
      amountRsd,
    })),
    [
      { sourceItemId: "ANON-RFB-TX-000001", reference: "EDU-AUTO-ANON-0001", amountRsd: 12500 },
      { sourceItemId: "ANON-RFB-TX-000002", reference: "EDU-AUTO-ANON-0002", amountRsd: 5000 },
    ],
  );
  assert.deepEqual(transactions[3], transactions[2]);
});

test("maps a Raiffeisen CAMT.053 credit to the normalized reconciliation boundary", () => {
  const preview = parseEducationCamt053(wrap(`
    <Ntry>
      <Amt Ccy="RSD">12500.00</Amt>
      <CdtDbtInd>CRDT</CdtDbtInd>
      <BookgDt><Dt>2026-09-01</Dt></BookgDt>
      <NtryDtls><TxDtls>
        <Refs>
          <AcctSvcrRef>RBA-2026-0001</AcctSvcrRef>
          <TxId>fallback-id</TxId>
          <EndToEndId>EDU-REFERENCE-1</EndToEndId>
        </Refs>
        <RmtInf><Ustrd>fallback-reference</Ustrd></RmtInf>
      </TxDtls></NtryDtls>
    </Ntry>`));

  assert.equal(preview.namespace, "urn:iso:std:iso:20022:tech:xsd:camt.053.001.08");
  assert.equal(preview.readyCount, 1);
  assert.equal(preview.invalidCount, 0);
  assert.deepEqual(normalizedTransactionsFromCamt053(preview), [{
    source: "raiffeisen_camt053",
    sourceItemId: "RBA-2026-0001",
    reference: "EDU-REFERENCE-1",
    amountRsd: 12500,
    receivedAt: new Date("2026-09-01T00:00:00.000Z"),
  }]);
});

test("falls back to TxId, Ustrd and ValDt", () => {
  const preview = parseEducationCamt053(wrap(`
    <Ntry>
      <Amt Ccy="RSD">900</Amt>
      <CdtDbtInd>CRDT</CdtDbtInd>
      <ValDt><Dt>2026-08-31</Dt></ValDt>
      <NtryDtls><TxDtls>
        <Refs><TxId>tx-fallback</TxId><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
        <RmtInf><Ustrd>EDU FALLBACK</Ustrd></RmtInf>
      </TxDtls></NtryDtls>
    </Ntry>`));
  assert.equal(preview.items[0]?.sourceItemId, "tx-fallback");
  assert.equal(preview.items[0]?.reference, "EDU FALLBACK");
  assert.equal(preview.items[0]?.receivedAt?.toISOString(), "2026-08-31T00:00:00.000Z");
});

test("expands batched Ntry transaction details into independently idempotent items", () => {
  const preview = parseEducationCamt053(wrap(`
    <Ntry>
      <Amt Ccy="RSD">1000</Amt><CdtDbtInd>CRDT</CdtDbtInd>
      <BookgDt><Dt>2026-09-01</Dt></BookgDt>
      <NtryDtls>
        <TxDtls><Amt Ccy="RSD">400</Amt><Refs><TxId>batch-1</TxId><EndToEndId>REF-1</EndToEndId></Refs></TxDtls>
        <TxDtls><Amt Ccy="RSD">600</Amt><Refs><TxId>batch-2</TxId><EndToEndId>REF-2</EndToEndId></Refs></TxDtls>
      </NtryDtls>
    </Ntry>`));
  assert.equal(preview.entryCount, 2);
  assert.equal(preview.invalidCount, 0);
  assert.deepEqual(preview.items.map((item) => item.sourceItemId), ["batch-1", "batch-2"]);
});

test("does not inherit a shared entry AcctSvcrRef over per-detail TxId values", () => {
  const preview = parseEducationCamt053(wrap(`
    <Ntry>
      <Amt Ccy="RSD">1000</Amt><CdtDbtInd>CRDT</CdtDbtInd><AcctSvcrRef>shared-batch</AcctSvcrRef>
      <BookgDt><Dt>2026-09-01</Dt></BookgDt>
      <NtryDtls>
        <TxDtls><Amt Ccy="RSD">400</Amt><Refs><TxId>detail-1</TxId><EndToEndId>REF-1</EndToEndId></Refs></TxDtls>
        <TxDtls><Amt Ccy="RSD">600</Amt><Refs><TxId>detail-2</TxId><EndToEndId>REF-2</EndToEndId></Refs></TxDtls>
      </NtryDtls>
    </Ntry>`));
  assert.deepEqual(preview.items.map((item) => item.sourceItemId), ["detail-1", "detail-2"]);
  assert.deepEqual(preview.items.map((item) => item.amountRsd), [400, 600]);
});

test("requires an explicit CRDT direction before an item can be imported", () => {
  const preview = parseEducationCamt053(wrap(`
    <Ntry>
      <Amt Ccy="RSD">900</Amt><BookgDt><Dt>2026-09-01</Dt></BookgDt>
      <NtryDtls><TxDtls><Refs><TxId>direction-missing</TxId><EndToEndId>REF</EndToEndId></Refs></TxDtls></NtryDtls>
    </Ntry>`));
  assert.equal(preview.invalidCount, 1);
  assert.match(preview.items[0]?.errors.join(" ") ?? "", /CRDT/);
});

test("rejects DTD and entity declarations before parsing", () => {
  const xml = `<?xml version="1.0"?><!DOCTYPE Document [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
    <Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt><Id>&xxe;</Id></Stmt></BkToCstmrStmt></Document>`;
  assert.throws(() => parseEducationCamt053(xml), /CAMT_XML_FORBIDDEN_DECLARATION/);
});

test("rejects non-CAMT namespaces and marks unsafe booking entries invalid", () => {
  assert.throws(
    () => parseEducationCamt053(wrap("<Ntry />", "urn:iso:std:iso:20022:tech:xsd:camt.052.001.08")),
    /CAMT_XML_UNSUPPORTED_NAMESPACE/,
  );
  const preview = parseEducationCamt053(wrap(`
    <Ntry>
      <Amt Ccy="EUR">10.50</Amt><CdtDbtInd>DBIT</CdtDbtInd>
      <BookgDt><Dt>2026-02-30</Dt></BookgDt>
    </Ntry>`));
  assert.equal(preview.invalidCount, 1);
  assert.ok(preview.items[0]?.errors.some((error) => error.includes("RSD")));
  assert.ok(preview.items[0]?.errors.some((error) => error.includes("priliv")));
  assert.ok(preview.items[0]?.errors.some((error) => error.includes("datum")));
});