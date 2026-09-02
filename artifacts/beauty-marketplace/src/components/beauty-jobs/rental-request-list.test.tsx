import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BeautyJobRentalRequest } from "@workspace/api-client-react";
import { RentalRequestList } from "./rental-request-list";

const baseRequest = {
  applicantDisplayName: "Milica",
  applicantUserId: "user-1",
  createdAt: "2026-09-01T08:00:00.000Z",
  listingId: "listing-1",
  listingTitle: "Profesionalni sto za masažu",
  message: "Molim vas javite da li je preuzimanje moguće ujutru.",
  respondedAt: null,
  slotId: "slot-1",
  status: "pending",
  updatedAt: "2026-09-01T08:00:00.000Z",
} satisfies Omit<BeautyJobRentalRequest, "id" | "startsAt" | "endsAt">;

function request(id: string, startsAt: string | null, endsAt: string | null): BeautyJobRentalRequest {
  return { ...baseRequest, id, startsAt, endsAt };
}

for (const viewport of ["mobile", "desktop"]) {
  test(`customer rental history keeps null slot dates usable on ${viewport}`, () => {
    const html = renderToStaticMarkup(
      <RentalRequestList
        requests={[
          request("missing-start", null, "2026-09-03T11:00:00.000Z"),
          request("missing-end", "2026-09-04T10:00:00.000Z", null),
          request("valid-neighbor", "2026-09-05T10:00:00.000Z", "2026-09-05T11:00:00.000Z"),
        ]}
        isLoading={false}
        incoming={false}
      />,
    );

    assert.match(html, /rental-request-missing-start/);
    assert.match(html, /rental-request-missing-end/);
    assert.equal((html.match(/Datum termina nije dostupan/g) ?? []).length, 2);
    assert.equal((html.match(/Profesionalni sto za masažu/g) ?? []).length, 3);
    assert.equal((html.match(/Na čekanju/g) ?? []).length, 3);
    assert.equal((html.match(/Molim vas javite/g) ?? []).length, 3);
    assert.match(html, /05\.09\.2026\. 10:00–11:00/);
    assert.match(html, /p-4 shadow-sm sm:p-5/);
    assert.match(html, /flex-col items-start justify-between gap-3 sm:flex-row/);
  });

  test(`salon rental inbox keeps null slot dates and response controls usable on ${viewport}`, () => {
    const html = renderToStaticMarkup(
      <RentalRequestList
        requests={[
          request("incoming-missing-start", null, "2026-09-03T11:00:00.000Z"),
          request("incoming-missing-end", "2026-09-04T10:00:00.000Z", null),
        ]}
        isLoading={false}
        incoming
        onRespond={() => undefined}
      />,
    );

    assert.match(html, /rental-request-incoming-missing-start/);
    assert.match(html, /rental-request-incoming-missing-end/);
    assert.equal((html.match(/Datum termina nije dostupan/g) ?? []).length, 2);
    assert.equal((html.match(/Korisnik: Milica/g) ?? []).length, 2);
    assert.equal((html.match(/Profesionalni sto za masažu/g) ?? []).length, 2);
    assert.equal((html.match(/Molim vas javite/g) ?? []).length, 2);
    assert.equal((html.match(/Na čekanju/g) ?? []).length, 2);
    assert.equal((html.match(/>Odbij</g) ?? []).length, 2);
    assert.equal((html.match(/>Prihvati termin</g) ?? []).length, 2);
    assert.match(html, /p-4 shadow-sm sm:p-5/);
    assert.match(html, /flex-col items-start justify-between gap-3 sm:flex-row/);
  });

  test(`salon rental inbox disables only the request being saved on ${viewport}`, () => {
    const html = renderToStaticMarkup(
      <RentalRequestList
        requests={[
          request("saving-request", "2026-09-03T10:00:00.000Z", "2026-09-03T11:00:00.000Z"),
          request("other-request", "2026-09-04T10:00:00.000Z", "2026-09-04T11:00:00.000Z"),
        ]}
        isLoading={false}
        incoming
        pendingRequestId="saving-request"
        onRespond={() => undefined}
      />,
    );

    const savingCardStart = html.indexOf("rental-request-saving-request");
    const otherCardStart = html.indexOf("rental-request-other-request");
    const savingCard = html.slice(savingCardStart, otherCardStart);
    const otherCard = html.slice(otherCardStart);
    assert.equal((savingCard.match(/disabled=""/g) ?? []).length, 2);
    assert.equal((savingCard.match(/Čuvanje\.\.\./g) ?? []).length, 2);
    assert.equal((otherCard.match(/disabled=""/g) ?? []).length, 0);
    assert.match(otherCard, />Odbij</);
    assert.match(otherCard, />Prihvati termin</);
  });
}