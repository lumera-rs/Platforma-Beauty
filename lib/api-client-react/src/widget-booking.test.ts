import assert from "node:assert/strict";
import test from "node:test";
import {
  createWidgetAppointmentCommand,
  createWidgetBookingGroupCommand,
} from "./widget-booking";

test("typed widget booking commands send and reuse the required idempotency key", async () => {
  const originalFetch = globalThis.fetch;
  const seen: Array<{ url: string; key: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    seen.push({
      url: String(input),
      key: new Headers(init?.headers).get("idempotency-key"),
    });
    const grouped = String(input).endsWith("/booking-groups");
    return new Response(JSON.stringify(grouped ? {
      id: "group-1",
      appointments: [],
    } : {
      appointmentId: "appointment-1",
      status: "pending",
      date: "2099-12-21",
      startTime: "12:00",
      endTime: "12:30",
      employeeName: "Test",
      serviceName: "Test",
      salonName: "Test",
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const idempotencyKey = "widget-retry-key";
    await createWidgetAppointmentCommand({
      slug: "test-salon",
      idempotencyKey,
      data: {
        serviceId: "service-1",
        date: "2099-12-21",
        startTime: "12:00",
        firstName: "Test",
        lastName: "Customer",
        phone: "+381611111111",
      },
    });
    const groupCommand = {
      slug: "test-salon",
      idempotencyKey,
      data: {
        firstName: "Test",
        lastName: "Customer",
        phone: "+381611111111",
        treatments: [{
          serviceId: "service-1",
          date: "2099-12-21",
          startTime: "12:00",
        }],
      },
    };
    await createWidgetBookingGroupCommand(groupCommand);
    await createWidgetBookingGroupCommand(groupCommand);

    assert.deepEqual(seen, [
      { url: "/api/widget/salons/test-salon/appointments", key: idempotencyKey },
      { url: "/api/widget/salons/test-salon/booking-groups", key: idempotencyKey },
      { url: "/api/widget/salons/test-salon/booking-groups", key: idempotencyKey },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});