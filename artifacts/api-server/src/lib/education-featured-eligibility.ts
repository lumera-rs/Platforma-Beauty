import { desc, inArray, sql, type SQL } from "drizzle-orm";
import { coursesTable, db, educationFeaturedChargesTable } from "@workspace/db";

/**
 * Canonical public-featured eligibility rule for education courses.
 *
 * This is the single source of truth every public-facing reader must use --
 * GET /education/public/popular's ranking, GET /education/public/featured's
 * listing, the single-course detail view, and the shared batch card
 * assembler (batchEducationCourseViews) -- so they can never again disagree
 * about whether a course is entitled to paid-featured treatment right now.
 * (Before this file existed, all four had their own slightly different
 * implementation of this exact question -- that drift is what let an unpaid
 * isFeatured=true course rank as featured in /education/public/popular; see
 * Task #6/#6B.)
 *
 * A course is publicly featured iff, at the given reference time:
 *   1. courses.is_featured = true (an activation is currently on), AND
 *   2. courses.featured_until is null OR strictly in the future, AND
 *   3. the MOST RECENT education_featured_charges row for this course has
 *      status = 'paid'.
 *
 * Why "latest charge", not "any paid charge ever existed" (the ambiguity
 * Task #6B was asked to resolve, not guess at):
 *
 * Every PATCH /education/courses/:courseId/featured {active:true} call --
 * whether it is the course's first activation or a later one issued while
 * isFeatured is already true -- unconditionally resets featuredActivatedAt
 * to now and inserts a brand-new education_featured_charges row. There is no
 * distinct "renew" code path, and featuredUntil never holds a genuine future
 * expiry anywhere in the current model: it is set to null on activation and
 * to "now" (i.e. already-passed) on deactivation. So calling activate()
 * again is, mechanically and by the system's own bookkeeping, indistinguishable
 * from a brand-new activation request -- and the very first activation
 * already requires its own payment before counting publicly (isFeatured
 * flips immediately, but a non-zero fee stays "pending" until an admin
 * settles it). The same rule must apply symmetrically to every later
 * activation: a fresh pending charge means THIS request hasn't been paid
 * for yet, so the course must not stay publicly featured on the strength of
 * a DIFFERENT, earlier charge -- exactly mirroring how the first activation
 * is already handled, and requiring nothing invented.
 *
 * "Any paid charge ever" would also reopen a variant of the exact bypass
 * Task #6 closed: pay once (even a free/$0 charge), deactivate, reactivate
 * indefinitely -- every reactivation would silently inherit the original
 * charge's paid status forever, without ever paying again. "Latest charge"
 * closes that: a reactivation only counts once its OWN charge clears.
 *
 * (batchEducationCourseViews's own pre-existing comment already said
 * "Featured: isFeatured flag + not expired + latest charge is 'paid'" --
 * the code just implemented "any paid charge" instead. This file is that
 * fix, not a new policy.)
 */

export type FeaturedCourseState = {
  id: string;
  isFeatured: boolean;
  featuredUntil: Date | null;
};

/**
 * The canonical rule as a SQL boolean, safe to use directly in a WHERE
 * clause or as an ORDER BY term against `coursesTable` (correlated on
 * `coursesTable.id`, so it can appear once per query regardless of how many
 * course rows are being read). Explicitly coalesced to `false`: a scalar
 * subquery that finds no charge row returns SQL NULL, and Postgres sorts
 * NULL as the *largest* value in a DESC ORDER BY by default -- without the
 * coalesce, a never-charged course would incorrectly outrank even genuinely
 * paid-featured ones.
 */
export function publicFeaturedEducationCourseSql(referenceTime: Date): SQL<boolean> {
  return sql<boolean>`coalesce((
    ${coursesTable.isFeatured}
    and (${coursesTable.featuredUntil} is null or ${coursesTable.featuredUntil} > ${referenceTime})
    and (
      select ${educationFeaturedChargesTable.status}
      from ${educationFeaturedChargesTable}
      where ${educationFeaturedChargesTable.courseId} = ${coursesTable.id}
      order by ${educationFeaturedChargesTable.createdAt} desc
      limit 1
    ) = 'paid'
  ), false)`;
}

/**
 * Batch resolver for the same rule: one query against
 * education_featured_charges for however many courses are passed in (skipping
 * courses already disqualified by isFeatured/featuredUntil alone), then the
 * "latest charge" rule applied in memory. Never call this per-course in a
 * loop -- callers with N courses must call it once with all N.
 */
export async function batchPublicFeaturedEducationCourseState(
  courses: readonly FeaturedCourseState[],
  referenceTime: Date,
  executor: Pick<typeof db, "select"> = db,
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  const candidates = courses.filter((course) =>
    course.isFeatured && (!course.featuredUntil || course.featuredUntil > referenceTime));
  for (const course of courses) {
    if (!candidates.includes(course)) result.set(course.id, false);
  }
  if (!candidates.length) return result;

  const candidateIds = candidates.map((course) => course.id);
  const charges = await executor.select({
    courseId: educationFeaturedChargesTable.courseId,
    status: educationFeaturedChargesTable.status,
  }).from(educationFeaturedChargesTable)
    .where(inArray(educationFeaturedChargesTable.courseId, candidateIds))
    .orderBy(desc(educationFeaturedChargesTable.createdAt));
  const latestStatusByCourseId = new Map<string, string>();
  for (const charge of charges) {
    if (!latestStatusByCourseId.has(charge.courseId)) latestStatusByCourseId.set(charge.courseId, charge.status);
  }
  for (const course of candidates) {
    result.set(course.id, latestStatusByCourseId.get(course.id) === "paid");
  }
  return result;
}

/**
 * Single-course convenience wrapper. Delegates to the exact same batch logic
 * above (rather than reimplementing it) so the single-course detail path can
 * never independently drift from the batch/list path again.
 */
export async function isPubliclyFeaturedEducationCourse(
  course: FeaturedCourseState,
  referenceTime: Date = new Date(),
  executor: Pick<typeof db, "select"> = db,
): Promise<boolean> {
  const map = await batchPublicFeaturedEducationCourseState([course], referenceTime, executor);
  return map.get(course.id) ?? false;
}
