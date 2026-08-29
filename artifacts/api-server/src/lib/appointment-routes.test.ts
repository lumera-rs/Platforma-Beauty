import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  appointmentResourceAllocationsTable,
  appointmentSeriesTable,
  appointmentsTable,
  customerPackagePurchasesTable,
  db,
  employeeLocationAssignmentsTable,
  employeeServicesTable,
  employeeTimeOffTable,
  employeesTable,
  mediaAssetsTable,
  packagePurchaseServiceLinksTable,
  packageRedemptionsTable,
  pool,
  salonCustomersTable,
  salonHoursTable,
  salonResourcesTable,
  serviceResourceRequirementsTable,
  salonsTable,
  servicesTable,
  treatmentPackagesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { lockAppointmentResources } from "./appointment-locks";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import { assertNoPgBusyClientWarnings } from "./pg-busy-client.test-support";
import { ensureDemoData } from "./seed";

const suffix = randomUUID();
const primarySalonDate = "2099-10-18";
const movedSeriesDate = "2099-10-19";
const completedOrCancelledDate = "2099-10-20";
const employeeBookingDate = "2099-10-21";
const customerBookingDate = "2099-10-23";
const updatedCustomerBookingDate = "2099-10-24";
const salonBookingDate = "2099-10-25";
const salonSeriesDate = "2099-10-26";
const movedSalonSeriesDate = "2099-10-27";
const employeeSeriesDate = "2099-10-28";
const homeServiceBookingDate = "2099-10-29";
const educationCourseDate = "2099-11-02";
const updatedEducationCourseDate = "2099-11-03";
const concurrentBookingDate = "2099-11-04";
const resourceTestDate = "2099-11-05";
const resourceConflictDate = "2099-11-06";

type HttpResult = {
  status: number;
  body: unknown;
};

type PublicSalonCard = {
  id: string;
  acceptsCards: boolean;
  instantBooking: boolean;
  homeService: boolean;
  servesMen: boolean;
  hasDiscount: boolean;
  openSunday: boolean;
  featured: boolean;
  topSalon: boolean;
};

function fixtureEmail(role: string) {
  return `${role}-${suffix}@example.test`;
}

function assertCalendarDate(value: string, expected: string, message: string): void {
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/, `${message} must be a YYYY-MM-DD calendar date`);
  assert.equal(value, expected, message);
}

async function request(
  baseUrl: string,
  session: string,
  path: string,
  method: "DELETE" | "PATCH" | "POST",
  body: Record<string, unknown>,
): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: `${sessionCookieName}=${session}`,
    },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json(),
  };
}

async function getRequest(baseUrl: string, session: string, path: string): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    headers: { cookie: `${sessionCookieName}=${session}` },
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

async function getPublicSalonCards(baseUrl: string, query: string): Promise<PublicSalonCard[]> {
  const response = await fetch(`${baseUrl}/api/salons?${query}`);
  assert.equal(response.status, 200, `public salon filter "${query}" must succeed`);
  return await response.json() as PublicSalonCard[];
}

async function assertPublicSalonBooleanFilter(
  baseUrl: string,
  queryKey: "discountsOnly" | "openSunday" | "featured" | "topSalon",
  responseKey: "hasDiscount" | "openSunday" | "featured" | "topSalon",
  positiveFixtureId: string,
  negativeFixtureId: string,
): Promise<void> {
  for (const expectedValue of [true, false]) {
    const salons = await getPublicSalonCards(baseUrl, `${queryKey}=${expectedValue}`);
    assert.ok(
      salons.every((item) => item[responseKey] === expectedValue),
      `${queryKey}=${expectedValue} must only return salons with the requested saved value`,
    );
    const matchingFixtureId = expectedValue ? positiveFixtureId : negativeFixtureId;
    const excludedFixtureId = expectedValue ? negativeFixtureId : positiveFixtureId;
    assert.ok(
      salons.some((item) => item.id === matchingFixtureId),
      `${queryKey}=${expectedValue} must include its matching isolated fixture salon`,
    );
    assert.ok(
      !salons.some((item) => item.id === excludedFixtureId),
      `${queryKey}=${expectedValue} must exclude its opposite isolated fixture salon`,
    );
  }
}

async function run(): Promise<void> {
  await ensureBusinessGrowthSchema();
  await ensureDemoData();
  const [seededMenService] = await db.select({
    salonId: servicesTable.salonId,
  }).from(servicesTable).where(eq(servicesTable.categoryName, "Muški frizeri")).limit(1);
  assert.ok(seededMenService, "demo data must include a salon with men's services");
  const [seededMenSalon] = await db.select({
    id: salonsTable.id,
    servesMen: salonsTable.servesMen,
  }).from(salonsTable).where(eq(salonsTable.id, seededMenService.salonId));
  assert.equal(seededMenSalon!.servesMen, true, "a salon with seeded men's services must be discoverable as serving men");
  const passwordHash = await hashPassword("test-password");
  const createdUserIds: string[] = [];
  const concurrentBookingAppointmentIds: string[] = [];
  let server: ReturnType<typeof app.listen> | undefined;

  try {
    const [owner, customer, otherCustomer, employeeUser, admin] = await db.insert(usersTable).values([
      {
        firstName: "Vlasnik",
        lastName: "HTTP test",
        email: fixtureEmail("owner"),
        passwordHash,
        passwordSetAt: new Date(),
        role: "SALON_OWNER",
      },
      {
        firstName: "Kupac",
        lastName: "HTTP test",
        email: fixtureEmail("customer"),
        passwordHash,
        passwordSetAt: new Date(),
        role: "CUSTOMER",
      },
      {
        firstName: "Drugi kupac",
        lastName: "HTTP test",
        email: fixtureEmail("other-customer"),
        passwordHash,
        passwordSetAt: new Date(),
        role: "CUSTOMER",
      },
      {
        firstName: "Zaposleni",
        lastName: "HTTP test",
        email: fixtureEmail("employee"),
        passwordHash,
        passwordSetAt: new Date(),
        role: "SALON_EMPLOYEE",
      },
      {
        firstName: "Administrator",
        lastName: "HTTP test",
        email: fixtureEmail("admin"),
        passwordHash,
        passwordSetAt: new Date(),
        role: "ADMIN",
      },
    ]).returning();
    createdUserIds.push(owner!.id, customer!.id, otherCustomer!.id, employeeUser!.id, admin!.id);

    const [salon, foreignSalon] = await db.insert(salonsTable).values([
      {
        ownerId: owner!.id,
        name: `HTTP termin salon ${suffix}`,
        slug: `http-appointment-salon-${suffix}`,
        city: "Beograd",
        municipality: "Vračar",
        address: "Test 29",
        postalCode: "11000",
        phone: "+381110000029",
        email: fixtureEmail("salon"),
        latitude: 44.7981,
        longitude: 20.4734,
        shortDescription: "Izolovan salon za HTTP regresione testove termina.",
        description: "Izolovan salon za proveru zaključavanja, statusa i autorizacije termina.",
        imageUrl: "/test.jpg",
        acceptsCards: true,
        instantBooking: true,
        homeService: false,
        servesMen: true,
        featured: true,
        topSalon: true,
      },
      {
        ownerId: owner!.id,
        name: `Drugi HTTP salon ${suffix}`,
        slug: `foreign-http-appointment-salon-${suffix}`,
        city: "Novi Sad",
        municipality: "Centar",
        address: "Test 30",
        phone: "+381110000030",
        email: fixtureEmail("foreign-salon"),
        shortDescription: "Drugi izolovan salon za autorizacioni test.",
        description: "Salon koji sadrži zaposlenog nedostupnog vlasniku aktivnog salona.",
        imageUrl: "/test.jpg",
        acceptsCards: false,
        instantBooking: false,
        homeService: true,
        servesMen: false,
        featured: false,
        topSalon: false,
      },
    ]).returning();
    await db.update(usersTable).set({ activeSalonId: salon!.id }).where(eq(usersTable.id, owner!.id));

    const [service] = await db.insert(servicesTable).values({
      salonId: salon!.id,
      categoryName: "Test",
      name: "HTTP zaključavanje termina",
      description: "Usluga za proveru HTTP tokova termina.",
      durationMinutes: 60,
      price: 1000,
      promoPrice: 800,
      imageUrl: "/test.jpg",
    }).returning();
    await db.insert(servicesTable).values({
      salonId: foreignSalon!.id,
      categoryName: "Test",
      name: "Mobilna HTTP usluga",
      description: "Usluga za proveru filtriranja dostupnosti na adresi.",
      durationMinutes: 60,
      price: 1000,
      imageUrl: "/test.jpg",
      homeServiceAvailable: true,
    });
    await db.insert(salonHoursTable).values([
      {
        salonId: salon!.id,
        weekday: 7,
        openTime: "10:00",
        closeTime: "18:00",
        closed: false,
      },
      {
        salonId: foreignSalon!.id,
        weekday: 7,
        openTime: "10:00",
        closeTime: "18:00",
        closed: true,
      },
    ]);
    const [employee, foreignEmployee] = await db.insert(employeesTable).values([
      {
        salonId: salon!.id,
        userId: employeeUser!.id,
        name: "Zaposleni za HTTP test",
        role: "Stilist",
        bio: "",
        avatarUrl: "",
      },
      {
        salonId: foreignSalon!.id,
        name: "Zaposleni drugog salona",
        role: "Stilist",
        bio: "",
        avatarUrl: "",
      },
    ]).returning();
    await db.insert(employeeLocationAssignmentsTable).values([
      {
        employeeId: employee!.id,
        salonId: salon!.id,
        active: true,
        isDefault: true,
      },
      {
        employeeId: foreignEmployee!.id,
        salonId: foreignSalon!.id,
        active: true,
        isDefault: true,
      },
    ]);
    await db.insert(employeeServicesTable).values({ employeeId: employee!.id, serviceId: service!.id });

    const [contact] = await db.insert(salonCustomersTable).values({
      salonId: salon!.id,
      userId: customer!.id,
      firstName: customer!.firstName,
      lastName: customer!.lastName,
      phone: "+381611234529",
      phoneNormalized: "+381611234529",
    }).returning();

    // The employee booking route only permits existing clients they have served.
    await db.insert(appointmentsTable).values({
      salonId: salon!.id,
      customerId: customer!.id,
      salonCustomerId: contact!.id,
      employeeId: employee!.id,
      serviceId: service!.id,
      date: "2099-10-17",
      startTime: "09:00",
      endTime: "10:00",
      durationMinutes: 60,
      price: 1000,
      status: "completed",
    });

    const [series] = await db.insert(appointmentSeriesTable).values({
      salonId: salon!.id,
      salonCustomerId: contact!.id,
      serviceId: service!.id,
      employeeId: employee!.id,
      totalAppointments: 1,
      createdByUserId: owner!.id,
    }).returning();
    const [seriesAppointment, completionRaceAppointment, cancelledAppointment, noShowAppointment] = await db.insert(appointmentsTable).values([
      {
        salonId: salon!.id,
        customerId: customer!.id,
        salonCustomerId: contact!.id,
        employeeId: employee!.id,
        serviceId: service!.id,
        seriesId: series!.id,
        date: primarySalonDate,
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        price: 1000,
        status: "confirmed",
      },
      {
        salonId: salon!.id,
        customerId: customer!.id,
        salonCustomerId: contact!.id,
        employeeId: employee!.id,
        serviceId: service!.id,
        date: completedOrCancelledDate,
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        price: 1000,
        status: "confirmed",
      },
      {
        salonId: salon!.id,
        customerId: customer!.id,
        salonCustomerId: contact!.id,
        employeeId: employee!.id,
        serviceId: service!.id,
        date: "2099-10-22",
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        price: 1000,
        status: "cancelled",
      },
      {
        salonId: salon!.id,
        customerId: customer!.id,
        salonCustomerId: contact!.id,
        employeeId: employee!.id,
        serviceId: service!.id,
        date: "2099-10-23",
        startTime: "10:00",
        endTime: "11:00",
        durationMinutes: 60,
        price: 1000,
        status: "no-show",
      },
    ]).returning();

    const [ownerSession, customerSession, otherCustomerSession, employeeSession, adminSession] = await Promise.all([
      createSession(owner!.id),
      createSession(customer!.id),
      createSession(otherCustomer!.id),
      createSession(employeeUser!.id),
      createSession(admin!.id),
    ]);

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const publicProfileResponse = await fetch(`${baseUrl}/api/salons/${salon!.slug}`);
    assert.equal(publicProfileResponse.status, 200, "a public salon profile must remain discoverable");
    const publicProfile = await publicProfileResponse.json() as Record<string, unknown>;
    for (const privateField of ["address", "phone", "email", "latitude", "longitude"]) {
      assert.ok(!Object.hasOwn(publicProfile, privateField), `public salon profiles must omit ${privateField}`);
    }
    assert.ok(!JSON.stringify(publicProfile).includes("Test 29"), "public salon profiles must not serialize the street address");
    assert.ok(!JSON.stringify(publicProfile).includes("+381110000029"), "public salon profiles must not serialize the phone number");
    assert.ok(!JSON.stringify(publicProfile).includes(fixtureEmail("salon")), "public salon profiles must not serialize the email address");
    const publicStaff = publicProfile.staff;
    assert.ok(Array.isArray(publicStaff), "public salon profiles must include their active staff");
    const publicEmployee = publicStaff.find((item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && item.id === employee!.id,
    );
    assert.equal(
      publicEmployee?.canOrderIndependently,
      false,
      "public salon profiles must normalize an employee's omitted purchasing permission to the database default",
    );

    const publicSalonCards = await getPublicSalonCards(baseUrl, "city=Beograd");
    const publicFixtureCard = publicSalonCards.find((item) => item.id === salon!.id) as Record<string, unknown> | undefined;
    assert.ok(publicFixtureCard, "public salon search must include the fixture salon");
    for (const privateField of ["address", "phone", "email", "latitude", "longitude"]) {
      assert.ok(!Object.hasOwn(publicFixtureCard!, privateField), `public salon cards must omit ${privateField}`);
    }

    const anonymousContactResponse = await fetch(`${baseUrl}/api/appointments/${seriesAppointment!.id}/salon-contact`);
    assert.notEqual(anonymousContactResponse.status, 200, "anonymous visitors must not retrieve salon contact details");
    const privateSalonContact = await getRequest(baseUrl, customerSession, `/appointments/${seriesAppointment!.id}/salon-contact`);
    assert.equal(privateSalonContact.status, 200, "a customer must retrieve contact details for their qualifying booking");
    assert.deepEqual(privateSalonContact.body, {
      appointmentId: seriesAppointment!.id,
      name: salon!.name,
      phone: salon!.phone,
      email: salon!.email,
      address: salon!.address,
      postalCode: salon!.postalCode,
      city: salon!.city,
      latitude: salon!.latitude,
      longitude: salon!.longitude,
    }, "the protected appointment-contact view must expose the complete salon contact details only after booking");
    const cancelledContact = await getRequest(baseUrl, customerSession, `/appointments/${cancelledAppointment!.id}/salon-contact`);
    assert.equal(cancelledContact.status, 403, "a cancelled appointment must not qualify for salon contact details");
    const noShowContact = await getRequest(baseUrl, customerSession, `/appointments/${noShowAppointment!.id}/salon-contact`);
    assert.equal(noShowContact.status, 403, "a no-show appointment must not qualify for salon contact details");
    const anotherCustomerContact = await getRequest(baseUrl, otherCustomerSession, `/appointments/${seriesAppointment!.id}/salon-contact`);
    assert.equal(anotherCustomerContact.status, 404, "a different customer must not retrieve another customer's salon contact details");

    const mobileServiceCreate = await request(baseUrl, ownerSession, "/salon/services", "POST", {
      category: "Test",
      name: "Aktivna usluga na adresi",
      description: "Usluga za proveru salonskog indikatora dolaska.",
      durationMinutes: 30,
      price: 1200,
      promoPrice: null,
      imageUrl: "/test.jpg",
      active: true,
      homeServiceAvailable: true,
      homeServiceFee: 200,
      homeServiceMinimumOrder: null,
    });
    assert.equal(mobileServiceCreate.status, 201, "an owner must be able to add an active home-service offering");
    const mobileService = mobileServiceCreate.body as { id: string };

    const inSalonServiceCreate = await request(baseUrl, ownerSession, "/salon/services", "POST", {
      category: "Test",
      name: "Aktivna usluga u salonu",
      description: "Usluga bez dolaska za proveru salonskog indikatora.",
      durationMinutes: 30,
      price: 900,
      promoPrice: null,
      imageUrl: "/test.jpg",
      active: true,
      homeServiceAvailable: false,
      homeServiceFee: 0,
      homeServiceMinimumOrder: null,
    });
    assert.equal(inSalonServiceCreate.status, 201, "an owner must be able to add an in-salon offering");
    const inSalonService = inSalonServiceCreate.body as { id: string };

    const listedServices = await getRequest(baseUrl, ownerSession, "/salon/services");
    assert.equal(listedServices.status, 200, "an owner must be able to see service removal eligibility");
    const serviceEligibility = listedServices.body as Array<{ id: string; canBePermanentlyDeleted: boolean }>;
    assert.equal(
      serviceEligibility.find((item) => item.id === service!.id)?.canBePermanentlyDeleted,
      false,
      "a service with appointment history must be marked as protected before deletion is attempted",
    );
    assert.equal(
      serviceEligibility.find((item) => item.id === inSalonService.id)?.canBePermanentlyDeleted,
      true,
      "an unused service must remain eligible for permanent deletion",
    );
    const protectedServiceDeletion = await request(baseUrl, ownerSession, `/salon/services/${service!.id}`, "DELETE", {});
    assert.equal(protectedServiceDeletion.status, 409, "the deletion guard must still protect a service with appointment history");

    const profileAfterInSalonService = await getRequest(baseUrl, ownerSession, "/salon/profile");
    assert.equal(
      (profileAfterInSalonService.body as { homeService: boolean }).homeService,
      true,
      "adding an in-salon service must preserve the salon home-service indicator when another active service offers visits",
    );

    const deactivateMobileService = await request(baseUrl, ownerSession, `/salon/services/${mobileService.id}`, "PATCH", {
      category: "Test",
      name: "Neaktivna usluga na adresi",
      description: "Deaktivirana usluga za proveru salonskog indikatora.",
      durationMinutes: 30,
      price: 1200,
      promoPrice: null,
      imageUrl: "/test.jpg",
      active: false,
      homeServiceAvailable: true,
      homeServiceFee: 200,
      homeServiceMinimumOrder: null,
    });
    assert.equal(deactivateMobileService.status, 200, "an owner must be able to deactivate a home-service offering");
    const profileAfterDeactivation = await getRequest(baseUrl, ownerSession, "/salon/profile");
    assert.equal(
      (profileAfterDeactivation.body as { homeService: boolean }).homeService,
      false,
      "deactivating the last active home-service offering must clear the salon home-service indicator",
    );

    const enableInSalonServiceForHome = await request(baseUrl, ownerSession, `/salon/services/${inSalonService.id}`, "PATCH", {
      category: "Test",
      name: "Usluga sada na adresi",
      description: "Izmenjena usluga za proveru salonskog indikatora.",
      durationMinutes: 30,
      price: 900,
      promoPrice: null,
      imageUrl: "/test.jpg",
      active: true,
      homeServiceAvailable: true,
      homeServiceFee: 150,
      homeServiceMinimumOrder: null,
    });
    assert.equal(enableInSalonServiceForHome.status, 200, "an owner must be able to enable home visits for an active service");
    const profileAfterServiceUpdate = await getRequest(baseUrl, ownerSession, "/salon/profile");
    assert.equal(
      (profileAfterServiceUpdate.body as { homeService: boolean }).homeService,
      true,
      "editing an active service to offer home visits must restore the salon home-service indicator",
    );

    const disableInSalonServiceHomeVisits = await request(baseUrl, ownerSession, `/salon/services/${inSalonService.id}`, "PATCH", {
      category: "Test",
      name: "Usluga sada samo u salonu",
      description: "Vraćena usluga za proveru salonskog indikatora.",
      durationMinutes: 30,
      price: 900,
      promoPrice: null,
      imageUrl: "/test.jpg",
      active: true,
      homeServiceAvailable: false,
      homeServiceFee: 0,
      homeServiceMinimumOrder: null,
    });
    assert.equal(disableInSalonServiceHomeVisits.status, 200, "an owner must be able to remove home visits from a service");
    const profileAfterRemovingHomeVisits = await getRequest(baseUrl, ownerSession, "/salon/profile");
    assert.equal(
      (profileAfterRemovingHomeVisits.body as { homeService: boolean }).homeService,
      false,
      "removing home visits from the last active offering must clear the salon home-service indicator",
    );
    const manualHomeServiceProfileUpdate = await request(baseUrl, ownerSession, "/salon/profile", "PATCH", {
      homeService: true,
    });
    assert.equal(
      manualHomeServiceProfileUpdate.status,
      400,
      "an owner must not be able to manually enable home visits on the salon profile",
    );
    assert.match(
      (manualHomeServiceProfileUpdate.body as { error: string }).error,
      /aktivne usluge/,
      "the profile update must explain that active services control home visits",
    );
    const profileAfterManualHomeServiceAttempt = await getRequest(baseUrl, ownerSession, "/salon/profile");
    assert.equal(
      (profileAfterManualHomeServiceAttempt.body as { homeService: boolean }).homeService,
      false,
      "the managed profile must keep deriving home visits from active services after a manual update attempt",
    );
    const [salonAfterManualHomeServiceAttempt] = await db.select({ homeService: salonsTable.homeService })
      .from(salonsTable).where(eq(salonsTable.id, salon!.id)).limit(1);
    assert.equal(
      salonAfterManualHomeServiceAttempt!.homeService,
      false,
      "a rejected profile update must not persist home visits without an active service",
    );

    const unavailableHomeBooking = await request(baseUrl, customerSession, "/appointments", "POST", {
      salonId: salon!.id,
      serviceId: service!.id,
      date: homeServiceBookingDate,
      startTime: "10:00",
      treatmentLocation: "home",
      treatmentAddress: { line1: "Privatna 74", city: "Beograd" },
    });
    assert.equal(unavailableHomeBooking.status, 400, "a service without home availability must reject a home appointment");
    assert.match(
      (unavailableHomeBooking.body as { error: string }).error,
      /nije dostupna na vašoj adresi/,
      "the unavailable-home-service response must explain why the booking was rejected",
    );

    await db.update(usersTable).set({
      phone: "+381611234529",
      phoneNormalized: "+381611234529",
    }).where(eq(usersTable.id, customer!.id));
    await db.update(servicesTable).set({
      homeServiceAvailable: true,
      homeServiceFee: 250,
      homeServiceMinimumOrder: 900,
    }).where(eq(servicesTable.id, service!.id));

    const belowMinimumHomeBooking = await request(baseUrl, customerSession, "/appointments", "POST", {
      salonId: salon!.id,
      serviceId: service!.id,
      date: homeServiceBookingDate,
      startTime: "10:00",
      treatmentLocation: "home",
      treatmentAddress: { line1: "Privatna 74", city: "Beograd" },
    });
    assert.equal(belowMinimumHomeBooking.status, 400, "a home appointment below the service minimum must be rejected");
    assert.match(
      (belowMinimumHomeBooking.body as { error: string }).error,
      /Minimalna vrednost usluge za dolazak je 900 RSD/,
      "the home-service minimum must be enforced against the service price",
    );

    await db.update(servicesTable).set({ homeServiceMinimumOrder: 750 }).where(eq(servicesTable.id, service!.id));
    const homeBooking = await request(baseUrl, customerSession, "/appointments", "POST", {
      salonId: salon!.id,
      serviceId: service!.id,
      date: homeServiceBookingDate,
      startTime: "10:00",
      treatmentLocation: "home",
      treatmentAddress: {
        line1: "Privatna 74",
        city: "Beograd",
        postalCode: "11000",
        details: "Pozvoniti na interfon 12",
      },
    });
    assert.equal(homeBooking.status, 201, "an eligible home appointment must be created");
    const createdHomeAppointment = homeBooking.body as {
      id: string;
      status: string;
      price: number;
      treatmentLocation: string;
      travelFee: number;
      treatmentAddress: { line1: string; city: string; postalCode: string | null; details: string | null } | null;
    };
    assert.equal(createdHomeAppointment.status, "pending", "a home appointment must remain pending even when instant booking is enabled");
    assert.equal(createdHomeAppointment.treatmentLocation, "home", "the appointment must preserve its home treatment location");
    assert.equal(createdHomeAppointment.travelFee, 250, "the home-service fee must be stored separately from the service price");
    assert.equal(createdHomeAppointment.price, 1050, "the appointment total must include the service price and home-service fee");
    assert.deepEqual(
      createdHomeAppointment.treatmentAddress,
      { line1: "Privatna 74", city: "Beograd", postalCode: "11000", details: "Pozvoniti na interfon 12" },
      "the customer creating a home appointment must receive its full address",
    );

    const customerHomeAppointments = await getRequest(baseUrl, customerSession, "/appointments");
    assert.equal(customerHomeAppointments.status, 200, "a customer must be able to retrieve their home appointment");
    const customerHomeAppointment = (customerHomeAppointments.body as Array<{ id: string; treatmentAddress: unknown }>).find(
      (appointment) => appointment.id === createdHomeAppointment.id,
    );
    assert.deepEqual(
      customerHomeAppointment?.treatmentAddress,
      createdHomeAppointment.treatmentAddress,
      "the customer must retain access to the full treatment address",
    );

    const ownerHomeAppointments = await getRequest(baseUrl, ownerSession, "/salon/appointments");
    assert.equal(ownerHomeAppointments.status, 200, "the salon owner must be able to retrieve home appointments");
    const ownerHomeAppointment = (ownerHomeAppointments.body as Array<{ id: string; treatmentAddress: unknown }>).find(
      (appointment) => appointment.id === createdHomeAppointment.id,
    );
    assert.deepEqual(
      ownerHomeAppointment?.treatmentAddress,
      createdHomeAppointment.treatmentAddress,
      "the salon owner must receive the full treatment address",
    );

    const employeePortal = await getRequest(baseUrl, employeeSession, "/employee/portal");
    assert.equal(employeePortal.status, 200, "an employee must be able to retrieve their portal");
    const employeeHomeAppointment = (employeePortal.body as { appointments: Array<Record<string, unknown>> }).appointments.find(
      (appointment) => appointment.id === createdHomeAppointment.id,
    );
    assert.ok(employeeHomeAppointment, "the assigned employee portal must include the home appointment");
    assert.ok(
      !Object.hasOwn(employeeHomeAppointment, "treatmentAddress"),
      "employees must not receive private treatment-address fields",
    );
    assert.ok(
      !JSON.stringify(employeePortal.body).includes("Privatna 74"),
      "employees must not receive the private treatment address anywhere in their portal response",
    );
    await db.update(servicesTable).set({
      homeServiceAvailable: false,
      homeServiceFee: 0,
      homeServiceMinimumOrder: null,
    }).where(eq(servicesTable.id, service!.id));

    const acceptsCardsSalons = await getPublicSalonCards(baseUrl, "acceptsCards=true");
    assert.ok(acceptsCardsSalons.every((item) => item.acceptsCards), "acceptsCards=true must only return card-accepting salons");
    assert.ok(acceptsCardsSalons.some((item) => item.id === salon!.id), "acceptsCards=true must include the card-accepting fixture salon");
    assert.ok(!acceptsCardsSalons.some((item) => item.id === foreignSalon!.id), "acceptsCards=true must exclude the non-card fixture salon");

    const cashOnlySalons = await getPublicSalonCards(baseUrl, "acceptsCards=false");
    assert.ok(cashOnlySalons.every((item) => !item.acceptsCards), "acceptsCards=false must only return non-card salons");
    assert.ok(cashOnlySalons.some((item) => item.id === foreignSalon!.id), "acceptsCards=false must include the non-card fixture salon");
    assert.ok(!cashOnlySalons.some((item) => item.id === salon!.id), "acceptsCards=false must exclude the card-accepting fixture salon");

    const instantBookingSalons = await getPublicSalonCards(baseUrl, "instantBooking=true");
    assert.ok(instantBookingSalons.every((item) => item.instantBooking), "instantBooking=true must only return instant-booking salons");
    assert.ok(instantBookingSalons.some((item) => item.id === salon!.id), "instantBooking=true must include the instant-booking fixture salon");
    assert.ok(!instantBookingSalons.some((item) => item.id === foreignSalon!.id), "instantBooking=true must exclude the pending-booking fixture salon");

    const pendingBookingSalons = await getPublicSalonCards(baseUrl, "instantBooking=false");
    assert.ok(pendingBookingSalons.every((item) => !item.instantBooking), "instantBooking=false must only return pending-booking salons");
    assert.ok(pendingBookingSalons.some((item) => item.id === foreignSalon!.id), "instantBooking=false must include the pending-booking fixture salon");
    assert.ok(!pendingBookingSalons.some((item) => item.id === salon!.id), "instantBooking=false must exclude the instant-booking fixture salon");

    const homeServiceSalons = await getPublicSalonCards(baseUrl, "homeService=true");
    assert.ok(homeServiceSalons.every((item) => item.homeService), "homeService=true must only return salons that offer home service");
    assert.ok(homeServiceSalons.some((item) => item.id === foreignSalon!.id), "homeService=true must include the home-service fixture salon");
    assert.ok(!homeServiceSalons.some((item) => item.id === salon!.id), "homeService=true must exclude the in-salon-only fixture salon");

    const inSalonOnly = await getPublicSalonCards(baseUrl, "homeService=false");
    assert.ok(inSalonOnly.every((item) => !item.homeService), "homeService=false must only return in-salon-only salons");
    assert.ok(inSalonOnly.some((item) => item.id === salon!.id), "homeService=false must include the in-salon-only fixture salon");
    assert.ok(!inSalonOnly.some((item) => item.id === foreignSalon!.id), "homeService=false must exclude the home-service fixture salon");

    const menSalons = await getPublicSalonCards(baseUrl, "gender=men");
    assert.ok(menSalons.every((item) => item.servesMen), "gender=men must only return salons marked as serving men");
    assert.ok(menSalons.some((item) => item.id === seededMenSalon!.id), "gender=men must include a salon with seeded men's services");
    assert.ok(menSalons.some((item) => item.id === salon!.id), "gender=men must include the men-serving fixture salon");
    assert.ok(!menSalons.some((item) => item.id === foreignSalon!.id), "gender=men must exclude the salon not marked as serving men");

    await assertPublicSalonBooleanFilter(baseUrl, "discountsOnly", "hasDiscount", salon!.id, foreignSalon!.id);
    await assertPublicSalonBooleanFilter(baseUrl, "openSunday", "openSunday", salon!.id, foreignSalon!.id);
    await assertPublicSalonBooleanFilter(baseUrl, "featured", "featured", salon!.id, foreignSalon!.id);
    await assertPublicSalonBooleanFilter(baseUrl, "topSalon", "topSalon", salon!.id, foreignSalon!.id);

    const availability = await fetch(
      `${baseUrl}/api/salons/${salon!.id}/availability?serviceId=${service!.id}&date=${employeeBookingDate}&employeeId=${employee!.id}`,
    );
    assert.equal(availability.status, 200, "parallel availability reads must use pool clients safely");

    const customerBooking = await request(baseUrl, customerSession, "/appointments", "POST", {
      salonId: salon!.id,
      serviceId: service!.id,
      date: customerBookingDate,
      startTime: "12:00",
      employeeId: employee!.id,
    });
    assert.equal(customerBooking.status, 201, "a customer must be able to create an available appointment");
    const createdCustomerAppointment = customerBooking.body as { id: string; date: string; startTime: string; status: string };
    assert.equal(createdCustomerAppointment.status, "confirmed", "instantBooking=true must create confirmed appointments on the server");
    const [persistedCustomerAppointment] = await db.select().from(appointmentsTable)
      .where(eq(appointmentsTable.id, createdCustomerAppointment.id));
    assert.equal(persistedCustomerAppointment!.customerId, customer!.id, "customer booking must persist its customer ownership");
    assert.equal(persistedCustomerAppointment!.status, "confirmed", "instantBooking=true must persist a confirmed appointment");

    const concurrentBookingPayload = {
      salonId: salon!.id,
      serviceId: service!.id,
      date: concurrentBookingDate,
      startTime: "10:00",
    };
    const concurrentBookingResults = await Promise.all([
      request(baseUrl, customerSession, "/appointments", "POST", concurrentBookingPayload),
      request(baseUrl, otherCustomerSession, "/appointments", "POST", concurrentBookingPayload),
    ].map(async (promise, index) => ({
      session: index === 0 ? customerSession : otherCustomerSession,
      response: await promise,
    })));
    assert.deepEqual(
      concurrentBookingResults.map(({ response }) => response.status).sort((left, right) => left - right),
      [201, 409],
      "parallel customer booking requests must leave one overlapping slot unavailable",
    );
    const winningConcurrentBooking = concurrentBookingResults.find(({ response }) => response.status === 201);
    const losingConcurrentBooking = concurrentBookingResults.find(({ response }) => response.status === 409);
    assert.ok(winningConcurrentBooking, "one customer must win the concurrent booking race");
    assert.ok(losingConcurrentBooking, "the other customer must receive a conflict response");
    const winningAppointment = winningConcurrentBooking!.response.body as { id: string; date: string; startTime: string };
    concurrentBookingAppointmentIds.push(winningAppointment.id);
    assertCalendarDate(winningAppointment.date, concurrentBookingDate, "the winning concurrent booking date");
    assert.equal(winningAppointment.startTime, "10:00", "the winning concurrent booking must claim the requested slot");
    assert.match(
      (losingConcurrentBooking!.response.body as { error: string }).error,
      /Osvežite dostupnost i izaberite drugi termin/,
      "the losing customer must receive a clear stale-availability retry message",
    );

    const refreshedAvailability = await getRequest(
      baseUrl,
      losingConcurrentBooking!.session,
      `/salons/${salon!.id}/availability?serviceId=${service!.id}&date=${concurrentBookingDate}`,
    );
    assert.equal(refreshedAvailability.status, 200, "the losing customer must be able to refresh availability");
    const refreshedSlots = refreshedAvailability.body as Array<{ start: string }>;
    assert.ok(!refreshedSlots.some((slot) => slot.start === "10:00"), "the refreshed availability must omit the claimed slot");
    assert.ok(refreshedSlots.some((slot) => slot.start === "12:00"), "the refreshed availability must offer another slot");

    const retryBooking = await request(baseUrl, losingConcurrentBooking!.session, "/appointments", "POST", {
      ...concurrentBookingPayload,
      startTime: "12:00",
    });
    assert.equal(retryBooking.status, 201, "the losing customer must be able to book another slot after refreshing");
    const retryAppointment = retryBooking.body as { id: string; date: string; startTime: string };
    concurrentBookingAppointmentIds.push(retryAppointment.id);
    assertCalendarDate(retryAppointment.date, concurrentBookingDate, "the retry booking date");
    assert.equal(retryAppointment.startTime, "12:00", "the retry booking must claim the newly selected slot");

    const concurrentActiveAppointments = await db.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.salonId, salon!.id),
      eq(appointmentsTable.date, concurrentBookingDate),
      inArray(appointmentsTable.status, ["pending", "confirmed"]),
    ));
    assert.equal(concurrentActiveAppointments.length, 2, "the race and retry must create exactly two non-overlapping appointments");
    assert.deepEqual(
      concurrentActiveAppointments.map((appointment) => appointment.startTime).sort(),
      ["10:00", "12:00"],
      "the concurrent check must not create duplicate appointments for the original slot",
    );

    await db.update(salonsTable).set({ instantBooking: false }).where(eq(salonsTable.id, salon!.id));
    const pendingBooking = await request(baseUrl, customerSession, "/appointments", "POST", {
      salonId: salon!.id,
      serviceId: service!.id,
      date: "2099-10-30",
      startTime: "12:00",
      employeeId: employee!.id,
    });
    assert.equal(pendingBooking.status, 201, "a customer must be able to create a pending-booking appointment");
    const createdPendingAppointment = pendingBooking.body as { id: string; status: string };
    assert.equal(createdPendingAppointment.status, "pending", "instantBooking=false must create pending appointments on the server");
    const [persistedPendingAppointment] = await db.select().from(appointmentsTable)
      .where(eq(appointmentsTable.id, createdPendingAppointment.id));
    assert.equal(persistedPendingAppointment!.status, "pending", "instantBooking=false must persist a pending appointment");

    const featuredOnly = await request(baseUrl, adminSession, `/admin/salons/${foreignSalon!.id}`, "PATCH", { featured: true });
    assert.equal(featuredOnly.status, 200, "an admin must be able to feature a salon");
    assert.deepEqual(
      (({ featured, topSalon }) => ({ featured, topSalon }))(featuredOnly.body as { featured: boolean; topSalon: boolean }),
      { featured: true, topSalon: false },
      "setting featured must not also set topSalon",
    );
    const topSalonOnly = await request(baseUrl, adminSession, `/admin/salons/${foreignSalon!.id}`, "PATCH", { topSalon: true });
    assert.equal(topSalonOnly.status, 200, "an admin must be able to mark a salon as top");
    assert.deepEqual(
      (({ featured, topSalon }) => ({ featured, topSalon }))(topSalonOnly.body as { featured: boolean; topSalon: boolean }),
      { featured: true, topSalon: true },
      "setting topSalon must retain an existing featured value",
    );
    const unfeatureOnly = await request(baseUrl, adminSession, `/admin/salons/${foreignSalon!.id}`, "PATCH", { featured: false });
    assert.equal(unfeatureOnly.status, 200, "an admin must be able to remove a featured designation");
    assert.deepEqual(
      (({ featured, topSalon }) => ({ featured, topSalon }))(unfeatureOnly.body as { featured: boolean; topSalon: boolean }),
      { featured: false, topSalon: true },
      "changing featured must not clear an existing topSalon designation",
    );

    const ownerServesMenUpdate = await request(baseUrl, ownerSession, "/salon/profile", "PATCH", { servesMen: false });
    assert.equal(ownerServesMenUpdate.status, 200, "a salon owner must be able to update the men's-services designation");
    assert.equal(
      (ownerServesMenUpdate.body as { servesMen: boolean }).servesMen,
      false,
      "the salon profile response must retain the owner's men's-services designation",
    );
    const [ownerUpdatedSalon] = await db.select({
      servesMen: salonsTable.servesMen,
      servesMenManuallySet: salonsTable.servesMenManuallySet,
    }).from(salonsTable).where(eq(salonsTable.id, salon!.id));
    assert.deepEqual(
      ownerUpdatedSalon,
      { servesMen: false, servesMenManuallySet: true },
      "the owner's men's-services designation must persist and opt out of inferred values",
    );

    const customerAppointments = await getRequest(baseUrl, customerSession, "/appointments");
    assert.equal(customerAppointments.status, 200, "a customer must be able to list their appointments");
    assert.ok(
      (customerAppointments.body as Array<{ id: string; date: string; startTime: string }>).some((appointment) =>
        appointment.id === createdCustomerAppointment.id
        && appointment.date === customerBookingDate
        && appointment.startTime === "12:00",
      ),
      "the customer appointment list must immediately include the newly created appointment",
    );

    const courseCoverId = randomUUID();
    const courseCoverHash = suffix.replaceAll("-", "").padEnd(64, "0");
    await db.insert(mediaAssetsTable).values({
      id: courseCoverId,
      ownerUserId: owner!.id,
      scope: "education-cover",
      originalFileName: "test-course.jpg",
      originalContentType: "image/jpeg",
      width: 1200,
      height: 800,
      contentHash: courseCoverHash,
      testCleanupKey: suffix,
    });
    const courseCreate = await request(baseUrl, ownerSession, "/education/courses", "POST", {
      title: "HTTP kalendarski datum kursa",
      description: "Kurs za proveru formata kalendarskog datuma u API odgovorima.",
      category: "Test",
      format: "online",
      price: 1000,
      duration: "1 dan",
      certification: false,
      imageUrl: `/api/media/${courseCoverId}?v=${courseCoverHash.slice(0, 16)}`,
      startDate: educationCourseDate,
    });
    assert.equal(courseCreate.status, 201, "a salon owner must be able to create a course");
    const createdCourse = courseCreate.body as { id: string; startDate: string };
    assertCalendarDate(
      createdCourse.startDate,
      educationCourseDate,
      "the education course creation response start date",
    );

    const courseList = await getRequest(baseUrl, ownerSession, "/education/courses?mine=true");
    assert.equal(courseList.status, 200, "a salon owner must be able to list their courses");
    const listedCourse = (courseList.body as Array<{ id: string; startDate: string }>).find(
      (course) => course.id === createdCourse.id,
    );
    assert.ok(listedCourse, "the created course must appear in the owner course list");
    assertCalendarDate(
      listedCourse.startDate,
      educationCourseDate,
      "the education course list response start date",
    );

    const courseDetail = await getRequest(baseUrl, ownerSession, `/education/courses/${createdCourse.id}`);
    assert.equal(courseDetail.status, 200, "a salon owner must be able to view their course");
    assertCalendarDate(
      (courseDetail.body as { startDate: string }).startDate,
      educationCourseDate,
      "the education course detail response start date",
    );

    const courseUpdate = await request(baseUrl, ownerSession, `/education/courses/${createdCourse.id}`, "PATCH", {
      startDate: updatedEducationCourseDate,
    });
    assert.equal(courseUpdate.status, 200, "a salon owner must be able to update their course");
    assertCalendarDate(
      (courseUpdate.body as { startDate: string }).startDate,
      updatedEducationCourseDate,
      "the education course update response start date",
    );

    const coursePublish = await request(baseUrl, ownerSession, `/education/courses/${createdCourse.id}/publish`, "POST", {});
    assert.equal(coursePublish.status, 200, "a salon owner must be able to publish their course");
    assertCalendarDate(
      (coursePublish.body as { startDate: string }).startDate,
      updatedEducationCourseDate,
      "the education course publish response start date",
    );

    const courseEnrollment = await request(
      baseUrl,
      ownerSession,
      `/education/courses/${createdCourse.id}/enrollments`,
      "POST",
      {},
    );
    assert.equal(courseEnrollment.status, 201, "a salon owner must be able to enroll in a published online course");
    const courseLms = await getRequest(
      baseUrl,
      ownerSession,
      `/education/enrollments/${(courseEnrollment.body as { id: string }).id}/lms`,
    );
    assert.equal(courseLms.status, 200, "an enrolled salon owner must be able to open the course LMS");
    assertCalendarDate(
      (courseLms.body as { course: { startDate: string } }).course.startDate,
      updatedEducationCourseDate,
      "the education LMS course start date",
    );

    const customerUpdate = await request(baseUrl, customerSession, `/appointments/${createdCustomerAppointment.id}`, "PATCH", {
      date: updatedCustomerBookingDate,
    });
    assert.equal(customerUpdate.status, 200, "a customer must be able to reschedule their appointment");
    assertCalendarDate(
      (customerUpdate.body as { date: string }).date,
      updatedCustomerBookingDate,
      "the customer appointment update response date",
    );

    const customerCancellation = await request(baseUrl, customerSession, `/appointments/${createdCustomerAppointment.id}/cancel`, "POST", {
      reason: "HTTP provera formata datuma",
    });
    assert.equal(customerCancellation.status, 200, "a customer must be able to cancel their rescheduled appointment");
    assertCalendarDate(
      (customerCancellation.body as { date: string }).date,
      updatedCustomerBookingDate,
      "the customer appointment cancellation response date",
    );

    const salonBooking = await request(baseUrl, ownerSession, "/salon/appointments", "POST", {
      serviceId: service!.id,
      salonCustomerId: contact!.id,
      employeeId: employee!.id,
      date: salonBookingDate,
      startTime: "12:00",
    });
    assert.equal(salonBooking.status, 201, "a salon owner must be able to create an appointment");
    const createdSalonAppointment = salonBooking.body as { id: string; date: string };
    assertCalendarDate(
      createdSalonAppointment.date,
      salonBookingDate,
      "the salon appointment creation response date",
    );

    const salonUpdate = await request(baseUrl, ownerSession, `/salon/appointments/${createdSalonAppointment.id}`, "PATCH", {
      status: "confirmed",
      notes: "HTTP provera formata datuma",
    });
    assert.equal(salonUpdate.status, 200, "a salon owner must be able to update an appointment");
    assertCalendarDate(
      (salonUpdate.body as { date: string }).date,
      salonBookingDate,
      "the salon appointment update response date",
    );

    const salonSeriesPreview = await request(baseUrl, ownerSession, "/salon/appointment-series/preview", "POST", {
      serviceId: service!.id,
      employeeId: employee!.id,
      slots: [{ date: salonSeriesDate, startTime: "12:00" }],
    });
    assert.equal(salonSeriesPreview.status, 200, "a salon owner must be able to preview an appointment series");
    const salonPreviewSlots = (salonSeriesPreview.body as { slots: Array<{ date: string }> }).slots;
    for (const slot of salonPreviewSlots) {
      assertCalendarDate(
        slot.date,
        salonSeriesDate,
        "the salon appointment-series availability preview date",
      );
    }

    const salonSeriesBooking = await request(baseUrl, ownerSession, "/salon/appointment-series", "POST", {
      serviceId: service!.id,
      salonCustomerId: contact!.id,
      employeeId: employee!.id,
      slots: [{ date: salonSeriesDate, startTime: "12:00" }],
    });
    assert.equal(salonSeriesBooking.status, 201, "a salon owner must be able to create an appointment series");
    const createdSalonSeries = salonSeriesBooking.body as {
      id: string;
      appointments: Array<{ date: string }>;
    };
    for (const appointment of createdSalonSeries.appointments) {
      assertCalendarDate(
        appointment.date,
        salonSeriesDate,
        "the salon appointment-series creation response date",
      );
    }

    const salonSeriesMovePreview = await request(
      baseUrl,
      ownerSession,
      `/salon/appointment-series/${createdSalonSeries.id}/move/preview`,
      "POST",
      { dayOffset: 1 },
    );
    assert.equal(salonSeriesMovePreview.status, 200, "a salon owner must be able to preview an appointment-series move");
    const salonMovePreviewSlots = (salonSeriesMovePreview.body as {
      slots: Array<{ currentDate: string; date: string }>;
    }).slots;
    for (const slot of salonMovePreviewSlots) {
      assertCalendarDate(
        slot.currentDate,
        salonSeriesDate,
        "the salon appointment-series move preview current date",
      );
      assertCalendarDate(
        slot.date,
        movedSalonSeriesDate,
        "the salon appointment-series move preview proposed date",
      );
    }

    const salonSeriesMove = await request(
      baseUrl,
      ownerSession,
      `/salon/appointment-series/${createdSalonSeries.id}/move`,
      "POST",
      { dayOffset: 1 },
    );
    assert.equal(salonSeriesMove.status, 200, "a salon owner must be able to move an appointment series");
    const movedSalonSeries = salonSeriesMove.body as { appointments: Array<{ date: string }> };
    for (const appointment of movedSalonSeries.appointments) {
      assertCalendarDate(
        appointment.date,
        movedSalonSeriesDate,
        "the salon appointment-series move response date",
      );
    }

    const employeeSeriesBooking = await request(baseUrl, employeeSession, "/employee/appointment-series", "POST", {
      serviceId: service!.id,
      salonCustomerId: contact!.id,
      slots: [{ date: employeeSeriesDate, startTime: "12:00" }],
    });
    assert.equal(employeeSeriesBooking.status, 201, "an employee must be able to create an appointment series");
    const createdEmployeeSeries = employeeSeriesBooking.body as {
      appointments: Array<{ date: string }>;
    };
    for (const appointment of createdEmployeeSeries.appointments) {
      assertCalendarDate(
        appointment.date,
        employeeSeriesDate,
        "the employee appointment-series creation response date",
      );
    }

    const employeeSeriesPreview = await request(baseUrl, employeeSession, "/employee/appointment-series/preview", "POST", {
      serviceId: service!.id,
      slots: [{ date: employeeSeriesDate, startTime: "13:00" }],
    });
    assert.equal(employeeSeriesPreview.status, 200, "an employee must be able to preview an appointment series");
    const employeePreviewSlots = (employeeSeriesPreview.body as { slots: Array<{ date: string }> }).slots;
    for (const slot of employeePreviewSlots) {
      assertCalendarDate(
        slot.date,
        employeeSeriesDate,
        "the employee appointment-series availability preview date",
      );
    }

    const bookingPayload = {
      serviceId: service!.id,
      salonCustomerId: contact!.id,
      slots: [{ date: employeeBookingDate, startTime: "10:00" }],
    };
    const [firstBooking, secondBooking] = await Promise.all([
      request(baseUrl, employeeSession, "/employee/appointments", "POST", bookingPayload),
      request(baseUrl, employeeSession, "/employee/appointments", "POST", bookingPayload),
    ]);
    assert.deepEqual(
      [firstBooking.status, secondBooking.status].sort((left, right) => left - right),
      [201, 409],
      "parallel employee booking requests must leave one overlapping slot unavailable",
    );
    const overlappingBookings = await db.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.salonId, salon!.id),
      eq(appointmentsTable.employeeId, employee!.id),
      eq(appointmentsTable.date, employeeBookingDate),
      inArray(appointmentsTable.status, ["pending", "confirmed"]),
    ));
    assert.equal(overlappingBookings.length, 1, "one employee must have only one active appointment in the same slot");

    const [moveSeries, cancelSeriesAppointment] = await Promise.all([
      request(baseUrl, ownerSession, `/salon/appointment-series/${series!.id}/move`, "POST", { dayOffset: 1 }),
      request(baseUrl, customerSession, `/appointments/${seriesAppointment!.id}/cancel`, "POST", { reason: "HTTP konkurentno otkazivanje" }),
    ]);
    assert.ok([200, 409].includes(moveSeries.status), "series move must either complete before cancellation or report a concurrent change");
    assert.equal(cancelSeriesAppointment.status, 200, "customer cancellation must remain successful while a series move is in flight");
    const [cancelledSeriesAppointment] = await db.select().from(appointmentsTable)
      .where(eq(appointmentsTable.id, seriesAppointment!.id));
    assert.equal(cancelledSeriesAppointment!.status, "cancelled", "a series move must never overwrite a concurrent cancellation");
    assert.ok(
      [primarySalonDate, movedSeriesDate].includes(cancelledSeriesAppointment!.date),
      "the moved series member must finish in one complete date state",
    );

    const [completeAppointment, cancelCompletedAppointment] = await Promise.all([
      request(baseUrl, employeeSession, `/employee/appointments/${completionRaceAppointment!.id}`, "PATCH", { status: "completed" }),
      request(baseUrl, customerSession, `/appointments/${completionRaceAppointment!.id}/cancel`, "POST", { reason: "HTTP konkurentno otkazivanje" }),
    ]);
    assert.deepEqual(
      [completeAppointment.status, cancelCompletedAppointment.status].sort((left, right) => left - right),
      [200, 409],
      "completion and cancellation must allow exactly one status transition",
    );
    const [completedOrCancelled] = await db.select().from(appointmentsTable)
      .where(eq(appointmentsTable.id, completionRaceAppointment!.id));
    assert.ok(
      completedOrCancelled!.status === "completed" || completedOrCancelled!.status === "cancelled",
      "the final status must be the single winning terminal transition",
    );

    const crossSalonAssignment = await request(
      baseUrl,
      ownerSession,
      `/salon/appointments/${cancelledAppointment!.id}`,
      "PATCH",
      { employeeId: foreignEmployee!.id },
    );
    assert.equal(crossSalonAssignment.status, 403, "an owner must not assign a cancelled appointment to an employee from another salon");
    const [stillCancelled] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, cancelledAppointment!.id));
    assert.equal(stillCancelled!.status, "cancelled", "a rejected cross-salon assignment must not change appointment status");
    assert.equal(stillCancelled!.employeeId, employee!.id, "a rejected cross-salon assignment must preserve the original employee");

    // -------------------------------------------------------------------------
    // Resource CRUD tests
    // -------------------------------------------------------------------------
    const createResourceResult = await request(baseUrl, ownerSession, "/salon/resources", "POST", {
      name: `Kabina za test ${suffix}`,
      type: "room",
      capacity: 2,
    });
    assert.equal(createResourceResult.status, 201, "salon owner must be able to create a resource");
    const createdResource = createResourceResult.body as { id: string; name: string; type: string; capacity: number; active: boolean };
    assert.equal(createdResource.name, `Kabina za test ${suffix}`, "created resource must have the given name");
    assert.equal(createdResource.capacity, 2, "created resource must have the given capacity");

    const listResourcesResult = await getRequest(baseUrl, ownerSession, "/salon/resources");
    assert.equal(listResourcesResult.status, 200, "salon owner must be able to list resources");
    const resourceList = listResourcesResult.body as Array<{ id: string; name: string }>;
    assert.ok(resourceList.some((r) => r.id === createdResource.id), "created resource must appear in the list");

    const patchResourceResult = await request(baseUrl, ownerSession, `/salon/resources/${createdResource.id}`, "PATCH", { capacity: 3 });
    assert.equal(patchResourceResult.status, 200, "salon owner must be able to update a resource");
    const patchedResource = patchResourceResult.body as { capacity: number };
    assert.equal(patchedResource.capacity, 3, "patched resource must reflect the new capacity");

    // Service requirement assignment
    const patchServiceWithResource = await request(
      baseUrl,
      ownerSession,
      `/salon/services/${service!.id}`,
      "PATCH",
      {
        category: "Test",
        name: "HTTP zaključavanje termina",
        description: "Usluga za proveru HTTP tokova termina.",
        durationMinutes: 60,
        price: 1000,
        promoPrice: 800,
        imageUrl: "/test.jpg",
        active: true,
        homeServiceAvailable: false,
        homeServiceFee: 0,
        resourceRequirements: [{ resourceId: createdResource.id, quantity: 1 }],
      },
    );
    assert.equal(patchServiceWithResource.status, 200, "service patch with resource requirement must succeed");
    const patchedService = patchServiceWithResource.body as { resourceRequirements: Array<{ resourceId: string; quantity: number }> };
    assert.ok(Array.isArray(patchedService.resourceRequirements), "patched service must return resourceRequirements");
    assert.equal(patchedService.resourceRequirements.length, 1, "patched service must have exactly one requirement");
    assert.equal(patchedService.resourceRequirements[0]!.resourceId, createdResource.id, "requirement must reference the created resource");

    // Duplicate resourceId validation
    const duplicateReqResult = await request(
      baseUrl,
      ownerSession,
      `/salon/services/${service!.id}`,
      "PATCH",
      {
        category: "Test",
        name: "HTTP zaključavanje termina",
        description: "Usluga za proveru HTTP tokova termina.",
        durationMinutes: 60,
        price: 1000,
        promoPrice: 800,
        imageUrl: "/test.jpg",
        active: true,
        homeServiceAvailable: false,
        homeServiceFee: 0,
        resourceRequirements: [
          { resourceId: createdResource.id, quantity: 1 },
          { resourceId: createdResource.id, quantity: 1 },
        ],
      },
    );
    assert.equal(duplicateReqResult.status, 400, "duplicate resourceId in requirements must return 400");

    // Quantity > capacity validation
    const overCapacityResult = await request(
      baseUrl,
      ownerSession,
      `/salon/services/${service!.id}`,
      "PATCH",
      {
        category: "Test",
        name: "HTTP zaključavanje termina",
        description: "Usluga za proveru HTTP tokova termina.",
        durationMinutes: 60,
        price: 1000,
        promoPrice: 800,
        imageUrl: "/test.jpg",
        active: true,
        homeServiceAvailable: false,
        homeServiceFee: 0,
        resourceRequirements: [{ resourceId: createdResource.id, quantity: 99 }],
      },
    );
    assert.equal(overCapacityResult.status, 400, "quantity > capacity must return 400");

    // Cross-salon resource validation
    const [foreignResource] = await db.insert(salonResourcesTable).values({
      salonId: foreignSalon!.id,
      name: `Foreign resource ${suffix}`,
      type: "equipment",
      capacity: 1,
    }).returning();
    const crossSalonReqResult = await request(
      baseUrl,
      ownerSession,
      `/salon/services/${service!.id}`,
      "PATCH",
      {
        category: "Test",
        name: "HTTP zaključavanje termina",
        description: "Usluga za proveru HTTP tokova termina.",
        durationMinutes: 60,
        price: 1000,
        promoPrice: 800,
        imageUrl: "/test.jpg",
        active: true,
        homeServiceAvailable: false,
        homeServiceFee: 0,
        resourceRequirements: [{ resourceId: foreignResource!.id, quantity: 1 }],
      },
    );
    assert.equal(crossSalonReqResult.status, 400, "cross-salon resource reference must return 400");
    await db.delete(salonResourcesTable).where(eq(salonResourcesTable.id, foreignResource!.id));

    // -------------------------------------------------------------------------
    // Resource-aware booking: salon POST /salon/appointments
    // -------------------------------------------------------------------------
    // Set up the service with capacity-1 resource (reset to quantity 1 requirement).
    await db.delete(serviceResourceRequirementsTable).where(eq(serviceResourceRequirementsTable.serviceId, service!.id));
    // Patch resource back to capacity 1.
    await request(baseUrl, ownerSession, `/salon/resources/${createdResource.id}`, "PATCH", { capacity: 1 });
    await db.insert(serviceResourceRequirementsTable).values({ serviceId: service!.id, resourceId: createdResource.id, quantity: 1 });
    const [resourceEmployee] = await db.insert(employeesTable).values({
      salonId: salon!.id,
      name: "Drugi zaposleni za resurs test",
      role: "Terapeut",
      bio: "",
      avatarUrl: "",
    }).returning();
    await db.insert(employeeServicesTable).values({ employeeId: resourceEmployee!.id, serviceId: service!.id });

    // First booking should succeed.
    const firstResourceBooking = await request(baseUrl, ownerSession, "/salon/appointments", "POST", {
      serviceId: service!.id,
      salonCustomerId: contact!.id,
      date: resourceTestDate,
      startTime: "10:00",
      employeeId: employee!.id,
    });
    assert.equal(firstResourceBooking.status, 201, "first booking with resource must succeed");
    const firstBookingBody = firstResourceBooking.body as { id: string; allocatedResources: unknown[] };
    assert.ok(Array.isArray(firstBookingBody.allocatedResources), "booking response must include allocatedResources");
    assert.equal(firstBookingBody.allocatedResources.length, 1, "booking must have one allocated resource");
    const employeePortalWithResources = await getRequest(baseUrl, employeeSession, "/employee/portal");
    assert.equal(employeePortalWithResources.status, 200, "employee portal must remain available");
    const employeePortalBody = employeePortalWithResources.body as {
      appointments: Array<{ id: string; allocatedResources?: unknown[] }>;
    };
    const employeePortalAppointment = employeePortalBody.appointments.find((appointment) => appointment.id === firstBookingBody.id);
    assert.equal(employeePortalAppointment?.allocatedResources?.length, 1, "employee portal must return allocated resources");

    // Second booking at same time must fail (capacity-1 resource exhausted).
    const conflictingResourceBooking = await request(baseUrl, ownerSession, "/salon/appointments", "POST", {
      serviceId: service!.id,
      salonCustomerId: contact!.id,
      date: resourceTestDate,
      startTime: "10:00",
      employeeId: resourceEmployee!.id,
    });
    assert.equal(conflictingResourceBooking.status, 409, "second booking at same time with capacity-1 resource must return 409");

    // Third booking at a different time slot should succeed.
    const nonConflictBooking = await request(baseUrl, ownerSession, "/salon/appointments", "POST", {
      serviceId: service!.id,
      salonCustomerId: contact!.id,
      date: resourceTestDate,
      startTime: "12:00",
      employeeId: employee!.id,
    });
    assert.equal(nonConflictBooking.status, 201, "booking at a non-overlapping time must succeed even with exhausted earlier slot");

    // -------------------------------------------------------------------------
    // Availability endpoint must reflect resource exhaustion
    // -------------------------------------------------------------------------
    const availabilityResult = await fetch(
      `${baseUrl}/api/salons/${salon!.id}/availability?serviceId=${service!.id}&date=${resourceTestDate}`,
    );
    assert.equal(availabilityResult.status, 200, "availability endpoint must return 200");
    const availabilitySlots = await availabilityResult.json() as Array<{ start: string; end: string }>;
    // The 10:00 slot is exhausted; it must not appear.
    assert.ok(
      !availabilitySlots.some((s) => s.start === "10:00"),
      "availability must not advertise the 10:00 slot when the resource is exhausted",
    );
    // The 12:00 slot is now taken by the nonConflictBooking employee, but other employees at other times may appear.

    // -------------------------------------------------------------------------
    // Cancellation releases resource for rebooking
    // -------------------------------------------------------------------------
    const ownerCancelBooking = await request(
      baseUrl,
      ownerSession,
      `/salon/appointments/${firstBookingBody.id}`,
      "PATCH",
      { status: "cancelled" },
    );
    assert.equal(ownerCancelBooking.status, 200, "owner cancellation must succeed");

    // After cancellation, the same slot must become available again.
    const retryResourceBooking = await request(baseUrl, ownerSession, "/salon/appointments", "POST", {
      serviceId: service!.id,
      salonCustomerId: contact!.id,
      date: resourceTestDate,
      startTime: "10:00",
      employeeId: employee!.id,
    });
    assert.equal(retryResourceBooking.status, 201, "after cancellation, the resource slot must be reavailable");

    const conflictingReactivation = await request(
      baseUrl,
      ownerSession,
      `/salon/appointments/${firstBookingBody.id}`,
      "PATCH",
      { status: "confirmed" },
    );
    assert.equal(conflictingReactivation.status, 409, "a cancelled booking must not reactivate over exhausted resource capacity");
    const [stillCancelledResourceBooking] = await db.select({ status: appointmentsTable.status })
      .from(appointmentsTable)
      .where(eq(appointmentsTable.id, firstBookingBody.id));
    assert.equal(stillCancelledResourceBooking!.status, "cancelled", "failed reactivation must roll back");

    const increaseCapacityResult = await request(
      baseUrl,
      ownerSession,
      `/salon/resources/${createdResource.id}`,
      "PATCH",
      { capacity: 2 },
    );
    assert.equal(increaseCapacityResult.status, 200, "resource capacity must be safely increasable");
    const secondConcurrentResourceBooking = await request(baseUrl, ownerSession, "/salon/appointments", "POST", {
      serviceId: service!.id,
      salonCustomerId: contact!.id,
      date: resourceTestDate,
      startTime: "10:00",
      employeeId: resourceEmployee!.id,
    });
    assert.equal(secondConcurrentResourceBooking.status, 201, "capacity two must allow a second concurrent resource booking");
    const unsafeCapacityReduction = await request(
      baseUrl,
      ownerSession,
      `/salon/resources/${createdResource.id}`,
      "PATCH",
      { capacity: 1 },
    );
    assert.equal(unsafeCapacityReduction.status, 409, "capacity must not be reducible below active overlapping allocations");

    // Clean up resources requirement to avoid polluting other tests.
    await db.delete(serviceResourceRequirementsTable).where(eq(serviceResourceRequirementsTable.serviceId, service!.id));

    // -------------------------------------------------------------------------
    // DELETE resource
    // -------------------------------------------------------------------------
    const protectedDeleteResult = await request(baseUrl, ownerSession, `/salon/resources/${createdResource.id}`, "DELETE", {});
    assert.equal(protectedDeleteResult.status, 409, "resource allocation history must prevent destructive deletion");
    const temporaryResourceResult = await request(baseUrl, ownerSession, "/salon/resources", "POST", {
      name: `Privremeni resurs ${suffix}`,
      type: "other",
      capacity: 1,
    });
    assert.equal(temporaryResourceResult.status, 201, "unused resource must be creatable for delete coverage");
    const temporaryResource = temporaryResourceResult.body as { id: string };
    const deleteResourceResult = await request(baseUrl, ownerSession, `/salon/resources/${temporaryResource.id}`, "DELETE", {});
    assert.equal(deleteResourceResult.status, 204, "an unused resource must be deletable");

    // Owner intraday blocks must share the booking availability predicate and
    // appointment advisory lock discipline, without changing all-day leave.
    const timeBlockDate = "2099-12-10";
    const filteredByEmployee = await getRequest(baseUrl, ownerSession, `/salon/appointments?employeeId=${employee!.id}`);
    assert.equal(filteredByEmployee.status, 200, "owner appointment employee filter must succeed");
    assert.ok((filteredByEmployee.body as Array<{ employeeId: string | null }>).every((item) => item.employeeId === employee!.id));
    const filteredByService = await getRequest(baseUrl, ownerSession, `/salon/appointments?serviceId=${service!.id}`);
    assert.equal(filteredByService.status, 200, "owner appointment service filter must succeed");
    assert.ok((filteredByService.body as Array<{ serviceId: string }>).every((item) => item.serviceId === service!.id));
    const foreignFilter = await getRequest(baseUrl, ownerSession, `/salon/appointments?employeeId=${foreignEmployee!.id}`);
    assert.equal(foreignFilter.status, 404, "owner appointment filter must reject a cross-salon employee");

    const crossSalonBlock = await request(baseUrl, ownerSession, "/salon/time-blocks", "POST", {
      employeeId: foreignEmployee!.id, date: timeBlockDate, startTime: "12:00", endTime: "13:00", reason: "Nedostupno",
    });
    assert.equal(crossSalonBlock.status, 404, "time block creation must reject a cross-salon employee");
    const createdBlock = await request(baseUrl, ownerSession, "/salon/time-blocks", "POST", {
      employeeId: employee!.id, date: timeBlockDate, startTime: "12:00", endTime: "13:00", reason: "Pauza",
    });
    assert.equal(createdBlock.status, 201, "owner can create a same-day intraday block");
    const block = createdBlock.body as { id: string; startTime: string; endTime: string };
    assert.equal(block.startTime, "12:00");
    assert.equal(block.endTime, "13:00");
    const listedBlocks = await getRequest(baseUrl, ownerSession, `/salon/time-blocks?date=${timeBlockDate}&employeeId=${employee!.id}`);
    assert.equal(listedBlocks.status, 200, "owner can list intraday blocks by date and employee");
    assert.ok((listedBlocks.body as Array<{ id: string }>).some((item) => item.id === block.id));
    const publicBlocked = await fetch(`${baseUrl}/api/salons/${salon!.id}/availability?serviceId=${service!.id}&employeeId=${employee!.id}&date=${timeBlockDate}`);
    assert.equal(publicBlocked.status, 200);
    const publicSlots = await publicBlocked.json() as Array<{ start: string }>;
    assert.ok(!publicSlots.some((slot) => slot.start === "12:00"), "public availability excludes overlapping intraday block");
    assert.ok(publicSlots.some((slot) => slot.start === "11:00"), "adjacent slot ending at block start remains available");
    assert.ok(publicSlots.some((slot) => slot.start === "13:00"), "adjacent slot starting at block end remains available");
    const ownerSearch = await getRequest(baseUrl, ownerSession, `/salon/availability/search?serviceId=${service!.id}&employeeId=${employee!.id}&startDate=${timeBlockDate}&limit=20`);
    assert.equal(ownerSearch.status, 200, "owner seven-day availability search succeeds");
    const ownerSlots = ownerSearch.body as Array<{ date: string; startTime: string; employeeId: string; employeeName: string }>;
    assert.ok(!ownerSlots.some((slot) => slot.date === timeBlockDate && slot.startTime === "12:00"), "owner search inherits the block exclusion");
    assert.ok(ownerSlots.every((slot) => slot.employeeId === employee!.id && slot.employeeName === employee!.name), "owner search returns selected employee identity");
    assert.deepEqual(
      ownerSlots.filter((slot) => slot.date === timeBlockDate).map((slot) => slot.startTime),
      publicSlots.map((slot) => slot.start),
      "batched owner search must preserve exact public canonical slot results for the selected employee",
    );
    const deletedBlock = await request(baseUrl, ownerSession, `/salon/time-blocks/${block.id}`, "DELETE", {});
    assert.equal(deletedBlock.status, 204, "owner can delete an intraday block");

    const [activeConflict] = await db.insert(appointmentsTable).values({
      salonId: salon!.id, customerId: customer!.id, salonCustomerId: contact!.id, employeeId: employee!.id, serviceId: service!.id,
      date: timeBlockDate, startTime: "14:00", endTime: "15:00", durationMinutes: 60, price: 1000, status: "confirmed",
    }).returning();
    const conflictingBlock = await request(baseUrl, ownerSession, "/salon/time-blocks", "POST", {
      employeeId: employee!.id, date: timeBlockDate, startTime: "14:30", endTime: "15:30", reason: "Sukob",
    });
    assert.equal(conflictingBlock.status, 409, "block overlapping an active appointment is rejected without cancelling it");
    const [stillActive] = await db.select({ status: appointmentsTable.status }).from(appointmentsTable).where(eq(appointmentsTable.id, activeConflict!.id));
    assert.equal(stillActive!.status, "confirmed", "block conflict never cancels an existing appointment");
    const [allDayLeave] = await db.insert(employeeTimeOffTable).values({
      employeeId: employee!.id, startDate: timeBlockDate, endDate: timeBlockDate, reason: "Odobreno odsustvo",
    }).returning();
    const calendarDay = await getRequest(baseUrl, ownerSession, `/salon/calendar-day?date=${timeBlockDate}`);
    assert.equal(calendarDay.status, 200, "owner calendar day data must succeed");
    const calendarEmployee = (calendarDay.body as Array<{
      employeeId: string;
      unavailable: boolean;
      unavailableReason: string | null;
    }>).find((item) => item.employeeId === employee!.id);
    assert.equal(calendarEmployee?.unavailable, true, "approved all-day leave must mark the employee unavailable");
    assert.equal(calendarEmployee?.unavailableReason, "Odobreno odsustvo");
    const allDayDelete = await request(baseUrl, ownerSession, `/salon/time-blocks/${allDayLeave!.id}`, "DELETE", {});
    assert.equal(allDayDelete.status, 404, "approved all-day leave cannot be deleted through time-block endpoint");

    // -------------------------------------------------------------------------
    // Owner package entitlement booking: single, series and full package flows.
    // Dates are isolated Sunday hours so availability is deterministic.
    // -------------------------------------------------------------------------
    const [packageService] = await db.insert(servicesTable).values({
      salonId: salon!.id, categoryName: "Test", name: `Paket druga usluga ${suffix}`,
      description: "Druga usluga za paketne HTTP testove.", durationMinutes: 60, price: 1200, imageUrl: "/test.jpg",
    }).returning();
    await db.insert(employeeServicesTable).values({ employeeId: employee!.id, serviceId: packageService!.id });
    let [otherContact] = await db.select().from(salonCustomersTable).where(and(
      eq(salonCustomersTable.salonId, salon!.id), eq(salonCustomersTable.userId, otherCustomer!.id),
    )).limit(1);
    if (!otherContact) {
      [otherContact] = await db.insert(salonCustomersTable).values({
        salonId: salon!.id, userId: otherCustomer!.id, firstName: otherCustomer!.firstName, lastName: otherCustomer!.lastName,
        phone: "+381611234530", phoneNormalized: "+381611234530",
      }).returning();
    }
    const expiresAt = new Date("2101-01-01T00:00:00.000Z");
    const createActivePurchase = async (name: string, quotas: Array<{ serviceId: string; quota: number }>) => {
      const [definition] = await db.insert(treatmentPackagesTable).values({
        salonId: salon!.id, name: `${name} ${suffix}`, description: "", priceInDinars: 1000,
        sessionCount: quotas.reduce((total, item) => total + item.quota, 0), validityDays: 365, active: true, quotaPolicy: "per_service",
      }).returning();
      const total = quotas.reduce((sum, item) => sum + item.quota, 0);
      const [purchase] = await db.insert(customerPackagePurchasesTable).values({
        salonId: salon!.id, packageId: definition!.id, salonCustomerId: contact!.id, totalSessions: total, remainingSessions: total,
        quotaPolicy: "per_service", priceInDinars: 1000, status: "active", expiresAt,
      }).returning();
      await db.insert(packagePurchaseServiceLinksTable).values(quotas.map((item) => ({
        purchaseId: purchase!.id, serviceId: item.serviceId, totalQuota: item.quota, remainingQuota: item.quota,
      })));
      return purchase!;
    };
    const purchaseBalances = async (purchaseId: string) => db.select({
      serviceId: packagePurchaseServiceLinksTable.serviceId, remainingQuota: packagePurchaseServiceLinksTable.remainingQuota,
    }).from(packagePurchaseServiceLinksTable).where(eq(packagePurchaseServiceLinksTable.purchaseId, purchaseId));

    const singlePurchase = await createActivePurchase("Jedan termin", [{ serviceId: service!.id, quota: 1 }]);
    const singleBooked = await request(baseUrl, ownerSession, "/salon/appointments", "POST", {
      salonCustomerId: contact!.id, serviceId: service!.id, date: "2100-01-03", startTime: "10:00", employeeId: employee!.id,
      packagePurchaseId: singlePurchase.id,
    });
    assert.equal(singleBooked.status, 201, "owner single booking redeems an active per-service package");
    const singleAppointment = singleBooked.body as { id: string; price: number };
    assert.equal(singleAppointment.price, 0, "package single booking zeroes appointment price");
    assert.deepEqual(await purchaseBalances(singlePurchase.id), [{ serviceId: service!.id, remainingQuota: 0 }], "single redemption consumes only its selected service quota");
    assert.equal((await db.select().from(packageRedemptionsTable).where(eq(packageRedemptionsTable.appointmentId, singleAppointment.id))).length, 1, "single booking writes one redemption");
    const wrongCustomerSingle = await request(baseUrl, ownerSession, "/salon/appointments", "POST", {
      salonCustomerId: otherContact!.id, serviceId: service!.id, date: "2100-01-03", startTime: "11:00", employeeId: employee!.id,
      packagePurchaseId: singlePurchase.id,
    });
    assert.equal(wrongCustomerSingle.status, 409, "owner cannot use another CRM customer's purchase");
    const uncoveredSingle = await request(baseUrl, ownerSession, "/salon/appointments", "POST", {
      salonCustomerId: contact!.id, serviceId: packageService!.id, date: "2100-01-03", startTime: "11:00", employeeId: employee!.id,
      packagePurchaseId: singlePurchase.id,
    });
    assert.equal(uncoveredSingle.status, 409, "owner cannot use a purchase for an uncovered service");
    assert.deepEqual(await purchaseBalances(singlePurchase.id), [{ serviceId: service!.id, remainingQuota: 0 }], "rejected single uses do not consume package balance");

    const seriesPurchase = await createActivePurchase("Serija", [{ serviceId: service!.id, quota: 2 }]);
    const seriesBody = {
      salonCustomerId: contact!.id, serviceId: service!.id, employeeId: employee!.id, packagePurchaseId: seriesPurchase.id,
      slots: [{ date: "2100-01-10", startTime: "10:00" }, { date: "2100-01-10", startTime: "11:00" }],
    };
    const seriesPreview = await request(baseUrl, ownerSession, "/salon/appointment-series/preview", "POST", seriesBody);
    assert.equal(seriesPreview.status, 200, "owner package series preview succeeds");
    assert.equal((seriesPreview.body as { packageEligible: boolean }).packageEligible, true, "series preview reports sufficient package balance");
    const seriesCreated = await request(baseUrl, ownerSession, "/salon/appointment-series", "POST", seriesBody);
    assert.equal(seriesCreated.status, 201, "owner package series creates atomically");
    assert.deepEqual(await purchaseBalances(seriesPurchase.id), [{ serviceId: service!.id, remainingQuota: 0 }], "series consumes exact number of per-service sessions");
    const insufficientPurchase = await createActivePurchase("Nedovoljno", [{ serviceId: service!.id, quota: 1 }]);
    const beforeInsufficientSeries = (await db.select().from(appointmentSeriesTable).where(eq(appointmentSeriesTable.salonId, salon!.id))).length;
    const insufficientSeries = await request(baseUrl, ownerSession, "/salon/appointment-series", "POST", { ...seriesBody, packagePurchaseId: insufficientPurchase.id, slots: [{ date: "2100-01-10", startTime: "12:00" }, { date: "2100-01-10", startTime: "13:00" }] });
    assert.equal(insufficientSeries.status, 409, "insufficient package series is rejected");
    assert.equal((await db.select().from(appointmentSeriesTable).where(eq(appointmentSeriesTable.salonId, salon!.id))).length, beforeInsufficientSeries, "insufficient series leaves no partial series");
    assert.deepEqual(await purchaseBalances(insufficientPurchase.id), [{ serviceId: service!.id, remainingQuota: 1 }], "insufficient series leaves balance intact");

    const fullPurchase = await createActivePurchase("Kompletan", [{ serviceId: service!.id, quota: 1 }, { serviceId: packageService!.id, quota: 1 }]);
    const fullBody = { packagePurchaseId: fullPurchase.id, slots: [
      { serviceId: service!.id, date: "2100-01-17", startTime: "10:00", employeeId: employee!.id },
      { serviceId: packageService!.id, date: "2100-01-17", startTime: "11:00", employeeId: employee!.id },
    ] };
    const fullPreview = await request(baseUrl, ownerSession, "/salon/package-appointments/preview", "POST", fullBody);
    assert.equal(fullPreview.status, 200, "full package preview succeeds");
    assert.equal((fullPreview.body as { allAvailable: boolean; packageEligible: boolean }).allAvailable, true);
    assert.equal((fullPreview.body as { packageEligible: boolean }).packageEligible, true);
    const fullCreated = await request(baseUrl, ownerSession, "/salon/package-appointments", "POST", fullBody);
    assert.equal(fullCreated.status, 201, "full multi-service package creates atomically");
    assert.equal((fullCreated.body as { series: unknown[] }).series.length, 2, "full package creates a separate series for each service");
    assert.deepEqual((await purchaseBalances(fullPurchase.id)).sort((a, b) => a.serviceId.localeCompare(b.serviceId)).map((item) => item.remainingQuota), [0, 0], "full package consumes exact service balances");
    const staleFull = await request(baseUrl, ownerSession, "/salon/package-appointments", "POST", fullBody);
    assert.equal(staleFull.status, 409, "a stale already-consumed full package request fails");

    const reversalRacePurchase = await createActivePurchase("Povrat tokom kompletnog plana", [{ serviceId: service!.id, quota: 2 }]);
    const reversalRaceSingle = await request(baseUrl, ownerSession, "/salon/appointments", "POST", {
      salonCustomerId: contact!.id, serviceId: service!.id, date: "2100-01-31", startTime: "10:00", employeeId: employee!.id,
      packagePurchaseId: reversalRacePurchase.id,
    });
    assert.equal(reversalRaceSingle.status, 201, "race fixture consumes one of two package sessions");
    const [reversalRaceRedemption] = await db.select().from(packageRedemptionsTable)
      .where(eq(packageRedemptionsTable.appointmentId, (reversalRaceSingle.body as { id: string }).id)).limit(1);
    assert.ok(reversalRaceRedemption, "race fixture redemption exists");
    const reversalRaceBody = {
      packagePurchaseId: reversalRacePurchase.id,
      slots: [{ serviceId: service!.id, date: "2100-02-07", startTime: "10:00", employeeId: employee!.id }],
    };
    const reversalRacePreview = await request(baseUrl, ownerSession, "/salon/package-appointments/preview", "POST", reversalRaceBody);
    assert.equal(reversalRacePreview.status, 200, "one remaining session initially previews as a complete package plan");

    let releaseCalendarLock!: () => void;
    let calendarLockAcquired!: () => void;
    const calendarLockReady = new Promise<void>((resolve) => { calendarLockAcquired = resolve; });
    const holdCalendarLock = new Promise<void>((resolve) => { releaseCalendarLock = resolve; });
    const calendarBlocker = db.transaction(async (tx) => {
      await lockAppointmentResources(tx, salon!.id, [{ date: "2100-02-07", employeeId: employee!.id }]);
      calendarLockAcquired();
      await holdCalendarLock;
    });
    await calendarLockReady;
    const racedCreatePromise = request(baseUrl, ownerSession, "/salon/package-appointments", "POST", reversalRaceBody);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const concurrentReversal = await request(baseUrl, ownerSession, `/growth/redemptions/${reversalRaceRedemption!.id}/reverse`, "POST", {});
    assert.equal(concurrentReversal.status, 200, "concurrent reversal restores the second entitlement while create waits on the calendar lock");
    releaseCalendarLock();
    await calendarBlocker;
    const racedCreate = await racedCreatePromise;
    assert.equal(racedCreate.status, 400, "full-package create revalidates the exact-all set after acquiring its transaction locks");
    assert.deepEqual(await purchaseBalances(reversalRacePurchase.id), [{ serviceId: service!.id, remainingQuota: 2 }], "raced full-package create leaves both restored sessions unbooked");

    const blockedPurchase = await createActivePurchase("Blokiran", [{ serviceId: service!.id, quota: 1 }, { serviceId: packageService!.id, quota: 1 }]);
    const blockedTimeBlock = await request(baseUrl, ownerSession, "/salon/time-blocks", "POST", {
      employeeId: employee!.id, date: "2100-01-24", startTime: "10:00", endTime: "11:00", reason: "Paket blokada",
    });
    assert.equal(blockedTimeBlock.status, 201, "fixture time block is created for blocked package slot");
    const beforeBlockedAppointments = (await db.select().from(appointmentsTable).where(eq(appointmentsTable.salonId, salon!.id))).length;
    const beforeBlockedSeries = (await db.select().from(appointmentSeriesTable).where(eq(appointmentSeriesTable.salonId, salon!.id))).length;
    const blockedFull = await request(baseUrl, ownerSession, "/salon/package-appointments", "POST", { packagePurchaseId: blockedPurchase.id, slots: [
      { serviceId: service!.id, date: "2100-01-24", startTime: "10:00", employeeId: employee!.id },
      { serviceId: packageService!.id, date: "2100-01-24", startTime: "11:00", employeeId: employee!.id },
    ] });
    assert.equal(blockedFull.status, 409, "one blocked full-package slot rejects the entire request");
    assert.equal((await db.select().from(appointmentsTable).where(eq(appointmentsTable.salonId, salon!.id))).length, beforeBlockedAppointments, "blocked full package creates no appointments");
    assert.equal((await db.select().from(appointmentSeriesTable).where(eq(appointmentSeriesTable.salonId, salon!.id))).length, beforeBlockedSeries, "blocked full package creates no series");
    assert.deepEqual((await purchaseBalances(blockedPurchase.id)).map((item) => item.remainingQuota).sort(), [1, 1], "blocked full package leaves every quota unchanged");

    console.log("Resource CRUD and booking capacity tests passed.");

    console.log("Appointment HTTP route regression passed.");
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (concurrentBookingAppointmentIds.length) {
      await db.update(appointmentsTable).set({ status: "cancelled" }).where(inArray(appointmentsTable.id, concurrentBookingAppointmentIds));
    }
    await db.delete(salonsTable).where(inArray(salonsTable.slug, [
      `http-appointment-salon-${suffix}`,
      `foreign-http-appointment-salon-${suffix}`,
    ]));
    await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.testCleanupKey, suffix));
    if (createdUserIds.length) await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
}

try {
  await assertNoPgBusyClientWarnings(run);
} finally {
  await pool.end();
}
