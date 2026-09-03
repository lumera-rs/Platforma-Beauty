import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkInternalRequestControlOutputs,
  findInternalControlsInGeneratedOutputs,
} from "./internal-request-control-output-check";
import { defineInventoriedGeneratorConfig } from "../../lib/api-spec/api-output-inventory.mjs";

test("an Orval target without inventoried source and published outputs fails closed", () => {
  assert.throws(
    () => defineInventoriedGeneratorConfig({
      "api-client-react": {},
      zod: {},
      "future-client": {},
    }),
    /future-client: add both source and published outputs to apiOutputInventory\.generators/,
  );
});

test("stale or alternate generated output exposes a clear internal-control failure", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "internal-control-output-"));
  const generatedDirectory = path.join(temporaryRoot, "alternate-client");
  await mkdir(generatedDirectory);
  await writeFile(
    path.join(generatedDirectory, "stale-client.ts"),
    'export const headers = { "X-Fixture-Internal": value };\n',
  );
  const controls = [{
    transport: "header",
    name: "x-fixture-internal",
    purpose: "fixture",
  }] as const;

  try {
    assert.deepEqual(
      await findInternalControlsInGeneratedOutputs(
        temporaryRoot,
        ["alternate-client"],
        controls,
      ),
      ["alternate-client/stale-client.ts exposes x-fixture-internal"],
    );
    await assert.rejects(
      checkInternalRequestControlOutputs(
        temporaryRoot,
        ["alternate-client"],
        controls,
      ),
      /Generated API or public documentation output exposes internal request controls[\s\S]*stale-client\.ts exposes x-fixture-internal/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});