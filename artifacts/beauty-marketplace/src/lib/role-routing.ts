import type { UserRole } from "@workspace/api-client-react";

export const ADMIN_ROLES: UserRole[] = ["ADMIN", "SUPER_ADMIN"];
export const BUSINESS_ROLES: UserRole[] = [
  "SALON_OWNER",
  "SALON_EMPLOYEE",
  "EDUCATION_CENTER_OWNER",
  "INSTRUCTOR",
  ...ADMIN_ROLES,
];

export function homeForRole(role: UserRole): string {
  switch (role) {
    case "CUSTOMER":
      return "/moj-nalog";
    case "SALON_OWNER":
      return "/vlasnik";
    case "EDUCATION_CENTER_OWNER":
      return "/biznis";
    case "ADMIN":
    case "SUPER_ADMIN":
      return "/admin";
    case "INSTRUCTOR":
      return "/za-biznise";
    case "SALON_EMPLOYEE":
      return "/zaposleni";
    default:
      return "/";
  }
}