import assert from "node:assert/strict";
import test from "node:test";
import { getCampaignCancellationWarning } from "./campaign-cancellation-warning";

test("does not flag a campaign with fewer than three attributed bookings", () => {
  const warning = getCampaignCancellationWarning({
    attributedAppointments: 1,
    cancelledAttributedAppointments: 1,
  });

  assert.equal(warning.totalAttributedBookings, 2);
  assert.equal(warning.isFlagged, false);
});

test("flags exactly one cancellation in three attributed bookings", () => {
  const warning = getCampaignCancellationWarning({
    attributedAppointments: 2,
    cancelledAttributedAppointments: 1,
  });

  assert.equal(warning.totalAttributedBookings, 3);
  assert.equal(warning.cancellationShare, 1 / 3);
  assert.equal(warning.isFlagged, true);
});

test("does not flag three attributed bookings with no cancellations", () => {
  const warning = getCampaignCancellationWarning({
    attributedAppointments: 3,
    cancelledAttributedAppointments: 0,
  });

  assert.equal(warning.totalAttributedBookings, 3);
  assert.equal(warning.cancellationShare, 0);
  assert.equal(warning.isFlagged, false);
});

test("keeps the warning presentation values aligned with the calculated share", () => {
  const warning = getCampaignCancellationWarning({
    attributedAppointments: 2,
    cancelledAttributedAppointments: 1,
  });

  assert.equal(warning.cancellationShareLabel, "33%");
  assert.equal(
    warning.explanation,
    "Visok udeo otkazanih termina: 33% (1 od 3 kampanjom pripisanih termina). Proverite poruke, ponude ili publiku kampanje.",
  );
});