import { useCallback, useEffect, useState } from "react";

export type BookingDraft = {
  salonSlug: string;
  salonName: string;
  serviceId: string;
  employeeId: string | null;
  date: string;
};

function storageKey(userId: string) {
  return `lumera:booking-draft:${userId}`;
}

function readDraft(userId?: string) {
  if (!userId || typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? "null") as BookingDraft | null;
    return parsed?.salonSlug && parsed.serviceId && parsed.date ? parsed : null;
  } catch {
    return null;
  }
}

export function useBookingDraft(userId?: string) {
  const [draft, setDraft] = useState<BookingDraft | null>(() => readDraft(userId));

  useEffect(() => {
    setDraft(readDraft(userId));
  }, [userId]);

  const saveDraft = useCallback((nextDraft: BookingDraft) => {
    if (!userId || typeof window === "undefined") return;
    window.localStorage.setItem(storageKey(userId), JSON.stringify(nextDraft));
    setDraft(nextDraft);
  }, [userId]);

  const clearDraft = useCallback(() => {
    if (userId && typeof window !== "undefined") window.localStorage.removeItem(storageKey(userId));
    setDraft(null);
  }, [userId]);

  return { draft, saveDraft, clearDraft };
}