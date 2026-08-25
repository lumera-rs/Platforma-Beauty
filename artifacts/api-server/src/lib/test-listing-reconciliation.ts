import { db } from "@workspace/db";
import { beautyJobListingsTable, coursesTable } from "@workspace/db/schema";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { logger } from "./logger";

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

const demoMarkerPatterns = [
  "%[LUMERA_DEMO_MARKETPLACE_2026_08_25]%",
  "%[LUMERA_DEMO_SEED_2026_08_25]%",
];

export async function reconcileKnownTestListings(): Promise<void> {
  const [beautyJobs, courses] = await db.transaction(async (tx) => Promise.all([
    tx.update(beautyJobListingsTable)
      .set({ isTest: true })
      .where(and(
        eq(beautyJobListingsTable.isTest, false),
        or(
          inArray(beautyJobListingsTable.id, knownTestBeautyJobIds),
          ...demoMarkerPatterns.map((pattern) => like(beautyJobListingsTable.description, pattern)),
        ),
      ))
      .returning({ id: beautyJobListingsTable.id }),
    tx.update(coursesTable)
      .set({ isTest: true })
      .where(and(
        eq(coursesTable.isTest, false),
        or(
          inArray(coursesTable.id, knownSeedCourseIds),
          ...demoMarkerPatterns.map((pattern) => like(coursesTable.description, pattern)),
        ),
      ))
      .returning({ id: coursesTable.id }),
  ]));

  logger.info(
    { beautyJobsMarked: beautyJobs.length, coursesMarked: courses.length },
    "Known test listings reconciled",
  );
}