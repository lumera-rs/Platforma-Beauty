import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyMigrationContract } from "./contract";

export interface CliArguments {
  currentDir: string;
  referenceDir: string;
}

export function parseArguments(argumentsToParse: string[]): CliArguments {
  const values = new Map<string, string>();
  for (const argument of argumentsToParse) {
    const match = /^--(current-dir|reference-dir)=(.+)$/.exec(argument);
    if (!match) throw new Error(`Unknown or incomplete argument: ${argument}`);
    if (values.has(match[1]!)) throw new Error(`Duplicate argument: --${match[1]}`);
    values.set(match[1]!, match[2]!);
  }
  const currentDir = values.get("current-dir");
  const referenceDir = values.get("reference-dir");
  if (!currentDir || !referenceDir) {
    throw new Error("Both --current-dir and --reference-dir are required");
  }
  return { currentDir: resolve(currentDir), referenceDir: resolve(referenceDir) };
}

export async function main(argumentsToParse = process.argv.slice(2)): Promise<number> {
  try {
    const { currentDir, referenceDir } = parseArguments(argumentsToParse);
    const result = await verifyMigrationContract(currentDir, referenceDir);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      migrations: result.current.map(({ directory, sequence, sha256 }) => ({
        directory,
        sequence,
        sha256,
      })),
      protectedMigrations: result.reference.length,
    }, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Migration contract verification failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}