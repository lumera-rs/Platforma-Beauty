import assert from "node:assert/strict";
import test from "node:test";

// Node's built-in TypeScript test runner requires the source extension.
// @ts-expect-error TS does not allow TypeScript extensions in emitted imports.
import { trackEvent } from "./analytics.ts";

test("forwards privacy-safe custom events to the Replit-injected tracker", () => {
  const calls: Array<{ name: string; data: Record<string, string | number | boolean> | undefined }> = [];
  const originalWindow = globalThis.window;

  globalThis.window = {
    umami: {
      track(name, data) {
        calls.push({ name, data });
      },
    },
  } as Window & typeof globalThis;

  try {
    trackEvent("treatment_cart_continued", {
      treatment_count: 2,
      customer_type: "guest",
      day_choice: "same_day",
      booking_surface: "booking_widget",
    });

    assert.deepEqual(calls, [{
      name: "treatment_cart_continued",
      data: {
        treatment_count: 2,
        customer_type: "guest",
        day_choice: "same_day",
        booking_surface: "booking_widget",
      },
    }]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("never lets tracker failures interrupt booking", () => {
  const originalWindow = globalThis.window;

  globalThis.window = {
    umami: {
      track() {
        throw new Error("analytics unavailable");
      },
    },
  } as Window & typeof globalThis;

  try {
    assert.doesNotThrow(() => trackEvent("grouped_booking_completed"));
  } finally {
    globalThis.window = originalWindow;
  }
});