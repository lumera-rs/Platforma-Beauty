import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  reviewsTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";

const suffix = randomUUID();
const customerEmail = `review-privacy-${suffix}@example.test`;
const customerPassword = "review-privacy-test-password";
const avatarUrl = `https://example.test/private-avatar-${suffix}.jpg`;

async function request(
  baseUrl: string,
  path: string,
  options: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: Record<string, unknown>; cookie?: string } = {},
) {
  return fetch(`${baseUrl}/api${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function run(): Promise<void> {
  await ensureDemoData();
  const createdUserIds: string[] = [];
  let salonId: string | undefined;
  let serviceId: string | undefined;
  let appointmentId: string | undefined;
  let server: ReturnType<typeof app.listen> | undefined;

  try {
    const [owner] = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.role, "SUPER_ADMIN"))
      .limit(1);
    assert.ok(owner, "Review privacy regression test requires a seeded owner.");

    const [customer] = await db.insert(usersTable).values({
      firstName: "Pavle",
      lastName: "Privatni",
      email: customerEmail,
      passwordHash: await hashPassword(customerPassword),
      passwordSetAt: new Date(),
      role: "CUSTOMER",
      avatarUrl,
    }).returning();
    assert.ok(customer, "Review privacy regression test must create its customer.");
    createdUserIds.push(customer.id);

    const [otherCustomer] = await db.insert(usersTable).values({
      firstName: "Mila",
      lastName: "Druga",
      email: `other-${customerEmail}`,
      passwordHash: await hashPassword(customerPassword),
      passwordSetAt: new Date(),
      role: "CUSTOMER",
    }).returning();
    assert.ok(otherCustomer, "Review deletion regression test must create another customer.");
    createdUserIds.push(otherCustomer.id);

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Privacy review salon ${suffix}`,
      slug: `privacy-review-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 41",
      phone: "+381110000041",
      email: `privacy-review-salon-${suffix}@example.test`,
      shortDescription: "Salon za proveru privatnosti recenzija.",
      description: "Izolovan salon za automatsku proveru pristanka na fotografiju.",
      imageUrl: "/test-review-privacy.jpg",
    }).returning();
    assert.ok(salon, "Review privacy regression test must create its salon.");
    salonId = salon.id;

    const [service] = await db.insert(servicesTable).values({
      salonId: salon.id,
      categoryName: "Test",
      name: "Privatni tretman",
      description: "Usluga za proveru privatnosti recenzija.",
      durationMinutes: 60,
      price: 1000,
      imageUrl: "/test-review-privacy.jpg",
    }).returning();
    assert.ok(service, "Review privacy regression test must create its service.");
    serviceId = service.id;

    const [appointment] = await db.insert(appointmentsTable).values({
      salonId: salon.id,
      customerId: customer.id,
      serviceId: service.id,
      date: "2024-01-10",
      startTime: "10:00",
      endTime: "11:00",
      durationMinutes: 60,
      price: 1000,
      status: "completed",
    }).returning();
    assert.ok(appointment, "Review privacy regression test must create a completed visit.");
    appointmentId = appointment.id;

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const login = await request(baseUrl, "/auth/login", {
      method: "POST",
      body: { email: customerEmail, password: customerPassword },
    });
    assert.equal(login.status, 200, "The fixture customer must be able to sign in through the real API.");
    const session = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(session?.startsWith(`${sessionCookieName}=`), "Login must establish a customer session.");

    const createPrivateReview = await request(baseUrl, `/customer/reviews/${salon.id}`, {
      method: "PUT",
      cookie: session,
      body: {
        serviceName: service.name,
        rating: 5,
        text: "Fotografija je privatna.",
        showProfilePhoto: false,
      },
    });
    assert.equal(createPrivateReview.status, 200, "A completed customer visit must be able to create a private review.");
    assert.equal((await createPrivateReview.json() as { showProfilePhoto: boolean }).showProfilePhoto, false);

    const privateSalonResponse = await request(baseUrl, `/salons/${salon.slug}`);
    assert.equal(privateSalonResponse.status, 200);
    const privateSalon = await privateSalonResponse.json() as { reviews: Array<{ text: string; avatarUrl: string | null }> };
    const privateReview = privateSalon.reviews.find((review) => review.text === "Fotografija je privatna.");
    assert.ok(privateReview, "The public salon response must include the saved review.");
    assert.equal(privateReview.avatarUrl, null, "The public salon response must not leak an avatar without consent.");

    const publishPhoto = await request(baseUrl, `/customer/reviews/${salon.id}`, {
      method: "PUT",
      cookie: session,
      body: {
        serviceName: service.name,
        rating: 5,
        text: "Fotografija je javna uz pristanak.",
        showProfilePhoto: true,
      },
    });
    assert.equal(publishPhoto.status, 200, "An existing review must allow a customer to grant photo consent.");
    assert.equal((await publishPhoto.json() as { showProfilePhoto: boolean }).showProfilePhoto, true);

    const publicSalonResponse = await request(baseUrl, `/salons/${salon.slug}`);
    assert.equal(publicSalonResponse.status, 200);
    const publicSalon = await publicSalonResponse.json() as { reviews: Array<{ text: string; avatarUrl: string | null }> };
    const publicReview = publicSalon.reviews.find((review) => review.text === "Fotografija je javna uz pristanak.");
    assert.ok(publicReview, "The consented review must remain public.");
    assert.equal(publicReview.avatarUrl, avatarUrl, "The public salon response must expose an avatar only after consent.");

    await db.delete(appointmentsTable).where(eq(appointmentsTable.id, appointment.id));
    appointmentId = undefined;

    const historicalContextResponse = await request(baseUrl, `/customer/reviews/${salon.id}`, { cookie: session });
    assert.equal(historicalContextResponse.status, 200);
    const historicalContext = await historicalContextResponse.json() as {
      review: { serviceName: string; showProfilePhoto: boolean } | null;
      eligibleServices: string[];
    };
    assert.deepEqual(historicalContext.eligibleServices, [], "The fixture must no longer have an eligible completed service.");
    assert.equal(historicalContext.review?.serviceName, service.name, "The historical review must still be returned for editing.");

    const revokePhoto = await request(baseUrl, `/customer/reviews/${salon.id}`, {
      method: "PUT",
      cookie: session,
      body: {
        serviceName: service.name,
        rating: 4,
        text: "Fotografija je ponovo privatna.",
        showProfilePhoto: false,
      },
    });
    assert.equal(revokePhoto.status, 200, "A historical review must stay editable after its completed visit is no longer eligible.");
    assert.equal((await revokePhoto.json() as { showProfilePhoto: boolean }).showProfilePhoto, false);

    const revokedSalonResponse = await request(baseUrl, `/salons/${salon.slug}`);
    assert.equal(revokedSalonResponse.status, 200);
    const revokedSalon = await revokedSalonResponse.json() as { reviews: Array<{ text: string; avatarUrl: string | null }> };
    const revokedReview = revokedSalon.reviews.find((review) => review.text === "Fotografija je ponovo privatna.");
    assert.ok(revokedReview, "The edited historical review must remain public.");
    assert.equal(revokedReview.avatarUrl, null, "Revoking consent must remove the public avatar URL.");

    const fractionalRating = await request(baseUrl, `/customer/reviews/${salon.id}`, {
      method: "PUT",
      cookie: session,
      body: {
        serviceName: service.name,
        rating: 4.5,
        text: "Ova ocena ne sme biti sačuvana.",
        showProfilePhoto: false,
      },
    });
    assert.equal(fractionalRating.status, 400, "Fractional review ratings must be rejected.");

    const storedReviews = await db.select({ id: reviewsTable.id }).from(reviewsTable).where(and(
      eq(reviewsTable.customerId, customer.id),
      eq(reviewsTable.salonId, salon.id),
    ));
    assert.equal(storedReviews.length, 1, "A customer must have at most one review for the same salon.");

    const [eligibleAppointment] = await db.insert(appointmentsTable).values({
      salonId: salon.id,
      customerId: customer.id,
      serviceId: service.id,
      date: "2024-01-11",
      startTime: "12:00",
      endTime: "13:00",
      durationMinutes: 60,
      price: 1000,
      status: "completed",
    }).returning();
    assert.ok(eligibleAppointment, "The customer needs a completed visit after deleting their review.");
    appointmentId = eligibleAppointment.id;

    await db.insert(reviewsTable).values({
      salonId: salon.id,
      customerId: otherCustomer.id,
      serviceName: service.name,
      rating: 2,
      text: "Tuđa recenzija mora ostati sačuvana.",
      showProfilePhoto: false,
    });

    const deleteOwnReview = await request(baseUrl, `/customer/reviews/${salon.id}`, {
      method: "DELETE",
      cookie: session,
    });
    assert.equal(deleteOwnReview.status, 204, "A signed-in customer must be able to delete their own review.");

    const afterDeleteSalonResponse = await request(baseUrl, `/salons/${salon.slug}`);
    assert.equal(afterDeleteSalonResponse.status, 200);
    const afterDeleteSalon = await afterDeleteSalonResponse.json() as {
      rating: number;
      reviewCount: number;
      reviews: Array<{ text: string; avatarUrl: string | null }>;
    };
    assert.equal(afterDeleteSalon.reviews.some((review) => review.text === "Fotografija je ponovo privatna."), false, "The deleted review must disappear from the public response.");
    assert.equal(afterDeleteSalon.reviews.length, 1, "Deleting a review must not remove another customer's review.");
    assert.equal(afterDeleteSalon.reviews[0]?.text, "Tuđa recenzija mora ostati sačuvana.");
    assert.equal(afterDeleteSalon.reviewCount, 1, "Deleting a review must recalculate the public review count.");
    assert.equal(afterDeleteSalon.rating, 2, "Deleting a review must recalculate the public rating.");

    const afterDeleteContextResponse = await request(baseUrl, `/customer/reviews/${salon.id}`, { cookie: session });
    assert.equal(afterDeleteContextResponse.status, 200);
    const afterDeleteContext = await afterDeleteContextResponse.json() as {
      review: { serviceName: string } | null;
      eligibleServices: string[];
    };
    assert.equal(afterDeleteContext.review, null, "The review editor must no longer load the deleted review.");
    assert.ok(afterDeleteContext.eligibleServices.includes(service.name), "The review editor must return to the completed-service eligibility state.");

    const reviewsAfterDelete = await db.select({ customerId: reviewsTable.customerId }).from(reviewsTable).where(eq(reviewsTable.salonId, salon.id));
    assert.deepEqual(reviewsAfterDelete.map((review) => review.customerId), [otherCustomer.id], "The delete endpoint must only remove the signed-in customer's review.");
    console.log("Review photo privacy regression passed.");
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (salonId) await db.delete(reviewsTable).where(eq(reviewsTable.salonId, salonId));
    if (appointmentId) await db.delete(appointmentsTable).where(eq(appointmentsTable.id, appointmentId));
    if (serviceId) await db.delete(servicesTable).where(eq(servicesTable.id, serviceId));
    if (salonId) await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    if (createdUserIds.length) await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});