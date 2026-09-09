import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import cookieParser from "cookie-parser";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import ts from "typescript";
import { parse as parseYaml } from "yaml";
import {
  denyInternalRequestControlErrors,
  denyInternalRequestControlsInProduction,
  internalRequestControls,
  makeDenyInternalRequestControlsInProduction,
  readInternalRequestControl,
  type InternalRequestControl,
} from "./internal-request-controls";

const INTERNAL_HEADER_NAME = /\bx-[a-z0-9-]*(?:test|testing|debug|diagnostic|observation|regression|qa|fault)[a-z0-9-]*\b/gi;
const TEST_ONLY_SIGNAL =
  /(?:\b[A-Za-z_$]\w*(?:Test|Testing|Diagnostic|Observation|Regression|QA|Fault)\w*(?:Runtime|Allowed|Enabled|Harness|Marker|Fixture|Control)\w*\b|NODE_ENV\s*(?:===|==)\s*["']test["'])/;
const REQUEST_OBJECTS = new Set(["req", "request"]);
const REQUEST_TRANSPORTS = new Set([
  "get",
  "header",
  "headers",
  "query",
  "params",
  "cookies",
  "body",
]);
const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

type OpenApiObject = Record<string, unknown>;

function isObject(value: unknown): value is OpenApiObject {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function resolveLocalReference(document: OpenApiObject, value: unknown): unknown {
  if (!isObject(value) || typeof value.$ref !== "string") return value;
  if (!value.$ref.startsWith("#/")) return value;
  return value.$ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>(
      (current, segment) => isObject(current) ? current[segment] : undefined,
      document,
    );
}

export function findInternalControlsInOpenApi(
  document: OpenApiObject,
  controls: readonly InternalRequestControl[],
): string[] {
  const findings = new Set<string>();
  const parameterControls = controls.filter((control) => control.transport !== "body");
  const bodyNames = new Set(
    controls
      .filter((control) => control.transport === "body")
      .map((control) => control.name),
  );

  const inspectParameters = (parameters: unknown, location: string): void => {
    if (!Array.isArray(parameters)) return;
    for (const unresolved of parameters) {
      const parameter = resolveLocalReference(document, unresolved);
      if (!isObject(parameter) || typeof parameter.name !== "string") continue;
      for (const control of parameterControls) {
        const expectedTransport = control.transport === "path"
          ? "path"
          : control.transport;
        const namesMatch = control.transport === "header"
          ? parameter.name.toLowerCase() === control.name.toLowerCase()
          : parameter.name === control.name;
        if (parameter.in === expectedTransport && namesMatch) {
          findings.add(`${control.transport}:${control.name} at ${location}`);
        }
      }
    }
  };

  const inspectBodySchema = (
    unresolved: unknown,
    location: string,
    visited = new Set<unknown>(),
  ): void => {
    const schema = resolveLocalReference(document, unresolved);
    if (!isObject(schema) || visited.has(schema)) return;
    visited.add(schema);
    if (isObject(schema.properties)) {
      for (const [name, child] of Object.entries(schema.properties)) {
        if (bodyNames.has(name)) findings.add(`body:${name} at ${location}`);
        inspectBodySchema(child, location, visited);
      }
    }
    inspectBodySchema(schema.items, location, visited);
    for (const keyword of ["allOf", "anyOf", "oneOf", "prefixItems"] as const) {
      const children = schema[keyword];
      if (Array.isArray(children)) {
        for (const child of children) inspectBodySchema(child, location, visited);
      }
    }
    if (isObject(schema.additionalProperties)) {
      inspectBodySchema(schema.additionalProperties, location, visited);
    }
  };

  const paths = document.paths;
  if (!isObject(paths)) return [];
  for (const [route, unresolvedPathItem] of Object.entries(paths)) {
    const pathItem = resolveLocalReference(document, unresolvedPathItem);
    if (!isObject(pathItem)) continue;
    inspectParameters(pathItem.parameters, route);
    for (const [method, unresolvedOperation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      const operation = resolveLocalReference(document, unresolvedOperation);
      if (!isObject(operation)) continue;
      const location = `${method.toUpperCase()} ${route}`;
      inspectParameters(operation.parameters, location);
      const requestBody = resolveLocalReference(document, operation.requestBody);
      if (!isObject(requestBody) || !isObject(requestBody.content)) continue;
      for (const mediaType of Object.values(requestBody.content)) {
        if (isObject(mediaType)) inspectBodySchema(mediaType.schema, location);
      }
    }
  }
  return [...findings].sort();
}

function accessPath(node: ts.Expression): { root: string; segments: string[] } | undefined {
  if (ts.isIdentifier(node)) return { root: node.text, segments: [] };
  if (ts.isPropertyAccessExpression(node)) {
    const parent = accessPath(node.expression);
    return parent && { root: parent.root, segments: [...parent.segments, node.name.text] };
  }
  if (ts.isElementAccessExpression(node) && node.argumentExpression) {
    const parent = accessPath(node.expression);
    const argument = node.argumentExpression;
    const segment = ts.isStringLiteralLike(argument) ? argument.text : "*";
    return parent && { root: parent.root, segments: [...parent.segments, segment] };
  }
  return undefined;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name));
}

function isRequestDerivedExpression(
  node: ts.Expression,
  aliases: ReadonlySet<string>,
): boolean {
  if (ts.isCallExpression(node)) {
    const target = accessPath(node.expression);
    return Boolean(
      target
      && (
        aliases.has(target.root)
        || (
          REQUEST_OBJECTS.has(target.root)
          && target.segments.length === 1
          && (target.segments[0] === "get" || target.segments[0] === "header")
        )
      ),
    );
  }
  const path = accessPath(node);
  if (!path) return false;
  return (
    (REQUEST_OBJECTS.has(path.root)
      && path.segments.length > 0
      && REQUEST_TRANSPORTS.has(path.segments[0]!))
    || aliases.has(path.root)
  );
}

function collectRequestAliases(sourceFile: ts.SourceFile): Set<string> {
  const aliases = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node)
        && node.initializer
        && ts.isObjectBindingPattern(node.name)
      ) {
        const initializerPath = accessPath(node.initializer);
        if (
          initializerPath
          && REQUEST_OBJECTS.has(initializerPath.root)
          && initializerPath.segments.length === 0
        ) {
          for (const element of node.name.elements) {
            const sourceProperty = element.propertyName
              ? element.propertyName.getText().replace(/^["']|["']$/g, "")
              : ts.isIdentifier(element.name) ? element.name.text : undefined;
            if (sourceProperty && REQUEST_TRANSPORTS.has(sourceProperty)) {
              for (const name of bindingNames(element.name)) {
                if (!aliases.has(name)) {
                  aliases.add(name);
                  changed = true;
                }
              }
            }
          }
        }
      }
      if (
        ts.isVariableDeclaration(node)
        && node.initializer
        && (
          isRequestDerivedExpression(node.initializer, aliases)
          || (
            ts.isIdentifier(node.initializer)
            && REQUEST_OBJECTS.has(node.initializer.text)
          )
        )
      ) {
        for (const name of bindingNames(node.name)) {
          if (!aliases.has(name)) {
            aliases.add(name);
            changed = true;
          }
        }
      }
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(node.left)
        && (
          isRequestDerivedExpression(node.right, aliases)
          || (ts.isIdentifier(node.right) && REQUEST_OBJECTS.has(node.right.text))
        )
        && !aliases.has(node.left.text)
      ) {
        aliases.add(node.left.text);
        changed = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return aliases;
}

function containsTestOnlySignal(node: ts.Node, signalAliases: ReadonlySet<string>): boolean {
  let found = TEST_ONLY_SIGNAL.test(node.getText());
  if (found) return true;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(child) && signalAliases.has(child.text)) found = true;
    else ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function statementTerminates(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  return ts.isBlock(statement)
    && statement.statements.length > 0
    && statementTerminates(statement.statements[statement.statements.length - 1]!);
}

export function findUndeclaredTestRequestControlReads(
  source: string,
): Array<{ line: number; text: string }> {
  const sourceFile = ts.createSourceFile(
    "request-control-scan.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const lines = source.split(/\r?\n/);
  const aliases = collectRequestAliases(sourceFile);
  const signalAliases = new Set<string>();
  const findingLines = new Set<number>();
  const findings: Array<{ line: number; text: string }> = [];

  const recordRequestReads = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "readInternalRequestControl"
    ) {
      return;
    }
    if (
      ts.isExpression(node)
      && isRequestDerivedExpression(node, aliases)
    ) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (!findingLines.has(line)) {
        findingLines.add(line);
        findings.push({ line, text: lines[line - 1]!.trim() });
      }
      return;
    }
    ts.forEachChild(node, recordRequestReads);
  };

  const visit = (node: ts.Node, testOnly: boolean): void => {
    if (ts.isBlock(node) || ts.isSourceFile(node)) {
      let guarded = false;
      for (const statement of node.statements) {
        visit(statement, testOnly || guarded);
        if (
          ts.isIfStatement(statement)
          && !statement.elseStatement
          && ts.isPrefixUnaryExpression(statement.expression)
          && statement.expression.operator === ts.SyntaxKind.ExclamationToken
          && containsTestOnlySignal(statement.expression.operand, signalAliases)
          && statementTerminates(statement.thenStatement)
        ) {
          guarded = true;
        }
      }
      return;
    }
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      if (containsTestOnlySignal(node.initializer, signalAliases)) {
        signalAliases.add(node.name.text);
      }
    }
    if (ts.isIfStatement(node)) {
      const gated = containsTestOnlySignal(node.expression, signalAliases);
      if (testOnly || gated) recordRequestReads(node.expression);
      visit(node.thenStatement, testOnly || gated);
      if (node.elseStatement) visit(node.elseStatement, testOnly || gated);
      return;
    }
    if (testOnly) {
      recordRequestReads(node);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, false));
  };

  visit(sourceFile, false);
  return findings.sort((left, right) => left.line - right.line);
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    return [absolute];
  }));
  return files.flat();
}

test("all test and diagnostic request headers are registered at the production boundary", async () => {
  const roots = [
    path.resolve(import.meta.dirname, ".."),
    path.resolve(import.meta.dirname, "../../../../lib/db/src"),
  ];
  const discovered = new Set<string>();

  for (const file of (await Promise.all(roots.map(sourceFiles))).flat()) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(INTERNAL_HEADER_NAME)) {
      discovered.add(match[0].toLowerCase());
    }
  }

  assert.deepEqual(
    [...discovered].sort(),
    internalRequestControls
      .filter((control) => control.transport === "header")
      .map((control) => control.name)
      .sort(),
    "Every test/diagnostic x-* request header must be added to internalRequestControlHeaders",
  );
});

test("test-only request controls are read only through the declared convention", async () => {
  const roots = [
    path.resolve(import.meta.dirname, ".."),
    path.resolve(import.meta.dirname, "../../../../lib/db/src"),
  ];
  const findings: string[] = [];
  for (const file of (await Promise.all(roots.map(sourceFiles))).flat()) {
    const source = await readFile(file, "utf8");
    for (const finding of findUndeclaredTestRequestControlReads(source)) {
      findings.push(`${path.relative(process.cwd(), file)}:${finding.line}: ${finding.text}`);
    }
  }
  assert.deepEqual(
    findings,
    [],
    "Test-only HTTP inputs must be declared and read with readInternalRequestControl()",
  );
});

test("declared internal request controls stay out of the public OpenAPI contract", async () => {
  const openApiPath = path.resolve(
    import.meta.dirname,
    "../../../../lib/api-spec/openapi.yaml",
  );
  const document = parseYaml(await readFile(openApiPath, "utf8")) as OpenApiObject;
  assert.deepEqual(
    findInternalControlsInOpenApi(document, internalRequestControls),
    [],
    "Internal test controls must not appear in OpenAPI parameters or request body schemas",
  );
});

test("OpenAPI contract check catches every internal request-control transport", () => {
  const controls = ([
    { transport: "header", name: "x-fixture", purpose: "fixture" },
    { transport: "query", name: "preview", purpose: "fixture" },
    { transport: "path", name: "scenario", purpose: "fixture" },
    { transport: "cookie", name: "harness", purpose: "fixture" },
    { transport: "body", name: "seed", purpose: "fixture" },
  ] as const) satisfies readonly InternalRequestControl[];
  const document = parseYaml(`
openapi: 3.1.0
paths:
  /probe/{scenario}:
    parameters:
      - in: path
        name: scenario
    post:
      parameters:
        - in: header
          name: X-Fixture
        - in: query
          name: preview
        - in: cookie
          name: harness
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/FixtureBody'
components:
  schemas:
    FixtureBody:
      type: object
      properties:
        nested:
          type: object
          properties:
            seed:
              type: string
`) as OpenApiObject;

  assert.deepEqual(findInternalControlsInOpenApi(document, controls), [
    "body:seed at POST /probe/{scenario}",
    "cookie:harness at POST /probe/{scenario}",
    "header:x-fixture at POST /probe/{scenario}",
    "path:scenario at /probe/{scenario}",
    "query:preview at POST /probe/{scenario}",
  ]);
});

test("repository check catches disguised controls in every request transport", () => {
  for (const expression of [
    'req.get("feature-mode")',
    "req.query.preview",
    "req.params.fixture",
    'req.cookies["scenario"]',
    "req.body.seed",
  ]) {
    const source = `if (isRegressionRuntimeAllowed()) {\n  const value = ${expression};\n}`;
    assert.equal(
      findUndeclaredTestRequestControlReads(source).length,
      1,
      `${expression} must be reported even without a suspicious name`,
    );
  }
});

test("repository check resists formatting, aliases, destructuring, and guard-clause evasion", () => {
  const fixtures = [
    `if (isRegressionRuntimeAllowed()) {
      const one = 1;
      const two = 2;
      const three = 3;
      const four = 4;
      const five = 5;
      const six = 6;
      const value = req.query.ordinary;
    }`,
    `const queryAlias = req?.["query"];
    if (isRegressionRuntimeAllowed()) {
      const value = queryAlias["ordinary"];
    }`,
    `if (isRegressionRuntimeAllowed()) {
      const { ordinary } = req.body;
    }`,
    `const { query } = req;
    if (isRegressionRuntimeAllowed()) {
      const value = query.preview;
    }`,
    `const { query: q } = request;
    if (isRegressionRuntimeAllowed()) {
      const value = q.preview;
    }`,
    `const { headers: incomingHeaders } = req;
    if (isRegressionRuntimeAllowed()) {
      const value = incomingHeaders["feature-mode"];
    }`,
    `const requestAlias = req;
    if (isRegressionRuntimeAllowed()) {
      const value = requestAlias.body.ordinary;
    }`,
    `const { get: getHeader } = request;
    if (isRegressionRuntimeAllowed()) {
      const value = getHeader("feature-mode");
    }`,
    `if (!isRegressionRuntimeAllowed()) return;
    const one = 1;
    const two = 2;
    const value = request?.params?.ordinary;`,
    `const harnessEnabled = isRegressionRuntimeAllowed();
    if (harnessEnabled) {
      const cookies = request.cookies;
      const value = cookies.ordinary;
    }`,
  ];
  for (const source of fixtures) {
    assert.ok(
      findUndeclaredTestRequestControlReads(source).length > 0,
      `expected an undeclared control finding for:\n${source}`,
    );
  }
  assert.deepEqual(
    findUndeclaredTestRequestControlReads(
      `if (isRegressionRuntimeAllowed()) {
        const value = readInternalRequestControl(req, declaredControl);
      }`,
    ),
    [],
    "declared controls read through the shared helper must remain allowed",
  );
});

test("the centralized reader supports every declared request transport", () => {
  const req = {
    get: (name: string) => name === "ordinary" ? "header-value" : undefined,
    query: { ordinary: "query-value" },
    params: { ordinary: "path-value" },
    cookies: { ordinary: "cookie-value" },
    body: { ordinary: "body-value" },
  } as unknown as Request;
  const expected = {
    header: "header-value",
    query: "query-value",
    path: "path-value",
    cookie: "cookie-value",
    body: "body-value",
  } as const;
  for (const [transport, value] of Object.entries(expected)) {
    const control: InternalRequestControl = {
      transport: transport as InternalRequestControl["transport"],
      name: "ordinary",
      purpose: "transport coverage fixture",
    };
    assert.equal(readInternalRequestControl(req, control), value);
  }
});

test("a real production Express pipeline denies every request transport", async () => {
  const controls = ([
    { transport: "header", name: "ordinary-header", purpose: "pipeline fixture" },
    { transport: "query", name: "ordinaryQuery", purpose: "pipeline fixture" },
    { transport: "path", name: "ordinaryPath", purpose: "pipeline fixture" },
    { transport: "cookie", name: "ordinaryCookie", purpose: "pipeline fixture" },
    { transport: "body", name: "ordinaryBody", purpose: "pipeline fixture" },
  ] as const) satisfies readonly InternalRequestControl[];
  const denyFixtureControls = makeDenyInternalRequestControlsInProduction(controls);
  const pathControl = controls.find((control) => control.transport === "path")!;
  const app = express();
  app.use(denyFixtureControls);
  app.use(cookieParser());
  app.use(express.json());
  app.use(denyFixtureControls);
  app.all("/probe", (_req, res) => {
    res.json({ ok: true });
  });
  app.all("/probe-path/:ordinaryPath", (req, res) => {
    readInternalRequestControl(req, pathControl);
    res.json({ ok: true });
  });
  app.use(denyInternalRequestControlErrors);

  const previousNodeEnv = process.env.NODE_ENV;
  const previousDeployment = process.env.REPLIT_DEPLOYMENT;
  const previousLegacyDeployment = process.env.REPL_DEPLOYMENT;
  process.env.NODE_ENV = "production";
  delete process.env.REPLIT_DEPLOYMENT;
  delete process.env.REPL_DEPLOYMENT;

  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const requests = [
      fetch(`${base}/probe`, { headers: { "ordinary-header": "value" } }),
      fetch(`${base}/probe?ordinaryQuery=value`),
      fetch(`${base}/probe`, { headers: { cookie: "ordinaryCookie=value" } }),
      fetch(`${base}/probe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ordinaryBody: "value" }),
      }),
      fetch(`${base}/probe-path/value`),
    ];
    for (const response of await Promise.all(requests)) {
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "Not found" });
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDeployment === undefined) delete process.env.REPLIT_DEPLOYMENT;
    else process.env.REPLIT_DEPLOYMENT = previousDeployment;
    if (previousLegacyDeployment === undefined) delete process.env.REPL_DEPLOYMENT;
    else process.env.REPL_DEPLOYMENT = previousLegacyDeployment;
  }
});

test("production and deployment runtimes deny every registered internal request control", () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    REPLIT_DEPLOYMENT: process.env.REPLIT_DEPLOYMENT,
    REPL_DEPLOYMENT: process.env.REPL_DEPLOYMENT,
  };

  try {
    for (const environment of [
      { NODE_ENV: "production" },
      { REPLIT_DEPLOYMENT: "1" },
      { REPL_DEPLOYMENT: "1" },
    ]) {
      delete process.env.NODE_ENV;
      delete process.env.REPLIT_DEPLOYMENT;
      delete process.env.REPL_DEPLOYMENT;
      Object.assign(process.env, environment);

      for (const control of internalRequestControls) {
        let statusCode: number | undefined;
        let body: unknown;
        let nextCalled = false;
        const req = {
          get: (name: string) => control.transport === "header" && name === control.name
            ? "internal-control-value"
            : undefined,
          query: {},
          params: {},
          cookies: {},
          body: {},
        } as Request;
        const res = {
          status(code: number) {
            statusCode = code;
            return this;
          },
          json(value: unknown) {
            body = value;
            return this;
          },
        } as unknown as Response;
        const next = (() => {
          nextCalled = true;
        }) as NextFunction;

        denyInternalRequestControlsInProduction(req, res, next);
        assert.equal(statusCode, 404, `${control.name} must be denied in ${JSON.stringify(environment)}`);
        assert.deepEqual(body, { error: "Not found" });
        assert.equal(nextCalled, false);
      }
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("registered controls remain available to explicitly enabled non-production harnesses", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDeployment = process.env.REPLIT_DEPLOYMENT;
  const previousLegacyDeployment = process.env.REPL_DEPLOYMENT;
  try {
    process.env.NODE_ENV = "test";
    delete process.env.REPLIT_DEPLOYMENT;
    delete process.env.REPL_DEPLOYMENT;
    let nextCalled = false;
    const req = { get: () => "internal-control-value" } as unknown as Request;
    const res = {} as Response;
    denyInternalRequestControlsInProduction(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDeployment === undefined) delete process.env.REPLIT_DEPLOYMENT;
    else process.env.REPLIT_DEPLOYMENT = previousDeployment;
    if (previousLegacyDeployment === undefined) delete process.env.REPL_DEPLOYMENT;
    else process.env.REPL_DEPLOYMENT = previousLegacyDeployment;
  }
});