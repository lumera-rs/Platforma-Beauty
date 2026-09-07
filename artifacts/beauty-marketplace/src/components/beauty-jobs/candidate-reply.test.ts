import assert from "node:assert/strict";
import test from "node:test";
import { createCandidateReplyHandler, type CandidateReplyVariables } from "./candidate-reply";

for (const outcome of ["success", "error"] as const) {
  test(`candidate reply rejects a second submit before settle and unlocks after ${outcome}`, () => {
    const replyPendingRef = { current: false };
    const mutationVariables: CandidateReplyVariables[] = [];
    const mutationCallbacks: Array<{
      onSuccess: () => void;
      onError: () => void;
      onSettled: () => void;
    }> = [];
    const handler = createCandidateReplyHandler({
      replyPendingRef,
      mutation: {
        mutate: (variables, callbacks) => {
          mutationVariables.push(variables);
          mutationCallbacks.push(callbacks);
        },
      },
      onSuccess: () => undefined,
      onError: () => undefined,
    });
    const firstReply: CandidateReplyVariables = {
      contactId: "contact-first",
      data: { authorReply: "Prvi odgovor", authorStatus: "accepted" },
    };
    const secondReply: CandidateReplyVariables = {
      contactId: "contact-second",
      data: { authorReply: "Drugi odgovor", authorStatus: "declined" },
    };

    handler(firstReply);
    handler(secondReply);

    assert.deepEqual(mutationVariables, [firstReply]);

    mutationCallbacks[0]?.[outcome === "success" ? "onSuccess" : "onError"]();
    mutationCallbacks[0]?.onSettled();
    handler(secondReply);

    assert.deepEqual(mutationVariables, [firstReply, secondReply]);
  });
}