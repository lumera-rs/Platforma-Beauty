import { useState, useEffect } from "react";

const STORAGE_KEY = "lumera_availability_view_v1";

export function useAvailabilityViewMode() {
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "list" || stored === "calendar") {
        setViewMode(stored);
      }
    } catch (e) {
      // Ignore corrupt/unavailable storage
    }
  }, []);

  const handleSetViewMode = (mode: "list" | "calendar") => {
    setViewMode(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (e) {
      // Ignore
    }
  };

  return [viewMode, handleSetViewMode] as const;
}
