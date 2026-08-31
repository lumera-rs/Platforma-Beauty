import { createHash } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  courseSessionsTable, coursesTable, db, educationBookingGroupsTable,
  educationBookingParticipantsTable, educationCenterStaffTable, educationOutboxTable,
  educationCentersTable, educationEducatorAbsencesTable, educationEducatorWeeklyAvailabilityTable, educationSessionEducatorsTable, educationRecurrenceCommandsTable,
  courseEnrollmentsTable, educationEscrowsTable, educationFinancialEventsTable, educationLedgerEntriesTable, educationPriceSnapshotsTable, educationInstallmentsTable, educationInstallmentSettlementCommandsTable, educationAttendanceTable, educationWaitlistTable,
  usersTable,
} from "@workspace/db";
import {
  CreateEducationOperationalBookingBody, CreateEducationOperationalBookingHeader,
  CreateEducationOperationalBookingResponse, GetEducationCourseAvailabilityParams,
  GetEducationCourseAvailabilityQueryParams, GetEducationCourseAvailabilityResponse,
  CreateEducationCenterOperationalStaffBody, CreateEducationCenterOperationalStaffParams,
  CreateEducationCenterOperationalStaffResponse, GetEducationCenterOperationalPermissionsParams,
  GetEducationCenterOperationalPermissionsResponse, ListEducationCenterOperationalStaffParams,
  ListEducationCenterOperationalStaffResponse, UpdateEducationCenterOperationalStaffBody,
  UpdateEducationCenterOperationalStaffParams, UpdateEducationCenterOperationalStaffResponse,
  CreateEducationEducatorAbsenceBody, CreateEducationEducatorAbsenceParams, CreateEducationEducatorAbsenceResponse,
  PreviewEducationEducatorAbsenceBody, PreviewEducationEducatorAbsenceParams, PreviewEducationEducatorAbsenceResponse,
  CreateEducationEducatorWeeklyAvailabilityBody, CreateEducationEducatorWeeklyAvailabilityParams, CreateEducationEducatorWeeklyAvailabilityResponse,
  DeleteEducationEducatorAbsenceParams, DeleteEducationEducatorWeeklyAvailabilityParams,
  ListEducationEducatorAbsencesParams, ListEducationEducatorAbsencesResponse,
  ListEducationEducatorWeeklyAvailabilityParams, ListEducationEducatorWeeklyAvailabilityResponse,
  UpdateEducationEducatorWeeklyAvailabilityBody, UpdateEducationEducatorWeeklyAvailabilityParams, UpdateEducationEducatorWeeklyAvailabilityResponse,
  UpdateEducationEducatorAbsenceBody, UpdateEducationEducatorAbsenceParams, UpdateEducationEducatorAbsenceResponse,
  CommitEducationCourseRecurrenceBody, CommitEducationCourseRecurrenceHeader, CommitEducationCourseRecurrenceParams, CommitEducationCourseRecurrenceResponse,
  PreviewEducationCourseRecurrenceBody, PreviewEducationCourseRecurrenceParams, PreviewEducationCourseRecurrenceResponse,
  GetEducationCenterOperationsCalendarParams, GetEducationCenterOperationsCalendarQueryParams, GetEducationCenterOperationsCalendarResponse,
  GetMyEducationOperationalBookingParams, GetMyEducationOperationalBookingResponse,
  ListMyEducationOperationalBookingsResponse,
  CancelEducationOperationalBookingBody, CancelEducationOperationalBookingParams, CancelEducationOperationalBookingResponse,
  RescheduleEducationOperationalBookingBody, RescheduleEducationOperationalBookingHeader, RescheduleEducationOperationalBookingParams, RescheduleEducationOperationalBookingResponse,
  GetEducationOperationalAttendanceParams, GetEducationOperationalAttendanceResponse, UpsertEducationOperationalAttendanceBody, UpsertEducationOperationalAttendanceParams, UpsertEducationOperationalAttendanceResponse,
  SubstituteEducationSessionEducatorBody, SubstituteEducationSessionEducatorParams, SubstituteEducationSessionEducatorResponse,
  CancelEducationOperationalSessionBody, CancelEducationOperationalSessionParams, CancelEducationOperationalSessionResponse,
  DownloadEducationOperationalBookingCalendarParams,
  GetEducationOperationalInstallmentIpsQrParams, GetEducationOperationalInstallmentIpsQrResponse,
  GetEducationOperationalPaymentPlanParams, GetEducationOperationalPaymentPlanResponse,
  SettleAdminEducationInstallmentParams, SettleAdminEducationInstallmentHeader, SettleAdminEducationInstallmentResponse,
  ListAdminEducationInstallmentsQueryParams, ListAdminEducationInstallmentsResponse,
} from "@workspace/api-zod";
import { getCurrentUser, isAdmin } from "../lib/auth";
import {
  assertBelgradeDate,
  educationAbsenceConflicts,
  educationBelgradeInstant,
  educationCanonicalAvailability,
  educationEducatorHasAbsenceOverlap,
  educationLocalDatesTouched,
} from "../lib/education-availability-store";
import { lockEducationScheduleResources } from "../lib/education-locks";
import { cancelEducationSession, releaseSeatAndPromoteWaiter } from "../lib/education-sessions";
import { educationIpsQrPayload, educationOperationalPriceQuote } from "../lib/education-marketplace-domain";
import { getEducationPlatformSettings, lockEducationBillingRules, resolveEducationBillingSettings } from "../lib/education-billing";
import { operationalCancellationDisposition, operationalPaymentTotals, operationalRescheduleAllowed } from "../lib/education-operational-policy";
import { reconcileOperationalEducationEnrollmentInTx } from "../lib/education-certificate-eligibility";

const router: IRouter = Router();

function invalid(res: Response, message: string) { res.status(400).json({ error: message }); }
function requestValue(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function sessionDay(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = get("year"); const month = get("month"); const day = get("day");
  if (!year || !month || !day) throw new Error("Cannot resolve Europe/Belgrade session day.");
  return `${year}-${month}-${day}`;
}
function sessionTime(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const hour = get("hour"); const minute = get("minute");
  if (!hour || !minute) throw new Error("Cannot resolve Europe/Belgrade session time.");
  return `${hour}:${minute}`;
}
function sessionLockResources(centerId: string, startsAt: Date, endsAt: Date, educatorStaffId?: string | null) {
  return educationLocalDatesTouched(startsAt, endsAt).map((date) => ({ centerId, date, educatorStaffId }));
}
function educatorCalendarMutationResources(centerId: string, educatorStaffId: string) {
  // The center lock is shared with every recurrence/session mutation. The
  // synthetic day also gives all calendar-fact writes one stable lock key.
  return [{ centerId, date: "calendar", educatorStaffId }];
}

async function centerRole(req: Request, centerId: string) {
  const user = await getCurrentUser(req);
  if (!user) return { user: null, role: null as string | null };
  if (isAdmin(user)) return { user, role: "owner_admin" };
  const [center] = await db.select({ ownerId: educationCentersTable.ownerId }).from(educationCentersTable)
    .where(eq(educationCentersTable.id, centerId)).limit(1);
  if (center?.ownerId === user.id) return { user, role: "owner_admin" };
  const [staff] = await db.select().from(educationCenterStaffTable).where(and(
    eq(educationCenterStaffTable.centerId, centerId), eq(educationCenterStaffTable.userId, user.id),
    eq(educationCenterStaffTable.active, true),
  )).limit(1);
  return { user, role: staff?.role ?? null };
}

function staffView(staff: typeof educationCenterStaffTable.$inferSelect) {
  return { id: staff.id, centerId: staff.centerId, userId: staff.userId, instructorProfileId: staff.instructorProfileId, role: staff.role, active: staff.active };
}

function validWallClockRange(startTime: string | null, endTime: string | null) {
  return (startTime === null && endTime === null) || (Boolean(startTime) && Boolean(endTime) && startTime! < endTime!);
}

/**
 * Customer-facing identity boundary for operational groups. Unlike the
 * center calendar, this view is only reachable by its purchaser or a named
 * participant, so contact details are never projected to an unrelated user.
 */
async function customerBookingView(group: typeof educationBookingGroupsTable.$inferSelect, viewerId: string, centerStaffView = false) {
  const [[course], session, participants, enrollments] = await Promise.all([
    db.select({ title: coursesTable.title }).from(coursesTable)
      .where(eq(coursesTable.id, group.courseId)).limit(1),
    group.sessionId
      ? db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, group.sessionId)).limit(1)
      : Promise.resolve([] as typeof courseSessionsTable.$inferSelect[]),
    db.select().from(educationBookingParticipantsTable)
      .where(eq(educationBookingParticipantsTable.bookingGroupId, group.id))
      .orderBy(educationBookingParticipantsTable.createdAt),
    db.select({
      id: courseEnrollmentsTable.id,
      participantId: courseEnrollmentsTable.participantId,
    }).from(courseEnrollmentsTable)
      .where(eq(courseEnrollmentsTable.bookingGroupId, group.id)),
  ]);
  // A group has a restrictive course FK. Retaining an explicit failure rather
  // than manufacturing a title keeps this read model honest for corrupt data.
  if (!course) throw new Error("Kurs rezervacije nije pronađen.");
  const currentSession = session[0] ?? null;
  return {
    id: group.id, centerId: group.centerId, courseId: group.courseId,
    courseTitle: course.title, sessionId: group.sessionId, purchaserId: group.purchaserId,
    status: group.status, createdAt: group.createdAt.toISOString(), updatedAt: group.updatedAt.toISOString(),
    session: currentSession ? {
      id: currentSession.id, startsAt: currentSession.startsAt.toISOString(), endsAt: currentSession.endsAt.toISOString(),
      location: currentSession.location, cancelledAt: currentSession.cancelledAt?.toISOString() ?? null,
    } : null,
    // A named participant is entitled to their own identity only.  The
    // purchaser owns the group and may manage all seats, so retains contacts.
    participants: participants.map((participant) => {
      const purchaserView = group.purchaserId === viewerId || centerStaffView;
      const ownRecord = participant.userId === viewerId;
      const enrollmentId = enrollments.find((enrollment) => enrollment.participantId === participant.id)?.id ?? null;
      return {
        id: participant.id, userId: purchaserView || ownRecord ? participant.userId : null,
        enrollmentId: purchaserView || ownRecord ? enrollmentId : null,
        fullName: purchaserView || ownRecord ? participant.fullName : "Rezervisano mesto",
        email: purchaserView || ownRecord ? participant.email : null,
        phone: purchaserView || ownRecord ? participant.phone : null, status: participant.status,
      };
    }),
  };
}

async function lockEducationCenterFinancials(tx: any, centerId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`education-center:${centerId}`}))`);
}

function operationFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function selectedOperationalParticipants(
  participants: (typeof educationBookingParticipantsTable.$inferSelect)[],
  requestedIds: string[] | undefined,
  actorId: string,
  purchaserId: string | null,
  canManageAll = false,
) {
  const selected = requestedIds ? participants.filter((row) => requestedIds.includes(row.id)) : participants;
  if (requestedIds && selected.length !== requestedIds.length) throw new Error("PARTICIPANT_NOT_FOUND");
  if (!canManageAll && actorId !== purchaserId && (selected.length !== 1 || selected[0]?.userId !== actorId)) throw new Error("NOT_SELF_PARTICIPANT");
  return selected;
}

function recurrenceDates(startDate: string, endDate: string, weekdays: number[]) {
  assertBelgradeDate(startDate); assertBelgradeDate(endDate);
  if (endDate < startDate) throw new Error("Datum završetka mora biti nakon datuma početka.");
  const start = new Date(`${startDate}T12:00:00Z`); const end = new Date(`${endDate}T12:00:00Z`);
  if ((end.getTime() - start.getTime()) / 86_400_000 > 366) throw new Error("Opseg može trajati najviše 366 dana.");
  const selected = new Set(weekdays);
  const dates: string[] = [];
  for (let day = start; day <= end; day = new Date(day.getTime() + 86_400_000)) {
    const isoWeekday = ((day.getUTCDay() + 6) % 7) + 1;
    if (selected.has(isoWeekday)) dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

async function operationalEducator(req: Request, centerId: string, staffId: string, write: "view" | "create" | "mutate") {
  const access = await centerRole(req, centerId);
  if (!access.user || !access.role) return { access, staff: null, allowed: false };
  const [staff] = await db.select().from(educationCenterStaffTable).where(and(
    eq(educationCenterStaffTable.id, staffId), eq(educationCenterStaffTable.centerId, centerId),
    eq(educationCenterStaffTable.role, "educator"), eq(educationCenterStaffTable.active, true),
  )).limit(1);
  if (!staff) return { access, staff: null, allowed: false };
  const own = staff.userId === access.user.id;
  const allowed = write === "view"
    || (write === "create" && (access.role === "owner_admin" || access.role === "manager_reception" || own))
    || (write === "mutate" && (access.role === "owner_admin" || own));
  return { access, staff, allowed };
}

router.get("/education/operations/centers/:centerId/permissions", async (req, res): Promise<void> => {
  const params = GetEducationCenterOperationalPermissionsParams.safeParse(req.params);
  if (!params.success) { invalid(res, params.error.message); return; }
  const access = await centerRole(req, params.data.centerId);
  if (!access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!access.role) { res.status(403).json({ error: "Pristup centru nije dozvoljen." }); return; }
  const [staff] = await db.select().from(educationCenterStaffTable).where(and(
    eq(educationCenterStaffTable.centerId, params.data.centerId), eq(educationCenterStaffTable.userId, access.user.id),
    eq(educationCenterStaffTable.role, "educator"), eq(educationCenterStaffTable.active, true),
  )).limit(1);
  res.json(GetEducationCenterOperationalPermissionsResponse.parse({
    centerId: params.data.centerId, role: access.role, educatorStaffId: staff?.id ?? null,
    canManageStaff: access.role === "owner_admin", canManageCalendar: true, canTakeAttendance: true,
  }));
});

router.get("/education/operations/centers/:centerId/calendar", async (req, res): Promise<void> => {
  const params = GetEducationCenterOperationsCalendarParams.safeParse(req.params);
  const query = GetEducationCenterOperationsCalendarQueryParams.safeParse(req.query);
  if (!params.success) { invalid(res, params.error.message); return; }
  if (!query.success) { invalid(res, query.error.message); return; }
  try {
    assertBelgradeDate(query.data.startDate); assertBelgradeDate(query.data.endDate);
    if (query.data.endDate < query.data.startDate) throw new Error("Datum završetka mora biti nakon datuma početka.");
    if ((new Date(`${query.data.endDate}T12:00:00Z`).getTime() - new Date(`${query.data.startDate}T12:00:00Z`).getTime()) / 86_400_000 > 366) throw new Error("Opseg može trajati najviše 366 dana.");
  } catch (error) { invalid(res, error instanceof Error ? error.message : "Opseg datuma nije ispravan."); return; }
  const access = await centerRole(req, params.data.centerId);
  if (!access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!access.role) { res.status(403).json({ error: "Pristup centru nije dozvoljen." }); return; }
  let educatorStaffId = query.data.educatorStaffId;
  if (access.role === "educator") {
    const [own] = await db.select({ id: educationCenterStaffTable.id }).from(educationCenterStaffTable).where(and(eq(educationCenterStaffTable.centerId, params.data.centerId), eq(educationCenterStaffTable.userId, access.user.id), eq(educationCenterStaffTable.role, "educator"), eq(educationCenterStaffTable.active, true))).limit(1);
    if (!own) { res.status(403).json({ error: "Aktivan edukator nije pronađen." }); return; }
    educatorStaffId = own.id;
  }
  const sessions = await db.select({ id: courseSessionsTable.id, courseId: courseSessionsTable.courseId, startsAt: courseSessionsTable.startsAt, endsAt: courseSessionsTable.endsAt, capacity: courseSessionsTable.capacity, reservedSeats: courseSessionsTable.reservedSeats, educatorStaffId: educationSessionEducatorsTable.staffId })
    .from(courseSessionsTable).innerJoin(coursesTable, eq(coursesTable.id, courseSessionsTable.courseId))
    .innerJoin(educationSessionEducatorsTable, eq(educationSessionEducatorsTable.sessionId, courseSessionsTable.id))
    .where(and(eq(coursesTable.centerId, params.data.centerId), gte(courseSessionsTable.startsAt, educationBelgradeInstant(query.data.startDate, "00:00")), lte(courseSessionsTable.startsAt, educationBelgradeInstant(query.data.endDate, "23:59")), educatorStaffId ? eq(educationSessionEducatorsTable.staffId, educatorStaffId) : undefined));
  // Participant identity is only materialized for the already role-scoped
  // sessions; no cross-center booking group can enter this query.
  const result = await Promise.all(sessions.map(async (session) => {
    const participants = await db.select({ id: educationBookingParticipantsTable.id, fullName: educationBookingParticipantsTable.fullName, email: educationBookingParticipantsTable.email, phone: educationBookingParticipantsTable.phone, status: educationBookingParticipantsTable.status })
      .from(educationBookingParticipantsTable).innerJoin(educationBookingGroupsTable, eq(educationBookingGroupsTable.id, educationBookingParticipantsTable.bookingGroupId))
      .where(and(eq(educationBookingGroupsTable.sessionId, session.id), eq(educationBookingGroupsTable.centerId, params.data.centerId)));
    return { ...session, startsAt: session.startsAt.toISOString(), endsAt: session.endsAt.toISOString(), participants };
  }));
  res.json(GetEducationCenterOperationsCalendarResponse.parse(result));
});

router.get("/education/operations/centers/:centerId/staff", async (req, res): Promise<void> => {
  const params = ListEducationCenterOperationalStaffParams.safeParse(req.params);
  if (!params.success) { invalid(res, params.error.message); return; }
  const access = await centerRole(req, params.data.centerId);
  if (!access.user || !access.role) { res.status(403).json({ error: "Pristup centru nije dozvoljen." }); return; }
  const staff = await db.select().from(educationCenterStaffTable).where(and(
    eq(educationCenterStaffTable.centerId, params.data.centerId),
    access.role === "educator" ? eq(educationCenterStaffTable.userId, access.user.id) : undefined,
  ));
  res.json(ListEducationCenterOperationalStaffResponse.parse(staff.map(staffView)));
});

router.post("/education/operations/centers/:centerId/staff", async (req, res): Promise<void> => {
  const params = CreateEducationCenterOperationalStaffParams.safeParse(req.params);
  const body = CreateEducationCenterOperationalStaffBody.safeParse(req.body);
  if (!params.success || !body.success) { invalid(res, (!params.success ? params.error : body.error!).message); return; }
  const access = await centerRole(req, params.data.centerId);
  if (!access.user || access.role !== "owner_admin") { res.status(403).json({ error: "Samo vlasnik ili administrator može upravljati osobljem." }); return; }
  try {
    const [staff] = await db.insert(educationCenterStaffTable).values({
      centerId: params.data.centerId, userId: body.data.userId, role: body.data.role,
      instructorProfileId: body.data.instructorProfileId ?? null,
    }).returning();
    res.status(201).json(CreateEducationCenterOperationalStaffResponse.parse(staffView(staff!)));
  } catch { res.status(409).json({ error: "Članstvo već postoji ili edukator već ima aktivan centar." }); }
});

router.patch("/education/operations/centers/:centerId/staff/:staffId", async (req, res): Promise<void> => {
  const params = UpdateEducationCenterOperationalStaffParams.safeParse(req.params);
  const body = UpdateEducationCenterOperationalStaffBody.safeParse(req.body);
  if (!params.success || !body.success) { invalid(res, (!params.success ? params.error : body.error!).message); return; }
  const access = await centerRole(req, params.data.centerId);
  if (!access.user || access.role !== "owner_admin") { res.status(403).json({ error: "Samo vlasnik ili administrator može upravljati osobljem." }); return; }
  try {
    const [staff] = await db.transaction(async (tx) => {
      await lockEducationScheduleResources(tx, educatorCalendarMutationResources(params.data.centerId, params.data.staffId));
      return tx.update(educationCenterStaffTable).set({ ...body.data, updatedAt: new Date() })
        .where(and(eq(educationCenterStaffTable.id, params.data.staffId), eq(educationCenterStaffTable.centerId, params.data.centerId))).returning();
    });
    if (!staff) { res.status(404).json({ error: "Član osoblja nije pronađen u ovom centru." }); return; }
    res.json(UpdateEducationCenterOperationalStaffResponse.parse(staffView(staff)));
  } catch { res.status(409).json({ error: "Edukator već ima aktivan centar." }); }
});

router.get("/education/operations/centers/:centerId/educators/:staffId/weekly-availability", async (req, res): Promise<void> => {
  const parsed = ListEducationEducatorWeeklyAvailabilityParams.safeParse(req.params);
  if (!parsed.success) { invalid(res, parsed.error.message); return; }
  const target = await operationalEducator(req, parsed.data.centerId, parsed.data.staffId, "view");
  if (!target.access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!target.access.role || !target.allowed) { res.status(403).json({ error: "Pristup centru nije dozvoljen." }); return; }
  if (!target.staff) { res.status(404).json({ error: "Edukator nije pronađen u ovom centru." }); return; }
  const rows = await db.select().from(educationEducatorWeeklyAvailabilityTable)
    .where(eq(educationEducatorWeeklyAvailabilityTable.staffId, target.staff.id));
  res.json(ListEducationEducatorWeeklyAvailabilityResponse.parse(rows.map(({ id, staffId, weekday, startTime, endTime }) => ({ id, staffId, weekday, startTime, endTime }))));
});

router.post("/education/operations/centers/:centerId/educators/:staffId/weekly-availability", async (req, res): Promise<void> => {
  const params = CreateEducationEducatorWeeklyAvailabilityParams.safeParse(req.params);
  const body = CreateEducationEducatorWeeklyAvailabilityBody.safeParse(req.body);
  if (!params.success || !body.success) { invalid(res, (!params.success ? params.error : body.error!).message); return; }
  if (body.data.startTime >= body.data.endTime) { invalid(res, "Vreme početka mora biti pre vremena završetka."); return; }
  const target = await operationalEducator(req, params.data.centerId, params.data.staffId, "create");
  if (!target.access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!target.access.role || !target.allowed) { res.status(403).json({ error: "Nemate pravo da kreirate blok za ovog edukatora." }); return; }
  if (!target.staff) { res.status(404).json({ error: "Edukator nije pronađen u ovom centru." }); return; }
  try {
    const [row] = await db.transaction(async (tx) => {
      await lockEducationScheduleResources(tx, educatorCalendarMutationResources(params.data.centerId, target.staff!.id));
      return tx.insert(educationEducatorWeeklyAvailabilityTable).values({ staffId: target.staff!.id, ...body.data }).returning();
    });
    res.status(201).json(CreateEducationEducatorWeeklyAvailabilityResponse.parse(row));
  } catch { res.status(409).json({ error: "Ovaj nedeljni blok već postoji." }); }
});

router.patch("/education/operations/centers/:centerId/educators/:staffId/weekly-availability/:availabilityId", async (req, res): Promise<void> => {
  const params = UpdateEducationEducatorWeeklyAvailabilityParams.safeParse(req.params);
  const body = UpdateEducationEducatorWeeklyAvailabilityBody.safeParse(req.body);
  if (!params.success || !body.success) { invalid(res, (!params.success ? params.error : body.error!).message); return; }
  if (body.data.startTime >= body.data.endTime) { invalid(res, "Vreme početka mora biti pre vremena završetka."); return; }
  const target = await operationalEducator(req, params.data.centerId, params.data.staffId, "mutate");
  if (!target.access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!target.access.role || !target.allowed) { res.status(403).json({ error: "Nemate pravo da menjate blok ovog edukatora." }); return; }
  if (!target.staff) { res.status(404).json({ error: "Edukator nije pronađen u ovom centru." }); return; }
  const [row] = await db.transaction(async (tx) => {
    await lockEducationScheduleResources(tx, educatorCalendarMutationResources(params.data.centerId, target.staff!.id));
    return tx.update(educationEducatorWeeklyAvailabilityTable).set({ ...body.data, updatedAt: new Date() }).where(and(
      eq(educationEducatorWeeklyAvailabilityTable.id, params.data.availabilityId), eq(educationEducatorWeeklyAvailabilityTable.staffId, target.staff!.id),
    )).returning();
  });
  if (!row) { res.status(404).json({ error: "Blok dostupnosti nije pronađen." }); return; }
  res.json(UpdateEducationEducatorWeeklyAvailabilityResponse.parse(row));
});

router.delete("/education/operations/centers/:centerId/educators/:staffId/weekly-availability/:availabilityId", async (req, res): Promise<void> => {
  const params = DeleteEducationEducatorWeeklyAvailabilityParams.safeParse(req.params);
  if (!params.success) { invalid(res, params.error.message); return; }
  const target = await operationalEducator(req, params.data.centerId, params.data.staffId, "mutate");
  if (!target.access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!target.access.role || !target.allowed) { res.status(403).json({ error: "Nemate pravo da brišete blok ovog edukatora." }); return; }
  if (!target.staff) { res.status(404).json({ error: "Edukator nije pronađen u ovom centru." }); return; }
  const [row] = await db.transaction(async (tx) => {
    await lockEducationScheduleResources(tx, educatorCalendarMutationResources(params.data.centerId, target.staff!.id));
    return tx.delete(educationEducatorWeeklyAvailabilityTable).where(and(eq(educationEducatorWeeklyAvailabilityTable.id, params.data.availabilityId), eq(educationEducatorWeeklyAvailabilityTable.staffId, target.staff!.id))).returning();
  });
  if (!row) { res.status(404).json({ error: "Blok dostupnosti nije pronađen." }); return; }
  res.status(204).send();
});

router.get("/education/operations/centers/:centerId/educators/:staffId/absences", async (req, res): Promise<void> => {
  const parsed = ListEducationEducatorAbsencesParams.safeParse(req.params);
  if (!parsed.success) { invalid(res, parsed.error.message); return; }
  const target = await operationalEducator(req, parsed.data.centerId, parsed.data.staffId, "view");
  if (!target.access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!target.access.role || !target.allowed) { res.status(403).json({ error: "Pristup centru nije dozvoljen." }); return; }
  if (!target.staff) { res.status(404).json({ error: "Edukator nije pronađen u ovom centru." }); return; }
  const rows = await db.select().from(educationEducatorAbsencesTable).where(eq(educationEducatorAbsencesTable.staffId, target.staff.id));
  res.json(ListEducationEducatorAbsencesResponse.parse(rows));
});

router.post("/education/operations/centers/:centerId/educators/:staffId/absences/preview", async (req, res): Promise<void> => {
  const params = PreviewEducationEducatorAbsenceParams.safeParse(req.params);
  const body = PreviewEducationEducatorAbsenceBody.safeParse(req.body);
  if (!params.success || !body.success) { invalid(res, (!params.success ? params.error : body.error!).message); return; }
  try { assertBelgradeDate(body.data.startDate); assertBelgradeDate(body.data.endDate); } catch (error) { invalid(res, error instanceof Error ? error.message : "Datum nije ispravan."); return; }
  if (body.data.endDate < body.data.startDate || !validWallClockRange(body.data.startTime ?? null, body.data.endTime ?? null)) { invalid(res, "Opseg odsustva nije ispravan."); return; }
  const target = await operationalEducator(req, params.data.centerId, params.data.staffId, "create");
  if (!target.access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!target.access.role || !target.allowed) { res.status(403).json({ error: "Nemate pravo da kreirate odsustvo ovog edukatora." }); return; }
  if (!target.staff) { res.status(404).json({ error: "Edukator nije pronađen u ovom centru." }); return; }
  const conflicts = await educationAbsenceConflicts({
    centerId: params.data.centerId, educatorStaffId: target.staff.id, ...body.data,
  });
  res.json(PreviewEducationEducatorAbsenceResponse.parse({
    canCreate: conflicts.length === 0,
    conflicts: conflicts.map((row) => ({ ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() })),
  }));
});

router.post("/education/operations/centers/:centerId/educators/:staffId/absences", async (req, res): Promise<void> => {
  const params = CreateEducationEducatorAbsenceParams.safeParse(req.params);
  const body = CreateEducationEducatorAbsenceBody.safeParse(req.body);
  if (!params.success || !body.success) { invalid(res, (!params.success ? params.error : body.error!).message); return; }
  try { assertBelgradeDate(body.data.startDate); assertBelgradeDate(body.data.endDate); } catch (error) { invalid(res, error instanceof Error ? error.message : "Datum nije ispravan."); return; }
  if (body.data.endDate < body.data.startDate || !validWallClockRange(body.data.startTime ?? null, body.data.endTime ?? null)) { invalid(res, "Opseg odsustva nije ispravan."); return; }
  const target = await operationalEducator(req, params.data.centerId, params.data.staffId, "create");
  if (!target.access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!target.access.role || !target.allowed) { res.status(403).json({ error: "Nemate pravo da kreirate odsustvo ovog edukatora." }); return; }
  if (!target.staff) { res.status(404).json({ error: "Edukator nije pronađen u ovom centru." }); return; }
  let rows: Array<typeof educationEducatorAbsencesTable.$inferSelect>;
  try {
    rows = await db.transaction(async (tx) => {
      await lockEducationScheduleResources(tx, educatorCalendarMutationResources(params.data.centerId, target.staff!.id));
      const conflicts = await educationAbsenceConflicts({
        centerId: params.data.centerId, educatorStaffId: target.staff!.id, ...body.data, store: tx,
      });
      if (conflicts.length) throw new Error("ABSENCE_SESSION_CONFLICT");
      return tx.insert(educationEducatorAbsencesTable).values({ staffId: target.staff!.id, ...body.data }).returning();
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ABSENCE_SESSION_CONFLICT") {
      res.status(409).json({ error: "Odsustvo se ne može potvrditi dok edukator ima aktivne termine u izabranom periodu. Prvo zamenite edukatora ili otkažite termine." });
      return;
    }
    throw error;
  }
  const [row] = rows;
  res.status(201).json(CreateEducationEducatorAbsenceResponse.parse(row));
});

router.patch("/education/operations/centers/:centerId/educators/:staffId/absences/:absenceId", async (req, res): Promise<void> => {
  const params = UpdateEducationEducatorAbsenceParams.safeParse(req.params);
  const body = UpdateEducationEducatorAbsenceBody.safeParse(req.body);
  if (!params.success || !body.success) { invalid(res, (!params.success ? params.error : body.error!).message); return; }
  try { assertBelgradeDate(body.data.startDate); assertBelgradeDate(body.data.endDate); } catch (error) { invalid(res, error instanceof Error ? error.message : "Datum nije ispravan."); return; }
  if (body.data.endDate < body.data.startDate || !validWallClockRange(body.data.startTime ?? null, body.data.endTime ?? null)) { invalid(res, "Opseg odsustva nije ispravan."); return; }
  const target = await operationalEducator(req, params.data.centerId, params.data.staffId, "mutate");
  if (!target.access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!target.access.role || !target.allowed) { res.status(403).json({ error: "Nemate pravo da menjate odsustvo ovog edukatora." }); return; }
  if (!target.staff) { res.status(404).json({ error: "Edukator nije pronađen u ovom centru." }); return; }
  let rows: Array<typeof educationEducatorAbsencesTable.$inferSelect>;
  try {
    rows = await db.transaction(async (tx) => {
      await lockEducationScheduleResources(tx, educatorCalendarMutationResources(params.data.centerId, target.staff!.id));
      const conflicts = await educationAbsenceConflicts({
        centerId: params.data.centerId, educatorStaffId: target.staff!.id, ...body.data, store: tx,
      });
      if (conflicts.length) throw new Error("ABSENCE_SESSION_CONFLICT");
      return tx.update(educationEducatorAbsencesTable).set(body.data).where(and(
        eq(educationEducatorAbsencesTable.id, params.data.absenceId), eq(educationEducatorAbsencesTable.staffId, target.staff!.id),
      )).returning();
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ABSENCE_SESSION_CONFLICT") {
      res.status(409).json({ error: "Odsustvo se ne može potvrditi dok edukator ima aktivne termine u izabranom periodu. Prvo zamenite edukatora ili otkažite termine." });
      return;
    }
    throw error;
  }
  const [row] = rows;
  if (!row) { res.status(404).json({ error: "Odsustvo nije pronađeno." }); return; }
  res.json(UpdateEducationEducatorAbsenceResponse.parse(row));
});

router.delete("/education/operations/centers/:centerId/educators/:staffId/absences/:absenceId", async (req, res): Promise<void> => {
  const params = DeleteEducationEducatorAbsenceParams.safeParse(req.params);
  if (!params.success) { invalid(res, params.error.message); return; }
  const target = await operationalEducator(req, params.data.centerId, params.data.staffId, "mutate");
  if (!target.access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!target.access.role || !target.allowed) { res.status(403).json({ error: "Nemate pravo da brišete odsustvo ovog edukatora." }); return; }
  if (!target.staff) { res.status(404).json({ error: "Edukator nije pronađen u ovom centru." }); return; }
  const [row] = await db.transaction(async (tx) => {
    await lockEducationScheduleResources(tx, educatorCalendarMutationResources(params.data.centerId, target.staff!.id));
    return tx.delete(educationEducatorAbsencesTable).where(and(eq(educationEducatorAbsencesTable.id, params.data.absenceId), eq(educationEducatorAbsencesTable.staffId, target.staff!.id))).returning();
  });
  if (!row) { res.status(404).json({ error: "Odsustvo nije pronađeno." }); return; }
  res.status(204).send();
});

async function recurrencePreviewFacts(course: typeof coursesTable.$inferSelect, input: {
  educatorStaffId: string; weekdays: number[]; startTime: string; endTime: string; durationMinutes: number; granularityMinutes?: number; startDate: string; endDate: string;
}, store: any = db) {
  if (!course.centerId || course.schedulingMode !== "individual_calendar") throw new Error("Kurs ne koristi individualni kalendar.");
  if (input.startTime >= input.endTime) throw new Error("Vreme početka mora biti pre vremena završetka.");
  const dates = recurrenceDates(input.startDate, input.endDate, input.weekdays);
  // Convert every requested boundary before querying availability: this rejects
  // non-existent Belgrade wall-clock times during the spring DST transition.
  for (const date of dates) { educationBelgradeInstant(date, input.startTime); educationBelgradeInstant(date, input.endTime); }
  const slots = await educationCanonicalAvailability({
    centerId: course.centerId, educatorStaffId: input.educatorStaffId, dates, durationMinutes: input.durationMinutes,
    granularityMinutes: input.granularityMinutes, store,
  });
  // A recurrence window is packed with deterministic, non-overlapping
  // occurrences. The availability engine exposes every grid start, but those
  // grid points are alternatives—not simultaneous sessions to insert.
  const expected = dates.flatMap((date) => {
    const result: Array<{ date: string; startTime: string }> = [];
    let minutes = Number(input.startTime.slice(0, 2)) * 60 + Number(input.startTime.slice(3));
    const end = Number(input.endTime.slice(0, 2)) * 60 + Number(input.endTime.slice(3));
    const granularity = input.granularityMinutes ?? 15;
    const cadence = Math.ceil(input.durationMinutes / granularity) * granularity;
    while (minutes + input.durationMinutes <= end) {
      result.push({ date, startTime: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}` });
      minutes += cadence;
    }
    return result;
  });
  const slotsByStart = new Map(
    slots
      .filter((slot) => slot.startTime >= input.startTime && slot.endTime <= input.endTime)
      .map((slot) => [`${slot.date}:${slot.startTime}`, slot] as const),
  );
  const candidates = expected.flatMap((requested) => {
    const slot = slotsByStart.get(`${requested.date}:${requested.startTime}`);
    return slot ? [{ date: slot.date, startTime: slot.startTime, endTime: slot.endTime }] : [];
  });
  const available = new Set(candidates.map((item) => `${item.date}:${item.startTime}`));
  const absences = await store.select().from(educationEducatorAbsencesTable)
    .where(eq(educationEducatorAbsencesTable.staffId, input.educatorStaffId));
  const assignments = await store.select({ startsAt: courseSessionsTable.startsAt, endsAt: courseSessionsTable.endsAt })
    .from(educationSessionEducatorsTable)
    .innerJoin(courseSessionsTable, eq(courseSessionsTable.id, educationSessionEducatorsTable.sessionId))
    .where(and(eq(educationSessionEducatorsTable.staffId, input.educatorStaffId), isNull(courseSessionsTable.cancelledAt)));
  let skippedAbsenceCount = 0; let skippedConflictCount = 0;
  for (const requested of expected.filter((item) => !available.has(`${item.date}:${item.startTime}`))) {
    const absence = absences.some((row: typeof educationEducatorAbsencesTable.$inferSelect) => row.startDate <= requested.date && row.endDate >= requested.date
      && (!row.startTime || (requested.startTime >= row.startTime && requested.startTime < row.endTime!)));
    if (absence) skippedAbsenceCount++; else skippedConflictCount++;
  }
  return { dates, candidates, skippedAbsenceCount, skippedConflictCount, assignments };
}

router.post("/education/operations/courses/:courseId/recurrence/preview", async (req, res): Promise<void> => {
  const params = PreviewEducationCourseRecurrenceParams.safeParse(req.params);
  const body = PreviewEducationCourseRecurrenceBody.safeParse(req.body);
  if (!params.success || !body.success) { invalid(res, (!params.success ? params.error : body.error!).message); return; }
  const [course] = await db.select().from(coursesTable).where(and(eq(coursesTable.id, params.data.courseId), eq(coursesTable.published, true), eq(coursesTable.archived, false))).limit(1);
  if (!course?.centerId) { res.status(404).json({ error: "Kurs nije pronađen." }); return; }
  const target = await operationalEducator(req, course.centerId, body.data.educatorStaffId, "create");
  if (!target.access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!target.access.role || !target.allowed) { res.status(403).json({ error: "Nemate pravo na kalendar kursa." }); return; }
  if (!target.staff) { res.status(404).json({ error: "Edukator nije pronađen u centru." }); return; }
  try {
    const facts = await recurrencePreviewFacts(course, body.data);
    res.json(PreviewEducationCourseRecurrenceResponse.parse({ timeZone: "Europe/Belgrade", candidates: facts.candidates, skippedAbsenceCount: facts.skippedAbsenceCount, skippedConflictCount: facts.skippedConflictCount }));
  } catch (error) { invalid(res, error instanceof Error ? error.message : "Raspored nije ispravan."); }
});

router.post("/education/operations/courses/:courseId/recurrence/commit", async (req, res): Promise<void> => {
  const params = CommitEducationCourseRecurrenceParams.safeParse(req.params);
  const body = CommitEducationCourseRecurrenceBody.safeParse(req.body);
  const headers = CommitEducationCourseRecurrenceHeader.safeParse({ "Idempotency-Key": requestValue(req.headers["idempotency-key"]) });
  if (!params.success) { invalid(res, params.error.message); return; }
  if (!body.success) { invalid(res, body.error.message); return; }
  if (!headers.success) { invalid(res, headers.error.message); return; }
  const [course] = await db.select().from(coursesTable).where(and(
    eq(coursesTable.id, params.data.courseId),
    eq(coursesTable.published, true),
    eq(coursesTable.archived, false),
  )).limit(1);
  if (!course?.centerId) { res.status(404).json({ error: "Kurs nije pronađen." }); return; }
  const target = await operationalEducator(req, course.centerId, body.data.educatorStaffId, "create");
  if (!target.access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!target.access.role || !target.allowed) { res.status(403).json({ error: "Nemate pravo na kalendar kursa." }); return; }
  if (!target.staff) { res.status(404).json({ error: "Edukator nije pronađen u centru." }); return; }
  try {
    const dateList = recurrenceDates(body.data.startDate, body.data.endDate, body.data.weekdays);
    const fingerprint = createHash("sha256").update(JSON.stringify(body.data)).digest("hex");
    const result = await db.transaction(async (tx) => {
      await lockEducationScheduleResources(tx, dateList.map((date) => ({ centerId: course.centerId!, date, educatorStaffId: target.staff!.id })));
      const [existing] = await tx.select().from(educationRecurrenceCommandsTable).where(and(
        eq(educationRecurrenceCommandsTable.actorUserId, target.access.user!.id),
        eq(educationRecurrenceCommandsTable.idempotencyKey, headers.data["Idempotency-Key"]),
      )).limit(1);
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        return { ...existing.responseSnapshot, replayed: true };
      }
      // The lock serializes all competing educator writes. Re-read canonical
      // availability only after it is held, so a concurrent commit cannot retain
      // stale preview candidates.
      const facts = await recurrencePreviewFacts(course, body.data, tx);
      const created = [];
      for (const candidate of facts.candidates) {
        const startsAt = educationBelgradeInstant(candidate.date, candidate.startTime);
        const endsAt = educationBelgradeInstant(candidate.date, candidate.endTime);
        const [conflict] = await tx.select({ id: courseSessionsTable.id })
          .from(educationSessionEducatorsTable)
          .innerJoin(courseSessionsTable, eq(courseSessionsTable.id, educationSessionEducatorsTable.sessionId))
          .where(and(
            eq(educationSessionEducatorsTable.staffId, target.staff!.id),
            isNull(courseSessionsTable.cancelledAt),
            sql`${courseSessionsTable.startsAt} < ${endsAt}`,
            sql`${courseSessionsTable.endsAt} > ${startsAt}`,
          ))
          .limit(1);
        if (conflict) throw new Error("OVERLAP");
        const [session] = await tx.insert(courseSessionsTable).values({
          courseId: course.id, startsAt, endsAt,
          capacity: body.data.capacity ?? 1, minimumEnrollments: body.data.minimumEnrollments ?? null,
        }).returning();
        await tx.insert(educationSessionEducatorsTable).values({ sessionId: session!.id, staffId: target.staff!.id, assignedByUserId: target.access.user!.id });
        created.push(session!.id);
      }
      const snapshot = { sessionIds: created, replayed: false };
      if (body.data.minimumEnrollmentRiskDeadline !== undefined) {
        await tx.update(coursesTable).set({
          minimumEnrollmentRiskDeadline: body.data.minimumEnrollmentRiskDeadline ?? null,
          updatedAt: new Date(),
        }).where(eq(coursesTable.id, course.id));
      }
      await tx.insert(educationRecurrenceCommandsTable).values({
        centerId: course.centerId!, actorUserId: target.access.user!.id, idempotencyKey: headers.data["Idempotency-Key"],
        requestFingerprint: fingerprint, responseSnapshot: snapshot,
      });
      return snapshot;
    });
    res.status(201).json(CommitEducationCourseRecurrenceResponse.parse(result));
  } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Termin više nije dostupan." }); }
});

router.get("/education/courses/:courseId/availability", async (req, res): Promise<void> => {
  const params = GetEducationCourseAvailabilityParams.safeParse(req.params);
  const query = GetEducationCourseAvailabilityQueryParams.safeParse(req.query);
  if (!params.success) { invalid(res, params.error.message); return; }
  if (!query.success) { invalid(res, query.error.message); return; }
  try { if (query.data.date) assertBelgradeDate(query.data.date); } catch (error) { invalid(res, error instanceof Error ? error.message : "Invalid date."); return; }
  const [course] = await db.select().from(coursesTable).where(and(
    eq(coursesTable.id, params.data.courseId),
    eq(coursesTable.published, true),
    eq(coursesTable.archived, false),
  )).limit(1);
  if (!course?.centerId) { res.status(404).json({ error: "Kurs nije pronađen." }); return; }
  // Booking always targets an actual session.  Exposing those public-safe IDs
  // avoids clients guessing staff IDs or synthesising a session from a slot.
  const sessions = await db.select({
    id: courseSessionsTable.id, startsAt: courseSessionsTable.startsAt, endsAt: courseSessionsTable.endsAt,
    capacity: courseSessionsTable.capacity, reservedSeats: courseSessionsTable.reservedSeats,
    educatorStaffId: educationSessionEducatorsTable.staffId,
  }).from(courseSessionsTable)
    .leftJoin(educationSessionEducatorsTable, eq(educationSessionEducatorsTable.sessionId, courseSessionsTable.id))
    .where(and(eq(courseSessionsTable.courseId, course.id), isNull(courseSessionsTable.cancelledAt),
      gte(courseSessionsTable.startsAt, new Date()),
      query.data.educatorStaffId ? eq(educationSessionEducatorsTable.staffId, query.data.educatorStaffId) : undefined))
    .orderBy(courseSessionsTable.startsAt);
  const publicSlots = sessions
    .map((session) => ({ session, date: sessionDay(session.startsAt), endTime: sessionTime(session.endsAt), startTime: sessionTime(session.startsAt) }))
    .filter(({ date }) => !query.data.date || date === query.data.date)
    .map(({ session, date, startTime, endTime }) => ({
      sessionId: session.id, date, startTime, endTime, educatorStaffId: session.educatorStaffId,
    }));
  const next = sessions.find((session) => !query.data.date || sessionDay(session.startsAt) === query.data.date);
  const occupancy = next?.reservedSeats ?? 0;
  const capacity = next?.capacity ?? null;
  const freeSeats = capacity === null ? null : Math.max(0, capacity - occupancy);
  const [operationalQueue] = next ? await db.select({ count: sql<number>`count(*)::int` })
    .from(educationBookingParticipantsTable)
    .innerJoin(educationBookingGroupsTable, eq(educationBookingGroupsTable.id, educationBookingParticipantsTable.bookingGroupId))
    .where(and(eq(educationBookingGroupsTable.sessionId, next.id), eq(educationBookingParticipantsTable.status, "waitlisted"))) : [];
  res.json(GetEducationCourseAvailabilityResponse.parse({
    timeZone: "Europe/Belgrade", occupancy, capacity, freeSeats,
    waitlistOpen: capacity !== null && (freeSeats === 0 || (operationalQueue?.count ?? 0) > 0), lastSpots: freeSeats !== null && freeSeats > 0 && freeSeats <= 3,
    nextAvailable: publicSlots[0] ?? null, slots: publicSlots,
  }));
});

router.get("/education/operations/bookings", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  // The participant join is deliberately only an authorization selector. The
  // resulting groups are de-duplicated before their identity-bearing view is
  // materialized, including when the purchaser is also a participant.
  const groups = await db.selectDistinct({ group: educationBookingGroupsTable }).from(educationBookingGroupsTable)
    .leftJoin(educationBookingParticipantsTable, eq(educationBookingParticipantsTable.bookingGroupId, educationBookingGroupsTable.id))
    .where(or(
      eq(educationBookingGroupsTable.purchaserId, user.id),
      eq(educationBookingParticipantsTable.userId, user.id),
    ))
    .orderBy(desc(educationBookingGroupsTable.createdAt));
  const views = await Promise.all(groups.map(({ group }) => customerBookingView(group, user.id)));
  res.json(ListMyEducationOperationalBookingsResponse.parse(views));
});

router.get("/education/operations/bookings/:bookingGroupId", async (req, res): Promise<void> => {
  const params = GetMyEducationOperationalBookingParams.safeParse(req.params);
  if (!params.success) { invalid(res, params.error.message); return; }
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  const [group] = await db.select({ group: educationBookingGroupsTable }).from(educationBookingGroupsTable)
    .where(eq(educationBookingGroupsTable.id, params.data.bookingGroupId)).limit(1);
  // Return 404 for unauthorized IDs, avoiding cross-customer group discovery.
  if (!group) { res.status(404).json({ error: "Rezervacija nije pronađena." }); return; }
  const [named] = await db.select({ id: educationBookingParticipantsTable.id }).from(educationBookingParticipantsTable)
    .where(and(eq(educationBookingParticipantsTable.bookingGroupId, group.group.id), eq(educationBookingParticipantsTable.userId, user.id))).limit(1);
  const staff = await centerRole(req, group.group.centerId);
  if (group.group.purchaserId !== user.id && !named && !staff.role) { res.status(404).json({ error: "Rezervacija nije pronađena." }); return; }
  res.json(GetMyEducationOperationalBookingResponse.parse(await customerBookingView(group.group, user.id, Boolean(staff.role))));
});

function icsEscape(value: string) { return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1"); }
function icsLocal(value: Date) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const x = (t: Intl.DateTimeFormatPartTypes) => p.find((v) => v.type === t)?.value ?? "00";
  return `${x("year")}${x("month")}${x("day")}T${x("hour")}${x("minute")}${x("second")}`;
}

router.get("/education/operations/bookings/:bookingGroupId/calendar.ics", async (req, res): Promise<void> => {
  const params = DownloadEducationOperationalBookingCalendarParams.safeParse(req.params);
  if (!params.success) { invalid(res, params.error.message); return; }
  const user = await getCurrentUser(req); if (!user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  const [group] = await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, params.data.bookingGroupId)).limit(1);
  if (!group) { res.status(404).json({ error: "Rezervacija nije pronađena." }); return; }
  const [named] = await db.select({ id: educationBookingParticipantsTable.id }).from(educationBookingParticipantsTable).where(and(eq(educationBookingParticipantsTable.bookingGroupId, group.id), eq(educationBookingParticipantsTable.userId, user.id))).limit(1);
  const staff = await centerRole(req, group.centerId);
  if (group.purchaserId !== user.id && !named && !staff.role) { res.status(404).json({ error: "Rezervacija nije pronađena." }); return; }
  const [[course], [session], participants] = await Promise.all([
    db.select().from(coursesTable).where(eq(coursesTable.id, group.courseId)).limit(1),
    group.sessionId ? db.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, group.sessionId)).limit(1) : Promise.resolve([]),
    db.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.bookingGroupId, group.id)),
  ]);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LUMERA//Education//SR", "CALSCALE:GREGORIAN", "BEGIN:VTIMEZONE", "TZID:Europe/Belgrade", "END:VTIMEZONE"];
  const visibleParticipants = group.purchaserId === user.id || staff.role
    ? participants
    : participants.filter((participant) => participant.userId === user.id);
  if (course && session && !session.cancelledAt) for (const participant of visibleParticipants) lines.push("BEGIN:VEVENT", `UID:education-${group.id}-${participant.id}-${session.id}@lumera`, `DTSTAMP:${icsLocal(new Date())}Z`, "DTSTART;TZID=Europe/Belgrade:" + icsLocal(session.startsAt), "DTEND;TZID=Europe/Belgrade:" + icsLocal(session.endsAt), `SUMMARY:${icsEscape(course.title)}`, `DESCRIPTION:${icsEscape(`Edukacija za ${participant.fullName}`)}`, "END:VEVENT");
  lines.push("END:VCALENDAR");
  res.type("text/calendar; charset=utf-8").send(`${lines.join("\r\n")}\r\n`);
});

async function attendanceScope(req: Request, centerId: string, sessionId: string, participantId: string) {
  const access = await centerRole(req, centerId);
  if (!access.user || !access.role) return { access, session: null, allowed: false };
  const [session] = await db.select().from(courseSessionsTable).innerJoin(coursesTable, eq(coursesTable.id, courseSessionsTable.courseId))
    .where(and(eq(courseSessionsTable.id, sessionId), eq(coursesTable.centerId, centerId))).limit(1);
  if (!session) return { access, session: null, allowed: false };
  const [participant] = await db.select({ id: educationBookingParticipantsTable.id }).from(educationBookingParticipantsTable)
    .innerJoin(educationBookingGroupsTable, eq(educationBookingGroupsTable.id, educationBookingParticipantsTable.bookingGroupId))
    .where(and(eq(educationBookingParticipantsTable.id, participantId), eq(educationBookingGroupsTable.centerId, centerId), eq(educationBookingGroupsTable.sessionId, sessionId))).limit(1);
  if (!participant) return { access, session: null, allowed: false };
  if (access.role !== "educator") return { access, session: session.course_sessions, allowed: true };
  const [assignment] = await db.select().from(educationSessionEducatorsTable).innerJoin(educationCenterStaffTable, eq(educationCenterStaffTable.id, educationSessionEducatorsTable.staffId))
    .where(and(eq(educationSessionEducatorsTable.sessionId, sessionId), eq(educationCenterStaffTable.userId, access.user.id), eq(educationCenterStaffTable.centerId, centerId), eq(educationCenterStaffTable.active, true))).limit(1);
  return { access, session: session.course_sessions, allowed: Boolean(assignment) };
}

router.get("/education/operations/centers/:centerId/sessions/:sessionId/attendance/:participantId", async (req, res): Promise<void> => {
  const params = GetEducationOperationalAttendanceParams.safeParse(req.params);
  if (!params.success) { invalid(res, params.error.message); return; }
  const scope = await attendanceScope(req, params.data.centerId, params.data.sessionId, params.data.participantId);
  if (!scope.access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!scope.session) { res.status(404).json({ error: "Polaznik ili termin nije pronađen." }); return; }
  if (!scope.allowed) { res.status(403).json({ error: "Nemate pravo na evidenciju prisustva." }); return; }
  const [row] = await db.select().from(educationAttendanceTable).where(and(eq(educationAttendanceTable.sessionId, params.data.sessionId), eq(educationAttendanceTable.participantId, params.data.participantId))).limit(1);
  if (!row) { res.status(404).json({ error: "Prisustvo nije evidentirano." }); return; }
  res.json(GetEducationOperationalAttendanceResponse.parse({ ...row, recordedAt: row.recordedAt.toISOString() }));
});

router.put("/education/operations/centers/:centerId/sessions/:sessionId/attendance/:participantId", async (req, res): Promise<void> => {
  const params = UpsertEducationOperationalAttendanceParams.safeParse(req.params); const body = UpsertEducationOperationalAttendanceBody.safeParse(req.body);
  if (!params.success || !body.success) { invalid(res, (!params.success ? params.error : body.error!).message); return; }
  const scope = await attendanceScope(req, params.data.centerId, params.data.sessionId, params.data.participantId);
  if (!scope.access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!scope.session) { res.status(404).json({ error: "Polaznik ili termin nije pronađen." }); return; }
  if (!scope.allowed) { res.status(403).json({ error: "Nemate pravo na evidenciju prisustva." }); return; }
  const occurredAt = body.data.occurredAt ? new Date(body.data.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime()) || occurredAt > new Date() || occurredAt < scope.session.startsAt || occurredAt > scope.session.endsAt) { invalid(res, "Vreme prisustva mora pripadati završenom terminu."); return; }
  const row = await db.transaction(async (tx) => {
    const [attendance] = await tx.insert(educationAttendanceTable).values({ participantId: params.data.participantId, sessionId: params.data.sessionId, status: body.data.status, recordedByUserId: scope.access.user!.id, recordedAt: occurredAt })
      .onConflictDoUpdate({ target: [educationAttendanceTable.participantId, educationAttendanceTable.sessionId], set: { status: body.data.status, recordedByUserId: scope.access.user!.id, recordedAt: occurredAt } }).returning();
    const [enrollment] = await tx.select({ id: courseEnrollmentsTable.id }).from(courseEnrollmentsTable)
      .where(eq(courseEnrollmentsTable.participantId, params.data.participantId)).limit(1);
    if (enrollment) await reconcileOperationalEducationEnrollmentInTx(tx, enrollment.id);
    return attendance!;
  });
  res.json(UpsertEducationOperationalAttendanceResponse.parse({ ...row, recordedAt: row.recordedAt.toISOString() }));
});

router.patch("/education/operations/centers/:centerId/sessions/:sessionId/educator", async (req, res): Promise<void> => {
  const params = SubstituteEducationSessionEducatorParams.safeParse(req.params); const body = SubstituteEducationSessionEducatorBody.safeParse(req.body);
  if (!params.success || !body.success) { invalid(res, (!params.success ? params.error : body.error!).message); return; }
  const access = await centerRole(req, params.data.centerId);
  if (!access.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!access.role) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  if (!["owner_admin", "manager_reception"].includes(access.role)) { res.status(403).json({ error: "Samo vlasnik ili menadžer može zameniti edukatora." }); return; }
  try {
    const assignment = await db.transaction(async (tx) => {
      const [sessionPreview] = await tx.select().from(courseSessionsTable).innerJoin(coursesTable, eq(coursesTable.id, courseSessionsTable.courseId)).where(and(eq(courseSessionsTable.id, params.data.sessionId), eq(coursesTable.centerId, params.data.centerId))).limit(1);
      const [currentPreview] = await tx.select().from(educationSessionEducatorsTable).where(eq(educationSessionEducatorsTable.sessionId, params.data.sessionId)).limit(1);
      if (!sessionPreview || !currentPreview) throw new Error("NOT_FOUND");
      await lockEducationScheduleResources(tx, [
        ...sessionLockResources(params.data.centerId, sessionPreview.course_sessions.startsAt, sessionPreview.course_sessions.endsAt, currentPreview.staffId),
        ...sessionLockResources(params.data.centerId, sessionPreview.course_sessions.startsAt, sessionPreview.course_sessions.endsAt, body.data.educatorStaffId),
      ]);
      const [session] = await tx.select().from(courseSessionsTable).innerJoin(coursesTable, eq(coursesTable.id, courseSessionsTable.courseId)).where(and(eq(courseSessionsTable.id, params.data.sessionId), eq(coursesTable.centerId, params.data.centerId))).for("update").limit(1);
      if (!session || session.course_sessions.cancelledAt) throw new Error("NOT_FOUND");
      const [current] = await tx.select().from(educationSessionEducatorsTable).where(eq(educationSessionEducatorsTable.sessionId, params.data.sessionId)).for("update").limit(1);
      const [replacement] = await tx.select().from(educationCenterStaffTable).where(and(eq(educationCenterStaffTable.id, body.data.educatorStaffId), eq(educationCenterStaffTable.centerId, params.data.centerId), eq(educationCenterStaffTable.role, "educator"), eq(educationCenterStaffTable.active, true))).for("update").limit(1);
      if (!current || !replacement) throw new Error("NOT_FOUND");
      const conflicts = await tx.select({ id: courseSessionsTable.id }).from(educationSessionEducatorsTable).innerJoin(courseSessionsTable, eq(courseSessionsTable.id, educationSessionEducatorsTable.sessionId)).where(and(eq(educationSessionEducatorsTable.staffId, replacement.id), isNull(courseSessionsTable.cancelledAt), sql`${courseSessionsTable.id} <> ${params.data.sessionId}`, sql`${courseSessionsTable.startsAt} < ${session.course_sessions.endsAt} and ${courseSessionsTable.endsAt} > ${session.course_sessions.startsAt}`)).limit(1);
      if (conflicts.length) throw new Error("OVERLAP");
      if (await educationEducatorHasAbsenceOverlap({
        educatorStaffId: replacement.id,
        startsAt: session.course_sessions.startsAt,
        endsAt: session.course_sessions.endsAt,
        store: tx,
      })) throw new Error("ABSENCE");
      await tx.update(educationSessionEducatorsTable).set({ staffId: replacement.id, assignedByUserId: access.user!.id, assignedAt: new Date() }).where(eq(educationSessionEducatorsTable.sessionId, params.data.sessionId));
      const participants = await tx.select({ id: educationBookingParticipantsTable.id }).from(educationBookingParticipantsTable).innerJoin(educationBookingGroupsTable, eq(educationBookingGroupsTable.id, educationBookingParticipantsTable.bookingGroupId)).where(eq(educationBookingGroupsTable.sessionId, params.data.sessionId));
      for (const p of participants) await tx.insert(educationOutboxTable).values({ centerId: params.data.centerId, sessionId: params.data.sessionId, participantId: p.id, eventType: "session_educator_substituted", dedupeKey: `education-substitute:${params.data.sessionId}:${p.id}:${replacement.id}`, payload: { oldEducatorStaffId: current.staffId, newEducatorStaffId: replacement.id } }).onConflictDoNothing();
      return { sessionId: params.data.sessionId, educatorStaffId: replacement.id };
    });
    res.json(SubstituteEducationSessionEducatorResponse.parse(assignment));
  } catch (error) { if (error instanceof Error && error.message === "NOT_FOUND") { res.status(404).json({ error: "Termin ili edukator nije pronađen." }); return; } if (error instanceof Error && error.message === "OVERLAP") { res.status(409).json({ error: "Edukator je zauzet u ovom terminu." }); return; } if (error instanceof Error && error.message === "ABSENCE") { res.status(409).json({ error: "Edukator je odsutan u ovom terminu." }); return; } throw error; }
});

router.post("/education/operations/centers/:centerId/sessions/:sessionId/cancel", async (req, res): Promise<void> => {
  const params = CancelEducationOperationalSessionParams.safeParse(req.params); const body = CancelEducationOperationalSessionBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) { invalid(res, (!params.success ? params.error : body.error!).message); return; }
  const access = await centerRole(req, params.data.centerId);
  if (!access.user || !access.role) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  try {
    const [joined] = await db.select().from(courseSessionsTable).innerJoin(coursesTable, eq(coursesTable.id, courseSessionsTable.courseId))
      .where(and(eq(courseSessionsTable.id, params.data.sessionId), eq(coursesTable.centerId, params.data.centerId))).limit(1);
    if (!joined) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
    const [assignment] = await db.select().from(educationSessionEducatorsTable)
      .where(eq(educationSessionEducatorsTable.sessionId, params.data.sessionId)).limit(1);
    if (access.role === "educator") {
      const [staff] = await db.select({ id: educationCenterStaffTable.id }).from(educationCenterStaffTable).where(and(
        eq(educationCenterStaffTable.centerId, params.data.centerId),
        eq(educationCenterStaffTable.userId, access.user.id),
        eq(educationCenterStaffTable.role, "educator"),
        eq(educationCenterStaffTable.active, true),
      )).limit(1);
      if (!staff || assignment?.staffId !== staff.id) { res.status(403).json({ error: "Niste dodeljeni ovom terminu." }); return; }
    }
    const result = await cancelEducationSession(
      params.data.sessionId,
      access.user.id,
      body.data.reason ?? "Centar je otkazao termin",
      { allowAlreadyCancelled: true, centerCaused: true, source: "operational" },
    );
    res.json(CancelEducationOperationalSessionResponse.parse({
      sessionId: result.sessionId,
      cancelledParticipants: result.cancelledParticipants,
      cancelledEnrollments: result.cancelledEnrollments,
      refundAmount: result.refundAmount,
    }));
  } catch (error) {
    if (error instanceof Error && error.message === "Termin nije pronađen.") { res.status(404).json({ error: "Termin nije pronađen." }); return; }
    if (error instanceof Error && error.message === "PAYOUT") { res.status(409).json({ error: "Povraćaj nije dozvoljen nakon isplate." }); return; }
    throw error;
  }
});

router.get("/education/operations/bookings/:bookingGroupId/installments/:installmentNumber/ips-qr", async (req, res): Promise<void> => {
  const params = GetEducationOperationalInstallmentIpsQrParams.safeParse(req.params);
  if (!params.success) { invalid(res, params.error.message); return; }
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  const [group] = await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, params.data.bookingGroupId)).limit(1);
  if (!group) { res.status(404).json({ error: "Rezervacija nije pronađena." }); return; }
  const role = await centerRole(req, group.centerId);
  const canManagePayments = role.role === "owner_admin" || role.role === "manager_reception";
  if (group.purchaserId !== user.id && !canManagePayments) { res.status(404).json({ error: "Rezervacija nije pronađena." }); return; }
  const [snapshot] = await db.select().from(educationPriceSnapshotsTable)
    .where(eq(educationPriceSnapshotsTable.bookingGroupId, group.id)).limit(1);
  const [installment] = snapshot ? await db.select().from(educationInstallmentsTable).where(and(
    eq(educationInstallmentsTable.priceSnapshotId, snapshot.id),
    eq(educationInstallmentsTable.installmentNumber, params.data.installmentNumber),
    eq(educationInstallmentsTable.status, "pending"),
  )).limit(1) : [];
  if (!installment) { res.status(404).json({ error: "Dospela rata nije pronađena." }); return; }
  try {
    const settings = await getEducationPlatformSettings();
    res.json(GetEducationOperationalInstallmentIpsQrResponse.parse(educationIpsQrPayload({
      recipientName: settings.ipsRecipientName, recipientAccount: settings.ipsRecipientAccount,
      purpose: settings.ipsPurpose, amount: installment.amount, reference: installment.paymentReference,
    })));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error && error.message === "IPS_PAYMENT_ACCOUNT_NOT_CONFIGURED"
      ? "IPS račun primaoca nije podešen od administratora." : "IPS podaci za uplatu nisu ispravni." });
  }
});

router.get("/education/operations/bookings/:bookingGroupId/payment-plan", async (req, res): Promise<void> => {
  const params = GetEducationOperationalPaymentPlanParams.safeParse(req.params);
  if (!params.success) { invalid(res, params.error.message); return; }
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  const [group] = await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, params.data.bookingGroupId)).limit(1);
  if (!group) { res.status(404).json({ error: "Plan plaćanja nije pronađen." }); return; }
  const role = await centerRole(req, group.centerId);
  const canManagePayments = role.role === "owner_admin" || role.role === "manager_reception";
  if (group.purchaserId !== user.id && !canManagePayments) { res.status(404).json({ error: "Plan plaćanja nije pronađen." }); return; }
  const [snapshot] = await db.select().from(educationPriceSnapshotsTable).where(eq(educationPriceSnapshotsTable.bookingGroupId, group.id)).limit(1);
  if (!snapshot) { res.status(404).json({ error: "Plan plaćanja nije pronađen." }); return; }
  const installments = await db.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, snapshot.id)).orderBy(educationInstallmentsTable.installmentNumber);
  const { capturedAmount, refundedAmount, netPaidAmount, outstandingAmount } = operationalPaymentTotals(snapshot.grossAmount, installments);
  const paymentStatus = refundedAmount === capturedAmount && capturedAmount > 0 ? "refunded" : capturedAmount === snapshot.grossAmount ? "paid" : capturedAmount > 0 ? "partial" : "pending";
  res.json(GetEducationOperationalPaymentPlanResponse.parse({
    bookingGroupId: group.id, grossAmount: snapshot.grossAmount, capturedAmount, refundedAmount, netPaidAmount, outstandingAmount,
    paymentStatus,
    installments: installments.map((row) => ({ installmentNumber: row.installmentNumber, amount: row.amount, paymentReference: row.paymentReference, status: row.status === "cancelled" ? "pending" : row.status })),
  }));
});

router.get("/admin/education/installments", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!isAdmin(user)) { res.status(403).json({ error: "Administratorski pristup je obavezan." }); return; }
  const query = ListAdminEducationInstallmentsQueryParams.safeParse(req.query);
  if (!query.success) { invalid(res, query.error.message); return; }
  const rows = await db.select({
    id: educationInstallmentsTable.id, installmentNumber: educationInstallmentsTable.installmentNumber, amount: educationInstallmentsTable.amount,
    status: educationInstallmentsTable.status, paymentReference: educationInstallmentsTable.paymentReference, settledAt: educationInstallmentsTable.settledAt,
    bookingGroupId: educationBookingGroupsTable.id, centerId: educationBookingGroupsTable.centerId,
    dueAt: educationInstallmentsTable.dueAt, courseTitle: coursesTable.title,
    customerFirstName: usersTable.firstName, customerLastName: usersTable.lastName,
  }).from(educationInstallmentsTable).innerJoin(educationPriceSnapshotsTable, eq(educationPriceSnapshotsTable.id, educationInstallmentsTable.priceSnapshotId))
    .innerJoin(educationBookingGroupsTable, eq(educationBookingGroupsTable.id, educationPriceSnapshotsTable.bookingGroupId))
    .innerJoin(coursesTable, eq(coursesTable.id, educationBookingGroupsTable.courseId))
    .innerJoin(usersTable, eq(usersTable.id, educationBookingGroupsTable.purchaserId))
    .where(and(query.data.status ? eq(educationInstallmentsTable.status, query.data.status) : undefined, query.data.reference ? eq(educationInstallmentsTable.paymentReference, query.data.reference) : undefined))
    .orderBy(educationInstallmentsTable.createdAt).limit(500);
  res.json(ListAdminEducationInstallmentsResponse.parse(rows.map((row) => ({
    ...row,
    customerName: `${row.customerFirstName} ${row.customerLastName}`.trim(),
    dueAt: row.dueAt?.toISOString() ?? null, settledAt: row.settledAt?.toISOString() ?? null,
  }))));
});

router.post("/admin/education/installments/:installmentId/settle", async (req, res): Promise<void> => {
  const params = SettleAdminEducationInstallmentParams.safeParse(req.params);
  const header = SettleAdminEducationInstallmentHeader.safeParse({ "Idempotency-Key": requestValue(req.headers["idempotency-key"]) });
  if (!params.success || !header.success) { invalid(res, (!params.success ? params.error : header.error!).message); return; }
  const admin = await getCurrentUser(req);
  if (!admin) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (!isAdmin(admin)) { res.status(403).json({ error: "Administratorski pristup je obavezan." }); return; }
  const fingerprint = operationFingerprint({ installmentId: params.data.installmentId });
  try {
    const settled = await db.transaction(async (tx) => {
      const [preview] = await tx.select({ centerId: educationBookingGroupsTable.centerId }).from(educationInstallmentsTable)
        .innerJoin(educationPriceSnapshotsTable, eq(educationPriceSnapshotsTable.id, educationInstallmentsTable.priceSnapshotId))
        .innerJoin(educationBookingGroupsTable, eq(educationBookingGroupsTable.id, educationPriceSnapshotsTable.bookingGroupId))
        .where(eq(educationInstallmentsTable.id, params.data.installmentId)).limit(1);
      if (!preview) throw new Error("NOT_FOUND");
      await lockEducationBillingRules(tx, "shared");
      await lockEducationCenterFinancials(tx, preview.centerId);
      const [receipt] = await tx.select().from(educationInstallmentSettlementCommandsTable).where(and(
        eq(educationInstallmentSettlementCommandsTable.actorUserId, admin.id),
        eq(educationInstallmentSettlementCommandsTable.idempotencyKey, header.data["Idempotency-Key"]),
      )).for("update").limit(1);
      if (receipt) {
        if (receipt.requestFingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        return { ...(receipt.responseSnapshot as { installmentId: string; paymentReference: string; amount: number; capturedAmount: number; paymentStatus: "partial" | "paid" }), replayed: true };
      }
      const [installment] = await tx.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.id, params.data.installmentId)).for("update").limit(1);
      if (!installment || installment.status !== "pending") throw new Error("NOT_PENDING");
      const [snapshot] = await tx.select().from(educationPriceSnapshotsTable).where(eq(educationPriceSnapshotsTable.id, installment.priceSnapshotId)).for("update").limit(1);
      if (!snapshot) throw new Error("NOT_FOUND");
      const all = await tx.select().from(educationInstallmentsTable).where(eq(educationInstallmentsTable.priceSnapshotId, snapshot.id)).for("update");
      const previouslyCaptured = all.filter((row) => row.status === "settled").reduce((sum, row) => sum + row.amount, 0);
      const capturedAmount = previouslyCaptured + installment.amount;
      if (capturedAmount > snapshot.grossAmount) throw new Error("CAPTURE_EXCEEDS_GROSS");
      const paymentStatus = capturedAmount === snapshot.grossAmount ? "paid" as const : "partial" as const;
      const response = { installmentId: installment.id, paymentReference: installment.paymentReference, amount: installment.amount, capturedAmount, paymentStatus };
      await tx.update(educationInstallmentsTable).set({ status: "settled", settledByUserId: admin.id, settledAt: new Date() })
        .where(and(eq(educationInstallmentsTable.id, installment.id), eq(educationInstallmentsTable.status, "pending")));
      const linkedEnrollments = await tx.select({
        enrollment: courseEnrollmentsTable, participantStatus: educationBookingParticipantsTable.status,
      }).from(courseEnrollmentsTable).innerJoin(educationBookingParticipantsTable, eq(
        educationBookingParticipantsTable.id, courseEnrollmentsTable.participantId,
      )).where(eq(courseEnrollmentsTable.bookingGroupId, snapshot.bookingGroupId)).for("update");
      const now = new Date();
      // The first trusted capture grants course access only to seats actually
      // reserved. Waitlisted attendees retain their pending entitlement.
      for (const row of linkedEnrollments.filter((row) => row.participantStatus === "reserved")) {
        await tx.update(courseEnrollmentsTable).set({
          status: "active", paymentStatus: paymentStatus === "paid" ? "paid" : "pending",
          accessGrantedAt: row.enrollment.accessGrantedAt ?? now, updatedAt: now,
        }).where(eq(courseEnrollmentsTable.id, row.enrollment.id));
      }
      if (linkedEnrollments.some((row) => row.participantStatus === "reserved")) {
        await tx.update(educationBookingGroupsTable).set({ status: "active", updatedAt: now })
          .where(and(eq(educationBookingGroupsTable.id, snapshot.bookingGroupId), eq(educationBookingGroupsTable.status, "pending")));
      }
      // Split every captured component in stable participant order. The final
      // net residual makes each participant slice and the installment itself
      // balance exactly despite integer rounding.
      const financialEnrollments = linkedEnrollments
        .filter((row) => row.participantStatus === "reserved" || row.participantStatus === "waitlisted")
        .sort((a, b) => a.enrollment.participantId!.localeCompare(b.enrollment.participantId!));
      if (financialEnrollments.length) {
        const split = (amount: number) => {
          const base = Math.floor(amount / financialEnrollments.length);
          const remainder = amount % financialEnrollments.length;
          return financialEnrollments.map((_row, index) => base + (index < remainder ? 1 : 0));
        };
        const installmentFee = Math.floor(capturedAmount * snapshot.platformFee / snapshot.grossAmount)
          - Math.floor(previouslyCaptured * snapshot.platformFee / snapshot.grossAmount);
        const installmentReserve = Math.floor(capturedAmount * snapshot.reserveAmount / snapshot.grossAmount)
          - Math.floor(previouslyCaptured * snapshot.reserveAmount / snapshot.grossAmount);
        const grossSlices = split(installment.amount);
        const feeSlices = split(installmentFee);
        const reserveSlices = split(installmentReserve);
        for (const [index, row] of financialEnrollments.entries()) {
          const gross = grossSlices[index]!;
          const fee = feeSlices[index]!;
          const reserve = reserveSlices[index]!;
          const net = gross - fee - reserve;
          const [existingEscrow] = await tx.select().from(educationEscrowsTable)
            .where(eq(educationEscrowsTable.enrollmentId, row.enrollment.id)).for("update").limit(1);
          const escrow = existingEscrow
            ? (await tx.update(educationEscrowsTable).set({
                grossAmount: existingEscrow.grossAmount + gross, platformFee: existingEscrow.platformFee + fee,
                reserveAmount: existingEscrow.reserveAmount + reserve, netAmount: existingEscrow.netAmount + net, updatedAt: now,
              }).where(eq(educationEscrowsTable.id, existingEscrow.id)).returning())[0]!
            : (await tx.insert(educationEscrowsTable).values({
                enrollmentId: row.enrollment.id, centerId: preview.centerId, grossAmount: gross, platformFee: fee,
                reserveAmount: reserve, netAmount: net, releaseAt: new Date(now.getTime() + 7 * 86_400_000),
                paymentReference: installment.paymentReference,
              }).returning())[0]!;
          await tx.insert(educationLedgerEntriesTable).values([
            { escrowId: escrow.id, enrollmentId: row.enrollment.id, centerId: preview.centerId, type: "charge", amount: gross, actorUserId: admin.id, idempotencyKey: `installment:${installment.id}:enrollment:${row.enrollment.id}:charge` },
            { escrowId: escrow.id, enrollmentId: row.enrollment.id, centerId: preview.centerId, type: "platform_fee", amount: -fee, actorUserId: admin.id, idempotencyKey: `installment:${installment.id}:enrollment:${row.enrollment.id}:fee` },
            { escrowId: escrow.id, enrollmentId: row.enrollment.id, centerId: preview.centerId, type: "reserve_hold", amount: -reserve, actorUserId: admin.id, idempotencyKey: `installment:${installment.id}:enrollment:${row.enrollment.id}:reserve` },
          ]).onConflictDoNothing();
          await tx.insert(educationFinancialEventsTable).values({
            escrowId: escrow.id, enrollmentId: row.enrollment.id, actorUserId: admin.id, eventType: "installment_settled_manual",
            nextStatus: "held", amount: gross, metadata: { installmentId: installment.id, paymentReference: installment.paymentReference, platformFee: fee, reserveAmount: reserve, netAmount: net },
          });
        }
      }
      for (const row of linkedEnrollments.filter((item) => item.participantStatus === "reserved")) {
        await reconcileOperationalEducationEnrollmentInTx(tx, row.enrollment.id);
      }
      await tx.insert(educationInstallmentSettlementCommandsTable).values({
        installmentId: installment.id, actorUserId: admin.id, idempotencyKey: header.data["Idempotency-Key"],
        requestFingerprint: fingerprint, responseSnapshot: response,
      });
      return { ...response, replayed: false };
    });
    res.json(SettleAdminEducationInstallmentResponse.parse(settled));
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") { res.status(404).json({ error: "Rata nije pronađena." }); return; }
    res.status(409).json({ error: error instanceof Error && error.message === "IDEMPOTENCY_MISMATCH" ? "Idempotency ključ pripada drugom zahtevu." : "Rata je već obrađena ili nije spremna za potvrdu." });
  }
});

router.post("/education/operations/bookings/:bookingGroupId/cancel", async (req, res): Promise<void> => {
  const params = CancelEducationOperationalBookingParams.safeParse(req.params);
  const requestBody = req.body ?? {};
  const body = CancelEducationOperationalBookingBody.safeParse(
    typeof requestBody.reason === "string" ? { ...requestBody, reason: requestBody.reason.trim() } : requestBody,
  );
  if (!params.success || !body.success) { invalid(res, (!params.success ? params.error : body.error!).message); return; }
  const cancellationReason = body.data.reason.trim();
  if (cancellationReason.length < 3) { invalid(res, "Razlog otkazivanja mora imati najmanje 3 znaka."); return; }
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  const [visible] = await db.select().from(educationBookingGroupsTable)
    .where(eq(educationBookingGroupsTable.id, params.data.bookingGroupId)).limit(1);
  if (!visible) { res.status(404).json({ error: "Rezervacija nije pronađena." }); return; }
  const [named] = await db.select({ id: educationBookingParticipantsTable.id }).from(educationBookingParticipantsTable)
    .where(and(eq(educationBookingParticipantsTable.bookingGroupId, visible.id), eq(educationBookingParticipantsTable.userId, user.id))).limit(1);
  const cancellationAccess = await centerRole(req, visible.centerId);
  const centerOverride = cancellationAccess.role === "owner_admin" || cancellationAccess.role === "manager_reception";
  if (visible.purchaserId !== user.id && !named && !centerOverride) { res.status(404).json({ error: "Rezervacija nije pronađena." }); return; }
  const visibleParticipants = await db.select().from(educationBookingParticipantsTable)
    .where(eq(educationBookingParticipantsTable.bookingGroupId, visible.id));
  const visibleActive = visibleParticipants.filter((row) => row.status === "reserved" || row.status === "waitlisted");
  let visibleSelected: typeof visibleParticipants;
  try {
    visibleSelected = selectedOperationalParticipants(visibleParticipants, body.data.participantIds, user.id, visible.purchaserId, centerOverride)
      .filter((row) => row.status === "reserved" || row.status === "waitlisted");
  } catch {
    res.status(404).json({ error: "Rezervacija ili polaznik nije pronađen." }); return;
  }
  if (visibleActive.length > 1 && (visibleSelected.length !== visibleActive.length
    || visibleActive.some((row) => !visibleSelected.some((selected) => selected.id === row.id)))) {
    res.status(409).json({ code: "PARTIAL_CANCELLATION_UNSUPPORTED", error: "Delimično otkazivanje nije podržano. Kupac ili centar mora otkazati celu grupu i ponovo rezervisati mesta." }); return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [group] = await tx.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, visible.id)).for("update").limit(1);
      if (!group) throw new Error("NOT_FOUND");
      const participants = await tx.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.bookingGroupId, group.id)).for("update");
      const selected = selectedOperationalParticipants(participants, body.data.participantIds, user.id, group.purchaserId, centerOverride);
      const active = selected.filter((row) => row.status === "reserved" || row.status === "waitlisted");
      const allActive = participants.filter((row) => row.status === "reserved" || row.status === "waitlisted");
      if (allActive.length > 1 && (active.length !== allActive.length
        || allActive.some((row) => !active.some((selected) => selected.id === row.id)))) throw new Error("PARTIAL_CANCELLATION_UNSUPPORTED");
      const [snapshot] = await tx.select().from(educationPriceSnapshotsTable).where(eq(educationPriceSnapshotsTable.bookingGroupId, group.id)).for("update").limit(1);
      if (!snapshot) throw new Error("SNAPSHOT_REQUIRED");
      const [cutoff] = await tx.select({
        databaseNow: sql<Date>`current_timestamp`,
      }).from(educationPriceSnapshotsTable).where(eq(educationPriceSnapshotsTable.id, snapshot.id)).limit(1);
      // Null is the explicit legacy behavior for pre-v93 groups: retain the
      // snapshotted disposition without inventing a cutoff retroactively.
      const effectiveDisposition = operationalCancellationDisposition(
        snapshot.depositDisposition, snapshot.cancellationDeadlineAt, cutoff!.databaseNow,
      );
      // A cancellation can never refund a promise to pay. Preserve captured
      // rows for audit, and make only future pending installments unpayable.
      await tx.update(educationInstallmentsTable).set({ status: "cancelled" }).where(and(
        eq(educationInstallmentsTable.priceSnapshotId, snapshot.id),
        eq(educationInstallmentsTable.status, "pending"),
      ));
      const [course] = await tx.select().from(coursesTable).where(eq(coursesTable.id, group.courseId)).limit(1);
      if (!course) throw new Error("NOT_FOUND");
      const [session] = group.sessionId ? await tx.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, group.sessionId)).limit(1) : [];
      const [assignment] = group.sessionId ? await tx.select().from(educationSessionEducatorsTable).where(eq(educationSessionEducatorsTable.sessionId, group.sessionId)).limit(1) : [];
      if (session) await lockEducationScheduleResources(tx, sessionLockResources(group.centerId, session.startsAt, session.endsAt, assignment?.staffId));
      await lockEducationCenterFinancials(tx, group.centerId);
      if (session) await tx.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, session.id)).for("update").limit(1);
      const enrollmentRows = active.length ? await tx.select().from(courseEnrollmentsTable)
        .where(inArray(courseEnrollmentsTable.participantId, active.map((row) => row.id))).for("update") : [];
      let refundAmount = 0;
      const refundedEnrollmentIds = new Set<string>();
      for (const enrollment of enrollmentRows) {
        const [escrow] = await tx.select().from(educationEscrowsTable).where(eq(educationEscrowsTable.enrollmentId, enrollment.id)).for("update").limit(1);
        if (escrow && effectiveDisposition === "refund") {
          if (escrow.netPaidAt || escrow.reservePaidAt) throw new Error("PAYOUT_COMPLETED");
          if (["held", "ready_for_payout", "frozen"].includes(escrow.status)) {
            const amount = Math.min(escrow.grossAmount, enrollment.chargedAmount ?? escrow.grossAmount);
            const [refunded] = await tx.update(educationEscrowsTable).set({ status: "refunded", updatedAt: new Date() })
              .where(and(eq(educationEscrowsTable.id, escrow.id), inArray(educationEscrowsTable.status, ["held", "ready_for_payout", "frozen"]), isNull(educationEscrowsTable.netPaidAt), isNull(educationEscrowsTable.reservePaidAt))).returning();
            if (refunded) {
              await tx.insert(educationLedgerEntriesTable).values({ escrowId: escrow.id, enrollmentId: enrollment.id, centerId: group.centerId, type: "refund", amount: -amount, actorUserId: user.id, note: cancellationReason, idempotencyKey: `education-operational-cancel:${group.id}:escrow:${escrow.id}`, metadata: { bookingGroupId: group.id, depositDisposition: effectiveDisposition } });
              await tx.insert(educationFinancialEventsTable).values({ escrowId: escrow.id, enrollmentId: enrollment.id, actorUserId: user.id, eventType: "operational_booking_cancelled_refund", previousStatus: escrow.status, nextStatus: "refunded", amount: -amount, note: cancellationReason, metadata: { bookingGroupId: group.id } });
              refundAmount += amount;
              refundedEnrollmentIds.add(enrollment.id);
            }
          }
        } else if (escrow) {
          await tx.insert(educationFinancialEventsTable).values({ escrowId: escrow.id, enrollmentId: enrollment.id, actorUserId: user.id, eventType: `operational_booking_cancelled_${effectiveDisposition}`, previousStatus: escrow.status, nextStatus: escrow.status, amount: 0, note: cancellationReason, metadata: { bookingGroupId: group.id, depositCreditRetained: effectiveDisposition === "transfer" } });
        }
        await tx.update(courseEnrollmentsTable).set({ status: "cancelled", paymentStatus: refundedEnrollmentIds.has(enrollment.id) ? "refunded" : enrollment.paymentStatus, updatedAt: new Date() }).where(eq(courseEnrollmentsTable.id, enrollment.id));
      }
      if (active.length) await tx.update(educationBookingParticipantsTable).set({ status: "cancelled", updatedAt: new Date() }).where(inArray(educationBookingParticipantsTable.id, active.map((row) => row.id)));
      const remaining = participants.filter((row) => !active.some((item) => item.id === row.id) && row.status !== "cancelled");
      const status = remaining.length ? group.status : "cancelled";
      await tx.update(educationBookingGroupsTable).set({ status, updatedAt: new Date() }).where(eq(educationBookingGroupsTable.id, group.id));
      if (status === "cancelled") {
        // Retain the settled history and record the refunded portion; pending
        // rows were cancelled above and are never represented as a refund.
        const settledRows = await tx.select().from(educationInstallmentsTable)
          .where(and(eq(educationInstallmentsTable.priceSnapshotId, snapshot.id), eq(educationInstallmentsTable.status, "settled"))).for("update");
        const capturedAmount = settledRows.reduce((sum, row) => sum + row.amount, 0);
        if (effectiveDisposition === "refund" && capturedAmount > 0) {
          if (refundAmount !== capturedAmount) throw new Error("REFUND_INCOMPLETE");
          await tx.update(educationInstallmentsTable).set({ refundedAmount: educationInstallmentsTable.amount })
            .where(and(eq(educationInstallmentsTable.priceSnapshotId, snapshot.id), eq(educationInstallmentsTable.status, "settled")));
        }
      }
      if (session) for (const row of active.filter((item) => item.status === "reserved")) await releaseSeatAndPromoteWaiter(tx, session.id, course);
      for (const participant of active) await tx.insert(educationOutboxTable).values({ centerId: group.centerId, sessionId: group.sessionId, participantId: participant.id, eventType: "booking_cancelled", dedupeKey: `education-booking-cancel:${group.id}:${participant.id}`, payload: { bookingGroupId: group.id, participantId: participant.id, reason: cancellationReason, depositDisposition: effectiveDisposition } }).onConflictDoNothing();
      return { bookingGroupId: group.id, sessionId: group.sessionId, status, affectedParticipantIds: active.map((row) => row.id), cancelledSeats: active.filter((row) => row.status === "reserved").length, movedSeats: 0, refundAmount, depositDisposition: effectiveDisposition, replayed: active.length === 0 };
    });
    res.json(CancelEducationOperationalBookingResponse.parse(result));
  } catch (error) {
    if (error instanceof Error && ["PARTICIPANT_NOT_FOUND", "NOT_SELF_PARTICIPANT", "NOT_FOUND"].includes(error.message)) { res.status(404).json({ error: "Rezervacija ili polaznik nije pronađen." }); return; }
    if (error instanceof Error && error.message === "PARTIAL_CANCELLATION_UNSUPPORTED") { res.status(409).json({ code: "PARTIAL_CANCELLATION_UNSUPPORTED", error: "Delimično otkazivanje nije podržano. Otkažite celu grupu i ponovo rezervišite mesta." }); return; }
    if (error instanceof Error && ["SNAPSHOT_REQUIRED", "PAYOUT_COMPLETED", "REFUND_INCOMPLETE"].includes(error.message)) { res.status(409).json({ error: "Povraćaj nije dostupan za ovu rezervaciju." }); return; }
    throw error;
  }
});

router.patch("/education/operations/bookings/:bookingGroupId/reschedule", async (req, res): Promise<void> => {
  const params = RescheduleEducationOperationalBookingParams.safeParse(req.params);
  const body = RescheduleEducationOperationalBookingBody.safeParse(req.body);
  const headers = RescheduleEducationOperationalBookingHeader.safeParse({ "Idempotency-Key": requestValue(req.headers["idempotency-key"]) });
  if (!params.success) { invalid(res, params.error.message); return; }
  if (!body.success) { invalid(res, body.error.message); return; }
  if (!headers.success) { invalid(res, headers.error.message); return; }
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  const [visible] = await db.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, params.data.bookingGroupId)).limit(1);
  if (!visible) { res.status(404).json({ error: "Rezervacija nije pronađena." }); return; }
  const [named] = await db.select({ id: educationBookingParticipantsTable.id }).from(educationBookingParticipantsTable)
    .where(and(eq(educationBookingParticipantsTable.bookingGroupId, visible.id), eq(educationBookingParticipantsTable.userId, user.id))).limit(1);
  const rescheduleAccess = await centerRole(req, visible.centerId);
  const centerOverride = rescheduleAccess.role === "owner_admin" || rescheduleAccess.role === "manager_reception";
  if (visible.purchaserId !== user.id && !named && !centerOverride) { res.status(404).json({ error: "Rezervacija nije pronađena." }); return; }
  const visibleParticipants = await db.select().from(educationBookingParticipantsTable)
    .where(eq(educationBookingParticipantsTable.bookingGroupId, visible.id));
  const visibleActive = visibleParticipants.filter((row) => row.status === "reserved" || row.status === "waitlisted");
  let visibleRequested: typeof visibleParticipants;
  try {
    visibleRequested = selectedOperationalParticipants(visibleParticipants, body.data.participantIds, user.id, visible.purchaserId, centerOverride)
      .filter((row) => row.status === "reserved" || row.status === "waitlisted");
  } catch {
    res.status(404).json({ error: "Rezervacija, polaznik ili termin nije pronađen." }); return;
  }
  if (visibleActive.length > 1 && (visibleRequested.length !== visibleActive.length
    || visibleActive.some((row) => !visibleRequested.some((selected) => selected.id === row.id)))) {
    res.status(409).json({ code: "PARTIAL_RESCHEDULE_UNSUPPORTED", error: "Delimična promena termina nije podržana. Otkažite i ponovo rezervišite pojedinačna mesta." }); return;
  }
  const fingerprint = operationFingerprint({ targetSessionId: body.data.targetSessionId, participantIds: body.data.participantIds ?? null });
  const receiptKey = `education-booking-reschedule:${visible.id}:${headers.data["Idempotency-Key"]}`;
  try {
    const result = await db.transaction(async (tx) => {
      const [receipt] = await tx.select().from(educationOutboxTable).where(eq(educationOutboxTable.dedupeKey, receiptKey)).for("update").limit(1);
      if (receipt) {
        if (receipt.payload.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        return { ...(receipt.payload.result as Record<string, unknown>), replayed: true };
      }
      const [group] = await tx.select().from(educationBookingGroupsTable).where(eq(educationBookingGroupsTable.id, visible.id)).for("update").limit(1);
      if (!group?.sessionId) throw new Error("SOURCE_UNAVAILABLE");
      const [[source], [target]] = await Promise.all([
        tx.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, group.sessionId)).limit(1),
        tx.select().from(courseSessionsTable).where(and(eq(courseSessionsTable.id, body.data.targetSessionId), eq(courseSessionsTable.courseId, group.courseId))).limit(1),
      ]);
      if (!source || !target || source.id === target.id || target.cancelledAt || target.startsAt <= new Date()) throw new Error("TARGET_UNAVAILABLE");
      const [[sourceAssignment], [targetAssignment]] = await Promise.all([
        tx.select().from(educationSessionEducatorsTable).where(eq(educationSessionEducatorsTable.sessionId, source.id)).limit(1),
        tx.select().from(educationSessionEducatorsTable).where(eq(educationSessionEducatorsTable.sessionId, target.id)).limit(1),
      ]);
      await lockEducationScheduleResources(tx, [
        ...sessionLockResources(group.centerId, source.startsAt, source.endsAt, sourceAssignment?.staffId),
        ...sessionLockResources(group.centerId, target.startsAt, target.endsAt, targetAssignment?.staffId),
      ]);
      await lockEducationCenterFinancials(tx, group.centerId);
      // Row locks follow the same lexical order as advisory locks. This matters
      // when two customers exchange sessions concurrently.
      const lockedById = new Map<string, typeof courseSessionsTable.$inferSelect>();
      for (const sessionId of [...new Set([source.id, target.id])].sort()) {
        const [locked] = await tx.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, sessionId)).for("update").limit(1);
        if (locked) lockedById.set(sessionId, locked);
      }
      const lockedSource = lockedById.get(source.id);
      const lockedTarget = lockedById.get(target.id);
      if (!lockedSource || !lockedTarget || lockedTarget.cancelledAt) throw new Error("TARGET_UNAVAILABLE");
      const participants = await tx.select().from(educationBookingParticipantsTable).where(eq(educationBookingParticipantsTable.bookingGroupId, group.id)).for("update");
      const activeParticipants = participants.filter((row) => row.status === "reserved" || row.status === "waitlisted");
      const requested = selectedOperationalParticipants(participants, body.data.participantIds, user.id, group.purchaserId, centerOverride)
        .filter((row) => row.status === "reserved" || row.status === "waitlisted");
      if (activeParticipants.length > 1 && (requested.length !== activeParticipants.length
        || activeParticipants.some((row) => !requested.some((selected) => selected.id === row.id)))) throw new Error("PARTIAL_RESCHEDULE_UNSUPPORTED");
      if (!requested.length) throw new Error("SOURCE_UNAVAILABLE");
      const selected = requested;
      const [snapshot] = await tx.select().from(educationPriceSnapshotsTable).where(eq(educationPriceSnapshotsTable.bookingGroupId, group.id)).for("update").limit(1);
      if (!snapshot) throw new Error("SNAPSHOT_REQUIRED");
      const [cutoff] = await tx.select({
        databaseNow: sql<Date>`current_timestamp`,
      }).from(educationPriceSnapshotsTable).where(eq(educationPriceSnapshotsTable.id, snapshot.id)).limit(1);
      if (!operationalRescheduleAllowed(snapshot.cancellationDeadlineAt, cutoff!.databaseNow, centerOverride)) throw new Error("RESCHEDULE_CUTOFF");
      if (lockedTarget.reservedSeats + selected.length > lockedTarget.capacity) throw new Error("TARGET_CAPACITY");
      const destinationGroupId = group.id;
      const destinationStatus = group.status === "active" ? "active" : "pending";
      await tx.update(educationBookingGroupsTable).set({ sessionId: lockedTarget.id, status: destinationStatus, updatedAt: new Date() }).where(eq(educationBookingGroupsTable.id, group.id));
      await tx.update(educationBookingParticipantsTable).set({ status: "reserved", updatedAt: new Date() }).where(inArray(educationBookingParticipantsTable.id, selected.map((row) => row.id)));
      await tx.update(courseSessionsTable).set({ reservedSeats: lockedTarget.reservedSeats + selected.length }).where(eq(courseSessionsTable.id, lockedTarget.id));
      await tx.update(courseEnrollmentsTable).set({ sessionId: lockedTarget.id, bookingGroupId: destinationGroupId, updatedAt: new Date() }).where(inArray(courseEnrollmentsTable.participantId, selected.map((row) => row.id)));
      const [course] = await tx.select().from(coursesTable).where(eq(coursesTable.id, group.courseId)).limit(1);
      if (!course) throw new Error("SOURCE_UNAVAILABLE");
      for (const _participant of selected.filter((participant) => participant.status === "reserved")) {
        await releaseSeatAndPromoteWaiter(tx, lockedSource.id, course);
      }
      const result = { bookingGroupId: destinationGroupId, sessionId: lockedTarget.id, status: group.status, affectedParticipantIds: selected.map((row) => row.id), cancelledSeats: 0, movedSeats: selected.length, refundAmount: 0, depositDisposition: snapshot.depositDisposition, replayed: false };
      await tx.insert(educationOutboxTable).values({ centerId: group.centerId, sessionId: lockedTarget.id, eventType: "booking_rescheduled", dedupeKey: receiptKey, payload: { fingerprint, result } });
      for (const participant of selected) await tx.insert(educationOutboxTable).values({ centerId: group.centerId, sessionId: lockedTarget.id, participantId: participant.id, eventType: "booking_rescheduled", dedupeKey: `education-booking-rescheduled:${destinationGroupId}:${participant.id}:${lockedTarget.id}`, payload: { bookingGroupId: destinationGroupId, participantId: participant.id, sourceSessionId: lockedSource.id, targetSessionId: lockedTarget.id, depositDisposition: snapshot.depositDisposition } }).onConflictDoNothing();
      return result;
    });
    res.json(RescheduleEducationOperationalBookingResponse.parse(result));
  } catch (error) {
    if (error instanceof Error && ["PARTICIPANT_NOT_FOUND", "NOT_SELF_PARTICIPANT", "SOURCE_UNAVAILABLE", "TARGET_UNAVAILABLE"].includes(error.message)) { res.status(404).json({ error: "Rezervacija, polaznik ili termin nije pronađen." }); return; }
    if (error instanceof Error && error.message === "PARTIAL_RESCHEDULE_UNSUPPORTED") { res.status(409).json({ code: "PARTIAL_RESCHEDULE_UNSUPPORTED", error: "Delimična promena termina nije podržana. Otkažite i ponovo rezervišite pojedinačna mesta." }); return; }
    if (error instanceof Error && ["TARGET_CAPACITY", "SNAPSHOT_REQUIRED", "IDEMPOTENCY_MISMATCH", "RESCHEDULE_CUTOFF"].includes(error.message)) { res.status(409).json({ error: "Termin nije dostupan, rok za promenu je istekao ili idempotency ključ ne odgovara zahtevu." }); return; }
    throw error;
  }
});

router.post("/education/operations/bookings", async (req, res): Promise<void> => {
  const body = CreateEducationOperationalBookingBody.safeParse(req.body);
  const headers = CreateEducationOperationalBookingHeader.safeParse({ "Idempotency-Key": requestValue(req.headers["idempotency-key"]) });
  if (!body.success) { invalid(res, body.error.message); return; }
  if (!headers.success) { invalid(res, headers.error.message); return; }
  const [course] = await db.select().from(coursesTable).where(and(eq(coursesTable.id, body.data.courseId), eq(coursesTable.published, true), eq(coursesTable.archived, false))).limit(1);
  const [session] = await db.select().from(courseSessionsTable).where(and(eq(courseSessionsTable.id, body.data.sessionId), eq(courseSessionsTable.courseId, body.data.courseId))).limit(1);
  if (!course?.centerId || !session || session.cancelledAt) { res.status(404).json({ error: "Kurs ili termin nije pronađen." }); return; }
  const auth = await centerRole(req, course.centerId);
  if (!auth.user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  const isCenterWrite = ["owner_admin", "manager_reception"].includes(auth.role ?? "");
  // Public customers own exactly their first named seat. Center-created guests
  // are deliberately unlinked unless a future verified-account flow resolves them.
  const suppliedSelfSeats = body.data.participants.filter((participant) => participant.userId === auth.user!.id).length;
  if (!isCenterWrite && (body.data.participants.some((participant) => participant.userId && participant.userId !== auth.user!.id)
    || body.data.participants.slice(1).some((participant) => participant.userId)
    || suppliedSelfSeats > 1)) {
    res.status(403).json({ error: "Kupac ne može rezervisati mesto u ime drugog naloga." }); return;
  }
  const normalizedParticipants = body.data.participants.map((participant, index) => ({
    ...participant,
    userId: isCenterWrite ? null : index === 0 ? auth.user!.id : null,
  }));
  const normalizedInput = { ...body.data, participants: normalizedParticipants };
  const fingerprint = createHash("sha256").update(JSON.stringify(normalizedInput)).digest("hex");
  const result = await db.transaction(async (tx) => {
    const [bookingAssignment] = await tx.select().from(educationSessionEducatorsTable)
      .where(eq(educationSessionEducatorsTable.sessionId, session.id)).limit(1);
    await lockEducationScheduleResources(tx, sessionLockResources(course.centerId!, session.startsAt, session.endsAt, bookingAssignment?.staffId));
    // Scheduling locks are acquired first throughout operational mutations.
    // Within the billing domain retain global -> center order used by escrow.
    await lockEducationBillingRules(tx, "shared");
    await lockEducationCenterFinancials(tx, course.centerId!);
    const [lockedSession] = await tx.select().from(courseSessionsTable).where(eq(courseSessionsTable.id, session.id)).for("update").limit(1);
    if (!lockedSession || lockedSession.cancelledAt) throw new Error("SESSION_UNAVAILABLE");
    const [lockedCourse] = await tx.select().from(coursesTable).where(eq(coursesTable.id, course.id)).for("update").limit(1);
    if (!lockedCourse?.centerId || lockedCourse.centerId !== course.centerId) throw new Error("SESSION_UNAVAILABLE");
    // PostgreSQL's transaction clock is authoritative: a direct API request
    // must not create any commercial records once the exact slot has started.
    const started = await tx.select({ id: courseSessionsTable.id }).from(courseSessionsTable)
      .where(and(eq(courseSessionsTable.id, lockedSession.id), sql`${courseSessionsTable.startsAt} <= now()`)).limit(1);
    if (started.length) throw new Error("SESSION_STARTED");
    const [existing] = await tx.select().from(educationBookingGroupsTable).where(and(
      eq(educationBookingGroupsTable.createdByUserId, auth.user!.id), eq(educationBookingGroupsTable.idempotencyKey, headers.data["Idempotency-Key"]),
    )).limit(1);
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
      const [snapshot] = await tx.select().from(educationPriceSnapshotsTable)
        .where(eq(educationPriceSnapshotsTable.bookingGroupId, existing.id)).limit(1);
      if (!snapshot) throw new Error("SNAPSHOT_REQUIRED");
      const installments = await tx.select().from(educationInstallmentsTable)
        .where(eq(educationInstallmentsTable.priceSnapshotId, snapshot.id))
        .orderBy(educationInstallmentsTable.installmentNumber);
      return {
        group: existing,
        quote: {
          grossAmount: snapshot.grossAmount, earlyBirdApplied: snapshot.earlyBirdApplied,
          discountReason: snapshot.discountReason as "none" | "early_bird" | "group" | "early_bird_and_group",
          installments: installments.map((row) => row.amount),
        },
      };
    }
    const seats = normalizedParticipants.length;
    const installmentCount = body.data.installmentCount ?? lockedCourse.installmentCount;
    if (installmentCount > lockedCourse.installmentCount) throw new Error("INSTALLMENT_PLAN_UNAVAILABLE");
    const quote = educationOperationalPriceQuote({
      price: lockedCourse.price,
      earlyBirdPrice: lockedCourse.earlyBirdPrice,
      earlyBirdCutoff: lockedCourse.earlyBirdCutoff,
      groupDiscountMinimum: lockedCourse.groupDiscountMinimum,
      groupDiscountPercent: lockedCourse.groupDiscountPercent,
      paymentMode: lockedCourse.paymentMode,
      depositAmount: lockedCourse.depositAmount,
      installmentCount,
    }, seats, new Date());
    const active = lockedSession.reservedSeats + seats <= lockedSession.capacity;
    const [group] = await tx.insert(educationBookingGroupsTable).values({
      centerId: course.centerId!, courseId: course.id, sessionId: lockedSession.id,
      purchaserId: auth.user!.id, createdByUserId: auth.user!.id,
      idempotencyKey: headers.data["Idempotency-Key"], requestFingerprint: fingerprint, status: active ? "pending" : "waitlisted",
    }).returning();
    const participantRows = await tx.insert(educationBookingParticipantsTable).values(normalizedParticipants.map((participant) => ({
      bookingGroupId: group!.id, userId: participant.userId ?? null, fullName: participant.fullName,
      email: participant.email ?? null, phone: participant.phone ?? null, status: active ? "reserved" as const : "waitlisted" as const,
    }))).returning();
    const settings = await resolveEducationBillingSettings(lockedCourse.centerId, tx);
    const platformFee = Math.floor(quote.grossAmount * settings.effective.commissionPercent / 100);
    const reserveAmount = Math.floor(quote.grossAmount * settings.effective.reservePercent / 100);
    const [snapshot] = await tx.insert(educationPriceSnapshotsTable).values({
      bookingGroupId: group!.id, courseId: lockedCourse.id, grossAmount: quote.grossAmount,
      platformFee, reserveAmount, netAmount: quote.grossAmount - platformFee - reserveAmount,
      earlyBirdApplied: quote.earlyBirdApplied, discountReason: quote.discountReason, earlyBirdCutoffSnapshot: quote.earlyBirdCutoffSnapshot,
      installmentCount, depositDisposition: lockedCourse.depositDisposition,
      cancellationDeadlineAt: new Date(lockedSession.startsAt.getTime() - lockedCourse.cancellationDeadlineHours * 3_600_000),
    }).returning();
    if (quote.installments.length) {
      await tx.insert(educationInstallmentsTable).values(quote.installments.map((amount, index) => ({
        priceSnapshotId: snapshot!.id, installmentNumber: index + 1, amount,
        paymentReference: `EDU-${group!.id.replace(/-/g, "").slice(0, 16)}-${index + 1}`,
        dueAt: index === 0 ? group!.createdAt : new Date(lockedSession.startsAt.getTime() - (quote.installments.length - index - 1) * 30 * 86_400_000),
      })));
    }
    // A group is the commercial parent; every named seat gets one durable
    // enrollment identity, including guests. No access is granted here.
    const seatBase = Math.floor(quote.grossAmount / participantRows.length);
    const seatRemainder = quote.grossAmount % participantRows.length;
    const seatAmounts = participantRows.map((_participant, index) => seatBase + (index < seatRemainder ? 1 : 0));
    await tx.insert(courseEnrollmentsTable).values(participantRows.map((participant, index) => ({
      courseId: lockedCourse.id, userId: participant.userId, purchaserId: auth.user!.id,
      sessionId: lockedSession.id, bookingGroupId: group!.id, participantId: participant.id,
      status: "pending" as const, paymentStatus: "pending" as const, chargedAmount: seatAmounts[index],
      auditData: { source: "education-operational-booking", guest: participant.userId === null },
    })));
    if (active) await tx.update(courseSessionsTable).set({ reservedSeats: lockedSession.reservedSeats + seats }).where(eq(courseSessionsTable.id, lockedSession.id));
    const bookingEvent = active ? "booking_confirmation" : "booking_waitlisted";
    for (const participant of participantRows) await tx.insert(educationOutboxTable).values({
      centerId: course.centerId!, sessionId: lockedSession.id, participantId: participant.id, eventType: bookingEvent,
      dedupeKey: `education-booking:${group!.id}:participant:${participant.id}:${active ? "confirmation" : "waitlisted"}`,
      payload: { bookingGroupId: group!.id, courseId: course.id, sessionId: lockedSession.id, participantId: participant.id },
    }).onConflictDoNothing();
    if (bookingAssignment) await tx.insert(educationOutboxTable).values({
      centerId: course.centerId!, sessionId: lockedSession.id, eventType: `${bookingEvent}_educator`,
      dedupeKey: `education-booking:${group!.id}:educator:${bookingAssignment.staffId}:${active ? "confirmation" : "waitlisted"}`,
      payload: { bookingGroupId: group!.id, courseId: course.id, sessionId: lockedSession.id, educatorStaffId: bookingAssignment.staffId },
    }).onConflictDoNothing();
    return { group: group!, quote };
  }).catch((error: unknown) => {
    if (error instanceof Error && ["IDEMPOTENCY_MISMATCH", "SESSION_UNAVAILABLE", "SESSION_STARTED", "INSTALLMENT_PLAN_UNAVAILABLE"].includes(error.message)) return null;
    throw error;
  });
  if (!result) { res.status(409).json({ error: "Rezervacija nije dostupna ili idempotency ključ ne odgovara zahtevu." }); return; }
  res.status(201).json(CreateEducationOperationalBookingResponse.parse({
    id: result.group.id, courseId: result.group.courseId, sessionId: result.group.sessionId!, status: result.group.status,
    participantCount: body.data.participants.length, paymentStatus: "pending",
    grossAmount: result.quote.grossAmount, earlyBirdApplied: result.quote.earlyBirdApplied,
    discountReason: result.quote.discountReason,
    installments: result.quote.installments.map((amount, index) => ({
      installmentNumber: index + 1, amount,
      paymentReference: `EDU-${result.group.id.replace(/-/g, "").slice(0, 16)}-${index + 1}`, status: "pending",
    })),
  }));
});

export default router;