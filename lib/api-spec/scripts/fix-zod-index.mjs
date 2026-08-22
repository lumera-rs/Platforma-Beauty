import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(scriptDirectory, "../../api-zod/src/index.ts");
const generatedPaths = [
  path.resolve(scriptDirectory, "../../api-zod/src/generated/api.ts"),
  path.resolve(scriptDirectory, "../../api-client-react/src/generated/api.schemas.ts"),
];

await writeFile(indexPath, 'export * from "./generated/api";\n', "utf8");
await Promise.all(generatedPaths.map(async (generatedPath) => {
  const content = await readFile(generatedPath, "utf8");
  await writeFile(generatedPath, `${content.trimEnd()}\n`, "utf8");
}));