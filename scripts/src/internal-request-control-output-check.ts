import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  apiOutputInventory,
} from "../../lib/api-spec/api-output-inventory.mjs";

const root = path.resolve(import.meta.dirname, "../..");

type InternalRequestControl = Readonly<{
  transport: "header" | "query" | "path" | "cookie" | "body";
  name: string;
  purpose: string;
}>;

async function loadInternalRequestControls(): Promise<readonly InternalRequestControl[]> {
  const moduleUrl = pathToFileURL(path.join(
    root,
    "artifacts/api-server/src/lib/internal-request-controls.ts",
  )).href;
  const inventory = await import(moduleUrl) as {
    internalRequestControls: readonly InternalRequestControl[];
  };
  return inventory.internalRequestControls;
}

export const publicApiDocumentationOutputs = [
  ...apiOutputInventory.publicDocumentation,
] as const;

export const generatedApiSourceOutputs = Object.values(apiOutputInventory.generators)
  .map((output) => output.source);

export const generatedApiPublishedOutputs = [
  ...publicApiDocumentationOutputs,
  ...generatedApiSourceOutputs,
  ...Object.values(apiOutputInventory.generators).map((output) => output.published),
];

async function listFiles(target: string): Promise<string[]> {
  const entries = await readdir(target, { withFileTypes: true });
  return (
    await Promise.all(entries.map(async (entry) => {
      const child = path.join(target, entry.name);
      return entry.isDirectory() ? listFiles(child) : entry.isFile() ? [child] : [];
    }))
  ).flat();
}

export async function findInternalControlsInGeneratedOutputs(
  outputRoot: string,
  relativeOutputs: readonly string[],
  controls: readonly InternalRequestControl[],
): Promise<string[]> {
  const findings: string[] = [];
  for (const relativeOutput of relativeOutputs) {
    const absoluteOutput = path.resolve(outputRoot, relativeOutput);
    const outputStat = await stat(absoluteOutput);
    const files = outputStat.isDirectory() ? await listFiles(absoluteOutput) : [absoluteOutput];
    for (const file of files) {
      const contents = (await readFile(file, "utf8")).toLowerCase();
      for (const control of controls) {
        if (contents.includes(control.name.toLowerCase())) {
          findings.push(`${path.relative(outputRoot, file)} exposes ${control.name}`);
        }
      }
    }
  }
  return findings.sort();
}

export async function checkInternalRequestControlOutputs(
  outputRoot = root,
  relativeOutputs: readonly string[] = generatedApiPublishedOutputs,
  controls?: readonly InternalRequestControl[],
): Promise<void> {
  const resolvedControls = controls ?? await loadInternalRequestControls();
  const findings = await findInternalControlsInGeneratedOutputs(
    outputRoot,
    relativeOutputs,
    resolvedControls,
  );
  if (findings.length > 0) {
    throw new Error([
      "Generated API or public documentation output exposes internal request controls.",
      ...findings.map((finding) => `  - ${finding}`),
      "Regenerate the API outputs and remove internal controls from the public contract before publishing.",
    ].join("\n"));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  if (process.argv.includes("--codegen")) {
    const codegenOutputRoot = process.env.API_CODEGEN_OUTPUT_ROOT
      ? path.resolve(process.env.API_CODEGEN_OUTPUT_ROOT)
      : root;
    await checkInternalRequestControlOutputs(codegenOutputRoot, generatedApiSourceOutputs);
    await checkInternalRequestControlOutputs(root, publicApiDocumentationOutputs);
  } else {
    await checkInternalRequestControlOutputs(root, generatedApiPublishedOutputs);
  }
  console.log("Generated API and public documentation outputs contain no internal request controls.");
}