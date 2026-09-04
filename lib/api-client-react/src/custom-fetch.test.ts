import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiError,
  NetworkError,
  customFetch,
  getApiErrorDetails,
  getApiErrorMessage,
  isNetworkError,
  bookingCommandKey,
  clearBookingCommandKey,
  createTargetedIdempotencyKeys,
} from "./custom-fetch";

// Accepts both sync and async callbacks; always returns a Promise so a
// caller that forgets to `await` an async `run` can't let the `finally`
// below restore sessionStorage before `run`'s body actually finishes.
async function withFakeSessionStorage<T>(run: () => T | Promise<T>): Promise<T> {
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
    return await run();
  } finally {
    if (originalSessionStorage === undefined) {
      delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
    } else {
      Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: originalSessionStorage });
    }
  }
}

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

// Regression coverage for Task #4D: booking-creation call sites now call
// bookingCommandKey() explicitly (Task #4C moved them off the untyped
// request-options escape hatch), so its own retry/rerender/rotation
// contract is what those call sites' correctness now rests on.

test("bookingCommandKey reuses the same key for repeated calls with an identical (pathname, body) pair", async () => {
  await withFakeSessionStorage(() => {
    const body = { salonId: "s1", date: "2099-01-01", treatments: [{ serviceId: "svc1", employeeId: null, date: "2099-01-01", startTime: "10:00" }] };
    // Simulates: the click handler is invoked again for a manual retry, or
    // simply called with the same in-flight selection again -- neither a
    // React rerender (which never re-invokes this, since it's only ever
    // called from inside an event handler, not the render body) nor a
    // logical retry may mint a new key while the selection is unchanged.
    const first = bookingCommandKey("/api/booking-groups", body);
    const second = bookingCommandKey("/api/booking-groups", body);
    const third = bookingCommandKey("/api/booking-groups", { ...body });
    assert.equal(second, first);
    assert.equal(third, first, "a structurally-identical body (fresh object, same content) must hash to the same key");
  });
});

test("bookingCommandKey issues a different key for a genuinely different payload or path", async () => {
  await withFakeSessionStorage(() => {
    const bodyA = { salonId: "s1", date: "2099-01-01", treatments: [{ serviceId: "svc1", employeeId: null, date: "2099-01-01", startTime: "10:00" }] };
    const bodyB = { ...bodyA, date: "2099-01-02" };
    const keyForA = bookingCommandKey("/api/booking-groups", bodyA);
    const keyForB = bookingCommandKey("/api/booking-groups", bodyB);
    const keyOnOtherPath = bookingCommandKey("/api/salon/booking-groups", bodyA);
    assert.notEqual(keyForB, keyForA, "two genuinely separate logical actions must not share a key");
    assert.notEqual(keyOnOtherPath, keyForA, "the same body against a different endpoint is a different command");
  });
});

test("clearBookingCommandKey rotates the key so the next command against the same target does not replay the completed one", async () => {
  await withFakeSessionStorage(() => {
    const body = { salonId: "s1", date: "2099-01-01", treatments: [] };
    const beforeSuccess = bookingCommandKey("/api/booking-groups", body);
    clearBookingCommandKey("/api/booking-groups", body);
    const afterSuccess = bookingCommandKey("/api/booking-groups", body);
    assert.notEqual(afterSuccess, beforeSuccess, "a confirmed completion must rotate the key for the next intentional command");
  });
});

test("a lost response followed by a client retry sends the identical Idempotency-Key header, so the server replays instead of re-executing", async () => {
  const originalFetch = globalThis.fetch;
  await withFakeSessionStorage(async () => {
    const executedKeys = new Set<string>();
    const seenHeaders: string[] = [];
    globalThis.fetch = async (_input, init) => {
      const key = new Headers(init?.headers).get("idempotency-key") ?? "";
      seenHeaders.push(key);
      // First delivery: the mutation succeeds server-side, but we simulate
      // the client never receiving/accepting that response (dropped
      // connection, parse failure, tab backgrounded mid-request, ...).
      if (!executedKeys.has(key)) {
        executedKeys.add(key);
        throw new TypeError("network error before the response was received");
      }
      // Second delivery, same key: a real backend (proven end-to-end by
      // education-b2b-checkout-idempotency.test.ts's replay assertions)
      // would recognize this key and replay the original result instead
      // of creating a second booking. This mock only needs to prove the
      // CLIENT's contribution to that guarantee: it sends the same header.
      return new Response(JSON.stringify({ id: "booking-1", replayed: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const path = "/api/booking-groups";
    const body = { salonId: "s1", date: "2099-01-01", treatments: [] };
    const key = bookingCommandKey(path, body);
    await assert.rejects(
      () => customFetch(path, { method: "POST", body: JSON.stringify(body), headers: { "Idempotency-Key": key }, responseType: "json" }),
      NetworkError,
    );
    // A manual retry of the same still-pending logical action: the caller
    // asks bookingCommandKey() again for the identical (path, body) pair,
    // exactly as the fixed call sites do, rather than minting a fresh UUID.
    const retryKey = bookingCommandKey(path, body);
    assert.equal(retryKey, key, "retrying the same logical booking must reuse the same key, not generate a new one");
    const result = await customFetch<{ id: string }>(path, {
      method: "POST", body: JSON.stringify(body), headers: { "Idempotency-Key": retryKey }, responseType: "json",
    });
    assert.equal(result.id, "booking-1");
    assert.deepEqual(seenHeaders, [key, key], "both the lost delivery and the retry must carry the identical Idempotency-Key header");
  });
  globalThis.fetch = originalFetch;
});

test("createTargetedIdempotencyKeys keeps one stable key per target id, independent of other targets, until cleared", () => {
  const keys = createTargetedIdempotencyKeys();
  const firstForA = keys.keyFor("installment-a");
  const secondForA = keys.keyFor("installment-a");
  const forB = keys.keyFor("installment-b");
  assert.equal(secondForA, firstForA, "retrying the same target must reuse its key");
  assert.notEqual(forB, firstForA, "a different target must never collide with another target's key");
  keys.clear("installment-a");
  const afterClearForA = keys.keyFor("installment-a");
  assert.notEqual(afterClearForA, firstForA, "clearing a target's key after a confirmed completion must rotate it for its next command");
  const stillForB = keys.keyFor("installment-b");
  assert.equal(stillForB, forB, "clearing one target's key must not disturb another target's key");
});