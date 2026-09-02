import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { businessGuide } from "./business-guide-content.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");

const navigationFiles = [
  "artifacts/beauty-marketplace/src/components/business-navbar.tsx",
  "artifacts/beauty-marketplace/src/pages/owner/dashboard.tsx",
  "artifacts/beauty-marketplace/src/pages/employee/portal.tsx",
];
const guideHelpLinkPath =
  "artifacts/beauty-marketplace/src/components/guide-help-link.tsx";

function collectContextualGuideIds(source: string): string[] {
  const ids = new Set<string>();

  for (const match of source.matchAll(/\bguideId\s*:\s*"([^"]+)"/g)) {
    ids.add(match[1]!);
  }

  for (const match of source.matchAll(
    /<GuideHelpLink\b(?:(?!\/>)[\s\S])*?\bsectionId\s*=\s*"([^"]+)"(?:(?!\/>)[\s\S])*?\/>/g,
  )) {
    ids.add(match[1]!);
  }

  return [...ids];
}

function guideSectionIds(): Set<string> {
  return new Set(
    businessGuide.chapters.flatMap((chapter) =>
      chapter.sections.map((section) => section.id),
    ),
  );
}

test("all owner and employee contextual guide links target existing guide sections", () => {
  const guideHelpLinkSource = fs.readFileSync(
    path.join(repositoryRoot, guideHelpLinkPath),
    "utf8",
  );
  assert.match(
    guideHelpLinkSource,
    /href=\{`\/biznis\/vodic#\$\{sectionId\}`\}/u,
    "GuideHelpLink must keep contextual links on the business guide route and preserve the section hash",
  );

  const guideIds = new Map<string, string[]>();

  for (const relativePath of navigationFiles) {
    const filePath = path.join(repositoryRoot, relativePath);
    assert.ok(fs.existsSync(filePath), `Navigation source is missing: ${relativePath}`);

    const ids = collectContextualGuideIds(fs.readFileSync(filePath, "utf8"));
    guideIds.set(relativePath, ids);
  }

  const referencedIds = [...new Set([...guideIds.values()].flat())];
  const knownSectionIds = guideSectionIds();
  const missingIds = referencedIds.filter((id) => !knownSectionIds.has(id));

  assert.ok(
    referencedIds.length > 0,
    "Expected owner and employee navigation to contain contextual guide links",
  );
  assert.deepEqual(
    missingIds,
    [],
    `Contextual guide links reference missing business guide section(s): ${missingIds.join(", ")}`,
  );

  const details = [...guideIds.entries()]
    .map(([file, ids]) => `${file}: ${ids.join(", ")}`)
    .join("\n");
  console.log(`Validated ${referencedIds.length} contextual guide section ID(s):\n${details}`);
});