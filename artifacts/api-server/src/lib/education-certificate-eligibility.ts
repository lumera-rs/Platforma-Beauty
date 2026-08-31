import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  courseEnrollmentsTable, courseLessonsTable, courseModulesTable, courseSessionsTable, coursesTable, db,
  educationAttendanceTable, educationBookingGroupsTable, educationBookingParticipantsTable, educationInstallmentsTable, educationPriceSnapshotsTable, lessonProgressTable,
} from "@workspace/db";

export type EducationEligibility = {
  total: number; completed: number; percent: number; certificateEligible: boolean; reasons: string[];
};

/** Single source of truth for operational completion and certificate issuance. */
export async function educationCertificateEligibility(enrollment: typeof courseEnrollmentsTable.$inferSelect, store: any = db): Promise<EducationEligibility> {
  // Historical records predate named operational participants; preserve their
  // completed-state contract rather than retroactively making them incomplete.
  if (!enrollment.participantId) return {
    total: 0, completed: 0, percent: enrollment.progress,
    certificateEligible: enrollment.status === "completed", reasons: enrollment.status === "completed" ? [] : ["enrollment_not_completed"],
  };
  const [modules, progress, participant] = await Promise.all([
    store.select({ id: courseLessonsTable.id }).from(courseLessonsTable).innerJoin(courseModulesTable, eq(courseModulesTable.id, courseLessonsTable.moduleId)).where(eq(courseModulesTable.courseId, enrollment.courseId)),
    store.select({ lessonId: lessonProgressTable.lessonId }).from(lessonProgressTable).where(eq(lessonProgressTable.enrollmentId, enrollment.id)),
    store.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.id, enrollment.participantId)).limit(1),
  ]);
  const lessons = modules.map((x: { id: string }) => x.id); const done = new Set(progress.map((x: { lessonId: string }) => x.lessonId));
  const [course] = await store.select({ format: coursesTable.format }).from(coursesTable).where(eq(coursesTable.id, enrollment.courseId)).limit(1);
  const reasons: string[] = [];
  if (enrollment.status === "cancelled" || enrollment.paymentStatus === "refunded") reasons.push("enrollment_cancelled");
  if (enrollment.paymentStatus !== "paid" || !enrollment.accessGrantedAt) reasons.push("access_inactive");
  if (enrollment.bookingGroupId) {
    const [snapshot] = await store.select({ id: educationPriceSnapshotsTable.id }).from(educationPriceSnapshotsTable)
      .where(eq(educationPriceSnapshotsTable.bookingGroupId, enrollment.bookingGroupId)).limit(1);
    if (snapshot) {
      const installments = await store.select({ status: educationInstallmentsTable.status }).from(educationInstallmentsTable)
        .where(eq(educationInstallmentsTable.priceSnapshotId, snapshot.id));
      if (installments.some((item: { status: string }) => item.status !== "settled")) reasons.push("payment_incomplete");
    }
  }
  const needsLessons = course?.format === "online" || course?.format === "hybrid";
  if (needsLessons && lessons.some((id: string) => !done.has(id))) reasons.push("lessons_incomplete");
  // `course_format` is deliberately the public contract vocabulary.  The
  // former `live` check could never match and issued in-person certificates
  // without attendance.
  const needsAttendance = course?.format === "in-person" || course?.format === "hybrid";
  if (needsAttendance) {
    const sessions = participant[0] ? await store.select({ id: courseSessionsTable.id }).from(educationBookingGroupsTable).innerJoin(courseSessionsTable, eq(courseSessionsTable.id, educationBookingGroupsTable.sessionId)).where(and(eq(educationBookingGroupsTable.courseId, enrollment.courseId), isNull(courseSessionsTable.cancelledAt), eq(educationBookingGroupsTable.id, participant[0].bookingGroupId))) : [];
    const attendance = sessions.length ? await store.select().from(educationAttendanceTable).where(and(eq(educationAttendanceTable.participantId, enrollment.participantId), inArray(educationAttendanceTable.sessionId, sessions.map((x: { id: string }) => x.id)))) : [];
    if (!sessions.length || sessions.some((s: { id: string }) => !attendance.some((a: any) => a.sessionId === s.id && (a.status === "present" || a.status === "excused")))) reasons.push("attendance_incomplete");
  }
  const total = (needsLessons ? lessons.length : 0) + (needsAttendance ? 1 : 0);
  const completed = (needsLessons ? lessons.filter((id: string) => done.has(id)).length : 0) + (needsAttendance && !reasons.includes("attendance_incomplete") ? 1 : 0);
  return { total, completed, percent: total ? Math.round(completed * 100 / total) : 100, certificateEligible: reasons.length === 0, reasons };
}

/** Reconcile an operational enrollment from live payment, lesson and
 * attendance gates. Call inside the transaction that changed any gate. */
export async function reconcileOperationalEducationEnrollmentInTx(tx: any, enrollmentId: string) {
  const [enrollment] = await tx.select().from(courseEnrollmentsTable)
    .where(eq(courseEnrollmentsTable.id, enrollmentId)).for("update").limit(1);
  if (!enrollment || !enrollment.participantId) return enrollment ?? null;
  // Cancellation/refund is terminal and must never be revived by progress.
  if (enrollment.status === "cancelled" || enrollment.paymentStatus === "refunded") return enrollment;
  const eligibility = await educationCertificateEligibility(enrollment, tx);
  const lessons = await tx.select({ id: courseLessonsTable.id }).from(courseLessonsTable)
    .innerJoin(courseModulesTable, eq(courseModulesTable.id, courseLessonsTable.moduleId))
    .where(eq(courseModulesTable.courseId, enrollment.courseId));
  const progressRows = await tx.select({ lessonId: lessonProgressTable.lessonId }).from(lessonProgressTable)
    .where(eq(lessonProgressTable.enrollmentId, enrollment.id));
  const done = new Set(progressRows.map((row: { lessonId: string }) => row.lessonId));
  const nextLesson = lessons.find((lesson: { id: string }) => !done.has(lesson.id))?.id ?? null;
  const eligible = eligibility.certificateEligible;
  const fallbackStatus = enrollment.paymentStatus === "paid" && enrollment.accessGrantedAt ? "active" : "pending";
  const [updated] = await tx.update(courseEnrollmentsTable).set({
    progress: eligibility.percent,
    nextLesson,
    status: eligible ? "completed" : fallbackStatus,
    completedAt: eligible ? enrollment.completedAt ?? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(courseEnrollmentsTable.id, enrollment.id)).returning();
  return updated!;
}