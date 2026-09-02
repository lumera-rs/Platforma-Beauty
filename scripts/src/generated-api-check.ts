import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");
const apiSpecDirectory = path.join(root, "lib", "api-spec");
const sourceContract = path.join("lib", "api-spec", "openapi.yaml");

const generatedArtifacts = [
  {
    label: path.join("lib", "api-zod", "src", "generated"),
    relativePath: path.join("lib", "api-zod", "src", "generated"),
  },
  {
    label: path.join("lib", "api-client-react", "src", "generated"),
    relativePath: path.join("lib", "api-client-react", "src", "generated"),
  },
] as const;

type GeneratedFile = {
  relativePath: string;
  absolutePath: string;
};

async function listFiles(directory: string, relativeDirectory = ""): Promise<GeneratedFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: GeneratedFile[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push({ relativePath, absolutePath });
    }
  }

  return files;
}

async function runCodegen(outputRoot: string): Promise<void> {
  const environment = {
    ...process.env,
    API_CODEGEN_OUTPUT_ROOT: outputRoot,
  };

  try {
    const temporaryClientSource = path.join(outputRoot, "lib", "api-client-react", "src");
    await mkdir(temporaryClientSource, { recursive: true });
    await cp(
      path.join(root, "lib", "api-client-react", "src", "custom-fetch.ts"),
      path.join(temporaryClientSource, "custom-fetch.ts"),
    );
    await execFileAsync(
      "pnpm",
      ["exec", "orval", "--config", "./orval.config.ts"],
      { cwd: apiSpecDirectory, env: environment, maxBuffer: 10 * 1024 * 1024 },
    );
    await execFileAsync(
      process.execPath,
      ["./scripts/fix-zod-index.mjs"],
      { cwd: apiSpecDirectory, env: environment, maxBuffer: 10 * 1024 * 1024 },
    );
  } catch (error) {
    const details = error as { stdout?: string; stderr?: string; message?: string };
    const output = [details.stdout, details.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      [
        `Could not regenerate API artifacts from ${sourceContract}.`,
        output || details.message || String(error),
      ].join("\n"),
    );
  }
}

async function compareArtifact(
  artifact: (typeof generatedArtifacts)[number],
  outputRoot: string,
): Promise<string[]> {
  const checkedInDirectory = path.join(root, artifact.relativePath);
  const regeneratedDirectory = path.join(outputRoot, artifact.relativePath);
  const [checkedInFiles, regeneratedFiles] = await Promise.all([
    listFiles(checkedInDirectory),
    listFiles(regeneratedDirectory),
  ]);
  const checkedInByPath = new Map(checkedInFiles.map((file) => [file.relativePath, file]));
  const regeneratedByPath = new Map(regeneratedFiles.map((file) => [file.relativePath, file]));
  const mismatches: string[] = [];

  for (const relativePath of new Set([...checkedInByPath.keys(), ...regeneratedByPath.keys()])) {
    const checkedInFile = checkedInByPath.get(relativePath);
    const regeneratedFile = regeneratedByPath.get(relativePath);
    if (!checkedInFile) {
      mismatches.push(`${artifact.label}/${relativePath} (missing from checked-in output)`);
      continue;
    }
    if (!regeneratedFile) {
      mismatches.push(`${artifact.label}/${relativePath} (extra in checked-in output)`);
      continue;
    }

    const [checkedInContents, regeneratedContents] = await Promise.all([
      readFile(checkedInFile.absolutePath),
      readFile(regeneratedFile.absolutePath),
    ]);
    if (!checkedInContents.equals(regeneratedContents)) {
      mismatches.push(`${artifact.label}/${relativePath}`);
    }
  }

  return mismatches;
}

export async function checkGeneratedApiContracts(): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(root, ".tmp-generated-api-"));
  try {
    await runCodegen(temporaryRoot);
    const mismatches = (
      await Promise.all(generatedArtifacts.map((artifact) => compareArtifact(artifact, temporaryRoot)))
    ).flat();

    if (mismatches.length > 0) {
      throw new Error(
        [
          `Generated API artifacts are stale relative to ${sourceContract}.`,
          "Affected generated artifacts:",
          ...mismatches.map((mismatch) => `  - ${mismatch}`),
          "Run `pnpm --filter @workspace/api-spec run codegen` to refresh them.",
        ].join("\n"),
      );
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await checkGeneratedApiContracts();
  console.log("Generated API artifacts match lib/api-spec/openapi.yaml.");
}