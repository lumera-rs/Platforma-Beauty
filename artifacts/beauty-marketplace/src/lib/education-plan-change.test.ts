import assert from "node:assert/strict";
import { educationPlanChangeSelection } from "./education-plan-change";

assert.deepEqual(educationPlanChangeSelection({
  currentCourseLimit: 30,
  targetCourseLimit: 15,
  publishedCourseCount: 1,
}), {
  requiredKeepCount: 1,
  requiresSelection: true,
}, "A lower entitlement requires selecting every currently published course even when usage is below the new cap.");

assert.deepEqual(educationPlanChangeSelection({
  currentCourseLimit: 15,
  targetCourseLimit: 30,
  publishedCourseCount: 1,
}), {
  requiredKeepCount: 1,
  requiresSelection: false,
});

assert.deepEqual(educationPlanChangeSelection({
  currentCourseLimit: 30,
  targetCourseLimit: 15,
  publishedCourseCount: 0,
}), {
  requiredKeepCount: 0,
  requiresSelection: false,
});

assert.deepEqual(educationPlanChangeSelection({
  currentCourseLimit: 5,
  targetCourseLimit: 5,
  publishedCourseCount: 6,
}), {
  requiredKeepCount: 5,
  requiresSelection: true,
});

console.log("education plan-change UI decision tests passed");