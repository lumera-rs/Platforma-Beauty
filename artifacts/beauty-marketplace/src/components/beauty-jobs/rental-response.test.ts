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