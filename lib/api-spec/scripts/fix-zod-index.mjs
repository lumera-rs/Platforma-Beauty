import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(scriptDirectory, "../../api-zod/src/index.ts");

await writeFile(indexPath, 'export * from "./generated/api";\n', "utf8");