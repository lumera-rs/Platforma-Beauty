import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ApiError,
  getApiErrorDetails,
  getApiErrorMessage,
  type ApiErrorData,
} from "../../../../lib/api-client-react/src/custom-fetch";
import { extractApiError } from "./admin-form-utils";

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
  const featureFiles = [
    "../components/beauty-jobs/business-job-applicants.tsx",
    "../hooks/use-shop-cart-mutations.ts",
    "../pages/auth.tsx",
    "../pages/business-auth.tsx",
    "../pages/business-education.tsx",
    "../pages/customer-dashboard.tsx",
    "../pages/owner/checkout.tsx",
    "../pages/retail-checkout.tsx",
    "../pages/salon-profile.tsx",
    "../pages/widget-booking.tsx",
    "../pages/admin/retention-settings.tsx",
    "../pages/admin/shipping.tsx",
  ];

  for (const relativePath of featureFiles) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.response\??\.(?:data|status)/, relativePath);
  }
});