import {
  beautyJobCategoriesTable,
  beautyJobListingsTable,
  courseCategoriesTable,
  coursesTable,
  db,
  educationCenterSubscriptionsTable,
  educationCentersTable,
  subscriptionPlansTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray, like, lte, ne, or, sql } from "drizzle-orm";
import { hashPassword } from "./auth";
import { logger } from "./logger";

const DEMO_MARKER = "[LUMERA_DEMO_MARKETPLACE_2026_08_25]";
const DEMO_PUBLISHER_EMAIL = "demo-marketplace-2026-08-25@lumera.invalid";
const DEMO_EDUCATION_OWNER_EMAIL = "demo-education-2026-08-25@lumera.invalid";
const DEMO_CENTER_DESCRIPTION = `${DEMO_MARKER}:education-center`;
const DEMO_COURSE_CATEGORY = { name: "Stručne tehnike", slug: "strucne-tehnike" };

const knownTestBeautyJobIds = [
  "327b5227-486b-474f-8523-afc4c9a53d0d",
  "5cd6387f-530c-4b54-a867-a0ffb1952302",
  "95cac92f-5010-4fdb-93a1-54bd6dfbeaa6",
  "af041971-c922-456f-b878-81ff9dba24cc",
];

const knownSeedCourseIds = [
  "0de908cf-8260-4511-94f7-98d0a4859302",
  "10009b85-7704-4d45-9ccc-f8bcabcd0253",
  "1fc0acd6-7a3e-4b6a-86d8-f4bde2c62bfd",
  "316cd953-0d0c-416d-86f2-358ee66a53a1",
  "6656dff3-94c2-4289-ac75-b9ffd98ff4b8",
  "b8c09ff1-93f8-4f62-af42-1bad893412f5",
  "e8db91bb-b083-4662-a0cf-429cfe685dbd",
  "ed401ea0-4394-47df-98d6-24f9bef2cbf5",
];

const demoJobCategories = [
  ["frizeri", "Frizeri"],
  ["barberi", "Barberi"],
  ["kozmetika", "Kozmetika"],
  ["kozmeticari", "Kozmetičari"],
  ["nokti", "Nokti (Manikir/Pedikir)"],
  ["lash-brow", "Lash/Brow"],
  ["make-up", "Make-up"],
  ["sminkeri", "Šminkeri"],
  ["pmu", "PMU"],
  ["estetika-masaza", "Estetika i masaža"],
  ["masaza-terapeuti", "Masaža/Terapeuti"],
  ["estetika-anti-aging", "Estetika/anti-aging"],
  ["pomocno-osoblje", "Pomoćno osoblje"],
  ["tattoo-piercing", "Tattoo/Piercing"],
  ["iznajmljivanje-opreme", "Iznajmljivanje opreme"],
  ["iznajmljivanje-prostora-stolice", "Iznajmljivanje prostora/stolice"],
  ["freelance-angazmani", "Freelance/angažmani"],
] as const;

const demoJobVariants = [
  { key: "offer-job-novi-sad", city: "Novi Sad", region: "Centar", type: "job", intent: "offering", pricePeriod: "month", title: (name: string) => `${name} — otvorena pozicija`, photo: "/lumera-media/salon-2.jpg" },
  { key: "offer-job-kragujevac", city: "Kragujevac", region: "Centar", type: "job", intent: "offering", pricePeriod: "month", title: (name: string) => `${name} — otvorena pozicija`, photo: "/lumera-media/salon-4.jpg" },
  { key: "offer-freelance-pancevo", city: "Pančevo", region: "Centar", type: "freelance", intent: "offering", pricePeriod: "project", title: (name: string) => `${name} — freelance usluge`, photo: null },
  { key: "seek-job-beograd", city: "Beograd", region: "Vračar", type: "job", intent: "seeking", pricePeriod: "month", title: (name: string) => `Tražim posao: ${name}`, photo: "/lumera-media/therapist-1.jpg" },
  { key: "seek-freelance-nis", city: "Niš", region: "Centar", type: "freelance", intent: "seeking", pricePeriod: "project", title: (name: string) => `Tražim angažman: ${name}`, photo: null },
  { key: "seek-job-subotica", city: "Subotica", region: "Centar", type: "job", intent: "seeking", pricePeriod: "month", title: (name: string) => `Tražim posao: ${name}`, photo: "/lumera-media/salon-1.jpg" },
] as const;

const demoCourses = [
  { key: "masterclass", title: "Masterclass: Stručne tehnike u praksi", format: "in-person", city: "Beograd", price: 22500, duration: "1 dan", level: "intermediate", certification: true, startDate: "2026-09-18" },
  { key: "intensive", title: "Intenzivni program: Stručne tehnike", format: "online", city: null, price: 27000, duration: "2 dana", level: "beginner", certification: true, startDate: "2026-09-22" },
  { key: "advanced-workshop", title: "Napredna radionica: Stručne tehnike", format: "hybrid", city: "Beograd", price: 31500, duration: "1 dan", level: "advanced", certification: false, startDate: "2026-09-26" },
  { key: "mentoring", title: "Mentorski kurs: Stručne tehnike", format: "in-person", city: "Beograd", price: 36000, duration: "2 dana", level: "all-levels", certification: true, startDate: "2026-09-30" },
  { key: "practical-training", title: "Praktični trening: Stručne tehnike", format: "online", city: null, price: 40500, duration: "1 dan", level: "beginner", certification: false, startDate: "2026-10-04" },
  { key: "certificate", title: "Od osnova do sertifikata: Stručne tehnike", format: "hybrid", city: "Beograd", price: 45000, duration: "3 dana", level: "intermediate", certification: true, startDate: "2026-10-08" },
] as const;

function demoJobDescription(slug: string, key: string, categoryName: string) {
  return `${DEMO_MARKER} [LUMERA_DEMO_MARKETPLACE_2026_08_25:beauty-job:${slug}:${key}] Demo oglas za prikaz kategorije ${categoryName}.`;
}

function demoCourseDescription(key: string) {
  return `${DEMO_MARKER} [LUMERA_DEMO_MARKETPLACE_2026_08_25:education:${key}] Javno vidljiva demo edukacija sa detaljnim programom, praktičnim vežbama i podrškom nakon završetka kursa.`;
}

function demoJobPrice(categoryIndex: number, variantIndex: number, rentalType: "equipment_rental" | "space_rental" | null) {
  if (rentalType) {
    const base = rentalType === "equipment_rental" ? 27500 : 30500;
    return base + [0, 1000, 2000, 2500, 500, 1500][variantIndex]!;
  }
  const jobBase = 70850 + categoryIndex * 5100;
  const freelanceBase = 6250 + categoryIndex * 1500;
  return variantIndex === 2 || variantIndex === 4
    ? freelanceBase + (variantIndex === 4 ? -750 : 0)
    : jobBase + [0, 1700, 0, 4250, 0, 2550][variantIndex]!;
}

function assertCanonicalSet(
  descriptions: string[],
  expectedDescriptions: readonly string[],
  label: string,
) {
  const allowed = new Set(expectedDescriptions);
  if (descriptions.some((description) => !allowed.has(description))) {
    throw new Error(`Unexpected ${label} demo record owned by the reconciliation account.`);
  }
  if (new Set(descriptions).size !== descriptions.length) {
    throw new Error(`Duplicate ${label} demo identity found; refusing to guess which row to modify.`);
  }
}

async function reconcileExplicitLegacyTestIds() {
  const [jobs, courses] = await db.transaction(async (tx) => [
    await tx.update(beautyJobListingsTable).set({ isTest: true })
      .where(and(eq(beautyJobListingsTable.isTest, false), inArray(beautyJobListingsTable.id, knownTestBeautyJobIds)))
      .returning({ id: beautyJobListingsTable.id }),
    await tx.update(coursesTable).set({ isTest: true })
      .where(and(eq(coursesTable.isTest, false), inArray(coursesTable.id, knownSeedCourseIds)))
      .returning({ id: coursesTable.id }),
  ] as const);
  return { beautyJobsMarked: jobs.length, coursesMarked: courses.length };
}

async function ensureProductionDemoMarketplace(): Promise<{
  beautyJobsCreated: number;
  coursesCreated: number;
  beautyJobsReconciled: number;
  coursesReconciled: number;
}> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('lumera-demo-marketplace-2026-08-25'))`);

    let [publisher] = await tx.select({
      id: usersTable.id,
      active: usersTable.active,
      role: usersTable.role,
    }).from(usersTable)
      .where(eq(usersTable.email, DEMO_PUBLISHER_EMAIL)).limit(1);
    if (!publisher) {
      [publisher] = await tx.insert(usersTable).values({
        firstName: "LUMERA",
        lastName: "Demo oglasi",
        email: DEMO_PUBLISHER_EMAIL,
        passwordHash: await hashPassword("disabled-demo-marketplace-account"),
        passwordSetAt: new Date(),
        role: "JOBSEEKER",
        active: false,
        marketingEmailsEnabled: false,
      }).returning({ id: usersTable.id, active: usersTable.active, role: usersTable.role });
    } else if (publisher.active || publisher.role !== "JOBSEEKER") {
      throw new Error("Demo Beauty Poslovi publisher identity is already in use; refusing to mutate production data.");
    }

    const categories = await tx.select({
      id: beautyJobCategoriesTable.id,
      slug: beautyJobCategoriesTable.slug,
      enabled: beautyJobCategoriesTable.enabled,
    }).from(beautyJobCategoriesTable)
      .where(inArray(beautyJobCategoriesTable.slug, demoJobCategories.map(([slug]) => slug)));
    const categoriesBySlug = new Map(categories.map((category) => [category.slug, category]));
    const unavailableCategories = demoJobCategories.map(([slug]) => slug)
      .filter((slug) => !categoriesBySlug.get(slug)?.enabled);
    if (unavailableCategories.length) {
      throw new Error(`Demo Beauty Poslovi categories must be enabled: ${unavailableCategories.join(", ")}`);
    }

    const expectedJobDescriptions = demoJobCategories.flatMap(([slug, name]) =>
      demoJobVariants.map((variant) => demoJobDescription(slug, variant.key, name)));
    const existingJobs = await tx.select({ id: beautyJobListingsTable.id, description: beautyJobListingsTable.description })
      .from(beautyJobListingsTable)
      .where(and(
        eq(beautyJobListingsTable.userId, publisher.id),
        like(beautyJobListingsTable.description, `${DEMO_MARKER} %`),
      ));
    assertCanonicalSet(existingJobs.map((job) => job.description), expectedJobDescriptions, "Beauty Poslovi");
    const existingJobDescriptions = new Set(existingJobs.map((job) => job.description));
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const jobsToCreate: Array<typeof beautyJobListingsTable.$inferInsert> = [];

    for (const [categoryIndex, [slug, name]] of demoJobCategories.entries()) {
      const rentalType = slug === "iznajmljivanje-opreme"
        ? "equipment_rental"
        : slug === "iznajmljivanje-prostora-stolice"
          ? "space_rental"
          : null;
      for (const [variantIndex, variant] of demoJobVariants.entries()) {
        const description = demoJobDescription(slug, variant.key, name);
        if (existingJobDescriptions.has(description)) continue;
        jobsToCreate.push({
          userId: publisher.id,
          categoryId: categoriesBySlug.get(slug)!.id,
          postedByType: "user",
          type: rentalType ?? variant.type,
          intent: variant.intent,
          title: variant.title(name),
          description,
          city: variant.city,
          region: variant.region,
          priceAmount: demoJobPrice(categoryIndex, variantIndex, rentalType),
          pricePeriod: variant.pricePeriod,
          negotiable: variantIndex === 1 || variantIndex === 3,
          photos: variant.photo ? [variant.photo] : [],
          isTest: true,
          status: "active",
          moderationStatus: "approved",
          expiresAt,
        });
      }
    }
    const createdJobs = jobsToCreate.length
      ? await tx.insert(beautyJobListingsTable).values(jobsToCreate).returning({ id: beautyJobListingsTable.id })
      : [];
    const ownedJobIds = [...existingJobs, ...createdJobs].map((job) => job.id);
    if (ownedJobIds.length !== expectedJobDescriptions.length) {
      throw new Error("Demo Beauty Poslovi reconciliation did not produce exactly 102 owned records.");
    }

    let [educationOwner] = await tx.select({
      id: usersTable.id,
      active: usersTable.active,
      role: usersTable.role,
    }).from(usersTable)
      .where(eq(usersTable.email, DEMO_EDUCATION_OWNER_EMAIL)).limit(1);
    if (!educationOwner) {
      [educationOwner] = await tx.insert(usersTable).values({
        firstName: "LUMERA",
        lastName: "Demo edukacije",
        email: DEMO_EDUCATION_OWNER_EMAIL,
        passwordHash: await hashPassword("disabled-demo-education-account"),
        passwordSetAt: new Date(),
        role: "EDUCATION_CENTER_OWNER",
        active: false,
        marketingEmailsEnabled: false,
      }).returning({ id: usersTable.id, active: usersTable.active, role: usersTable.role });
    } else if (educationOwner.active || educationOwner.role !== "EDUCATION_CENTER_OWNER") {
      throw new Error("Demo education owner identity is already in use; refusing to mutate production data.");
    }
    const centersWithDescription = await tx.select({
      id: educationCentersTable.id,
      ownerId: educationCentersTable.ownerId,
    }).from(educationCentersTable)
      .where(eq(educationCentersTable.description, DEMO_CENTER_DESCRIPTION));
    if (
      centersWithDescription.length > 1
      || (centersWithDescription[0] && centersWithDescription[0].ownerId !== educationOwner.id)
    ) {
      throw new Error("Demo education center identity is already in use; refusing to mutate production data.");
    }
    let [center] = centersWithDescription;
    if (!center) {
      [center] = await tx.insert(educationCentersTable).values({
        ownerId: educationOwner.id,
        name: "LUMERA Demo Akademija",
        city: "Beograd",
        description: DEMO_CENTER_DESCRIPTION,
        imageUrl: "/lumera-media/course-1.jpg",
        verificationStatus: "verified",
        verifiedAt: new Date(),
      }).returning({ id: educationCentersTable.id, ownerId: educationCentersTable.ownerId });
    }

    await tx.insert(courseCategoriesTable).values(DEMO_COURSE_CATEGORY).onConflictDoNothing();
    const [courseCategory] = await tx.select({ id: courseCategoriesTable.id }).from(courseCategoriesTable)
      .where(eq(courseCategoriesTable.slug, DEMO_COURSE_CATEGORY.slug)).limit(1);
    if (!courseCategory) throw new Error("Demo education category could not be created.");
    let [plan] = await tx.select({ id: subscriptionPlansTable.id }).from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.active, true)).limit(1);
    if (!plan) {
      [plan] = await tx.insert(subscriptionPlansTable).values({
        name: "LUMERA Demo Education",
        price: 0,
        trialDays: 0,
        features: [],
        limits: {},
      }).returning({ id: subscriptionPlansTable.id });
    }
    const [subscription] = await tx.select({ id: educationCenterSubscriptionsTable.id })
      .from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, center.id)).limit(1);
    if (subscription) {
      await tx.update(educationCenterSubscriptionsTable).set({ status: "active", updatedAt: new Date() })
        .where(eq(educationCenterSubscriptionsTable.id, subscription.id));
    } else {
      await tx.insert(educationCenterSubscriptionsTable).values({
        centerId: center.id, planId: plan.id, status: "active", dueAmount: 0,
      });
    }

    const expectedCourseDescriptions = demoCourses.map((course) => demoCourseDescription(course.key));
    const existingCourses = await tx.select({ id: coursesTable.id, description: coursesTable.description })
      .from(coursesTable).where(and(
        eq(coursesTable.centerId, center.id),
        like(coursesTable.description, `${DEMO_MARKER} %`),
      ));
    assertCanonicalSet(existingCourses.map((course) => course.description), expectedCourseDescriptions, "education");
    const existingCourseDescriptions = new Set(existingCourses.map((course) => course.description));
    const coursesToCreate = demoCourses.filter((course) => !existingCourseDescriptions.has(demoCourseDescription(course.key)));
    const createdCourses = coursesToCreate.length
      ? await tx.insert(coursesTable).values(coursesToCreate.map((course, index) => ({
        centerId: center.id,
        categoryId: courseCategory.id,
        title: course.title,
        description: demoCourseDescription(course.key),
        category: DEMO_COURSE_CATEGORY.name,
        format: course.format,
        city: course.city,
        price: course.price,
        duration: course.duration,
        level: course.level,
        learningOutcomes: ["Samostalan rad sa klijentima", "Pravilna primena tehnike", "Organizacija profesionalnog tretmana"],
        includedItems: ["Radni materijal", "Sertifikat", "Podrška mentora"],
        requirements: "Nije potrebno prethodno iskustvo. Ponesite beleške i dođite 15 minuta ranije.",
        rating: 44 + index,
        certification: course.certification,
        imageUrl: "/lumera-media/course-1.jpg",
        isTest: true,
        published: true,
        archived: false,
        startDate: course.startDate,
      }))).returning({ id: coursesTable.id })
      : [];
    const ownedCourseIds = [...existingCourses, ...createdCourses].map((course) => course.id);
    if (ownedCourseIds.length !== expectedCourseDescriptions.length) {
      throw new Error("Demo education reconciliation did not produce exactly six owned records.");
    }

    const now = new Date();
    const [reconciledJobs, reconciledCourses] = [
      await tx.update(beautyJobListingsTable).set({
        isTest: true, status: "active", moderationStatus: "approved",
        expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      }).where(and(
        inArray(beautyJobListingsTable.id, ownedJobIds),
        or(
          eq(beautyJobListingsTable.isTest, false),
          ne(beautyJobListingsTable.status, "active"),
          ne(beautyJobListingsTable.moderationStatus, "approved"),
          lte(beautyJobListingsTable.expiresAt, now),
        ),
      )).returning({ id: beautyJobListingsTable.id }),
      await tx.update(coursesTable).set({ isTest: true, published: true, archived: false })
        .where(and(
          inArray(coursesTable.id, ownedCourseIds),
          or(eq(coursesTable.isTest, false), eq(coursesTable.published, false), eq(coursesTable.archived, true)),
        )).returning({ id: coursesTable.id }),
    ];
    return {
      beautyJobsCreated: createdJobs.length,
      coursesCreated: createdCourses.length,
      beautyJobsReconciled: reconciledJobs.length,
      coursesReconciled: reconciledCourses.length,
    };
  });
}

export async function reconcileKnownTestListings(): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    const result = await reconcileExplicitLegacyTestIds();
    logger.info(result, "Explicit legacy test listings reconciled");
    return;
  }
  const result = await ensureProductionDemoMarketplace();
  logger.info(result, "Production demo marketplace listings reconciled");
}