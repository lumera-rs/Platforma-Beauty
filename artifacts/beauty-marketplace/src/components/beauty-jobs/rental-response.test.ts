import assert from "node:assert/strict";
import test from "node:test";
import { createRentalResponseHandler, type RentalResponseStatus } from "./rental-response";

for (const status of ["accepted", "declined"] as const) {
  test(`${status} sends the request identity, shows pending state, refreshes rental data, and settles`, () => {
    const pendingStates: Array<string | undefined> = [];
    const refreshed = [
      "rental-inbox",
      "sent-rental-requests",
      "rental-notifications",
      "rental-listings",
    ];
    const invalidated: string[] = [];
    const successes: RentalResponseStatus[] = [];
    let mutationVariables: unknown;
    let mutationCallbacks: {
      onSuccess: () => void;
      onError: () => void;
      onSettled: () => void;
    } | undefined;

    const respond = createRentalResponseHandler({
      responsePendingRef: { current: false },
      mutation: {
        mutate: (variables, callbacks) => {
          mutationVariables = variables;
          mutationCallbacks = callbacks;
        },
      },
      setPendingRequestId: (requestId) => pendingStates.push(requestId),
      onSuccess: (savedStatus) => {
        successes.push(savedStatus);
        refreshed.forEach((query) => invalidated.push(query));
      },
      onError: () => assert.fail("successful response must not show an error"),
    });

    respond("request-42", status);

    assert.deepEqual(mutationVariables, { requestId: "request-42", data: { status } });
    assert.deepEqual(pendingStates, ["request-42"]);

    mutationCallbacks?.onSuccess();
    assert.deepEqual(successes, [status]);
    assert.deepEqual(invalidated, refreshed);

    mutationCallbacks?.onSettled();
    assert.deepEqual(pendingStates, ["request-42", undefined]);
  });
}

test("a failed response keeps owner feedback visible until the next user action", () => {
  const pendingStates: Array<string | undefined> = [];
  const visibleErrors: string[] = [];
  let mutationCallbacks: {
    onSuccess: () => void;
    onError: () => void;
    onSettled: () => void;
  } | undefined;

  const respond = createRentalResponseHandler({
    responsePendingRef: { current: false },
    mutation: {
      mutate: (_variables, callbacks) => {
        mutationCallbacks = callbacks;
      },
    },
    setPendingRequestId: (requestId) => pendingStates.push(requestId),
    onSuccess: () => assert.fail("failed response must not report success"),
    onError: () => visibleErrors.push("Zahtev je već obrađen ili termin više nije dostupan."),
  });

  respond("request-failure", "declined");
  mutationCallbacks?.onError();
  mutationCallbacks?.onSettled();

  assert.deepEqual(pendingStates, ["request-failure", undefined]);
  assert.deepEqual(visibleErrors, ["Zahtev je već obrađen ili termin više nije dostupan."]);
});

for (const outcome of ["success", "error"] as const) {
  test(`rejects a second response before settle and unlocks after ${outcome}`, () => {
    const responsePendingRef = { current: false };
    const mutationVariables: unknown[] = [];
    const mutationCallbacks: Array<{
      onSuccess: () => void;
      onError: () => void;
      onSettled: () => void;
    }> = [];

    const createHandler = () =>
      createRentalResponseHandler({
        responsePendingRef,
        mutation: {
          mutate: (variables, callbacks) => {
            mutationVariables.push(variables);
            mutationCallbacks.push(callbacks);
          },
        },
        setPendingRequestId: () => undefined,
        onSuccess: () => undefined,
        onError: () => undefined,
      });

    createHandler()("request-first", "accepted");
    createHandler()("request-second", "declined");

    assert.deepEqual(mutationVariables, [
      { requestId: "request-first", data: { status: "accepted" } },
    ]);

    mutationCallbacks[0]?.[outcome === "success" ? "onSuccess" : "onError"]();
    mutationCallbacks[0]?.onSettled();
    createHandler()("request-after-settle", "declined");

    assert.deepEqual(mutationVariables, [
      { requestId: "request-first", data: { status: "accepted" } },
      { requestId: "request-after-settle", data: { status: "declined" } },
    ]);
  });
}