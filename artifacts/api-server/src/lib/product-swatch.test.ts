import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeColorSwatch } from "./product-swatch";

test("canonicalizes accepted COLOR hex values to uppercase", () => {
  const cases = [
    ["#aabbcc", "#AABBCC"],
    ["#AaBbCc", "#AABBCC"],
    ["#AABBCC", "#AABBCC"],
  ] as const;

  for (const [hex, expectedHex] of cases) {
    const input = { kind: "COLOR", hex };
    const before = { ...input };
    const output = canonicalizeColorSwatch(input);

    assert.deepEqual(output, { kind: "COLOR", hex: expectedHex });
    assert.notStrictEqual(output, input);
    assert.deepEqual(input, before, "normalization must not mutate its input");
  }
});

test("preserves malformed COLOR values so validation can reject them", () => {
  const malformed = [
    "#RGB",
    "aabbcc",
    "red",
    "",
    "#GGHHII",
    "#aabbc",
    "#aabbccdd",
    undefined,
    null,
    42,
  ];

  for (const hex of malformed) {
    const input = { kind: "COLOR", hex };
    assert.strictEqual(canonicalizeColorSwatch(input), input);
  }

  assert.strictEqual(canonicalizeColorSwatch(null), null);
  assert.strictEqual(canonicalizeColorSwatch(undefined), undefined);
});

test("preserves TEXT and IMAGE swatches by identity", () => {
  const text = { kind: "TEXT", text: "Rose", hex: "#aabbcc", extra: { source: "catalog" } };
  const image = { kind: "IMAGE", imageUrl: "/media/swatch.png", extra: { source: "catalog" } };

  assert.strictEqual(canonicalizeColorSwatch(text), text);
  assert.strictEqual(canonicalizeColorSwatch(image), image);
});

test("preserves additional swatch fields and variant data", () => {
  const metadata = { source: "supplier", rank: 2 };
  const input = {
    kind: "COLOR",
    hex: "#aabbcc",
    label: "Warm beige",
    value: "beige",
    stock: 7,
    price: 1250,
    metadata,
  };

  const output = canonicalizeColorSwatch(input);

  assert.deepEqual(output, {
    kind: "COLOR",
    hex: "#AABBCC",
    label: "Warm beige",
    value: "beige",
    stock: 7,
    price: 1250,
    metadata,
  });
  assert.strictEqual(output.metadata, metadata);
  assert.deepEqual(input, {
    kind: "COLOR",
    hex: "#aabbcc",
    label: "Warm beige",
    value: "beige",
    stock: 7,
    price: 1250,
    metadata,
  });
});