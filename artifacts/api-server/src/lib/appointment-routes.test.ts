import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  appointmentSeriesTable,
  appointmentsTable,
  db,
  employeeServicesTable,
  employeesTable,
  pool,
  salonCustomersTable,
  salonHoursTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
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
    body: await response.json(),
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
  let server: ReturnType<typeof app.listen> | undefined;

  try {
    const [owner, customer, employeeUser, admin] = await db.insert(usersTable).values([
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
    createdUserIds.push(owner!.id, customer!.id, employeeUser!.id, admin!.id);

    const [salon, foreignSalon] = await db.insert(salonsTable).values([
      {
        ownerId: owner!.id,
        name: `HTTP termin salon ${suffix}`,
        slug: `http-appointment-salon-${suffix}`,
        city: "Beograd",
        municipality: "Vračar",
        address: "Test 29",
        phone: "+381110000029",
        email: fixtureEmail("salon"),
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
    const [seriesAppointment, completionRaceAppointment, cancelledAppointment] = await db.insert(appointmentsTable).values([
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
    ]).returning();

    const [ownerSession, customerSession, employeeSession, adminSession] = await Promise.all([
      createSession(owner!.id),
      createSession(customer!.id),
      createSession(employeeUser!.id),
      createSession(admin!.id),
    ]);

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

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

    const courseCreate = await request(baseUrl, ownerSession, "/education/courses", "POST", {
      title: "HTTP kalendarski datum kursa",
      description: "Kurs za proveru formata kalendarskog datuma u API odgovorima.",
      category: "Test",
      format: "online",
      price: 1000,
      duration: "1 dan",
      certification: false,
      imageUrl: "/test-course.jpg",
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

    console.log("Appointment HTTP route regression passed.");
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    await db.delete(salonsTable).where(inArray(salonsTable.slug, [
      `http-appointment-salon-${suffix}`,
      `foreign-http-appointment-salon-${suffix}`,
    ]));
    if (createdUserIds.length) await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
}

try {
  await assertNoPgBusyClientWarnings(run);
} finally {
  await pool.end();
}
