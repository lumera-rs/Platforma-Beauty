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

test("employee booking commands retain one idempotency key through transport retry", async () => {
  const originalFetch = globalThis.fetch;
  const originalSessionStorage = globalThis.sessionStorage;
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  });

  try {
    for (const path of ["/api/employee/appointments", "/api/employee/appointment-series"]) {
      values.clear();
      const seenKeys: string[] = [];
      let attempt = 0;
      globalThis.fetch = async (_input, init) => {
        seenKeys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
        attempt += 1;
        if (attempt === 1) throw new TypeError("connection reset after send");
        return new Response(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      };
      const body = JSON.stringify({
        serviceId: "service-1",
        salonCustomerId: "customer-1",
        slots: [{ date: "2099-12-20", startTime: "10:00" }],
      });
      await assert.rejects(() => customFetch(path, {
        method: "POST", body, responseType: "json",
      }), NetworkError);
      await customFetch(path, { method: "POST", body, responseType: "json" });
      assert.ok(seenKeys[0]);
      assert.deepEqual(seenKeys, [seenKeys[0], seenKeys[0]]);
      assert.equal(values.size, 0, "a successful replay retires the persisted command key");
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSessionStorage === undefined) {
      delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
    } else {
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: originalSessionStorage,
      });
    }
  }
});