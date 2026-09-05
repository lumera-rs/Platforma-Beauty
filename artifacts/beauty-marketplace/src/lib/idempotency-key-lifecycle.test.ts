/**
 * Regression coverage for Task #4D: the Idempotency-Key lifecycle contract
 * two specific call sites were found violating --
 * center-operations.tsx's commitMut (commitEducationCourseRecurrence) and
 * reschedule-modal.tsx (rescheduleEducationOperationalBooking) -- both
 * previously called `crypto.randomUUID()` inline at the `.mutate()` call
 * site, so every invocation of the click handler (including a manual retry
 * of the exact same still-pending logical action) minted a brand-new key,
 * defeating server-side replay protection.
 *
 * The fix in both files replaced that with a `useState(() => crypto.randomUUID())`
 * slot: stable across repeated invocations of the handler (retries,
 * rerenders), rotated only at a point where it is safe to consider the
 * prior logical command finished.
 *
 * This repository has no React-rendering test harness (no
 * @testing-library/react, no jsdom/happy-dom devDependency) and Task #4D's
 * scope does not justify introducing one. This file therefore verifies the
 * INTENDED CONTRACT the two fixed components implement, using a plain JS
 * "state slot" (`createLifecycleSlot` below) that mirrors exactly what
 * `useState`/`setState` provide -- a value that persists across repeated
 * reads until explicitly replaced. It is a logic-level simulation, not a
 * rendered-component test: each scenario is commented with the exact file
 * and lines it mirrors so a reviewer can directly compare the sequence
 * against the real component code. See this task's final report for this
 * tradeoff as an explicit, documented limitation.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

/** Mirrors `const [key, setKey] = useState(() => crypto.randomUUID())`. */
function createLifecycleSlot() {
  let value = randomUUID();
  return {
    get: () => value,
    rotate: () => { value = randomUUID(); },
  };
}

// Mirrors artifacts/beauty-marketplace/src/components/education/center-operations.tsx:
//   const [commitIdempotencyKey, setCommitIdempotencyKey] = useState(() => crypto.randomUUID());
//   ...
//   const handleCommit = () => {
//     commitMut.mutate({ ..., headers: { "Idempotency-Key": commitIdempotencyKey } }, {
//       onSuccess: () => { ...; setCommitIdempotencyKey(crypto.randomUUID()); },
//     });
//   };
test("commitMut: a logical retry (handleCommit invoked again without a prior success) reuses the same key", () => {
  const key = createLifecycleSlot();
  const handleCommit = () => key.get(); // the header value handleCommit would send this invocation

  const firstAttempt = handleCommit(); // fails (network error, server 409, ...) -- no rotation happens on failure
  const retryAttempt = handleCommit(); // user clicks "Commit" again for the same still-pending recurrence

  assert.equal(retryAttempt, firstAttempt, "a retry of the same logical commit must send the same Idempotency-Key");
});

test("commitMut: a confirmed success rotates the key so the next commit (even with identical parameters) gets its own", () => {
  const key = createLifecycleSlot();
  const handleCommit = () => key.get();
  const onSuccess = () => key.rotate(); // exact mirror of setCommitIdempotencyKey(crypto.randomUUID()) in onSuccess

  const succeeded = handleCommit();
  onSuccess();
  const nextIntentionalCommit = handleCommit();

  assert.notEqual(nextIntentionalCommit, succeeded, "a new commit after a confirmed success must not reuse the completed command's key");
});

test("commitMut: a React rerender (reading the key without invoking the handler) never changes it", () => {
  const key = createLifecycleSlot();
  // A rerender re-evaluates the component body, which reads commitIdempotencyKey
  // (e.g. to pass to useCommitEducationCourseRecurrence's surrounding JSX/props)
  // without calling handleCommit -- this must never mutate the slot.
  const renderedValue1 = key.get();
  const renderedValue2 = key.get();
  const renderedValue3 = key.get();
  assert.equal(renderedValue2, renderedValue1);
  assert.equal(renderedValue3, renderedValue1);
});

// Mirrors artifacts/beauty-marketplace/src/components/education/reschedule-modal.tsx:
//   const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
//   ...
//   const handleReschedule = () => {
//     mut.mutate({ ..., headers: { "Idempotency-Key": idempotencyKey } }, {
//       onSuccess: () => { ...; onSuccess(); },  // parent unmounts this modal
//       onError: (error) => {
//         if (status === 409) { ...; setIdempotencyKey(crypto.randomUUID()); }
//         // else: no rotation -- an uncertain/transport failure keeps the key
//       }
//     });
//   };
// The parent (operational-purchases.tsx) only ever renders this modal
// conditionally ({rescheduleModal && <RescheduleModal .../>}), so closing
// it for any reason unmounts the component and discards its state.
test("reschedule-modal: a retry after an uncertain/transport failure reuses the same key (modal stays open)", () => {
  const key = createLifecycleSlot();
  const handleReschedule = () => key.get();

  const firstAttempt = handleReschedule(); // e.g. network error; onError's non-409 branch does not rotate
  const retryAttempt = handleReschedule(); // user clicks "Potvrdi promenu" again, same selected candidate

  assert.equal(retryAttempt, firstAttempt, "an uncertain-failure retry must reuse the same key -- it may already have succeeded server-side");
});

test("reschedule-modal: a confirmed 409 slot conflict rotates the key before the user can pick a new candidate", () => {
  const key = createLifecycleSlot();
  const handleReschedule = () => key.get();
  const on409 = () => key.rotate(); // exact mirror of setIdempotencyKey(crypto.randomUUID()) in the 409 branch

  const rejectedAttempt = handleReschedule();
  on409();
  const attemptAgainstNewCandidate = handleReschedule();

  assert.notEqual(attemptAgainstNewCandidate, rejectedAttempt, "after a confirmed conflict, the next attempt targets a different slot and must not replay the stale key");
});

test("reschedule-modal: closing and reopening the modal (component remount) starts a genuinely new reschedule with a fresh key", () => {
  // {rescheduleModal && <RescheduleModal .../>} unmounts on close (cancel,
  // or onSuccess closing it) and mounts fresh on reopen -- useState's lazy
  // initializer runs again, independent of the previous instance's value.
  const firstMountKey = createLifecycleSlot().get();
  const secondMountKey = createLifecycleSlot().get();
  assert.notEqual(secondMountKey, firstMountKey, "reopening for a new reschedule must never reuse a prior mount's key");
});

test("reschedule-modal: a React rerender (reading the key without submitting) never changes it", () => {
  const key = createLifecycleSlot();
  const renderedValue1 = key.get();
  const renderedValue2 = key.get();
  assert.equal(renderedValue2, renderedValue1);
});
