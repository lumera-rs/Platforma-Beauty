import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../routes/marketplace.ts", import.meta.url), "utf8");
// Every authoring mutation resolves its target through the center-only helper.
for (const route of [
  "gallery/upload-url", "/gallery", "/featured", "/instructor", "/days",
  "/modules", "/lessons", "/sessions", "/publish",
]) assert.match(source, new RegExp(`(?:requireOwnedCourse|requireOwnedEducationCenterCourse)[\\s\\S]{0,600}${route.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}|${route.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}[\\s\\S]{0,900}(?:requireOwnedCourse|requireOwnedEducationCenterCourse)`));
assert.match(source, /if \(!course\.centerId \|\| \(!access\.admin && !\(await canManageEducationCourses\(access, course\.centerId\)\)\)\)/);
console.log("education course authoring isolation tests passed");