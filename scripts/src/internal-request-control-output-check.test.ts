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

test("an auxiliary Orval output outside its inventoried source root fails closed", () => {
  const fixtureRoot = path.resolve(os.tmpdir(), "orval-output-inventory-fixture");

  assert.throws(
    () => defineInventoriedGeneratorConfig({
      "api-client-react": {
        output: {
          workspace: path.resolve(fixtureRoot, "lib/api-client-react/src"),
          target: "generated",
        },
      },
      zod: {
        output: {
          workspace: path.resolve(fixtureRoot, "lib/api-zod/src"),
          target: "generated",
          schemas: { path: "../escaped-schemas", type: "typescript" },
          operationSchemas: "../escaped-operation-schemas",
          mock: {
            path: "../escaped-mocks",
            generators: [
              { type: "faker", path: "../escaped-faker-mocks" },
            ],
          },
        },
      },
    }, fixtureRoot),
    /Orval output paths are not covered[\s\S]*zod output\.schemas:[\s\S]*zod output\.operationSchemas:[\s\S]*zod output\.mock\.path:[\s\S]*zod output\.mock\.generators\[0\]\.path:[\s\S]*outside inventoried source root/,
  );
});

test("an Orval target outside its inventoried source root fails closed", () => {
  const fixtureRoot = path.resolve(os.tmpdir(), "orval-target-inventory-fixture");

  assert.throws(
    () => defineInventoriedGeneratorConfig({
      "api-client-react": {
        output: {
          workspace: path.resolve(fixtureRoot, "lib/api-client-react/src"),
          target: "../escaped-client",
        },
      },
      zod: {
        output: {
          workspace: path.resolve(fixtureRoot, "lib/api-zod/src"),
          target: "generated",
        },
      },
    }, fixtureRoot),
    /api-client-react output\.workspace \+ target:[\s\S]*outside inventoried source root/,
  );
});

test("current split React and Zod output layouts stay covered", () => {
  const fixtureRoot = path.resolve(os.tmpdir(), "orval-output-inventory-current");

  assert.doesNotThrow(() => defineInventoriedGeneratorConfig({
    "api-client-react": {
      output: {
        workspace: path.resolve(fixtureRoot, "lib/api-client-react/src"),
        target: "generated",
        mode: "split",
      },
    },
    zod: {
      output: {
        workspace: path.resolve(fixtureRoot, "lib/api-zod/src"),
        target: "generated",
        schemas: { path: "generated/types", type: "typescript" },
        mock: {
          path: "generated/mocks",
          generators: [
            { type: "faker", path: "generated/faker-mocks" },
          ],
        },
        mode: "split",
      },
    },
  }, fixtureRoot));
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