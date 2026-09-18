import {
  beautyJobListingsTable,
  coursesTable,
  db,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
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

export async function reconcileKnownTestListings(
  reconcileLegacyTestIds: () => Promise<{
    beautyJobsMarked: number;
    coursesMarked: number;
  }> = reconcileExplicitLegacyTestIds,
): Promise<void> {
  if (process.env.NODE_ENV === "production") return;

  const result = await reconcileLegacyTestIds();
  logger.info(result, "Explicit legacy test listings reconciled");
}