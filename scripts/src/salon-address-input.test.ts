import assert from "node:assert/strict";
import test from "node:test";
import { CreateSalonLocationBody, UpdateManagedSalonProfileBody } from "@workspace/api-zod";
const { normalizeSalonAddressInput } = await import(
  new URL("../../artifacts/api-server/src/lib/salon-address-input.ts", import.meta.url).href
) as { normalizeSalonAddressInput: (input: unknown) => unknown };

const parse = (value: unknown) => UpdateManagedSalonProfileBody.safeParse(normalizeSalonAddressInput(value));
for (const [key, limit] of Object.entries({ entranceDirections: 500, intercom: 80, floor: 80, apartment: 40 })) {
  test(`${key}: optional, nullable, trimmed, clearable, bounded and no markup`, () => {
    assert.deepEqual(parse({}), { success: true, data: {} });
    for (const value of [null, "", " \t\n "]) {
      assert.deepEqual(parse({ [key]: value }), { success: true, data: { [key]: null } });
    }
    assert.deepEqual(parse({ [key]: "  IV sprat  " }), { success: true, data: { [key]: "IV sprat" } });
    assert.equal(parse({ [key]: ` ${"x".repeat(limit)} ` }).success, true);
    for (const value of ["x".repeat(limit + 1), "<b>ulaz</b>", "<script>alert(1)</script>", 22, {}, []]) {
      assert.equal(parse({ [key]: value }).success, false);
    }
    // Creation must use the same generated constraints as profile editing.
    const creationField = CreateSalonLocationBody.shape[key as keyof typeof CreateSalonLocationBody.shape];
    assert.equal(creationField.safeParse(null).success, true);
    assert.equal(creationField.safeParse("x".repeat(limit)).success, true);
    assert.equal(creationField.safeParse("x".repeat(limit + 1)).success, false);
    assert.equal(creationField.safeParse("<img>").success, false);
  });
}