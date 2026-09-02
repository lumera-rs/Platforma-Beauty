import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type Coupon } from "@/types/coupon";
import { fetchNativeJson } from "@/lib/native-fetch";
import { getAdminGetShopSettingsQueryKey } from "@workspace/api-client-react";

export function getAdminListCouponsQueryKey() {
  return ["admin", "coupons"];
}

export function useAdminListCoupons() {
  return useQuery<Coupon[]>({
    queryKey: getAdminListCouponsQueryKey(),
    queryFn: async () => {
      return fetchNativeJson<Coupon[]>("/api/admin/coupons", { credentials: "include" }, {
        httpErrorMessage: "Kuponi nisu učitani. Pokušajte ponovo.",
      });
    },
  });
}

export function useAdminCreateCoupon() {
  const qc = useQueryClient();
  return useMutation<Coupon, Error, { data: Partial<Coupon> }>({
    mutationFn: async ({ data }) => {
      return fetchNativeJson<Coupon>("/api/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      }, {
        httpErrorMessage: "Kupon nije kreiran. Pokušajte ponovo.",
      });
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
      return fetchNativeJson<Coupon>(`/api/admin/coupons/${couponId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      }, {
        httpErrorMessage: "Kupon nije izmenjen. Pokušajte ponovo.",
      });
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
      await fetchNativeJson<void>(`/api/admin/coupons/${couponId}`, {
        method: "DELETE",
        credentials: "include",
      }, {
        httpErrorMessage: "Kupon nije deaktiviran. Pokušajte ponovo.",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getAdminListCouponsQueryKey() });
    },
  });
}
