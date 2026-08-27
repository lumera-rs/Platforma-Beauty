import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiError,
  NetworkError,
  customFetch,
  getApiErrorDetails,
  getApiErrorMessage,
  isNetworkError,
} from "./custom-fetch";

test("customFetch keeps structured 4xx payload and status on ApiError", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({
      error: "Termin više nije slobodan.",
      code: "SLOT_TAKEN",
      issues: [{ path: ["startTime"], message: "Izaberite drugi termin." }],
    }),
    {
      status: 409,
      statusText: "Conflict",
      headers: { "content-type": "application/json" },
    },
  );

  try {
    await assert.rejects(
      () => customFetch("/api/appointments", { method: "POST", responseType: "json" }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 409);
        assert.deepEqual(error.data, {
          error: "Termin više nije slobodan.",
          code: "SLOT_TAKEN",
          issues: [{ path: ["startTime"], message: "Izaberite drugi termin." }],
        });
        assert.equal(error.response.status, 409);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getApiErrorDetails exposes generated ApiError fields without Axios response.data", () => {
  const response = new Response(null, { status: 422, statusText: "Unprocessable Entity" });
  const error = new ApiError(
    response,
    { error: "Email je već registrovan.", code: "EMAIL_TAKEN", issues: [] },
    { method: "POST", url: "/api/auth/register" },
  );

  assert.deepEqual(getApiErrorDetails(error), {
    status: 422,
    data: { error: "Email je već registrovan.", code: "EMAIL_TAKEN", issues: [] },
    code: "EMAIL_TAKEN",
    message: "Email je već registrovan.",
  });
  assert.equal(getApiErrorMessage(error, "Registracija nije uspela."), "Email je već registrovan.");
});

test("legacy Axios and native Response objects are not treated as generated ApiError", () => {
  const axiosLike = {
    response: { status: 409, data: { error: "Pogrešna poruka.", code: "LEGACY" } },
  };
  const response = new Response(JSON.stringify({ error: "Nečitano telo." }), { status: 400 });

  assert.deepEqual(getApiErrorDetails(axiosLike), {
    status: undefined,
    data: null,
    code: undefined,
    message: undefined,
  });
  assert.deepEqual(getApiErrorDetails(response), {
    status: undefined,
    data: null,
    code: undefined,
    message: undefined,
  });
});

test("transport and non-object API failures use a user-safe fallback", () => {
  assert.equal(
    getApiErrorMessage(new Error("Mrežna veza je prekinuta."), "Pokušajte ponovo."),
    "Pokušajte ponovo.",
  );

  const response = new Response(null, { status: 500 });
  const error = new ApiError(response, "upstream failed", { method: "GET", url: "/api/test" });
  assert.equal(getApiErrorMessage(error, "Pokušajte ponovo."), "Pokušajte ponovo.");
});

test("isNetworkError identifies transport failures across module boundaries", () => {
  const error = new NetworkError(new Error("offline"), {
    method: "GET",
    url: "/api/widget/salons/demo",
  });

  assert.equal(isNetworkError(error), true);
  assert.equal(isNetworkError({
    name: "NetworkError",
    method: "GET",
    url: "/api/widget/salons/demo",
  }), true);
  assert.equal(isNetworkError(new Error("server error")), false);
});