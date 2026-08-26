import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { captureReferralCode, getStoredReferralCode } from "@/lib/referral-storage";
import { validateReferralCode } from "@workspace/api-client-react";

export function useReferralCapture() {
  const searchString = useSearch();
  const [storedCode, setStoredCode] = useState<string | undefined>(getStoredReferralCode());

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(searchString);
    const code = params.get("ref") || params.get("referralCode");
    if (code) {
      void validateReferralCode(code).then((result) => {
        if (cancelled || !result.valid) return;
        captureReferralCode(result.code);
        setStoredCode(getStoredReferralCode());
      }).catch(() => {
        // Invalid or unavailable codes must not occupy the first-touch slot.
      });
    }
    return () => { cancelled = true; };
  }, [searchString]);

  return storedCode;
}