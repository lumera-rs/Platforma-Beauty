import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiSrcRoot = join(srcRoot, "../../api-server/src");
const BANNED_USER_VISIBLE_TERMS = /\b(?:AI|LMS|ICS)\b/i;
const HAS_AUDITED_FOREIGN_TERM = /\b(?:AI|LMS|ICS|B2B|RSD|HTML)\b/i;
const AUDITED_FOREIGN_TERMS = /\b(?:AI|LMS|ICS|B2B|RSD|HTML)\b/gi;

// These terms are intentionally retained because translating them would obscure
// established commercial or technical standards.
const INTENTIONAL_FOREIGN_TERM_ALLOWLIST: Readonly<Record<string, string>> = {
  B2B: "Established business-to-business commercial abbreviation used throughout the product.",
  RSD: "ISO 4217 currency code required for unambiguous Serbian dinar amounts.",
  HTML: "W3C markup-language standard referenced when authors may enter formatted lesson content.",
};

const USER_FACING_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "description",
  "label",
  "placeholder",
  "text",
  "title",
]);
const USER_FACING_PROPERTIES = new Set([
  "copy",
  "desc",
  "description",
  "error",
  "grounding",
  "label",
  "reply",
  "text",
  "title",
]);

type VisibleText = {
  file: string;
  line: number;
  text: string;
};

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });
}

function frontendEducationFile(file: string): boolean {
  const path = relative(srcRoot, file).replaceAll("\\", "/");
  return /^components\/education(?:\/|-purchases)/.test(path)
    || path === "components/education-center-navigation.tsx"
    || path === "lib/education-center-navigation.ts"
    || /^pages\/(?:business-)?education/.test(path)
    || /^pages\/business-landing-education/.test(path)
    || /^pages\/owner\/education/.test(path)
    || /^pages\/admin\/education/.test(path);
}

function apiEducationFile(file: string): boolean {
  const path = relative(apiSrcRoot, file).replaceAll("\\", "/");
  return path === "routes/marketplace.ts"
    || path === "lib/business-guide-content.ts"
    || /^(?:lib|routes)\/education[^/]*\.ts$/.test(path);
}

function propertyName(node: ts.PropertyAssignment): string {
  return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
}

function callName(node: ts.CallExpression): string {
  return node.expression.getText().replace(/\s+/g, "");
}

function isTechnicalLiteral(node: ts.Node, text: string): boolean {
  if (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) return true;
  if (ts.isPropertyAssignment(node.parent)) {
    if (node.parent.name === node) return true;
    if (["guideId", "id", "queryKey"].includes(propertyName(node.parent))) return true;
  }
  return text.startsWith("/")
    || /^[a-z]+:\/\//i.test(text)
    || /(?:^|\/)[^\s]*\.(?:ics|tsx?|jsx?)$/i.test(text)
    || /(?:[?&]format=ics\b|filename\s*=.*\.ics\b)/i.test(text);
}

function collectVisibleText(file: string, displayRoot: string): VisibleText[] {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: VisibleText[] = [];

  const record = (node: ts.Node, text: string) => {
    if (!text.trim()) return;
    found.push({
      file: relative(displayRoot, file).replaceAll("\\", "/"),
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      text: text.trim(),
    });
  };

  const visit = (node: ts.Node) => {
    const templateText = ts.isTemplateExpression(node)
      ? node.head.text + node.templateSpans.map((span) => `\${…}${span.literal.text}`).join("")
      : null;
    if (ts.isJsxText(node)) {
      record(node, node.text);
    } else if (ts.isJsxAttribute(node) && USER_FACING_ATTRIBUTES.has(node.name.getText(sourceFile))) {
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteral(initializer)) record(initializer, initializer.text);
      if (
        initializer
        && ts.isJsxExpression(initializer)
        && initializer.expression
        && (ts.isStringLiteral(initializer.expression) || ts.isNoSubstitutionTemplateLiteral(initializer.expression))
      ) {
        record(initializer.expression, initializer.expression.text);
      }
    } else if (ts.isPropertyAssignment(node) && USER_FACING_PROPERTIES.has(propertyName(node))) {
      const value = node.initializer;
      if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) record(value, value.text);
    } else if (
      ts.isCallExpression(node)
      && /^(?:toast\.(?:error|success|info|warning)|window\.prompt|Error)$/.test(callName(node))
    ) {
      for (const argument of node.arguments) {
        if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) record(argument, argument.text);
      }
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      && HAS_AUDITED_FOREIGN_TERM.test(node.text)
      && !isTechnicalLiteral(node, node.text)
    ) {
      record(node, node.text);
    } else if (
      templateText
      && HAS_AUDITED_FOREIGN_TERM.test(templateText)
      && !isTechnicalLiteral(node, templateText)
    ) {
      record(node, templateText);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

test("Education user-facing source contains no untranslated AI, LMS or ICS tokens", () => {
  assert.deepEqual(
    Object.keys(INTENTIONAL_FOREIGN_TERM_ALLOWLIST).sort(),
    ["B2B", "HTML", "RSD"],
    "The allowlist may contain only approved commercial abbreviations and unavoidable standards.",
  );
  for (const [term, rationale] of Object.entries(INTENTIONAL_FOREIGN_TERM_ALLOWLIST)) {
    assert.ok(rationale.length >= 30, `${term} must have a specific allowlist rationale.`);
  }

  const frontendFiles = filesBelow(srcRoot).filter(frontendEducationFile);
  const apiFiles = filesBelow(apiSrcRoot).filter(apiEducationFile);
  const visibleText = [
    ...frontendFiles.flatMap((file) => collectVisibleText(file, srcRoot)),
    ...apiFiles.flatMap((file) => collectVisibleText(file, apiSrcRoot)),
  ];
  const violations: string[] = [];

  for (const item of visibleText) {
    if (BANNED_USER_VISIBLE_TERMS.test(item.text)) {
      violations.push(`${item.file}:${item.line}: ${JSON.stringify(item.text)}`);
    }
    for (const match of item.text.matchAll(AUDITED_FOREIGN_TERMS)) {
      const term = match[0].toUpperCase();
      if (!BANNED_USER_VISIBLE_TERMS.test(term)) {
        assert.ok(
          INTENTIONAL_FOREIGN_TERM_ALLOWLIST[term],
          `${item.file}:${item.line}: ${term} needs an explicit standards rationale or a Serbian translation.`,
        );
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Translate banned Education terms in user-facing JSX, literals, or API errors:\n${violations.join("\n")}`,
  );
});