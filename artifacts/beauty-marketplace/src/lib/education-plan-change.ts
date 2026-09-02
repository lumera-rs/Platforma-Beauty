export function educationPlanChangeSelection(input: {
  currentCourseLimit: number | null | undefined;
  targetCourseLimit: number;
  publishedCourseCount: number;
}) {
  const currentLimitReduction = input.currentCourseLimit != null
    && input.targetCourseLimit < input.currentCourseLimit;
  const publishedCoursesExceedTarget = input.publishedCourseCount > input.targetCourseLimit;
  const requiredKeepCount = Math.min(input.targetCourseLimit, input.publishedCourseCount);

  return {
    requiredKeepCount,
    requiresSelection: requiredKeepCount > 0
      && (currentLimitReduction || publishedCoursesExceedTarget),
  };
}