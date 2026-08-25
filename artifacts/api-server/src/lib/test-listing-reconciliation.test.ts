import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  beautyJobCategoriesTable,
  beautyJobListingsTable,
  coursesTable,
  db,
  educationCenterSubscriptionsTable,
  educationCentersTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth";
import { reconcileKnownTestListings } from "./test-listing-reconciliation";

const demoMarker = "[LUMERA_DEMO_MARKETPLACE_2026_08_25]";
const demoPublisherEmail = "demo-marketplace-2026-08-25@lumera.invalid";
const demoEducationOwnerEmail = "demo-education-2026-08-25@lumera.invalid";
const demoCenterDescription = `${demoMarker}:education-center`;

test("creates an exact public demo set and never trusts a user description marker", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let markerInjectionJobId: string | undefined;
  let fixtureUserId: string | undefined;

  process.env.NODE_ENV = "production";
  try {
    const [activeEmailCollision] = await db.insert(usersTable).values({
      firstName: "Collision",
      lastName: "Publisher",
      email: demoPublisherEmail,
      passwordHash: await hashPassword("collision-publisher"),
      role: "CUSTOMER",
      active: true,
    }).returning({ id: usersTable.id });
    try {
      await assert.rejects(reconcileKnownTestListings(), /publisher identity is already in use/);
    } finally {
      await db.delete(usersTable).where(eq(usersTable.id, activeEmailCollision!.id));
    }

    const collisionPasswordHash = await hashPassword("collision-center");
    const [validPublisher, validEducationOwner, foreignCenterOwner] = await db.insert(usersTable).values([
      {
        firstName: "LUMERA", lastName: "Demo oglasi", email: demoPublisherEmail,
        passwordHash: collisionPasswordHash, role: "JOBSEEKER", active: false,
      },
      {
        firstName: "LUMERA", lastName: "Demo edukacije", email: demoEducationOwnerEmail,
        passwordHash: collisionPasswordHash, role: "EDUKATIVNI_CENTAR", active: false,
      },
      {
        firstName: "Foreign", lastName: "Center", email: `foreign-center-${randomUUID()}@example.test`,
        passwordHash: collisionPasswordHash, role: "EDUKATIVNI_CENTAR",
      },
    ]).returning({ id: usersTable.id });
    const [foreignCenter] = await db.insert(educationCentersTable).values({
      ownerId: foreignCenterOwner!.id,
      name: "Foreign collision center",
      city: "Beograd",
      description: demoCenterDescription,
      imageUrl: "/lumera-media/course-1.jpg",
      verificationStatus: "verified",
      verifiedAt: new Date(),
    }).returning({ id: educationCentersTable.id });
    try {
      await assert.rejects(reconcileKnownTestListings(), /center identity is already in use/);
    } finally {
      await db.delete(educationCentersTable).where(eq(educationCentersTable.id, foreignCenter!.id));
      await db.delete(usersTable).where(eq(usersTable.id, foreignCenterOwner!.id));
      await db.delete(usersTable).where(eq(usersTable.id, validEducationOwner!.id));
      await db.delete(usersTable).where(eq(usersTable.id, validPublisher!.id));
    }

    await reconcileKnownTestListings();

    const [publisher, center] = await Promise.all([
      db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, demoPublisherEmail)).limit(1),
      db.select({ id: educationCentersTable.id }).from(educationCentersTable)
        .where(eq(educationCentersTable.description, demoCenterDescription)).limit(1),
    ]).then(([publishers, centers]) => [publishers[0], centers[0]]);
    assert.ok(publisher && center, "production reconciliation accepts the migrated JOBSEEKER publisher and creates only its bounded support accounts");

    const [ownedJobs, ownedCourses] = await Promise.all([
      db.select({
        id: beautyJobListingsTable.id,
        isTest: beautyJobListingsTable.isTest,
        status: beautyJobListingsTable.status,
        moderationStatus: beautyJobListingsTable.moderationStatus,
        expiresAt: beautyJobListingsTable.expiresAt,
      }).from(beautyJobListingsTable).where(eq(beautyJobListingsTable.userId, publisher.id)),
      db.select({
        id: coursesTable.id,
        isTest: coursesTable.isTest,
        published: coursesTable.published,
        archived: coursesTable.archived,
      }).from(coursesTable).where(eq(coursesTable.centerId, center.id)),
    ]);
    assert.equal(ownedJobs.length, 102, "the explicit Beauty Poslovi demo set has exactly 102 records");
    assert.ok(ownedJobs.every((job) =>
      job.isTest && job.status === "active" && job.moderationStatus === "approved" && job.expiresAt > new Date()),
    "every owned demo job is public and marked as test data");
    assert.equal(ownedCourses.length, 6, "the explicit education demo set has exactly six records");
    assert.ok(ownedCourses.every((course) => course.isTest && course.published && !course.archived),
      "every owned demo course is public and marked as test data");

    const [category] = await db.select({ id: beautyJobCategoriesTable.id }).from(beautyJobCategoriesTable)
      .where(eq(beautyJobCategoriesTable.slug, "frizeri")).limit(1);
    assert.ok(category, "the explicit Beauty Poslovi category exists");
    const [fixtureUser] = await db.insert(usersTable).values({
      firstName: "Reconciliation",
      lastName: "Guard",
      email: `reconciliation-guard-${randomUUID()}@example.test`,
      passwordHash: await hashPassword("reconciliation-guard"),
      role: "CUSTOMER",
    }).returning({ id: usersTable.id });
    fixtureUserId = fixtureUser!.id;
    const [markerInjectionJob] = await db.insert(beautyJobListingsTable).values({
      categoryId: category.id,
      userId: fixtureUserId,
      postedByType: "user",
      type: "job",
      intent: "offering",
      title: "Marker-injection guard",
      description: `${demoMarker} user-authored content must remain untrusted`,
      city: "Beograd",
      region: "Centar",
      pricePeriod: "month",
      isTest: false,
      status: "closed",
      moderationStatus: "pending",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }).returning({ id: beautyJobListingsTable.id });
    markerInjectionJobId = markerInjectionJob!.id;

    await reconcileKnownTestListings();
    const [stillUntrusted] = await db.select({
      isTest: beautyJobListingsTable.isTest,
      status: beautyJobListingsTable.status,
      moderationStatus: beautyJobListingsTable.moderationStatus,
    }).from(beautyJobListingsTable).where(eq(beautyJobListingsTable.id, markerInjectionJobId));
    assert.deepEqual(stillUntrusted, {
      isTest: false,
      status: "closed",
      moderationStatus: "pending",
    }, "a user-controlled marker never grants test status or public visibility");

    const afterSecondRun = await db.select({ id: beautyJobListingsTable.id })
      .from(beautyJobListingsTable).where(eq(beautyJobListingsTable.userId, publisher.id));
    assert.equal(afterSecondRun.length, 102, "a repeated reconciliation does not duplicate owned demo jobs");
  } finally {
    if (markerInjectionJobId) {
      await db.delete(beautyJobListingsTable).where(eq(beautyJobListingsTable.id, markerInjectionJobId));
    }
    if (fixtureUserId) {
      await db.delete(usersTable).where(eq(usersTable.id, fixtureUserId));
    }
    const [publisher, center] = await Promise.all([
      db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, demoPublisherEmail)).limit(1),
      db.select({ id: educationCentersTable.id }).from(educationCentersTable)
        .where(eq(educationCentersTable.description, demoCenterDescription)).limit(1),
    ]).then(([publishers, centers]) => [publishers[0], centers[0]]);
    if (publisher) {
      await db.delete(beautyJobListingsTable).where(eq(beautyJobListingsTable.userId, publisher.id));
    }
    if (center) {
      await db.delete(coursesTable).where(eq(coursesTable.centerId, center.id));
      await db.delete(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, center.id));
      await db.delete(educationCentersTable).where(eq(educationCentersTable.id, center.id));
    }
    if (publisher) await db.delete(usersTable).where(eq(usersTable.id, publisher.id));
    const [educationOwner] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, demoEducationOwnerEmail)).limit(1);
    if (educationOwner) await db.delete(usersTable).where(eq(usersTable.id, educationOwner.id));
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});