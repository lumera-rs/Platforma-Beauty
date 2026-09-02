import { educationBelgradeCalendarDayDifference, educationBelgradeDateKey } from "./education-belgrade-calendar";

type SubscriptionLike = {
  status: string;
  contractKind: string;
  paidAt: Date | null;
  currentPeriodEnd: Date | null;
  courseLimitOverride: number | null;
  currentCourseLimitSnapshot: number | null;
  pendingKeepCourseIds: string[] | null;
};

type PlanLike = {
  courseLimit: number | null;
  limits: Record<string, number>;
};

type CourseLike = {
  id: string;
  title: string;
  published: boolean;
  subscriptionSuspended: boolean;
};

export function educationGraceDaysRemaining(now: Date, graceEndsAt: Date | null): number | null {
  if (!graceEndsAt || graceEndsAt <= now) return null;
  return Math.max(0, educationBelgradeCalendarDayDifference(
    educationBelgradeDateKey(now), educationBelgradeDateKey(graceEndsAt),
  ));
}

export function educationCurrentCourseLimit(subscription: SubscriptionLike, plan: PlanLike): number {
  const raw = subscription.contractKind === "custom"
    ? subscription.courseLimitOverride
    : subscription.currentCourseLimitSnapshot;
  return Math.max(0, Math.floor(raw ?? plan.courseLimit ?? plan.limits.courses ?? 0));
}

export function educationReactivationState(input: {
  subscription: SubscriptionLike;
  plan: PlanLike;
  courses: CourseLike[];
  now: Date;
}) {
  const courseLimit = educationCurrentCourseLimit(input.subscription, input.plan);
  const publishedCount = input.courses.filter((course) => course.published).length;
  const availableCourseSlots = Math.max(0, courseLimit - publishedCount);
  const candidateCourses = input.courses
    .filter((course) => !course.published && course.subscriptionSuspended)
    .map(({ id, title }) => ({ id, title }));
  const requiredKeepCount = Math.min(candidateCourses.length, availableCourseSlots);
  const selectionRequired = candidateCourses.length > availableCourseSlots;
  const candidateIds = new Set(candidateCourses.map((course) => course.id));
  const selectedKeepCourseIds = input.subscription.pendingKeepCourseIds ?? [];
  const selectionComplete = !selectionRequired || (
    selectedKeepCourseIds.length === requiredKeepCount
    && new Set(selectedKeepCourseIds).size === selectedKeepCourseIds.length
    && selectedKeepCourseIds.every((id) => candidateIds.has(id))
  );
  const paymentReady = Boolean(
    input.subscription.paidAt
    && input.subscription.currentPeriodEnd
    && input.subscription.currentPeriodEnd > input.now,
  );
  const suspended = input.subscription.status === "suspended";
  const state = !suspended
    ? "not_needed"
    : !paymentReady
      ? "payment_required"
      : selectionComplete
        ? "ready"
        : "selection_required";

  return {
    state,
    paymentReady,
    courseLimit,
    publishedCount,
    availableCourseSlots,
    candidateCourses,
    requiredKeepCount,
    selectionRequired,
    selectionComplete,
    selectedKeepCourseIds,
  } as const;
}