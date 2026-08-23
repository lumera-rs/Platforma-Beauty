import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  appointmentsTable,
  db,
  employeeClockEntriesTable,
  employeesTable,
  mediaAssetsTable,
  productsTable,
  salonCustomersTable,
  salonInventoryMovementsTable,
  salonInventoryTable,
  salonNotificationsTable,
  serviceProductConsumptionsTable,
  servicesTable,
  shiftSwapRequestsTable,
  treatmentPhotosTable,
} from "@workspace/db";
import {
  CreateEmployeeShiftSwapBody,
  CreateEmployeeTreatmentPhotoBody,
  ListSalonClockEntriesQueryParams,
  PutServiceConsumptionsBody,
  RespondEmployeeShiftSwapBody,
  ReviewSalonShiftSwapBody,
  UpdateSalonClockEntryBody,
  UpdateSalonInventoryItemBody,
} from "@workspace/api-zod";
import { getCurrentUser } from "../lib/auth";
import { lockAppointmentResources } from "../lib/appointment-locks";
import { publishSalonNotificationUpdate } from "../lib/salon-notification-events";
import { effectiveLowStockThreshold, listSalonInventory, listServiceConsumptions } from "../lib/salon-inventory";
import { claimMediaReference, mediaAssetIdFromUrl, stableMediaUrl } from "./media";
import { requireSalonEmployee, requireSalonOwner } from "./marketplace";

const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Strict calendar-date check: format AND round-trip (rejects 2026-02-30). */
function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "23505"
    || (error as { cause?: { code?: string } })?.cause?.code === "23505");
}

// ─────────────────────────────────────────────────────────────────────────────
// Before/after treatment photos
// ─────────────────────────────────────────────────────────────────────────────

type PhotoRow = {
  photo: typeof treatmentPhotosTable.$inferSelect;
  assetContentHash: string | null;
  employeeName: string | null;
  appointmentDate: string | null;
  serviceName: string | null;
};

function photoResponse(row: PhotoRow) {
  return {
    id: row.photo.id,
    appointmentId: row.photo.appointmentId,
    salonCustomerId: row.photo.salonCustomerId,
    employeeId: row.photo.employeeId,
    employeeName: row.employeeName,
    kind: row.photo.kind,
    url: row.assetContentHash
      ? stableMediaUrl({ id: row.photo.mediaAssetId, contentHash: row.assetContentHash })
      : `/api/media/${row.photo.mediaAssetId}`,
    consentConfirmed: row.photo.consentConfirmed,
    createdAt: row.photo.createdAt.toISOString(),
    appointmentDate: row.appointmentDate,
    serviceName: row.serviceName,
  };
}

async function loadPhotos(where: ReturnType<typeof and>): Promise<PhotoRow[]> {
  return db.select({
    photo: treatmentPhotosTable,
    assetContentHash: mediaAssetsTable.contentHash,
    employeeName: employeesTable.name,
    appointmentDate: appointmentsTable.date,
    serviceName: servicesTable.name,
  }).from(treatmentPhotosTable)
    .leftJoin(mediaAssetsTable, eq(mediaAssetsTable.id, treatmentPhotosTable.mediaAssetId))
    .leftJoin(employeesTable, eq(employeesTable.id, treatmentPhotosTable.employeeId))
    .innerJoin(appointmentsTable, eq(appointmentsTable.id, treatmentPhotosTable.appointmentId))
    .leftJoin(servicesTable, eq(servicesTable.id, appointmentsTable.serviceId))
    .where(where)
    .orderBy(asc(treatmentPhotosTable.createdAt));
}

router.get("/employee/appointments/:appointmentId/treatment-photos", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res);
  if (!access) return;
  const appointmentId = String(req.params.appointmentId);
  if (!UUID_PATTERN.test(appointmentId)) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  const [appointment] = await db.select({ id: appointmentsTable.id }).from(appointmentsTable).where(and(
    eq(appointmentsTable.id, appointmentId),
    eq(appointmentsTable.employeeId, access.employee.id),
    eq(appointmentsTable.salonId, access.salon.id),
  )).limit(1);
  if (!appointment) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  const photos = await loadPhotos(and(eq(treatmentPhotosTable.appointmentId, appointmentId)));
  res.json(photos.map(photoResponse));
});

router.post("/employee/appointments/:appointmentId/treatment-photos", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res);
  if (!access) return;
  const appointmentId = String(req.params.appointmentId);
  if (!UUID_PATTERN.test(appointmentId)) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  const parsed = CreateEmployeeTreatmentPhotoBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (!parsed.data.consentConfirmed) {
    res.status(400).json({ error: "Fotografija se može sačuvati samo uz potvrđenu saglasnost klijenta." });
    return;
  }
  const assetId = mediaAssetIdFromUrl(parsed.data.url);
  if (!assetId) { res.status(400).json({ error: "Fotografija mora biti otpremljena kroz sistem pre čuvanja." }); return; }
  const [appointment] = await db.select().from(appointmentsTable).where(and(
    eq(appointmentsTable.id, appointmentId),
    eq(appointmentsTable.employeeId, access.employee.id),
    eq(appointmentsTable.salonId, access.salon.id),
  )).limit(1);
  if (!appointment) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  if (appointment.status !== "completed") {
    res.status(400).json({ error: "Fotografije se dodaju samo na završene termine." });
    return;
  }
  if (!appointment.salonCustomerId) {
    res.status(400).json({ error: "Termin nije povezan sa CRM profilom klijenta." });
    return;
  }
  try {
    const photoId = await db.transaction(async (tx) => {
      const [photo] = await tx.insert(treatmentPhotosTable).values({
        salonId: access.salon.id,
        salonCustomerId: appointment.salonCustomerId!,
        appointmentId: appointment.id,
        employeeId: access.employee.id,
        uploadedByUserId: access.user.id,
        kind: parsed.data.kind,
        mediaAssetId: assetId,
        consentConfirmed: true,
      }).returning({ id: treatmentPhotosTable.id });
      const claimed = await claimMediaReference({
        userId: access.user.id,
        url: parsed.data.url,
        scope: "treatment-photo",
        resourceId: photo!.id,
        visibility: "private",
      }, tx);
      if (!claimed) throw new Error("TREATMENT_PHOTO_CLAIM_FAILED");
      return photo!.id;
    });
    const [row] = await loadPhotos(and(eq(treatmentPhotosTable.id, photoId)));
    res.status(201).json(photoResponse(row!));
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "Ova fotografija je već sačuvana." });
      return;
    }
    if (error instanceof Error && error.message === "TREATMENT_PHOTO_CLAIM_FAILED") {
      res.status(409).json({ error: "Fotografija nije dostupna za povezivanje — otpremite je ponovo." });
      return;
    }
    throw error;
  }
});

router.get("/appointments/:appointmentId/treatment-photos", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Prijavite se da biste videli fotografije." }); return; }
  const appointmentId = String(req.params.appointmentId);
  if (!UUID_PATTERN.test(appointmentId)) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  const [appointment] = await db.select({ id: appointmentsTable.id }).from(appointmentsTable).where(and(
    eq(appointmentsTable.id, appointmentId),
    eq(appointmentsTable.customerId, user.id),
  )).limit(1);
  if (!appointment) { res.status(404).json({ error: "Termin nije pronađen." }); return; }
  const photos = await loadPhotos(and(eq(treatmentPhotosTable.appointmentId, appointmentId)));
  res.json(photos.map(photoResponse));
});

router.get("/salon/customers/:customerId/treatment-photos", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res);
  if (!access) return;
  const customerId = String(req.params.customerId);
  if (!UUID_PATTERN.test(customerId)) { res.status(404).json({ error: "Klijent nije pronađen." }); return; }
  const [contact] = await db.select({ id: salonCustomersTable.id }).from(salonCustomersTable).where(and(
    eq(salonCustomersTable.id, customerId),
    eq(salonCustomersTable.salonId, access.salon.id),
  )).limit(1);
  if (!contact) { res.status(404).json({ error: "Klijent nije pronađen." }); return; }
  const photos = await loadPhotos(and(eq(treatmentPhotosTable.salonCustomerId, customerId)));
  res.json(photos.map(photoResponse));
});

// ─────────────────────────────────────────────────────────────────────────────
// Service consumption mapping + salon inventory (owner)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/salon/services/:serviceId/consumptions", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res);
  if (!access) return;
  const serviceId = String(req.params.serviceId);
  if (!UUID_PATTERN.test(serviceId)) { res.status(404).json({ error: "Usluga nije pronađena." }); return; }
  const [service] = await db.select({ id: servicesTable.id }).from(servicesTable).where(and(
    eq(servicesTable.id, serviceId), eq(servicesTable.salonId, access.salon.id),
  )).limit(1);
  if (!service) { res.status(404).json({ error: "Usluga nije pronađena." }); return; }
  res.json(await listServiceConsumptions(access.salon.id, [serviceId]));
});

router.put("/salon/services/:serviceId/consumptions", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res);
  if (!access) return;
  const serviceId = String(req.params.serviceId);
  if (!UUID_PATTERN.test(serviceId)) { res.status(404).json({ error: "Usluga nije pronađena." }); return; }
  const parsed = PutServiceConsumptionsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [service] = await db.select({ id: servicesTable.id }).from(servicesTable).where(and(
    eq(servicesTable.id, serviceId), eq(servicesTable.salonId, access.salon.id),
  )).limit(1);
  if (!service) { res.status(404).json({ error: "Usluga nije pronađena." }); return; }
  const productIds = parsed.data.items.map((item) => item.productId);
  if (new Set(productIds).size !== productIds.length) {
    res.status(400).json({ error: "Isti proizvod ne može biti mapiran dva puta." });
    return;
  }
  if (productIds.length) {
    const found = await db.select({ id: productsTable.id }).from(productsTable).where(inArray(productsTable.id, productIds));
    if (found.length !== productIds.length) {
      res.status(404).json({ error: "Neki od izabranih proizvoda više ne postoje." });
      return;
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(serviceProductConsumptionsTable).where(and(
      eq(serviceProductConsumptionsTable.serviceId, serviceId),
      eq(serviceProductConsumptionsTable.salonId, access.salon.id),
    ));
    if (parsed.data.items.length) {
      await tx.insert(serviceProductConsumptionsTable).values(parsed.data.items.map((item) => ({
        salonId: access.salon.id,
        serviceId,
        productId: item.productId,
        quantityPerUse: item.quantityPerUse,
      })));
    }
  });
  res.json(await listServiceConsumptions(access.salon.id, [serviceId]));
});

router.get("/salon/inventory", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res);
  if (!access) return;
  res.json(await listSalonInventory(access.salon.id));
});

router.patch("/salon/inventory/:productId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res);
  if (!access) return;
  const productId = String(req.params.productId);
  if (!UUID_PATTERN.test(productId)) { res.status(404).json({ error: "Artikal nije pronađen u zalihama." }); return; }
  const parsed = UpdateSalonInventoryItemBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.select().from(salonInventoryTable).where(and(
    eq(salonInventoryTable.salonId, access.salon.id),
    eq(salonInventoryTable.productId, productId),
  )).limit(1);
  if (!row) { res.status(404).json({ error: "Artikal nije pronađen u zalihama." }); return; }
  await db.transaction(async (tx) => {
    const updates: Partial<typeof salonInventoryTable.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.unitContentAmount !== undefined) updates.unitContentAmount = parsed.data.unitContentAmount;
    if (parsed.data.usageUnit !== undefined) updates.usageUnit = parsed.data.usageUnit?.trim() || null;
    if (parsed.data.lowStockThreshold !== undefined) updates.lowStockThreshold = parsed.data.lowStockThreshold;
    if (parsed.data.quantity !== undefined && parsed.data.quantity !== row.quantity) {
      updates.quantity = parsed.data.quantity;
      updates.peakQuantity = Math.max(row.peakQuantity, parsed.data.quantity);
      await tx.insert(salonInventoryMovementsTable).values({
        salonId: access.salon.id,
        inventoryId: row.id,
        productId,
        type: "adjustment",
        quantityDelta: parsed.data.quantity - row.quantity,
      });
    }
    await tx.update(salonInventoryTable).set(updates).where(eq(salonInventoryTable.id, row.id));
  });
  const items = await listSalonInventory(access.salon.id);
  const item = items.find((entry) => entry.productId === productId);
  if (!item) { res.status(404).json({ error: "Artikal nije pronađen u zalihama." }); return; }
  res.json(item);
});

// ─────────────────────────────────────────────────────────────────────────────
// Employee time clock
// ─────────────────────────────────────────────────────────────────────────────

function clockEntryResponse(entry: typeof employeeClockEntriesTable.$inferSelect) {
  const end = entry.clockOutAt ?? new Date();
  return {
    id: entry.id,
    employeeId: entry.employeeId,
    clockInAt: entry.clockInAt.toISOString(),
    clockOutAt: entry.clockOutAt ? entry.clockOutAt.toISOString() : null,
    editedByOwner: entry.editedByOwner,
    note: entry.note,
    durationMinutes: Math.max(0, Math.round((end.getTime() - entry.clockInAt.getTime()) / 60000)),
  };
}

function sumMinutes(entries: (typeof employeeClockEntriesTable.$inferSelect)[], since: Date, now: Date): number {
  let total = 0;
  for (const entry of entries) {
    const start = entry.clockInAt.getTime() < since.getTime() ? since : entry.clockInAt;
    const end = entry.clockOutAt ?? now;
    if (end.getTime() > start.getTime()) total += (end.getTime() - start.getTime()) / 60000;
  }
  return Math.round(total);
}

router.get("/employee/clock", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res);
  if (!access) return;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const entries = await db.select().from(employeeClockEntriesTable).where(and(
    eq(employeeClockEntriesTable.employeeId, access.employee.id),
    or(gte(employeeClockEntriesTable.clockInAt, monthStart), isNull(employeeClockEntriesTable.clockOutAt)),
  )).orderBy(desc(employeeClockEntriesTable.clockInAt)).limit(100);
  const openEntry = entries.find((entry) => !entry.clockOutAt) ?? null;
  res.json({
    openEntry: openEntry ? clockEntryResponse(openEntry) : null,
    entries: entries.map(clockEntryResponse),
    weekMinutes: sumMinutes(entries.filter((entry) => (entry.clockOutAt ?? now) >= weekStart), weekStart, now),
    monthMinutes: sumMinutes(entries.filter((entry) => (entry.clockOutAt ?? now) >= monthStart), monthStart, now),
  });
});

router.post("/employee/clock-in", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res);
  if (!access) return;
  try {
    const [entry] = await db.insert(employeeClockEntriesTable).values({
      salonId: access.salon.id,
      employeeId: access.employee.id,
      clockInAt: new Date(),
    }).returning();
    res.status(201).json(clockEntryResponse(entry!));
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "Smena je već započeta — prvo je završite." });
      return;
    }
    throw error;
  }
});

router.post("/employee/clock-out", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res);
  if (!access) return;
  const [entry] = await db.update(employeeClockEntriesTable).set({ clockOutAt: new Date() }).where(and(
    eq(employeeClockEntriesTable.employeeId, access.employee.id),
    isNull(employeeClockEntriesTable.clockOutAt),
  )).returning();
  if (!entry) { res.status(409).json({ error: "Nema započete smene." }); return; }
  res.json(clockEntryResponse(entry));
});

router.get("/salon/clock-entries", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res);
  if (!access) return;
  const parsed = ListSalonClockEntriesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { from, to, employeeId } = parsed.data;
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) {
    res.status(400).json({ error: "Period mora imati važeći početni i krajnji datum." });
    return;
  }
  const spanDays = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000;
  if (spanDays > 92) { res.status(400).json({ error: "Period ne može biti duži od tri meseca." }); return; }
  const rangeStart = new Date(`${from}T00:00:00`);
  const rangeEnd = new Date(new Date(`${to}T00:00:00`).getTime() + 86400000);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const employees = await db.select().from(employeesTable).where(and(
    eq(employeesTable.salonId, access.salon.id),
    eq(employeesTable.active, true),
    ...(employeeId ? [eq(employeesTable.id, employeeId)] : []),
  )).orderBy(asc(employeesTable.name));
  const employeeIds = employees.map((employee) => employee.id);
  if (!employeeIds.length) { res.json([]); return; }

  const entries = await db.select().from(employeeClockEntriesTable).where(and(
    eq(employeeClockEntriesTable.salonId, access.salon.id),
    inArray(employeeClockEntriesTable.employeeId, employeeIds),
    or(
      and(gte(employeeClockEntriesTable.clockInAt, rangeStart), lt(employeeClockEntriesTable.clockInAt, rangeEnd)),
      isNull(employeeClockEntriesTable.clockOutAt),
    ),
  )).orderBy(desc(employeeClockEntriesTable.clockInAt));

  const appointmentCounts = await db.select({
    employeeId: appointmentsTable.employeeId,
    count: sql<number>`count(*)::int`,
  }).from(appointmentsTable).where(and(
    eq(appointmentsTable.salonId, access.salon.id),
    inArray(appointmentsTable.employeeId, employeeIds),
    gte(appointmentsTable.date, from),
    lte(appointmentsTable.date, to),
    inArray(appointmentsTable.status, ["pending", "confirmed", "completed"]),
  )).groupBy(appointmentsTable.employeeId);
  const countByEmployee = new Map(appointmentCounts.map((row) => [row.employeeId, row.count]));

  res.json(employees.map((employee) => {
    const own = entries.filter((entry) => entry.employeeId === employee.id);
    const open = own.find((entry) => !entry.clockOutAt) ?? null;
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      totalMinutes: sumMinutes(own, rangeStart, now),
      appointmentCount: countByEmployee.get(employee.id) ?? 0,
      openEntry: Boolean(open),
      staleOpenEntry: Boolean(open && open.clockInAt < todayStart),
      entries: own.map(clockEntryResponse),
    };
  }));
});

router.patch("/salon/clock-entries/:entryId", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res);
  if (!access) return;
  const entryId = String(req.params.entryId);
  if (!UUID_PATTERN.test(entryId)) { res.status(404).json({ error: "Evidencija nije pronađena." }); return; }
  const parsed = UpdateSalonClockEntryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [entry] = await db.select().from(employeeClockEntriesTable).where(and(
    eq(employeeClockEntriesTable.id, entryId),
    eq(employeeClockEntriesTable.salonId, access.salon.id),
  )).limit(1);
  if (!entry) { res.status(404).json({ error: "Evidencija nije pronađena." }); return; }
  const clockOutAt = new Date(parsed.data.clockOutAt);
  if (Number.isNaN(clockOutAt.getTime())) { res.status(400).json({ error: "Nevažeće vreme završetka." }); return; }
  if (clockOutAt.getTime() <= entry.clockInAt.getTime()) {
    res.status(400).json({ error: "Završetak smene mora biti posle početka." });
    return;
  }
  if (clockOutAt.getTime() > Date.now() + 5 * 60000) {
    res.status(400).json({ error: "Završetak smene ne može biti u budućnosti." });
    return;
  }
  const [updated] = await db.update(employeeClockEntriesTable).set({
    clockOutAt,
    editedByOwner: true,
    note: parsed.data.note !== undefined ? (parsed.data.note?.trim() || null) : entry.note,
  }).where(eq(employeeClockEntriesTable.id, entry.id)).returning();
  res.json(clockEntryResponse(updated!));
});

// ─────────────────────────────────────────────────────────────────────────────
// Shift swapping
// ─────────────────────────────────────────────────────────────────────────────

const requesterEmployee = alias(employeesTable, "requester_employee");
const targetEmployee = alias(employeesTable, "target_employee");

type SwapRow = {
  request: typeof shiftSwapRequestsTable.$inferSelect;
  requesterName: string;
  targetName: string;
};

function swapResponse(row: SwapRow) {
  return {
    id: row.request.id,
    requesterEmployeeId: row.request.requesterEmployeeId,
    requesterName: row.requesterName,
    targetEmployeeId: row.request.targetEmployeeId,
    targetName: row.targetName,
    swapDate: row.request.swapDate,
    note: row.request.note,
    status: row.request.status,
    colleagueRespondedAt: row.request.colleagueRespondedAt ? row.request.colleagueRespondedAt.toISOString() : null,
    ownerReviewedAt: row.request.ownerReviewedAt ? row.request.ownerReviewedAt.toISOString() : null,
    createdAt: row.request.createdAt.toISOString(),
  };
}

async function loadSwaps(where: ReturnType<typeof and>, limit = 50): Promise<SwapRow[]> {
  return db.select({
    request: shiftSwapRequestsTable,
    requesterName: requesterEmployee.name,
    targetName: targetEmployee.name,
  }).from(shiftSwapRequestsTable)
    .innerJoin(requesterEmployee, eq(requesterEmployee.id, shiftSwapRequestsTable.requesterEmployeeId))
    .innerJoin(targetEmployee, eq(targetEmployee.id, shiftSwapRequestsTable.targetEmployeeId))
    .where(where)
    .orderBy(desc(shiftSwapRequestsTable.createdAt))
    .limit(limit);
}

router.get("/employee/shift-swaps", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res);
  if (!access) return;
  const [outgoing, incoming, colleagues] = await Promise.all([
    loadSwaps(and(eq(shiftSwapRequestsTable.requesterEmployeeId, access.employee.id))),
    loadSwaps(and(eq(shiftSwapRequestsTable.targetEmployeeId, access.employee.id))),
    db.select({ id: employeesTable.id, name: employeesTable.name }).from(employeesTable).where(and(
      eq(employeesTable.salonId, access.salon.id),
      eq(employeesTable.active, true),
    )).orderBy(asc(employeesTable.name)),
  ]);
  res.json({
    outgoing: outgoing.map(swapResponse),
    incoming: incoming.map(swapResponse),
    colleagues: colleagues.filter((colleague) => colleague.id !== access.employee.id),
  });
});

router.post("/employee/shift-swaps", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res);
  if (!access) return;
  const parsed = CreateEmployeeShiftSwapBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { targetEmployeeId, swapDate } = parsed.data;
  if (!isValidIsoDate(swapDate)) { res.status(400).json({ error: "Nevažeći datum zamene." }); return; }
  const today = new Date().toISOString().slice(0, 10);
  if (swapDate < today) { res.status(400).json({ error: "Datum zamene mora biti današnji ili budući." }); return; }
  if (targetEmployeeId === access.employee.id) {
    res.status(400).json({ error: "Ne možete predložiti zamenu samom sebi." });
    return;
  }
  const [colleague] = await db.select({ id: employeesTable.id }).from(employeesTable).where(and(
    eq(employeesTable.id, targetEmployeeId),
    eq(employeesTable.salonId, access.salon.id),
    eq(employeesTable.active, true),
  )).limit(1);
  if (!colleague) { res.status(400).json({ error: "Kolega nije pronađen u vašem salonu." }); return; }
  const [open] = await db.select({ id: shiftSwapRequestsTable.id }).from(shiftSwapRequestsTable).where(and(
    eq(shiftSwapRequestsTable.requesterEmployeeId, access.employee.id),
    eq(shiftSwapRequestsTable.swapDate, swapDate),
    inArray(shiftSwapRequestsTable.status, ["pending_colleague", "pending_owner"]),
  )).limit(1);
  if (open) { res.status(409).json({ error: "Već imate otvoren zahtev za taj dan." }); return; }
  const [request] = await db.insert(shiftSwapRequestsTable).values({
    salonId: access.salon.id,
    requesterEmployeeId: access.employee.id,
    targetEmployeeId,
    swapDate,
    note: parsed.data.note?.trim() || null,
  }).returning();
  const [row] = await loadSwaps(and(eq(shiftSwapRequestsTable.id, request!.id)), 1);
  res.status(201).json(swapResponse(row!));
});

router.post("/employee/shift-swaps/:requestId/respond", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res);
  if (!access) return;
  const requestId = String(req.params.requestId);
  if (!UUID_PATTERN.test(requestId)) { res.status(404).json({ error: "Zahtev nije pronađen." }); return; }
  const parsed = RespondEmployeeShiftSwapBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [request] = await db.select().from(shiftSwapRequestsTable).where(and(
    eq(shiftSwapRequestsTable.id, requestId),
    eq(shiftSwapRequestsTable.targetEmployeeId, access.employee.id),
  )).limit(1);
  if (!request) { res.status(404).json({ error: "Zahtev nije pronađen." }); return; }
  const [updated] = await db.update(shiftSwapRequestsTable).set({
    status: parsed.data.accept ? "pending_owner" : "colleague_declined",
    colleagueRespondedAt: new Date(),
  }).where(and(
    eq(shiftSwapRequestsTable.id, request.id),
    eq(shiftSwapRequestsTable.status, "pending_colleague"),
  )).returning();
  if (!updated) { res.status(409).json({ error: "Zahtev više ne čeka vaš odgovor." }); return; }
  if (parsed.data.accept) {
    await db.insert(salonNotificationsTable).values({
      salonId: access.salon.id,
      title: "Zamena smene čeka odobrenje",
      message: `Zahtev za zamenu smene ${updated.swapDate} čeka vaše odobrenje.`,
      href: "/vlasnik/radno-vreme",
    });
    await publishSalonNotificationUpdate(access.salon.id);
  }
  const [row] = await loadSwaps(and(eq(shiftSwapRequestsTable.id, request.id)), 1);
  res.json(swapResponse(row!));
});

router.post("/employee/shift-swaps/:requestId/cancel", async (req, res): Promise<void> => {
  const access = await requireSalonEmployee(req, res);
  if (!access) return;
  const requestId = String(req.params.requestId);
  if (!UUID_PATTERN.test(requestId)) { res.status(404).json({ error: "Zahtev nije pronađen." }); return; }
  const [request] = await db.select({ id: shiftSwapRequestsTable.id }).from(shiftSwapRequestsTable).where(and(
    eq(shiftSwapRequestsTable.id, requestId),
    eq(shiftSwapRequestsTable.requesterEmployeeId, access.employee.id),
  )).limit(1);
  if (!request) { res.status(404).json({ error: "Zahtev nije pronađen." }); return; }
  const [updated] = await db.update(shiftSwapRequestsTable).set({ status: "cancelled" }).where(and(
    eq(shiftSwapRequestsTable.id, request.id),
    inArray(shiftSwapRequestsTable.status, ["pending_colleague", "pending_owner"]),
  )).returning();
  if (!updated) { res.status(409).json({ error: "Zahtev se više ne može otkazati." }); return; }
  const [row] = await loadSwaps(and(eq(shiftSwapRequestsTable.id, request.id)), 1);
  res.json(swapResponse(row!));
});

async function swapAppointmentPreviews(salonId: string, date: string, employeeIds: string[]) {
  const rows = await db.select({
    id: appointmentsTable.id,
    employeeId: appointmentsTable.employeeId,
    startTime: appointmentsTable.startTime,
    endTime: appointmentsTable.endTime,
    status: appointmentsTable.status,
    serviceName: servicesTable.name,
    customerFirstName: salonCustomersTable.firstName,
    customerLastName: salonCustomersTable.lastName,
  }).from(appointmentsTable)
    .innerJoin(servicesTable, eq(servicesTable.id, appointmentsTable.serviceId))
    .leftJoin(salonCustomersTable, eq(salonCustomersTable.id, appointmentsTable.salonCustomerId))
    .where(and(
      eq(appointmentsTable.salonId, salonId),
      eq(appointmentsTable.date, date),
      inArray(appointmentsTable.employeeId, employeeIds),
      inArray(appointmentsTable.status, ["pending", "confirmed"]),
    ))
    .orderBy(asc(appointmentsTable.startTime));
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    startTime: row.startTime,
    endTime: row.endTime,
    serviceName: row.serviceName,
    customerName: row.customerFirstName ? `${row.customerFirstName} ${row.customerLastName ?? ""}`.trim() : null,
    status: row.status,
  }));
}

router.get("/salon/shift-swaps", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res);
  if (!access) return;
  const swaps = await loadSwaps(and(eq(shiftSwapRequestsTable.salonId, access.salon.id)));
  const results = [];
  for (const row of swaps) {
    const needsPreviews = row.request.status === "pending_owner";
    const previews = needsPreviews
      ? await swapAppointmentPreviews(access.salon.id, row.request.swapDate, [row.request.requesterEmployeeId, row.request.targetEmployeeId])
      : [];
    results.push({
      request: swapResponse(row),
      requesterAppointments: previews.filter((preview) => preview.employeeId === row.request.requesterEmployeeId),
      targetAppointments: previews.filter((preview) => preview.employeeId === row.request.targetEmployeeId),
    });
  }
  res.json(results);
});

router.post("/salon/shift-swaps/:requestId/review", async (req, res): Promise<void> => {
  const access = await requireSalonOwner(req, res);
  if (!access) return;
  const requestId = String(req.params.requestId);
  if (!UUID_PATTERN.test(requestId)) { res.status(404).json({ error: "Zahtev nije pronađen." }); return; }
  const parsed = ReviewSalonShiftSwapBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [request] = await db.select().from(shiftSwapRequestsTable).where(and(
    eq(shiftSwapRequestsTable.id, requestId),
    eq(shiftSwapRequestsTable.salonId, access.salon.id),
  )).limit(1);
  if (!request) { res.status(404).json({ error: "Zahtev nije pronađen." }); return; }

  if (!parsed.data.approve) {
    const [updated] = await db.update(shiftSwapRequestsTable).set({
      status: "owner_declined",
      ownerReviewedAt: new Date(),
    }).where(and(
      eq(shiftSwapRequestsTable.id, request.id),
      eq(shiftSwapRequestsTable.status, "pending_owner"),
    )).returning();
    if (!updated) { res.status(409).json({ error: "Zahtev ne čeka odobrenje." }); return; }
  } else {
    const approved = await db.transaction(async (tx) => {
      // Serialize with booking allocation on this salon-day before reassigning.
      await lockAppointmentResources(tx, request.salonId, [{ date: request.swapDate }]);
      const [updated] = await tx.update(shiftSwapRequestsTable).set({
        status: "approved",
        ownerReviewedAt: new Date(),
      }).where(and(
        eq(shiftSwapRequestsTable.id, request.id),
        eq(shiftSwapRequestsTable.status, "pending_owner"),
      )).returning();
      if (!updated) return false;
      // Single-statement A↔B swap of that day's upcoming appointments.
      await tx.update(appointmentsTable).set({
        employeeId: sql`CASE WHEN ${appointmentsTable.employeeId} = ${request.requesterEmployeeId} THEN ${request.targetEmployeeId}::uuid ELSE ${request.requesterEmployeeId}::uuid END`,
      }).where(and(
        eq(appointmentsTable.salonId, request.salonId),
        eq(appointmentsTable.date, request.swapDate),
        inArray(appointmentsTable.employeeId, [request.requesterEmployeeId, request.targetEmployeeId]),
        inArray(appointmentsTable.status, ["pending", "confirmed"]),
      ));
      return true;
    });
    if (!approved) { res.status(409).json({ error: "Zahtev ne čeka odobrenje." }); return; }
  }
  const [row] = await loadSwaps(and(eq(shiftSwapRequestsTable.id, request.id)), 1);
  const previews = await swapAppointmentPreviews(access.salon.id, request.swapDate, [request.requesterEmployeeId, request.targetEmployeeId]);
  res.json({
    request: swapResponse(row!),
    requesterAppointments: previews.filter((preview) => preview.employeeId === request.requesterEmployeeId),
    targetAppointments: previews.filter((preview) => preview.employeeId === request.targetEmployeeId),
  });
});

export default router;
