import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTROL_NAMES = new Set(["Input", "Textarea", "Select", "input", "textarea", "select"]);

type Control = {
  file: string;
  line: number;
  name: string;
  node: ts.JsxElement | ts.JsxSelfClosingElement;
  opening: ts.JsxOpeningLikeElement;
  sourceFile: ts.SourceFile;
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function isEducationScope(file: string): boolean {
  return /^components\/education(?:\/|-purchases)/.test(file)
    || /^pages\/(?:business-)?education/.test(file)
    || /^pages\/owner\/education/.test(file)
    || /^pages\/admin\/education/.test(file);
}

function jsxName(node: ts.JsxTagNameExpression): string {
  return node.getText();
}

function openingOf(node: ts.Node): ts.JsxOpeningLikeElement | undefined {
  if (ts.isJsxSelfClosingElement(node)) return node;
  if (ts.isJsxElement(node)) return node.openingElement;
  return undefined;
}

function attributeValue(opening: ts.JsxOpeningLikeElement, name: string, sourceFile: ts.SourceFile): string | undefined {
  const attribute = opening.attributes.properties.find(
    (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText(sourceFile) === name,
  );
  if (!attribute?.initializer) return undefined;
  if (ts.isStringLiteral(attribute.initializer)) return `literal:${attribute.initializer.text}`;
  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) return undefined;
  const expression = attribute.initializer.expression;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return `literal:${expression.text}`;
  return `expression:${expression.getText(sourceFile).replace(/\s+/g, "")}`;
}

function descendants(node: ts.Node, predicate: (candidate: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (candidate: ts.Node) => {
    if (predicate(candidate)) found.push(candidate);
    candidate.forEachChild(visit);
  };
  node.forEachChild(visit);
  return found;
}

function controlsIn(path: string): Control[] {
  const file = relative(srcRoot, path).replaceAll("\\", "/");
  const sourceFile = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return descendants(sourceFile, (node) => {
    const opening = openingOf(node);
    return Boolean(opening && CONTROL_NAMES.has(jsxName(opening.tagName)));
  }).map((node) => {
    const opening = openingOf(node)!;
    return {
      file,
      line: sourceFile.getLineAndCharacterOfPosition(opening.getStart(sourceFile)).line + 1,
      name: jsxName(opening.tagName),
      node: node as ts.JsxElement | ts.JsxSelfClosingElement,
      opening,
      sourceFile,
    };
  });
}

function descriptorFor(control: Control): string | undefined {
  if (control.name !== "Select") {
    return attributeValue(control.opening, "aria-describedby", control.sourceFile);
  }
  const triggers = descendants(control.node, (node) => {
    const opening = openingOf(node);
    return Boolean(opening && jsxName(opening.tagName) === "SelectTrigger");
  });
  if (triggers.length !== 1) return undefined;
  return attributeValue(openingOf(triggers[0])!, "aria-describedby", control.sourceFile);
}

function hasMatchingHelpInLogicalBlock(control: Control, descriptor: string): boolean {
  // A logical field block is the first JSX wrapper above the control which
  // contains its exactly-linked help. We deliberately stop before form/page
  // containers so an unrelated help elsewhere cannot satisfy the control.
  let ancestor: ts.Node | undefined = control.node.parent;
  let jsxDepth = 0;
  while (ancestor && jsxDepth < 5) {
    if (ts.isJsxElement(ancestor)) {
      jsxDepth += 1;
      const matchingHelp = descendants(ancestor, (node) => {
        const opening = openingOf(node);
        return Boolean(
          opening
          && jsxName(opening.tagName) === "EducationFieldHelp"
          && attributeValue(opening, "id", control.sourceFile) === descriptor,
        );
      });
      if (matchingHelp.length === 1) return true;
      if (matchingHelp.length > 1) return false;
    }
    ancestor = ancestor.parent;
  }
  return false;
}

test("every Education data-entry control has exactly linked EducationFieldHelp", () => {
  const files = sourceFiles(srcRoot).filter((path) => isEducationScope(relative(srcRoot, path).replaceAll("\\", "/")));
  const controls = files.flatMap(controlsIn);

  const missing = controls.filter((control) => {
    const descriptor = descriptorFor(control);
    return !descriptor || !hasMatchingHelpInLogicalBlock(control, descriptor);
  }).map((control) => `${control.file}:${control.line} <${control.name}>`);

  assert.deepEqual(missing, [], `Education controls without exactly linked EducationFieldHelp:\n${missing.join("\n")}`);
});

test("known high-risk Education forms use linked accessible help", () => {
  const expectations: Record<string, string[]> = {
    "pages/business-education-resources.tsx": ["resource-name-help", "resource-type-help", "resource-capacity-help"],
    "pages/business-education-inventory.tsx": ["inventory-name-help", "inventory-quantity-help", "inventory-unit-help"],
    "pages/business-education-bundles.tsx": ["bundle-name-help", "bundle-description-help", "bundle-price-help", "bundle-courses-help", "bundle-published-help"],
    "pages/business-education-ai-assistant.tsx": ["education-assistant-question-help"],
  };
  for (const [file, ids] of Object.entries(expectations)) {
    const controls = controlsIn(join(srcRoot, file));
    const descriptors = controls.map(descriptorFor);
    for (const id of ids) {
      const normalized = `literal:${id}`;
      assert.equal(descriptors.filter((descriptor) => descriptor === normalized).length, 1, `${file} must link exactly one control to ${id}`);
      assert.ok(controls.some((control) => descriptorFor(control) === normalized && hasMatchingHelpInLogicalBlock(control, normalized)), `${file} must render ${id} in that field block`);
    }
  }
});