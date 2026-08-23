import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(scriptDirectory, "../../api-zod/src/index.ts");
const generatedApiPath = path.resolve(scriptDirectory, "../../api-zod/src/generated/api.ts");
const generatedClientSchemasPath = path.resolve(
  scriptDirectory,
  "../../api-client-react/src/generated/api.schemas.ts",
);
const generatedClientApiPath = path.resolve(
  scriptDirectory,
  "../../api-client-react/src/generated/api.ts",
);
const openApiPath = path.resolve(scriptDirectory, "../openapi.yaml");

function operationBodyName(operationId) {
  return `${operationId.charAt(0).toUpperCase()}${operationId.slice(1)}Body`;
}

function makeObjectStrict(source, exportName) {
  const marker = `export const ${exportName} = zod.object(`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return source;

  const expressionStart = markerIndex + marker.indexOf("zod.object(");
  let depth = 0;
  let quote;
  let escaped = false;
  for (let index = expressionStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character !== ")") continue;
    depth -= 1;
    if (depth !== 0) continue;
    if (source.slice(index + 1, index + 10).startsWith(".strict()")) return source;
    return `${source.slice(0, index + 1)}.strict()${source.slice(index + 1)}`;
  }
  throw new Error(`Could not find the end of generated schema ${exportName}`);
}

const specification = await readFile(openApiPath, "utf8");
const strictAdminBodies = new Set();
let currentPath = "";
for (const line of specification.split("\n")) {
  const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
  if (pathMatch) {
    currentPath = pathMatch[1];
    continue;
  }
  const operationMatch = line.match(/^\s{6}operationId:\s*(\S+)\s*$/);
  if (operationMatch && currentPath.startsWith("/admin/")) {
    strictAdminBodies.add(operationBodyName(operationMatch[1]));
  }
}

let generatedApi = await readFile(generatedApiPath, "utf8");
// Orval 8 may emit the Zod 4-only z.int() helper for OpenAPI integer fields,
// while this workspace intentionally uses Zod 3. Keep generated contracts
// runtime-compatible without weakening integer validation.
generatedApi = generatedApi.replace(/\bzod\.int\(\)/g, "zod.number().int()");
// Orval 8 may also emit Zod 4's top-level z.url() for URI-formatted strings.
// Zod 3 exposes the same validation on the string schema.
generatedApi = generatedApi.replace(/\bzod\.url\(\)/g, "zod.string().url()");
for (const bodyName of strictAdminBodies) {
  generatedApi = makeObjectStrict(generatedApi, bodyName);
}

await writeFile(indexPath, 'export * from "./generated/api";\n', "utf8");
await writeFile(generatedApiPath, `${generatedApi.trimEnd()}\n`, "utf8");
const generatedClientSchemas = await readFile(generatedClientSchemasPath, "utf8");
await writeFile(
  generatedClientSchemasPath,
  `${generatedClientSchemas.trimEnd()}\n`,
  "utf8",
);
const generatedClientApi = await readFile(generatedClientApiPath, "utf8");
await writeFile(
  generatedClientApiPath,
  `${generatedClientApi.trimEnd()}\n`,
  "utf8",
);