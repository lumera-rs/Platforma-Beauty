import { db } from "@workspace/db";
import {
  beautyJobCategoriesTable,
  beautyJobListingAvailabilityTable,
  beautyJobListingsTable,
  beautyJobRentalSlotsTable,
  courseCategoriesTable,
  coursesTable,
  educationCentersTable,
  educationInstructorsTable,
  salonsTable,
  usersTable,
} from "@workspace/db/schema";
import { count, eq, inArray, like, sql } from "drizzle-orm";
import { logger } from "./logger";
import { restoreDemoEducationOwnerRole } from "./seed";

const MARKER = "[LUMERA_DEMO_MARKETPLACE_2026_08_25]";
const DEMO_USER_EMAIL = "kupac24@lumera.local";
const DEMO_SALON_SLUG = "lotos-rituals";
const DEMO_EDUCATION_OWNER_EMAIL = "edukacija@lumera.local";
const DEMO_JOB_COUNT = 102;
const DEMO_COURSE_COUNT = 6;
const DEMO_CENTER_COUNT = 3;
const DEMO_INSTRUCTOR_COUNT = 3;

export async function repairProductionMarketplaceDemoIdentity(
  database: Pick<typeof db, "update"> = db,
): Promise<void> {
  await restoreDemoEducationOwnerRole(database);
}

const categorySlugs = [
  "barberi", "estetika-masaza", "estetika-anti-aging", "freelance-angazmani",
  "frizeri", "iznajmljivanje-opreme", "iznajmljivanje-prostora-stolice",
  "kozmetika", "kozmeticari", "lash-brow", "make-up", "masaza-terapeuti",
  "nokti", "pmu", "pomocno-osoblje", "tattoo-piercing", "sminkeri",
] as const;

type ListingType = "job" | "freelance" | "equipment_rental" | "space_rental";
type ListingIntent = "offering" | "seeking";
type PostedByType = "user" | "salon";
type PricePeriod = "month" | "project";

type DemoJobPlan = {
  description: string;
  categoryId: string;
  type: ListingType;
  intent: ListingIntent;
  postedByType: PostedByType;
  title: string;
  city: string;
  region: string;
  priceAmount: number;
  pricePeriod: PricePeriod;
  negotiable: boolean;
  userId: string | null;
  salonId: string | null;
};

function createDemoJobs(
  categories: Array<{ id: string; slug: string; name: string }>,
  userId: string,
  salonId: string,
): DemoJobPlan[] {
  const regularCategories = categories.filter((category) => ![
    "freelance-angazmani",
    "iznajmljivanje-opreme",
    "iznajmljivanje-prostora-stolice",
  ].includes(category.slug));

  return categories.flatMap((category) => {
    const regularIndex = regularCategories.findIndex(({ slug }) => slug === category.slug);
    const jobQuota = regularIndex >= 0 ? (regularIndex < 7 ? 5 : 4) : 0;
    const rentalType: ListingType | undefined = category.slug === "iznajmljivanje-opreme"
      ? "equipment_rental"
      : category.slug === "iznajmljivanje-prostora-stolice"
        ? "space_rental"
        : undefined;

    return Array.from({ length: 6 }, (_, index) => {
      const postedByType: PostedByType = index < 3 ? "user" : "salon";
      const authorIndex = index % 3;
      const type: ListingType = rentalType
        ?? (category.slug === "freelance-angazmani" || index >= jobQuota ? "freelance" : "job");
      const intent: ListingIntent = index % 2 === 0 ? "offering" : "seeking";
      const descriptor = type === "job"
        ? (intent === "offering" ? "otvorena pozicija" : "tražim posao")
        : type === "freelance"
          ? (intent === "offering" ? "freelance usluge" : "freelance angažman")
          : (intent === "offering" ? "dostupno odmah" : "tražim iznajmljivanje");
      const location = postedByType === "user"
        ? { city: "Novi Sad", region: "Centar" }
        : { city: "Beograd", region: "Vračar" };
      const description = `${MARKER} [job:${category.slug}:${postedByType}:${authorIndex}] `
        + `Demo oglas za prikaz kategorije ${category.name}. Sadrži primer uslova, cene i dostupnosti za pregled funkcionalnosti Beauty Poslovi platforme.`;

      return {
        description,
        categoryId: category.id,
        type,
        intent,
        postedByType,
        title: `${category.name} — ${descriptor} ${authorIndex + 1}`,
        city: location.city,
        region: location.region,
        priceAmount: type === "freelance" ? 8_000 + index * 2_750 : 30_000 + index * 9_500,
        pricePeriod: type === "freelance" ? "project" : "month",
        negotiable: index % 2 === 1,
        userId: postedByType === "user" ? userId : null,
        salonId: postedByType === "salon" ? salonId : null,
      };
    });
  });
}

export async function seedProductionMarketplaceDemoContent(): Promise<void> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('lumera-production-marketplace-demo-seed-v1'))`);
    await repairProductionMarketplaceDemoIdentity(tx);

    const [jobCount, courseCount, centerCount, instructorCount] = await Promise.all([
      tx.select({ total: count() }).from(beautyJobListingsTable)
        .where(like(beautyJobListingsTable.description, `%${MARKER}%`)),
      tx.select({ total: count() }).from(coursesTable)
        .where(like(coursesTable.description, `%${MARKER}%`)),
      tx.select({ total: count() }).from(educationCentersTable)
        .where(like(educationCentersTable.description, `%${MARKER}%`)),
      tx.select({ total: count() }).from(educationInstructorsTable)
        .where(like(educationInstructorsTable.biography, `%${MARKER}%`)),
    ]);
    const existing = {
      jobs: jobCount[0]?.total ?? 0,
      courses: courseCount[0]?.total ?? 0,
      centers: centerCount[0]?.total ?? 0,
      instructors: instructorCount[0]?.total ?? 0,
    };
    const isEmpty = existing.jobs === 0 && existing.courses === 0 && existing.centers === 0 && existing.instructors === 0;
    const isComplete = existing.jobs === DEMO_JOB_COUNT
      && existing.courses === DEMO_COURSE_COUNT
      && existing.centers === DEMO_CENTER_COUNT
      && existing.instructors === DEMO_INSTRUCTOR_COUNT;

    if (isComplete) return { jobsCreated: 0, coursesCreated: 0, skipped: false };
    if (!isEmpty) {
      logger.error(
        { existing, expected: { jobs: DEMO_JOB_COUNT, courses: DEMO_COURSE_COUNT, centers: DEMO_CENTER_COUNT, instructors: DEMO_INSTRUCTOR_COUNT } },
        "Marketplace demo seed skipped because a partial managed demo set already exists",
      );
      return { jobsCreated: 0, coursesCreated: 0, skipped: true };
    }

    const [demoUser, demoSalon, educationOwner, categoryRows, courseCategory] = await Promise.all([
      tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, DEMO_USER_EMAIL)).limit(1),
      tx.select({ id: salonsTable.id }).from(salonsTable).where(eq(salonsTable.slug, DEMO_SALON_SLUG)).limit(1),
      tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, DEMO_EDUCATION_OWNER_EMAIL)).limit(1),
      tx.select({ id: beautyJobCategoriesTable.id, slug: beautyJobCategoriesTable.slug, name: beautyJobCategoriesTable.name })
        .from(beautyJobCategoriesTable).where(inArray(beautyJobCategoriesTable.slug, [...categorySlugs])),
      tx.select({ id: courseCategoriesTable.id, name: courseCategoriesTable.name })
        .from(courseCategoriesTable).where(eq(courseCategoriesTable.slug, "strucne-tehnike")).limit(1),
    ]);
    const categoryBySlug = new Map(categoryRows.map((category) => [category.slug, category]));
    const categories = categorySlugs.map((slug) => categoryBySlug.get(slug)).filter((category): category is NonNullable<typeof category> => Boolean(category));

    if (!demoUser[0] || !demoSalon[0] || !educationOwner[0] || categories.length !== categorySlugs.length || !courseCategory[0]) {
      logger.error(
        {
          hasDemoUser: Boolean(demoUser[0]),
          hasDemoSalon: Boolean(demoSalon[0]),
          hasEducationOwner: Boolean(educationOwner[0]),
          categories: categories.length,
          hasCourseCategory: Boolean(courseCategory[0]),
        },
        "Marketplace demo seed skipped because required seed records are unavailable",
      );
      return { jobsCreated: 0, coursesCreated: 0, skipped: true };
    }

    const centers = await tx.insert(educationCentersTable).values([
      {
        ownerId: educationOwner[0].id,
        name: "LUMERA Demo Akademija Beograd",
        city: "Beograd",
        description: `${MARKER} [center:0] Namenski demo edukativni centar za prikaz platforme.`,
        imageUrl: "/lumera-media/course-1.jpg",
        verificationStatus: "verified",
        verifiedAt: new Date(),
      },
      {
        ownerId: educationOwner[0].id,
        name: "LUMERA Demo Akademija Novi Sad",
        city: "Novi Sad",
        description: `${MARKER} [center:1] Namenski demo edukativni centar za prikaz platforme.`,
        imageUrl: "/lumera-media/course-1.jpg",
        verificationStatus: "verified",
        verifiedAt: new Date(),
      },
      {
        ownerId: educationOwner[0].id,
        name: "LUMERA Demo Akademija Niš",
        city: "Niš",
        description: `${MARKER} [center:2] Namenski demo edukativni centar za prikaz platforme.`,
        imageUrl: "/lumera-media/course-1.jpg",
        verificationStatus: "verified",
        verifiedAt: new Date(),
      },
    ]).returning({ id: educationCentersTable.id, city: educationCentersTable.city });
    const instructorProfiles = await tx.insert(educationInstructorsTable).values(centers.map((center, index) => ({
      centerId: center.id,
      fullName: ["Ana Petrović", "Marija Marković", "Jelena Savić"][index]!,
      photoUrl: "/lumera-media/therapist-1.jpg",
      biography: `${MARKER} [instructor:${index}] Namenski demo instruktor za prikaz individualne edukacije.`,
      industryYears: 8 + index,
      experienceYears: 5 + index,
      specializations: ["Stručne tehnike", "Praktičan rad"],
      qualifications: ["Sertifikovani edukator"],
    }))).returning({ id: educationInstructorsTable.id, centerId: educationInstructorsTable.centerId });

    const plans = createDemoJobs(categories, demoUser[0].id, demoSalon[0].id);
    const expiresAt = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000);
    const jobs = await tx.insert(beautyJobListingsTable).values(plans.map((plan) => ({
      ...plan,
      photos: [],
      isTest: true,
      status: "active" as const,
      moderationStatus: "approved" as const,
      expiresAt,
    }))).returning({ id: beautyJobListingsTable.id, description: beautyJobListingsTable.description });
    const idsByDescription = new Map(jobs.map((listing) => [listing.description, listing.id]));
    const rentalPlans = plans.filter((plan) => plan.type === "equipment_rental" || plan.type === "space_rental");
    await tx.insert(beautyJobListingAvailabilityTable).values(rentalPlans.flatMap((plan) => {
      const listingId = idsByDescription.get(plan.description);
      return listingId ? [{
        listingId,
        availabilityPattern: "Radnim danima i vikendom po dogovoru",
        dayLabels: ["Pon", "Uto", "Sre", "Čet", "Pet", "Sub"],
      }] : [];
    }));
    const slotStart = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await tx.insert(beautyJobRentalSlotsTable).values(rentalPlans
      .filter((plan) => plan.intent === "offering")
      .flatMap((plan, index) => {
        const listingId = idsByDescription.get(plan.description);
        if (!listingId) return [];
        const startsAt = new Date(slotStart.getTime() + index * 24 * 60 * 60 * 1000);
        return [{ listingId, startsAt, endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000) }];
      }));

    const startDate = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const centerCourses = centers.map((center, index) => ({
      centerId: center.id,
      categoryId: courseCategory[0]!.id,
      title: ["Napredne tehnike nege lica", "Praktična maderoterapija", "Wellness protokoli za salon"][index]!,
      description: `${MARKER} [course:center:${index}] Javna demo edukacija edukativnog centra sa detaljnim programom i praktičnim radom.`,
      category: courseCategory[0]!.name,
      format: index === 1 ? "hybrid" as const : "in-person" as const,
      city: center.city,
      price: 15_000 + index * 6_500,
      duration: `${2 + index} dana`,
      level: index === 0 ? "intermediate" as const : "all-levels" as const,
      learningOutcomes: ["Siguran rad", "Praktična primena", "Plan tretmana"],
      includedItems: ["Materijal za rad", "Sertifikat"],
      requirements: "Osnovno poznavanje beauty usluga.",
      rating: 47 + index,
      certification: true,
      imageUrl: "/lumera-media/course-1.jpg",
      isTest: true,
      published: true,
      archived: false,
      startDate,
    }));
    const instructorCourses = instructorProfiles.map((profile, index) => {
      const center = centers.find((item) => item.id === profile.centerId);
      if (!center) throw new Error("Demo instructor profile is not attached to a managed demo center.");
      return {
        centerId: center.id,
        instructorProfileId: profile.id,
        categoryId: courseCategory[0]!.id,
        title: ["Individualna obuka za lash/brow", "Masterclass za make-up tehniku", "Mentorska radionica za masažu"][index]!,
        description: `${MARKER} [course:instructor:${index}] Javna demo edukacija instruktora sa mentorskim pristupom i radom u malim grupama.`,
        category: courseCategory[0]!.name,
        format: index === 0 ? "online" as const : "hybrid" as const,
        city: index === 0 ? null : center.city,
        price: 12_000 + index * 7_000,
        duration: `${1 + index} dan`,
        level: index === 2 ? "advanced" as const : "beginner" as const,
        learningOutcomes: ["Individualni pristup", "Tehnika", "Povratna informacija"],
        includedItems: ["Skripta", "Sertifikat"],
        requirements: "Prijava je otvorena za beauty profesionalce.",
        rating: 48,
        certification: true,
        imageUrl: "/lumera-media/course-1.jpg",
        isTest: true,
        published: true,
        archived: false,
        startDate,
      };
    });
    const courses = await tx.insert(coursesTable).values([...centerCourses, ...instructorCourses])
      .returning({ id: coursesTable.id });

    return { jobsCreated: jobs.length, coursesCreated: courses.length, skipped: false };
  });

  logger.info(result, "Production marketplace demo content checked");
}