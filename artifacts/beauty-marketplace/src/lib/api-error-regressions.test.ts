import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ApiError,
  getApiErrorDetails,
  getApiErrorMessage,
  type ApiErrorData,
} from "../../../../lib/api-client-react/src/custom-fetch";
import { extractApiError } from "./admin-form-utils";

const GENERATED_API_CLIENT_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\()\s*["']@workspace\/api-client-react["']/;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

type SourceFile = {
  absolutePath: string;
  relativePath: string;
  source: string;
};

type ApiErrorViolation = {
  line: number;
  message: string;
};

function listProductionFrontendFiles(directory: string, relativeDirectory = ""): SourceFile[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const relativePath = path.join(relativeDirectory, entry.name);
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return listProductionFrontendFiles(absolutePath, relativePath);
      }

      const extension = path.extname(entry.name);
      if (
        !entry.isFile()
        || !SOURCE_EXTENSIONS.has(extension)
        || /\.(?:test|fixture)\.[^.]+$/.test(entry.name)
      ) {
        return [];
      }

      return [{
        absolutePath,
        relativePath,
        source: readFileSync(absolutePath, "utf8"),
      }];
    });
}

/**
 * Keep the source offsets intact while ignoring comments and string literals.
 * A textual guard should report real property access, not an example in a
 * comment or an error-shaped string shown in the UI.
 */
function maskNonCode(source: string): string {
  const masked = source.split("");
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  const mask = (index: number) => {
    if (masked[index] !== "\n" && masked[index] !== "\r") masked[index] = " ";
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (quote) {
      mask(index);
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      mask(index);
      mask(index + 1);
      index += 1;
      while (index + 1 < source.length && source[index + 1] !== "\n" && source[index + 1] !== "\r") {
        index += 1;
        mask(index);
      }
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      mask(index);
      mask(index + 1);
      index += 1;
      while (index + 1 < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
        mask(index);
      }
      if (index + 1 < source.length) {
        index += 1;
        mask(index);
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      mask(index);
    }
  }

  return masked.join("");
}

function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function isErrorIdentifier(identifier: string): boolean {
  const normalized = identifier.toLowerCase();
  return normalized === "e"
    || normalized === "err"
    || normalized === "error"
    || normalized.includes("error")
    || normalized.includes("exception")
    || normalized.includes("failure")
    || normalized === "caught";
}

function findGeneratedApiErrorViolations(source: string): ApiErrorViolation[] {
  const code = maskNonCode(source);
  const violations: ApiErrorViolation[] = [];
  const addMatches = (expression: RegExp, message: (match: RegExpExecArray) => string) => {
    for (const match of code.matchAll(expression)) {
      const identifier = match[1];
      if (identifier && isErrorIdentifier(identifier)) {
        violations.push({
          line: lineNumberAt(source, match.index ?? 0),
          message: message(match),
        });
      }
    }
  };

  addMatches(
    /\b([A-Za-z_$][\w$]*)(?:\.|\?\.)response(?:\.|\?\.)?(?:data|status)\b/g,
    (match) => `${match[1]}.response.data/status must use getApiErrorDetails`,
  );
  addMatches(
    /\b([A-Za-z_$][\w$]*)(?:\.|\?\.)data\b/g,
    (match) => `${match[1]}.data must use getApiErrorDetails`,
  );
  addMatches(
    /\(\s*([A-Za-z_$][\w$]*)\s+as\s+[^)\n]*(?:\bdata\b|\bstatus\b)[^)\n]*\)\s*(?:\.|\?\.)\s*(?:data|status)\b/g,
    (match) => `manual ${match[1]} data/status cast must use getApiErrorDetails`,
  );

  return violations.sort((left, right) => left.line - right.line || left.message.localeCompare(right.message));
}

function apiError(status: number, data: ApiErrorData): ApiError<ApiErrorData> {
  return new ApiError(
    new Response(null, { status }),
    data,
    { method: "POST", url: "/api/regression-fixture" },
  );
}

test("auth mutation errors keep the server's precise user message", () => {
  const error = apiError(409, {
    error: "Nalog sa ovom email adresom već postoji.",
    code: "EMAIL_ALREADY_EXISTS",
  });

  assert.equal(error.status, 409);
  assert.equal(getApiErrorDetails(error).code, "EMAIL_ALREADY_EXISTS");
  assert.equal(
    getApiErrorMessage(error, "Došlo je do greške prilikom registracije."),
    "Nalog sa ovom email adresom već postoji.",
  );
});

test("booking mutation errors preserve status and package code for non-destructive recovery", () => {
  const error = apiError(409, {
    error: "Paket nema dovoljno preostalih termina.",
    code: "PACKAGE_ERROR",
  });
  const details = getApiErrorDetails(error);

  assert.equal(details.status, 409);
  assert.equal(details.code, "PACKAGE_ERROR");
  assert.equal(details.message, "Paket nema dovoljno preostalih termina.");
});

test("cart and checkout errors retain stock details and stable quote codes", () => {
  const error = apiError(409, {
    error: "Ponuda je promenjena. Pregledajte nove iznose.",
    code: "CHECKOUT_QUOTE_CHANGED",
    unavailableProducts: ["Serum A", "Krema B"],
  });
  const details = getApiErrorDetails(error);

  assert.equal(details.status, 409);
  assert.equal(details.code, "CHECKOUT_QUOTE_CHANGED");
  assert.deepEqual(details.data?.unavailableProducts, ["Serum A", "Krema B"]);
  assert.equal(
    getApiErrorMessage(error, "Porudžbina nije potvrđena."),
    "Ponuda je promenjena. Pregledajte nove iznose.",
  );
});

test("admin mutation errors use the same generated ApiError parser", () => {
  const error = apiError(409, {
    error: "Podešavanja je izmenio drugi administrator.",
    code: "VERSION_CONFLICT",
    changedByName: "Drugi administrator",
    changedAt: "2026-08-27T10:00:00.000Z",
  });
  const details = getApiErrorDetails(error);

  assert.equal(extractApiError(error, "Promena nije sačuvana."), details.message);
  assert.equal(details.code, "VERSION_CONFLICT");
  assert.equal(details.data?.changedByName, "Drugi administrator");
});

test("feature fallback does not accidentally read an Axios response.data payload", () => {
  const legacyError = {
    response: {
      status: 422,
      data: { error: "Ova poruka ne sme procuriti.", code: "AXIOS_ONLY" },
    },
  };

  assert.equal(
    getApiErrorMessage(legacyError, "Precizna poruka trenutno nije dostupna."),
    "Precizna poruka trenutno nije dostupna.",
  );
  assert.equal(extractApiError(legacyError, "Promena nije sačuvana."), "Promena nije sačuvana.");
});

test("critical generated-client handlers stay on the shared parser and preserve recovery state", () => {
  const auth = readFileSync(new URL("../pages/auth.tsx", import.meta.url), "utf8");
  const booking = readFileSync(new URL("../pages/salon-profile.tsx", import.meta.url), "utf8");
  const cart = readFileSync(new URL("../hooks/use-shop-cart-mutations.ts", import.meta.url), "utf8");
  const checkout = readFileSync(new URL("../pages/retail-checkout.tsx", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../pages/admin/shipping.tsx", import.meta.url), "utf8");

  assert.match(auth, /onError: \(err: unknown\)[\s\S]*?getApiErrorMessage\(err,/);
  assert.doesNotMatch(auth, /onError:[\s\S]{0,300}loginForm\.reset/);

  assert.match(booking, /code === 'PACKAGE_ERROR'[\s\S]*?DO NOT reset selection or step/);
  assert.match(booking, /getApiErrorDetails\(error\)/);

  assert.match(cart, /onError: \(error,[\s\S]*?rollback\(context\);[\s\S]*?getApiErrorMessage\(/);
  assert.match(checkout, /onError: \(error: unknown\)[\s\S]*?getApiErrorMessage\(/);
  assert.doesNotMatch(checkout, /onError:[\s\S]{0,500}setForm\(/);

  assert.match(admin, /getApiErrorMessage\(error, "Promena nije sačuvana\."/);
});

test("frontend feature code contains no Axios-style generated error access", () => {
  const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
  const productionFiles = listProductionFrontendFiles(sourceRoot);
  const generatedClientFiles = productionFiles.filter(({ source }) =>
    GENERATED_API_CLIENT_IMPORT.test(source),
  );

  assert.ok(generatedClientFiles.length > 0, "expected production files to use the generated API client");

  const violations = generatedClientFiles.flatMap(({ relativePath, source }) =>
    findGeneratedApiErrorViolations(source).map(({ line, message }) => `${relativePath}:${line} ${message}`),
  );

  assert.deepEqual(violations, [], violations.join("\n"));
});

test("the generated-client guard catches a newly added bad handler", () => {
  const newScreenFixture = readFileSync(
    new URL("../../test-fixtures/generated-api-error-handler.fixture.tsx", import.meta.url),
    "utf8",
  );

  assert.match(newScreenFixture, GENERATED_API_CLIENT_IMPORT);
  const violations = findGeneratedApiErrorViolations(newScreenFixture);

  assert.equal(violations.length, 3);
  assert.equal(
    violations.filter(({ message }) => /error\.response\.data\/status/.test(message)).length,
    2,
  );
  assert.ok(violations.some(({ message }) => /manual error data\/status cast/.test(message)));
});

test("native fetch Response handling is not mistaken for generated API error access", () => {
  const nativeFetchHelper = `
    async function loadWithNativeFetch() {
      const response = await fetch("/api/native");
      if (!response.ok) throw new Error("Request failed");
      return response.status;
    }
  `;

  assert.deepEqual(findGeneratedApiErrorViolations(nativeFetchHelper), []);
});

test("generated-client discovery excludes regression test fixtures", () => {
  const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
  const productionFiles = listProductionFrontendFiles(sourceRoot);

  assert.equal(
    productionFiles.some(({ relativePath }) => relativePath.endsWith("api-error-regressions.test.ts")),
    false,
  );
  assert.equal(
    productionFiles.some(({ relativePath }) => relativePath.endsWith("generated-api-error-handler.fixture.tsx")),
    false,
  );
  assert.ok(
    productionFiles.some(({ relativePath }) => relativePath === path.join("pages", "auth.tsx")),
  );
});