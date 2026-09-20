import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

// Inspect syntax only: never import commerce.ts or initialize a database client.
const commercePath = new URL("./commerce.ts", import.meta.url);
const source = readFileSync(commercePath, "utf8");
const cart = "retail_cart_items_cart_product_variant_unique";
const wishlist = "product_wishlists_user_product_variant_unique";

function inspect(text: string) {
  const file = ts.createSourceFile(
    "commerce.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );
  const declarations = new Map<string, {
    kind: string;
    nullsNotDistinct: boolean;
    start: number;
    end: number;
  }[]>();
  let nullsNotDistinctCount = 0;
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "nullsNotDistinct") {
        nullsNotDistinctCount++;
      }
      const name = node.arguments[0];
      if (ts.isIdentifier(node.expression)
        && ["unique", "uniqueIndex"].includes(node.expression.text)
        && name && ts.isStringLiteralLike(name)) {
        let chained: ts.Node = node;
        let nullsNotDistinct = false;
        while (ts.isPropertyAccessExpression(chained.parent)
          && chained.parent.expression === chained
          && ts.isCallExpression(chained.parent.parent)
          && chained.parent.parent.expression === chained.parent) {
          nullsNotDistinct ||= chained.parent.name.text === "nullsNotDistinct";
          chained = chained.parent.parent;
        }
        const items = declarations.get(name.text) ?? [];
        items.push({
          kind: node.expression.text,
          nullsNotDistinct,
          start: node.expression.getStart(file),
          end: node.expression.end,
        });
        declarations.set(name.text, items);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { declarations, nullsNotDistinctCount };
}

function assertKind(text: string, object: string, expected: string) {
  const found = inspect(text).declarations.get(object) ?? [];
  const actual = found.map(item => item.kind).join(", ") || "missing";
  assert.equal(found.length, 1,
    `${object}: expected exactly one ${expected} declaration; actual ${found.length} (${actual})`);
  assert.equal(found[0].kind, expected,
    `${object}: expected object kind ${expected}; actual object kind ${actual}`);
  return found[0];
}

function assertWishlist(text: string): void {
  const declaration = assertKind(text, wishlist, "unique");
  assert.equal(declaration.nullsNotDistinct, true,
    `${wishlist}: expected unique constraint with nullsNotDistinct(); actual unique constraint without nullsNotDistinct()`);
}

function assertNullCount(text: string): void {
  const actual = inspect(text).nullsNotDistinctCount;
  assert.equal(actual, 1,
    `commerce.ts (${wishlist}): expected exactly 1 nullsNotDistinct() declaration; actual ${actual}`);
}

test(`${cart} is a uniqueIndex, not a unique constraint`, () => {
  assertKind(source, cart, "uniqueIndex");
});

test(`${wishlist} is a unique constraint with nullsNotDistinct(), not a uniqueIndex`, () => {
  assertWishlist(source);
});

test("commerce.ts has exactly one nullsNotDistinct() declaration", () => {
  assertNullCount(source);
});

for (const [object, correct, inverted] of [
  [cart, "uniqueIndex", "unique"],
  [wishlist, "unique", "uniqueIndex"],
]) {
  test(`${object}: inverted fixture fails and is restored`, (context) => {
    const directory = mkdtempSync(path.join(tmpdir(), "commerce-unique-kinds-"));
    const fixture = path.join(directory, "commerce.ts");
    try {
      writeFileSync(fixture, source);
      const declaration = assertKind(source, object, correct);
      const mutated = source.slice(0, declaration.start)
        + inverted + source.slice(declaration.end);
      try {
        writeFileSync(fixture, mutated);
        assert.throws(
          () => assertKind(readFileSync(fixture, "utf8"), object, correct),
          (error: unknown) => {
            assert.ok(error instanceof assert.AssertionError);
            assert.ok(error.message.includes(
              `${object}: expected object kind ${correct}; actual object kind ${inverted}`,
            ));
            context.diagnostic(
              `Expected regression failure: ${object}: expected ${correct}; actual ${inverted}`,
            );
            return true;
          },
        );
      } finally {
        writeFileSync(fixture, source);
        assert.equal(readFileSync(fixture, "utf8"), source);
        assertKind(readFileSync(fixture, "utf8"), cart, "uniqueIndex");
        assertWishlist(readFileSync(fixture, "utf8"));
        assertNullCount(readFileSync(fixture, "utf8"));
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    assert.equal(readFileSync(commercePath, "utf8"), source);
  });
}