/**
 * Explicit repair for the managed education demo identity used by the
 * separately controlled marketplace showcase bootstrap.
 *
 * This is not fixture initialization and is never called by HTTP request
 * handling.  Keeping it in its own module prevents the production bootstrap
 * from importing the fixture facade.
 */
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

const DEMO_EDUCATION_OWNER_EMAIL = "edukacija@lumera.local";

export async function restoreDemoEducationOwnerRole(
  database: Pick<typeof db, "update"> = db,
): Promise<void> {
  await database.update(usersTable).set({
    role: "EDUKATIVNI_CENTAR",
    active: true,
    updatedAt: new Date(),
  }).where(eq(usersTable.email, DEMO_EDUCATION_OWNER_EMAIL));
}
