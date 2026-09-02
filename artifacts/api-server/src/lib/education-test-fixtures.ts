import { asc, eq } from "drizzle-orm";
import {
  coursesTable,
  db,
  educationPlatformSettingsTable,
  pool,
} from "@workspace/db";

const EDUCATION_IPS_TEST_LOCK = "education-test-ips-settings";

export const VALID_TEST_IPS_SETTINGS = {
  ipsRecipientName: "LUMERA test",
  ipsRecipientAccount: "160000000000000000",
  ipsPurpose: "Edukacija",
  ipsAccountEnvironment: "test",
} as const;

type IpsSettingsPatch = Partial<Pick<
  typeof educationPlatformSettingsTable.$inferInsert,
  "ipsRecipientName" | "ipsRecipientAccount" | "ipsPurpose" | "ipsAccountEnvironment"
>>;

export async function installTemporaryEducationIpsSettings(
  patch: IpsSettingsPatch = VALID_TEST_IPS_SETTINGS,
): Promise<{
  settingsId: string;
  restore: () => Promise<void>;
}> {
  const client = await pool.connect();
  await client.query("select pg_advisory_lock(hashtext($1))", [EDUCATION_IPS_TEST_LOCK]);

  try {
    const [existing] = await db.select().from(educationPlatformSettingsTable)
      .orderBy(asc(educationPlatformSettingsTable.createdAt))
      .limit(1);
    if (!existing) {
      const [created] = await db.insert(educationPlatformSettingsTable).values({
        commissionPercent: 15,
        reservePercent: 5,
        ...patch,
      }).returning({ id: educationPlatformSettingsTable.id });
      if (!created) throw new Error("Could not create temporary Education IPS settings.");
      return {
        settingsId: created.id,
        restore: async () => {
          try {
            await db.delete(educationPlatformSettingsTable)
              .where(eq(educationPlatformSettingsTable.id, created.id));
          } finally {
            try {
              await client.query("select pg_advisory_unlock(hashtext($1))", [EDUCATION_IPS_TEST_LOCK]);
            } finally {
              client.release();
            }
          }
        },
      };
    }

    const changedKeys = Object.keys(patch) as Array<keyof IpsSettingsPatch>;
    const snapshot = Object.fromEntries(
      changedKeys.map((key) => [key, existing[key]]),
    ) as IpsSettingsPatch;
    await db.update(educationPlatformSettingsTable).set(patch)
      .where(eq(educationPlatformSettingsTable.id, existing.id));

    return {
      settingsId: existing.id,
      restore: async () => {
        try {
          await db.update(educationPlatformSettingsTable).set(snapshot)
            .where(eq(educationPlatformSettingsTable.id, existing.id));
        } finally {
          try {
            await client.query("select pg_advisory_unlock(hashtext($1))", [EDUCATION_IPS_TEST_LOCK]);
          } finally {
            client.release();
          }
        }
      },
    };
  } catch (error) {
    try {
      await client.query("select pg_advisory_unlock(hashtext($1))", [EDUCATION_IPS_TEST_LOCK]);
    } finally {
      client.release();
    }
    throw error;
  }
}

type OnlineCourseFixture = typeof coursesTable.$inferInsert;

export function buildValidOnlineEducationCourse(
  overrides: Partial<OnlineCourseFixture> & Pick<OnlineCourseFixture, "title" | "category" | "price">,
): OnlineCourseFixture {
  return {
    description: "Valid online Education test course.",
    format: "online",
    city: "Beograd",
    duration: "4 nedelje",
    imageUrl: "/test-education-course.jpg",
    published: true,
    onlineAccessDays: 30,
    extensionPrice1Month: 1_000,
    extensionPrice3Months: 2_500,
    extensionPrice6Months: 4_000,
    ...overrides,
  };
}

export function buildValidOnlineEducationEnrollmentRequest<T extends Record<string, unknown>>(
  overrides?: T,
): T & { digitalContentConsent: true } {
  return {
    ...overrides,
    digitalContentConsent: true,
  } as T & { digitalContentConsent: true };
}