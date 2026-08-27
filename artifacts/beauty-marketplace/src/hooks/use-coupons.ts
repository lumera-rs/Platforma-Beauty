import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type Coupon } from "@/types/coupon";
import { getAdminGetShopSettingsQueryKey } from "@workspace/api-client-react";

export function getAdminListCouponsQueryKey() {
  return ["admin", "coupons"];
}

export function useAdminListCoupons() {
  return useQuery<Coupon[]>({
    queryKey: getAdminListCouponsQueryKey(),
    queryFn: async () => {
      const res = await fetch("/api/admin/coupons", { credentials: "include" });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Failed to fetch coupons");
      }
      return res.json();
    },
  });
}

export function useAdminCreateCoupon() {
  const qc = useQueryClient();
  return useMutation<Coupon, Error, { data: Partial<Coupon> }>({
    mutationFn: async ({ data }) => {
      const res = await fetch("/api/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Failed to create coupon");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getAdminListCouponsQueryKey() });
    },
  });
}

export function useAdminUpdateCoupon() {
  const qc = useQueryClient();
  return useMutation<Coupon, Error, { couponId: string; data: Partial<Coupon> }>({
    mutationFn: async ({ couponId, data }) => {
      const res = await fetch(`/api/admin/coupons/${couponId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Failed to update coupon");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getAdminListCouponsQueryKey() });
    },
  });
}

export function useAdminDeactivateCoupon() {
  const qc = useQueryClient();
  return useMutation<void, Error, { couponId: string }>({
    mutationFn: async ({ couponId }) => {
      const res = await fetch(`/api/admin/coupons/${couponId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Failed to deactivate coupon");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getAdminListCouponsQueryKey() });
    },
  });
}
