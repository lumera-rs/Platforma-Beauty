import type { UserRole } from "@workspace/api-client-react";

export const ADMIN_ROLES: UserRole[] = ["ADMIN", "SUPER_ADMIN"];
export const BUSINESS_ROLES: UserRole[] = [
  "SALON_OWNER",
  "SALON_EMPLOYEE",
  "EDUKATIVNI_CENTAR",
  "INSTRUCTOR",
  ...ADMIN_ROLES,
];

export function homeForRole(role: UserRole): string {
  switch (role) {
    case "CUSTOMER":
      return "/moj-nalog";
    case "STUDENT":
      return "/student/edukacije";
    case "JOBSEEKER":
      return "/poslovi/nalog";
    case "SALON_OWNER":
      return "/vlasnik";
    case "EDUKATIVNI_CENTAR":
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

export function beautyJobCreationPathForRole(role: UserRole): string {
  switch (role) {
    case "JOBSEEKER":
      return "/poslovi/nalog/oglasi?new=1";
    case "SALON_OWNER":
    case "EDUKATIVNI_CENTAR":
    case "INSTRUCTOR":
      return "/biznis/poslovi?tab=my-jobs&new=1";
    case "ADMIN":
    case "SUPER_ADMIN":
      return "/admin/poslovi";
    case "SALON_EMPLOYEE":
      return "/zaposleni";
    default:
      return homeForRole(role);
  }
}